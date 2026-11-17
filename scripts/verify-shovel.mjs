import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
const browser = await chromium.launch({ executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:true,
  args:['--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({viewport:{width:850,height:850}});
  await page.route('**/favicon.ico', route => route.fulfill({ status: 204, body: '' }));
  const errors = []; page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{ if(message.type()==='error')errors.push(message.text()); });
  await page.goto('http://127.0.0.1:5173'); await page.waitForFunction(()=>window.studio?.mocapController.motions.size>0);
  await page.locator('[data-animation="shovel.001"]').click();
  await page.waitForFunction(()=>studio.mocapController.playback.name==='shovel.001');
  await page.getByRole('button',{name:'Pause animation',exact:true}).click();
  await page.evaluate(()=>studio.mocapController.seek(8));
  await page.locator('#armSoftening').uncheck();
  assert(await page.evaluate(()=>zack.geometry.attributes.armSurfaceCorrection.array.every(value=>value===0)));
  await page.locator('#armSoftening').check();
  assert(await page.evaluate(()=>zack.geometry.attributes.armSurfaceCorrection.array.some(value=>Math.abs(value)>1e-5)));
  const report = await page.evaluate(async()=>{
    const THREE=await import('/node_modules/three/build/three.module.js');
    const p=zack.geometry.attributes.position, map=new Map(),groups=[],vg=[];
    for(let i=0;i<p.count;i++){
      const key=`${p.getX(i)},${p.getY(i)},${p.getZ(i)}`;
      if(!map.has(key)){map.set(key,groups.length);groups.push({vertex:i,neighbors:new Set()});}
      vg[i]=map.get(key);
    }
    const triangles=zack.geometry.index.array;
    for(let i=0;i<triangles.length;i+=3)for(let k=0;k<3;k++){
      const a=vg[triangles[i+k]],b=vg[triangles[i+(k+1)%3]];
      if(a!==b){groups[a].neighbors.add(b);groups[b].neighbors.add(a);}
    }
    const vertex=i=>zack.mesh.getVertexPosition(i,new THREE.Vector3()).applyMatrix4(zack.mesh.matrixWorld);
    studio.mocapController.seek(8);
    const correction=zack.geometry.attributes.armSurfaceCorrection;
    const active=groups.flatMap((group,i)=>{
      const v=group.vertex;return correction.getX(v)||correction.getY(v)||correction.getZ(v)?[i]:[];
    });
    const energy=points=>active.reduce((sum,i)=>{
      const average=new THREE.Vector3();let count=0;
      for(const j of groups[i].neighbors){average.add(points[j]);count++;}
      return sum+(count?points[i].distanceToSquared(average.multiplyScalar(1/count)):0);
    },0)/active.length;
    zack.armSoftening.setEnabled(false);
    const before=groups.map(group=>vertex(group.vertex));
    const start=performance.now();zack.armSoftening.setEnabled(true);const updateMs=performance.now()-start;
    const after=groups.map(group=>vertex(group.vertex));
    const beforeEnergy=energy(before),afterEnergy=energy(after);
    const geometry=zack.geometry,influences=zack.mesh.morphTargetInfluences;
    const copy=await new THREE.ObjectLoader().parseAsync(zack.root.toJSON());copy.updateMatrixWorld(true);let mesh;
    copy.traverse(node=>{if(node.isSkinnedMesh)mesh=node});
    let exportError=0;
    for(const i of active){const v=groups[i].vertex;exportError=Math.max(exportError,vertex(v).distanceTo(mesh.getVertexPosition(v,new THREE.Vector3()).applyMatrix4(mesh.matrixWorld)));}
    const exportRestored=zack.mesh.geometry===geometry&&zack.mesh.morphTargetInfluences===influences;
    let previous,maxStep=0;
    const samples=active.filter((_,i)=>i%4===0).map(i=>groups[i].vertex);
    for(let frame=0;frame<=68;frame++){
      studio.mocapController.seek(6.3+frame*.025);
      const values=samples.map(v=>new THREE.Vector3().fromBufferAttribute(correction,v));
      if(previous)values.forEach((value,i)=>maxStep=Math.max(maxStep,value.distanceTo(previous[i])));
      previous=values;
    }
    studio.mocapController.seek(8);
    const repeat=correction.array.slice();zack.armSoftening.update();
    const repeatable=repeat.every((value,i)=>value===correction.array[i]);
    await studio.mocapController.select('static');zackRig.setPose('rest');
    const reset=correction.array.every(value=>Math.abs(value)<1e-7);
    return{beforeEnergy,afterEnergy,roughnessRatio:afterEnergy/beforeEnergy,updateMs,exportError,exportRestored,maxStep,repeatable,reset,
      vertices:geometry.attributes.position.count,triangles:geometry.index.count/3};
  });
  assert(report.afterEnergy<report.beforeEnergy,'The Shovel sleeve must become less angular');
  assert(report.exportError<1e-6&&report.exportRestored&&report.repeatable&&report.reset);
  assert(report.maxStep<.015,'The surface correction must not pop during Shovel');
  await page.evaluate(async()=>{
    await studio.mocapController.select('shovel.001');studio.mocapController.playing=false;studio.mocapController.seek(8);studio.renderer.setAnimationLoop(null);
  });
  await page.addStyleTag({content:'.properties,#timeline{display:none}.workspace{grid-template-columns:1fr}.viewer{grid-template-rows:1fr}'});
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  await mkdir('artifacts/shovel-arms/compare',{recursive:true});
  for(const time of[6.3,8])for(const enabled of[false,true]){
    await page.evaluate(async({time,enabled})=>{
      const THREE=await import('/node_modules/three/build/three.module.js');
      studio.mocapController.seek(time);zack.armSoftening.setEnabled(enabled);
      const target=zack.bones.L_Upperarm.getWorldPosition(new THREE.Vector3()).lerp(zack.bones.L_Forearm.getWorldPosition(new THREE.Vector3()),.5);
      studio.controls.minDistance=.02;studio.controls.enableDamping=false;studio.controls.target.copy(target);
      studio.camera.position.copy(target).add(new THREE.Vector3(.1,.12,.4));studio.controls.update();studio.renderer.render(studio.scene,studio.camera);
    },{time,enabled});
    await page.screenshot({path:`artifacts/shovel-arms/compare/${time}-${enabled?'on':'off'}.png`});
    if(time===8)await page.screenshot({path:`artifacts/shovel-arms/compare/8-${enabled?'on':'off'}-detail.png`,clip:{x:160,y:200,width:430,height:520}});
  }
  assert.deepEqual(errors,[]);
  await writeFile('artifacts/shovel-arms/viewer-checks.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
  console.log('Shovel passed: reduced sleeve roughness, continuous 6.3–8 second playback, checkbox A/B, reset, and native posed export.');
}finally{await browser.close();}
