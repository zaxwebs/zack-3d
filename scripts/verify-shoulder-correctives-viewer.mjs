import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 800, height: 800 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:5173');
  await page.waitForFunction(() => window.studio?.mocapController.motions.size > 0);
  await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    zack.reset(); window.shoulderTestSpine = zack.bones.Spine02.getWorldQuaternion(new THREE.Quaternion()).normalize();
    await studio.mocapController.select('dance_04.001');
    studio.mocapController.playing = false; studio.mocapController.seek(4.25);
  });
  const active = () => page.evaluate(() => zack.mesh.morphTargetInfluences.slice(zack.root.userData.shoulderCorrectives.firstTarget));
  assert((await active()).some(weight => weight > 0));
  await page.locator('#shoulderCorrectives').uncheck();
  assert((await active()).every(weight => weight === 0));
  await page.locator('#shoulderCorrectives').check();
  assert((await active()).some(weight => weight > 0));
  assert.equal(await page.evaluate(() => studio.mocapController.playback.time), 4.25);
  const independence = await page.evaluate(() => {
    const start = zack.root.userData.shoulderCorrectives.firstTarget;
    const shoulder = zack.mesh.morphTargetInfluences.slice(start);
    zack.elbowCorrectives.setEnabled(false);
    const elbowPreservesShoulder = shoulder.every((weight, i) => weight === zack.mesh.morphTargetInfluences[start + i]);
    zack.elbowCorrectives.setEnabled(true);
    const elbow = zack.mesh.morphTargetInfluences.slice(0, start);
    zack.shoulderCorrectives.setEnabled(false);
    const shoulderPreservesElbow = elbow.every((weight, i) => weight === zack.mesh.morphTargetInfluences[i]);
    zack.shoulderCorrectives.setEnabled(true);
    return { elbowPreservesShoulder, shoulderPreservesElbow };
  });
  assert(independence.elbowPreservesShoulder && independence.shoulderPreservesElbow);
  await page.evaluate(() => studio.renderer.setAnimationLoop(null));
  await page.addStyleTag({ content: '.properties,#timeline{display:none}.workspace{grid-template-columns:1fr}.viewer{grid-template-rows:1fr}' });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await mkdir('artifacts/dance04-shoulder/compare', { recursive: true });
  for (const time of [4, 4.25, 4.5, 4.75, 5]) for (const enabled of [false, true]) {
    await page.evaluate(async ({ time, enabled }) => {
      const THREE = await import('/node_modules/three/build/three.module.js');
      studio.mocapController.seek(time); zack.shoulderCorrectives.setEnabled(enabled);
      zack.armSoftening.update();
      const shoulder = zack.bones.L_Upperarm.getWorldPosition(new THREE.Vector3());
      const clavicle = zack.bones.L_Clavicle.getWorldPosition(new THREE.Vector3());
      const body = zack.bones.Spine02.getWorldQuaternion(new THREE.Quaternion()).normalize().multiply(shoulderTestSpine.clone().invert());
      const target = shoulder.clone().lerp(clavicle, 0.4);
      studio.controls.minDistance = 0.02; studio.controls.enableDamping = false;
      studio.controls.target.copy(target);
      studio.camera.position.copy(target).add(new THREE.Vector3(0.05, 0.015, 0.38).applyQuaternion(body));
      studio.controls.update(); studio.renderer.render(studio.scene, studio.camera);
    }, { time, enabled });
    await page.screenshot({ path: `artifacts/dance04-shoulder/compare/${time}-${enabled ? 'on' : 'off'}.png` });
  }
  const report = await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const vertex = (mesh, i) => mesh.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld);
    const attributes = zack.geometry.morphAttributes.position.filter(attribute => attribute.name.includes('_Shoulder_'));
    const samples = [];
    for (let i = 0; i < zack.geometry.attributes.position.count; i++) if (i % 7 === 0
      && attributes.some(a => a.getX(i) || a.getY(i) || a.getZ(i))) samples.push(i);
    let previous, maxCorrectionStep = 0;
    for (let frame = 0; frame <= 40; frame++) {
      studio.mocapController.seek(4 + frame / 40);
      zack.shoulderCorrectives.setEnabled(false);
      zack.armSoftening.update();
      const baseline = samples.map(i => vertex(zack.mesh, i));
      zack.shoulderCorrectives.setEnabled(true);
      zack.armSoftening.update();
      const offsets = samples.map((i, k) => vertex(zack.mesh, i).sub(baseline[k]));
      offsets.forEach((p, k) => {
        if (!p.toArray().every(Number.isFinite)) throw new Error('Invalid shoulder correction');
        if (previous) maxCorrectionStep = Math.max(maxCorrectionStep, p.distanceTo(previous[k]));
      });
      previous = offsets;
    }
    studio.mocapController.seek(4.25);
    const first = zack.mesh.morphTargetInfluences.slice();
    const copy = await new THREE.ObjectLoader().parseAsync(zack.root.toJSON());
    copy.updateMatrixWorld(true); let mesh;
    copy.traverse(node => { if (node.isSkinnedMesh) mesh = node; });
    let maxExportError = 0;
    for (const i of samples) maxExportError = Math.max(maxExportError, vertex(zack.mesh, i).distanceTo(vertex(mesh, i)));
    studio.mocapController.seek(5); studio.mocapController.seek(4.25);
    const repeatable = first.every((weight, i) => Math.abs(weight - zack.mesh.morphTargetInfluences[i]) < 1e-10);
    await studio.mocapController.select('static'); zackRig.setPose('rest');
    return { maxCorrectionStep, maxExportError, repeatable,
      reset: zack.mesh.morphTargetInfluences.every(weight => weight < 1e-10),
      targets: attributes.length, vertices: zack.geometry.attributes.position.count, triangles: zack.geometry.index.count / 3 };
  });
  assert(report.maxCorrectionStep < 0.01, 'The 4–5 second shoulder correction must not pop between frames');
  assert(report.maxExportError < 1e-6 && report.repeatable && report.reset);
  assert.equal(report.targets, 18); assert.deepEqual(errors, []);
  await writeFile('artifacts/dance04-shoulder/viewer-checks.json', JSON.stringify({ ...report, ...independence }, null, 2));
  console.log('Shoulder viewer passed: Dance 04 at 4–5 seconds, independent A/B controls, continuous scrubbing, reset, repeatability, and posed JSON export.');
} finally { await browser.close(); }
