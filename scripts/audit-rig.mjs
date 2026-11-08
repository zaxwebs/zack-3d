import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const output = process.env.RIG_AUDIT_DIR || 'artifacts/rig-audit/before';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
  await page.goto('http://127.0.0.1:5173');
  await page.waitForFunction(() => window.zack);
  await page.addStyleTag({ content: 'header,aside,footer{display:none}' });
  const report = {};
  for (const pose of ['rest', 'down', 'front', 'hi']) {
    await page.evaluate(pose => zackRig.setPose(pose), pose);
    report[pose] = await page.evaluate(async () => {
      const T = await import('/node_modules/three/build/three.module.js');
      const model = zack;
      const p = new T.Vector3();
      const positions = new Float32Array(model.geometry.attributes.position.count * 3);
      for (let i = 0; i < model.geometry.attributes.position.count; i++) {
        model.mesh.getVertexPosition(i, p).applyMatrix4(model.mesh.matrixWorld);
        p.toArray(positions, i * 3);
      }
      const bones = model.skeleton.bones.map(bone => ({ name: bone.name, parent: bone.parent.name, position: bone.getWorldPosition(new T.Vector3()).toArray(), scale: bone.scale.toArray() }));
      return { bones, positions: Array.from(positions) };
    });
    for (const [view, camera] of [['front', [0, 0.63, 2.05]], ['side', [-2.05, 0.63, 0]], ['back', [0, 0.63, -2.05]]]) {
      await page.evaluate(camera => {
        studio.controls.target.set(0, 0.5, 0);
        studio.camera.position.fromArray(camera);
        studio.controls.update();
      }, camera);
      await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
      await page.screenshot({ path: `${output}/${pose}-${view}.png` });
    }
  }
  for (const [label, value] of [['head-left', -30], ['head-right', 30]]) {
    await page.evaluate(value => {
      zackRig.setPose('down');
      document.querySelector('#head').value = value;
      document.querySelector('#head').dispatchEvent(new Event('input'));
      studio.controls.target.set(0, .76, 0);
      studio.camera.position.set(0, .78, 1.0);
      studio.controls.update();
    }, value);
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    await page.screenshot({ path: `${output}/${label}.png` });
  }
  for (const [label, setup] of [
    ['knee-bend', { thigh: -25, calf: 65 }],
    ['hip-flex', { thigh: -50, calf: 0 }],
  ]) {
    await page.evaluate(async setup => {
      const T = await import('/node_modules/three/build/three.module.js');
      document.querySelector('#head').value = 0;
      document.querySelector('#head').dispatchEvent(new Event('input'));
      zack.reset(); zackRig.setPose('down');
      const rotate = (bone, angle) => {
        zack.root.updateMatrixWorld(true);
        const q = bone.getWorldQuaternion(new T.Quaternion());
        const parent = bone.parent.getWorldQuaternion(new T.Quaternion()).invert();
        bone.quaternion.copy(parent.multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(1, 0, 0), T.MathUtils.degToRad(angle)).multiply(q)));
        zack.root.updateMatrixWorld(true);
      };
      rotate(zack.bones.R_Thigh, setup.thigh); rotate(zack.bones.R_Calf, setup.calf);
      studio.controls.target.set(0, .35, 0);
      studio.camera.position.set(-1.35, .42, .55);
      studio.controls.update();
    }, setup);
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    await page.screenshot({ path: `${output}/${label}.png` });
  }
  await page.evaluate(() => { zack.reset(); document.querySelector('#head').value = 0; document.querySelector('#head').dispatchEvent(new Event('input')); });
  await page.evaluate(async () => {
    const T = await import('/node_modules/three/build/three.module.js');
    zackRig.setPose('rest');
    for (const finger of ['Index', 'Mid', 'Ring', 'Pinky']) for (let joint = 1; joint <= 2; joint++) {
      const bone = zack.bones[`R_${finger}${joint}`];
      const next = zack.bones[`R_${finger}${joint + 1}`];
      const direction = next.getWorldPosition(new T.Vector3()).sub(bone.getWorldPosition(new T.Vector3())).normalize();
      const axis = direction.cross(new T.Vector3(0, -1, 0)).normalize();
      const q = bone.getWorldQuaternion(new T.Quaternion());
      const parent = bone.parent.getWorldQuaternion(new T.Quaternion()).invert();
      bone.quaternion.copy(parent.multiply(new T.Quaternion().setFromAxisAngle(axis, T.MathUtils.degToRad(25)).multiply(q)));
      zack.root.updateMatrixWorld(true);
    }
    studio.controls.target.set(-.36, .61, .05);
    studio.camera.position.set(-.38, .78, .48);
    studio.controls.update();
  });
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.screenshot({ path: `${output}/finger-flex.png` });
  await page.evaluate(() => zackRig.setPose('rest'));
  await page.evaluate(() => { zackRig.setPose('rest'); document.querySelector('#rig').checked = true; document.querySelector('#rig').dispatchEvent(new Event('change')); studio.camera.position.set(0, .6, 2); studio.controls.update(); });
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.screenshot({ path: `${output}/skeleton-front.png` });
  await writeFile(`${output}/measurements.json`, JSON.stringify(report));
  console.log(`Rig audit captured to ${output}`);
} finally { await browser.close(); }
