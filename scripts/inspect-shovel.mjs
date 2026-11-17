import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const output = process.env.SHOVEL_AUDIT_DIR || 'artifacts/shovel-arms/after';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:true,
  args:['--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport:{width:850,height:850} });
  await page.goto('http://127.0.0.1:5173'); await page.waitForFunction(()=>window.studio?.mocapController.motions.size>0);
  const duration = await page.evaluate(async()=>{
    const T=await import('/node_modules/three/build/three.module.js');
    zack.reset(); window.shovelSpineRest=zack.bones.Spine02.getWorldQuaternion(new T.Quaternion()).normalize();
    await studio.mocapController.select('shovel.001'); studio.mocapController.playing=false; studio.renderer.setAnimationLoop(null);
    return studio.mocapController.playback.duration;
  });
  console.log({duration});
  await page.addStyleTag({content:'.properties,#timeline{display:none}.workspace{grid-template-columns:1fr}.viewer{grid-template-rows:1fr}'});
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  for(const time of [.8,6.3,6.8,7.4,8].filter(time=>time<=duration))for(const side of ['L','R'])for(const mode of ['on','surface-off','all-off']){
    const data=await page.evaluate(async({side,time,mode})=>{
      const T=await import('/node_modules/three/build/three.module.js'); studio.mocapController.seek(time);
      zack.elbowCorrectives.setEnabled(mode!=='all-off'); zack.shoulderCorrectives.setEnabled(mode!=='all-off');
      zack.armSoftening.setEnabled(mode==='on');
      const shoulder=zack.bones[side+'_Upperarm'].getWorldPosition(new T.Vector3()),elbow=zack.bones[side+'_Forearm'].getWorldPosition(new T.Vector3());
      const target=shoulder.clone().lerp(elbow,.5);
      studio.controls.minDistance=.02; studio.controls.enableDamping=false; studio.controls.target.copy(target);
      studio.camera.position.copy(target).add(new T.Vector3(side==='L'?.1:-.1,.12,.4));
      studio.controls.update(); studio.renderer.render(studio.scene,studio.camera);
      return {side,time,mode,shoulder:shoulder.toArray(),elbow:elbow.toArray(),influences:zack.mesh.morphTargetInfluences.slice()};
    },{side,time,mode});
    await page.screenshot({path:`${output}/${side}-${time}-${mode}.png`});
    if(time===6.3&&mode==='on')await writeFile(`${output}/${side}-6.3.json`,JSON.stringify(data,null,2));
  }
}finally{await browser.close();}
