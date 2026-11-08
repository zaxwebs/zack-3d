import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { createZackModel } from '../src/ZackModel.js';
import { repairShoeLaceGaps } from '../src/repairShoeLaceGaps.js';
const manifest = JSON.parse(await fs.readFile('public/model/manifest.json'));
const packed = await fs.readFile('public/model/geometry.bin');
const model = createZackModel(manifest, packed.buffer.slice(packed.byteOffset, packed.byteOffset + packed.byteLength));
const correction = model.root.userData.shoeLaceGapCorrection;
assert.equal(correction.patchedGaps, 2);
assert.equal(correction.addedVertices, 0);
assert.equal(correction.addedTriangles, 0);
assert(correction.maxDisplacement < 0.00035);
const { position, normal, uv, skinIndex, skinWeight } = model.geometry.attributes;
for (const { vertices } of correction.repairs) {
  assert(vertices.length >= 2);
  for (const attribute of [position, normal, skinIndex, skinWeight]) {
    const values = v => Array.from(attribute.array.slice(v * attribute.itemSize, (v + 1) * attribute.itemSize));
    for (const vertex of vertices) assert.deepEqual(values(vertex), values(vertices[0]));
  }
}
const layout = manifest.arrays.uv;
const sourceUv = new Float32Array(packed.buffer, packed.byteOffset + layout.byteOffset, layout.count * layout.itemSize);
assert.deepEqual(uv.array.slice(0, sourceUv.length), sourceUv);
// A second call cannot add faces or move the already joined seams.
const saved = position.array.slice();
assert.equal(repairShoeLaceGaps(model.geometry).patchedGaps, 0);
assert.deepEqual(position.array, saved);
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:5173/');
  await page.waitForFunction(() => window.zack);
  for (const button of await page.locator('[data-pose]').all()) {
    await button.click();
    assert(await page.evaluate(async () => {
      const T = await import('/node_modules/three/build/three.module.js');
      zack.root.updateMatrixWorld(true); zack.skeleton.update();
      return zack.root.userData.shoeLaceGapCorrection.repairs.every(({ vertices }) => {
        const first = zack.mesh.getVertexPosition(vertices[0], new T.Vector3());
        return vertices.every(v => first.distanceTo(zack.mesh.getVertexPosition(v, new T.Vector3())) < 1e-8);
      });
    }), 'Shoe seams must remain joined in every pose');
  }
  await page.click('[data-pose="down"]');
  await page.evaluate(async () => {
    const T = await import('/node_modules/three/build/three.module.js');
    const p = zack.geometry.attributes.position, box = new T.Box3();
    for (let i = 0; i < p.count; i++) if (p.getZ(i) < -.37)
      box.expandByPoint(zack.mesh.getVertexPosition(i, new T.Vector3()).applyMatrix4(zack.mesh.matrixWorld));
    const target = box.getCenter(new T.Vector3());
    studio.controls.enableDamping = false; studio.controls.minDistance = .01;
    studio.controls.target.copy(target);
    studio.camera.position.copy(target).add(new T.Vector3(.22, .18, .32));
    studio.controls.update();
  });
  await page.screenshot({ path: 'artifacts/shoes-repaired.png' });
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
console.log('Shoe seams: joined on both shoes, UVs preserved, all poses passed, no browser errors.');
