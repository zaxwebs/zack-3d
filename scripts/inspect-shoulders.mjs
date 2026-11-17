import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const output = process.env.SHOULDER_AUDIT_DIR || 'artifacts/dance04-shoulder/before';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:true, args:['--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
try {
  const page=await browser.newPage({viewport:{width:800,height:800}});
  await page.goto('http://127.0.0.1:5173');
  await page.waitForFunction(()=>window.studio?.mocapController.motions.size>0);
  await page.evaluate(async()=>{
    const T=await import('/node_modules/three/build/three.module.js');
    zack.reset(); window.spineRest=zack.bones.Spine02.getWorldQuaternion(new T.Quaternion()).normalize();
    await studio.mocapController.select('dance_04.001');
    studio.mocapController.playing=false; studio.renderer.setAnimationLoop(null);
  });
  await page.addStyleTag({content:'.properties,#timeline{display:none}.workspace{grid-template-columns:1fr}.viewer{grid-template-rows:1fr}'});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const report=[];
  for(const side of ['L','R'])for(const time of [4,4.25,4.5,4.75,5]){
    report.push(await page.evaluate(async({side,time})=>{
      const T=await import('/node_modules/three/build/three.module.js');
      studio.mocapController.seek(time);
      const shoulder=zack.bones[`${side}_Upperarm`].getWorldPosition(new T.Vector3());
      const clavicle=zack.bones[`${side}_Clavicle`].getWorldPosition(new T.Vector3());
      const elbow=zack.bones[`${side}_Forearm`].getWorldPosition(new T.Vector3());
      const body=zack.bones.Spine02.getWorldQuaternion(new T.Quaternion()).normalize().multiply(spineRest.clone().invert());
      const target=shoulder.clone().lerp(clavicle,.4);
      studio.controls.minDistance=.02; studio.controls.enableDamping=false;
      studio.controls.target.copy(target);
      studio.camera.position.copy(target).add(new T.Vector3(side==='L'?.05:-.05,.015,.38).applyQuaternion(body));
      studio.controls.update(); studio.renderer.render(studio.scene,studio.camera);
      return{side,time,shoulder:shoulder.toArray(),clavicle:clavicle.toArray(),armDirection:elbow.sub(shoulder).normalize().applyQuaternion(body.invert()).toArray()};
    },{side,time}));
    await page.screenshot({path:`${output}/${side}-${time}.png`});
  }
  await writeFile(`${output}/poses.json`,JSON.stringify(report,null,2));
  console.log('Saved Dance 04 shoulder closeups to '+output);
}finally{await browser.close();}
