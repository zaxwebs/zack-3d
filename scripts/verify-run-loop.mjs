import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
const browser = await chromium.launch({ executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,
  args:['--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({viewport:{width:1000,height:850}});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:5173');await page.waitForFunction(()=>window.studio?.mocapController.motions.size>0);
  const report = await page.evaluate(async()=>{
    const THREE=await import('/node_modules/three/build/three.module.js');
    const {prepareLoopingClip}=await import('/src/prepareLoopingClip.js');
    const c=studio.mocapController;
    const source=c.motions.get('run.001').sourceClip;
    const original=JSON.stringify(source.toJSON());
    await c.select('run.001');studio.renderer.setAnimationLoop(null);
    const clip=c.activeAction.getClip(),duration=clip.duration;
    const mainNames=['Hip','L_Thigh','R_Thigh','L_Calf','R_Calf','L_Upperarm','R_Upperarm'];
    let endpointAngle=0;
    for(const track of clip.tracks.filter(track=>track.name.endsWith('.quaternion'))){
      endpointAngle=Math.max(endpointAngle,new THREE.Quaternion().fromArray(track.values).normalize()
        .angleTo(new THREE.Quaternion().fromArray(track.values,track.values.length-4).normalize()));
    }
    c.seek(0);const initial=mainNames.map(name=>zack.bones[name].quaternion.clone().normalize());
    c.seek(1/60);const firstStep=Math.sqrt(mainNames.reduce((sum,name,i)=>sum+zack.bones[name].quaternion.clone().normalize().angleTo(initial[i])**2,0)/mainNames.length);
    c.seek(0);c.playing=true;
    const frames=[],loopFrames=[];
    for(let i=0;i<Math.ceil(duration*60*3.2);i++){
      const previous=c.activeAction.time;c.update(1/60);zack.root.updateMatrixWorld(true);
      if(c.activeAction.time<previous)loopFrames.push(i);
      frames.push({hip:zack.bones.Hip.getWorldPosition(new THREE.Vector3()).toArray(),
        q:mainNames.map(name=>zack.bones[name].quaternion.clone().normalize().toArray())});
    }
    const hipSteps=[],poseSteps=[];
    for(let i=1;i<frames.length;i++){
      hipSteps[i]=new THREE.Vector3().fromArray(frames[i].hip).distanceTo(new THREE.Vector3().fromArray(frames[i-1].hip));
      poseSteps[i]=Math.sqrt(mainNames.reduce((sum,_,k)=>sum+new THREE.Quaternion().fromArray(frames[i].q[k])
        .angleTo(new THREE.Quaternion().fromArray(frames[i-1].q[k]))**2,0)/mainNames.length);
    }
    const positionBefore=zack.bones.Hip.position.clone();
    for(let i=0;i<10;i++)c.update(0);
    const zeroDeltaDrift=positionBefore.distanceTo(zack.bones.Hip.position);
    c.playing=false;const paused=zack.bones.Hip.position.clone();c.update(.25);
    const pauseDrift=paused.distanceTo(zack.bones.Hip.position);
    const offset=c.rootMotionOffset.clone();
    const worldCycle=new THREE.Vector3().fromArray(clip.userData.continuousRootMotion)
      .applyMatrix3(new THREE.Matrix3().setFromMatrix4(zack.bones.Hip.parent.matrixWorld));
    c.seek(.4);const firstSeek=zack.bones.Hip.position.clone();c.seek(1);c.seek(.4);
    const seekError=firstSeek.distanceTo(zack.bones.Hip.position);
    const seekOffset=c.rootMotionOffset.length();
    const sameSource=JSON.stringify(source.toJSON())===original;
    const unchangedClips=[...c.motions.values()].filter(m=>m.name!=='run.001')
      .every(m=>prepareLoopingClip(c.sourceState,m.sourceClip)===m.sourceClip);
    await c.select('idle.001');c.update(.3);await c.select('run.001');c.update(.3);
    const returnsToRun=c.activeName==='run.001'&&zack.bones.Hip.position.toArray().every(Number.isFinite);
    await c.select('static');
    return{duration,sourceDuration:source.duration,sourceFirstKey:source.tracks.find(t=>t.name==='pelvis.position').times[0],
      preparedFirstKey:clip.tracks[0].times[0],samples:clip.tracks[0].times.length,endpointAngle,firstStep,
      loopFrames,loopHipSteps:loopFrames.map(i=>hipSteps[i]),maxHipStep:Math.max(...hipSteps.filter(Number.isFinite)),
      loopPoseSteps:loopFrames.map(i=>poseSteps[i]),maxPoseStep:Math.max(...poseSteps.filter(Number.isFinite)),
      worldCycle:worldCycle.toArray(),accumulatedOffset:offset.toArray(),zeroDeltaDrift,pauseDrift,seekError,seekOffset,
      sameSource,unchangedClips,returnsToRun,staticOffset:c.rootMotionOffset.length()};
  });
  assert.equal(report.duration,report.sourceDuration);
  assert.equal(report.preparedFirstKey,0);assert.equal(report.samples,32);
  assert(report.endpointAngle<.001,'All joint and helper tracks must close continuously');
  assert(report.firstStep>.015,'Run must move during the first frame instead of holding');
  assert(report.loopFrames.length>=3);
  assert(report.maxHipStep<.06,'Root motion must not teleport at a loop');
  assert(Math.max(...report.loopPoseSteps)<=report.maxPoseStep*1.01,'The loop seam must be no sharper than interior motion');
  assert(Math.abs(report.worldCycle[1])<1e-5,'Forward travel must not accumulate vertical drift');
  assert(report.zeroDeltaDrift<1e-8&&report.pauseDrift<1e-8&&report.seekError<1e-8);
  assert.equal(report.seekOffset,0);assert.equal(report.staticOffset,0);
  assert(report.sameSource&&report.unchangedClips&&report.returnsToRun);
  assert.deepEqual(errors,[]);
  await mkdir('artifacts/run-hitch',{recursive:true});
  await writeFile('artifacts/run-hitch/checks.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
  console.log('Run passed: no leading hold, closed pose cycle, continuous root motion over three loops, pause/zero-delta/seek/reset, and unchanged other source clips.');
}finally{await browser.close();}
