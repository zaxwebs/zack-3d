import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto('http://127.0.0.1:5173');
  await page.waitForFunction(() => window.zack);
  await page.click('[data-pose="rest"]');
  await page.evaluate(async () => {
    const T = await import('/node_modules/three/build/three.module.js');
    window.chestSamples = [];
    const point = new T.Vector3();
    for (let i = 0; i < zack.geometry.attributes.position.count; i++) {
      zack.mesh.getVertexPosition(i, point).applyMatrix4(zack.mesh.matrixWorld);
      if (Math.abs(point.x - 0.002) < 0.08 && point.y > 0.42 && point.y < 0.62) {
        chestSamples.push({ index: i, position: point.toArray() });
      }
    }
  });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await mkdir('artifacts/poses', { recursive: true });
  await page.evaluate(async () => {
    studio.camera.position.set(0.65, 0.65, 2.1);
    studio.controls.target.set(0, 0.5, 0);
    studio.controls.update();
  });
  const results = {};
  for (const pose of ['down', 'front', 'hi', 'down', 'hi']) {
    await page.click(`[data-pose="${pose}"]`);
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    const data = await page.evaluate(async () => {
      const T = await import('/node_modules/three/build/three.module.js');
      const positions = {};
      for (const side of ['L', 'R']) {
        for (const part of ['Upperarm', 'Forearm', 'Hand', 'Index1', 'Pinky1', 'Thumb3']) {
          positions[`${side}_${part}`] = zack.bones[`${side}_${part}`].getWorldPosition(new T.Vector3()).toArray();
        }
      }
      const point = new T.Vector3(); let finite = true;
      let maxChestDisplacement = 0;
      for (const sample of chestSamples) {
        zack.mesh.getVertexPosition(sample.index, point).applyMatrix4(zack.mesh.matrixWorld);
        maxChestDisplacement = Math.max(maxChestDisplacement, point.distanceTo(new T.Vector3().fromArray(sample.position)));
      }
      let maxWeightSumError = 0;
      for (let i = 0; i < zack.geometry.attributes.position.count; i++) {
        zack.mesh.getVertexPosition(i, point);
        finite &&= point.toArray().every(Number.isFinite);
        let sum = 0;
        for (let slot = 0; slot < 4; slot++) sum += zack.geometry.attributes.skinWeight.array[i * 4 + slot];
        maxWeightSumError = Math.max(maxWeightSumError, Math.abs(sum - 1));
      }
      return { positions, finite, pose: zackRig.currentPose, maxChestDisplacement, chestSampleCount: chestSamples.length, maxWeightSumError };
    });
    assert.equal(data.pose, pose); assert(data.finite);
    assert(data.chestSampleCount > 500);
    assert(data.maxChestDisplacement < 1e-6, `Chest must keep its shape in ${pose}: ${data.maxChestDisplacement}`);
    assert(data.maxWeightSumError < 1e-6);
    const p = data.positions;
    if (pose === 'down') for (const s of ['L', 'R']) assert(p[`${s}_Hand`][1] < p[`${s}_Upperarm`][1] - 0.15);
    if (pose === 'front') for (const s of ['L', 'R']) assert(p[`${s}_Hand`][2] > p[`${s}_Upperarm`][2] + 0.14);
    if (pose === 'hi') {
      assert(p.R_Hand[1] > p.R_Upperarm[1] + 0.05);
      assert(p.L_Hand[1] < p.L_Upperarm[1] - 0.15);
      assert(p.R_Thumb3[0] > p.R_Hand[0], 'Waving thumb must face inward toward the ear');
    }
    if (results[pose]) assert.deepEqual(data, results[pose], 'Switching poses must not accumulate rotations');
    results[pose] = data;
    await page.screenshot({ path: `artifacts/poses/${pose}.png` });
    const exported = await page.evaluate(() => JSON.stringify(zack.root.toJSON()));
    await writeFile(`artifacts/poses/zack-${pose}.three.json`, exported);
  }
  assert.deepEqual(errors, []);
  await writeFile('artifacts/poses/verification.json', JSON.stringify(results, null, 2));
  console.log('Pose checks passed: hands down, hands front, hi; stable chest, normalized skin weights, finite vertices and repeatable switching.');
} finally { await browser.close(); }
