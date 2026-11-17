import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
try {
  const page = await browser.newPage({ viewport: { width: 800, height: 800 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:5173');
  await page.waitForFunction(() => window.studio?.mocapController.motions.size > 0);
  await page.locator('[data-animation="frustrated_02.001"]').click();
  await page.waitForFunction(() => studio.mocapController.playback.name === 'frustrated_02.001');
  await page.getByRole('button', { name: 'Pause animation', exact: true }).click();
  await page.evaluate(() => studio.mocapController.seek(5));
  const enabled = await page.evaluate(() => zack.mesh.morphTargetInfluences.slice(0, zack.root.userData.elbowCorrectives.targets).some(value => value > 0));
  assert(enabled, 'Seeking the reported frame should evaluate corrective shapes immediately');
  await page.locator('#elbowCorrectives').uncheck();
  assert.equal(await page.evaluate(() => zack.elbowCorrectives.enabled), false);
  assert(await page.evaluate(() => zack.mesh.morphTargetInfluences.slice(0, zack.root.userData.elbowCorrectives.targets).every(value => value === 0)));
  await page.locator('#elbowCorrectives').check();
  assert(await page.evaluate(() => zack.mesh.morphTargetInfluences.slice(0, zack.root.userData.elbowCorrectives.targets).some(value => value > 0)));
  assert.equal(await page.evaluate(() => studio.mocapController.playback.time), 5);

  await page.evaluate(() => studio.renderer.setAnimationLoop(null));
  await page.addStyleTag({ content: '.properties,#timeline{display:none}.workspace{grid-template-columns:1fr}.viewer{grid-template-rows:1fr}' });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await mkdir('artifacts/corrective-elbows', { recursive: true });
  for (const name of ['off', 'on']) {
    await page.evaluate(async enabled => {
      const THREE = await import('/node_modules/three/build/three.module.js');
      studio.mocapController.seek(5);
      zack.elbowCorrectives.setEnabled(enabled);
      zack.armSoftening.update();
      const elbow = zack.bones.L_Forearm.getWorldPosition(new THREE.Vector3());
      studio.controls.minDistance = 0.02;
      studio.controls.enableDamping = false;
      studio.controls.target.copy(elbow);
      studio.camera.position.copy(elbow).add(new THREE.Vector3(0.32, 0.03, 0.24));
      studio.controls.update();
      studio.renderer.render(studio.scene, studio.camera);
    }, name === 'on');
    await page.screenshot({ path: `artifacts/corrective-elbows/frustrated02-5s-${name}.png`, clip: { x: 90, y: 90, width: 500, height: 600 } });
  }
  const report = await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const worldVertex = (mesh, i) => mesh.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld);
    const copy = await new THREE.ObjectLoader().parseAsync(zack.root.toJSON());
    copy.updateMatrixWorld(true);
    let mesh;
    copy.traverse(node => { if (node.isSkinnedMesh) mesh = node; });
    let maxExportError = 0;
    for (let i = 0; i < zack.geometry.attributes.position.count; i += 7) {
      maxExportError = Math.max(maxExportError, worldVertex(zack.mesh, i).distanceTo(worldVertex(mesh, i)));
    }
    const before = zack.mesh.morphTargetInfluences.slice();
    studio.mocapController.seek(2);
    studio.mocapController.seek(5);
    const repeatable = before.every((weight, i) => Math.abs(weight - zack.mesh.morphTargetInfluences[i]) < 1e-10);
    await studio.mocapController.select('static');
    zackRig.setPose('rest');
    const reset = zack.mesh.morphTargetInfluences.every(weight => weight < 1e-10);
    return { maxExportError, repeatable, reset, vertices: mesh.geometry.attributes.position.count,
      triangles: mesh.geometry.index.count / 3,
      targets: mesh.geometry.morphAttributes.position.filter(attribute => attribute.name.includes('_Elbow_')).length };
  });
  assert(report.maxExportError < 1e-6, 'Posed JSON export must retain the corrective deformation');
  assert(report.repeatable && report.reset);
  assert.equal(report.targets, 24);
  assert.deepEqual(errors, []);
  await writeFile('artifacts/corrective-elbows/viewer-checks.json', JSON.stringify(report, null, 2));
  console.log('Corrective viewer passed: checkbox A/B, paused scrubbing at 5 seconds, repeatability, reset, posed JSON round trip, and no browser errors.');
} finally { await browser.close(); }
