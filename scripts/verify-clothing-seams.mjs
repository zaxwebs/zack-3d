import assert from 'node:assert/strict';
import * as THREE from 'three';
import fs from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { createZackModel } from '../src/ZackModel.js';
import { repairClothingSeams } from '../src/repairClothingSeams.js';
const manifest = JSON.parse(await fs.readFile('public/model/manifest.json'));
const packed = await fs.readFile('public/model/geometry.bin');
const model = createZackModel(manifest, packed.buffer.slice(packed.byteOffset, packed.byteOffset + packed.byteLength));
// Exercise the repair in isolation to check that unrelated vertices and topology stay intact.
const isolated = new THREE.BufferGeometry();
const constructors = { Float32Array, Uint16Array, Uint8Array, Uint32Array };
for (const name of ['position', 'normal', 'uv', 'skinIndex', 'skinWeight', 'index']) {
  const a = manifest.arrays[name];
  const values = new constructors[a.type](packed.buffer, packed.byteOffset + a.byteOffset, a.count * a.itemSize);
  const array = a.normalized ? Float32Array.from(values, v => v / 255) : values.slice();
  const attr = new THREE.BufferAttribute(array, a.itemSize);
  if (name === 'index') isolated.setIndex(attr); else isolated.setAttribute(name, attr);
}
const before = isolated.clone();
const isolatedRepair = repairClothingSeams(isolated);
assert.equal(isolatedRepair.slits, 3);
const edited = new Set(isolatedRepair.repairs.flatMap(r => r.vertices));
for (const [name, attr] of Object.entries(isolated.attributes)) {
  assert.equal(attr.count, before.attributes[name].count);
  for (let i = 0; i < attr.array.length; i++) {
    if (name === 'uv' || !edited.has(Math.floor(i / attr.itemSize)))
      assert.equal(attr.array[i], before.attributes[name].array[i], `Unrelated ${name} changed at ${i}`);
  }
}
assert.deepEqual(isolated.index.array, before.index.array);
// After welding, every edge touching a repaired vertex has exactly two faces.
const positionKey = i => [0, 1, 2].map(c => isolated.attributes.position.array[i * 3 + c]).join(',');
const seamKeys = new Set([...edited].map(positionKey));
const seamEdges = new Map();
const indices = isolated.index.array;
for (let i = 0; i < indices.length; i += 3) for (let c = 0; c < 3; c++) {
  const a = positionKey(indices[i + c]), b = positionKey(indices[i + (c + 1) % 3]);
  if (!seamKeys.has(a) && !seamKeys.has(b)) continue;
  const key = [a, b].sort().join('|');
  seamEdges.set(key, (seamEdges.get(key) ?? 0) + 1);
}
assert(seamEdges.size > 0);
assert([...seamEdges.values()].every(count => count === 2), 'Repaired seams must have no boundary edges');
const correction = model.root.userData.clothingSeamCorrection;
assert.equal(correction.slits, 3);


assert(correction.maxDisplacement < 0.00025);
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
assert.equal(repairClothingSeams(model.geometry).slits, 0);
assert.deepEqual(position.array, saved);
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:5173/');
  await page.waitForFunction(() => window.zack);
  assert.equal(await page.locator('#ground').isChecked(), false);
  assert.equal(await page.evaluate(() => studio.scene.children.find(n => n.type === 'GridHelper').visible), false);
  await page.check('#ground');
  assert.equal(await page.evaluate(() => studio.scene.children.find(n => n.type === 'GridHelper').visible), true);
  await page.uncheck('#ground');
  for (const button of await page.locator('[data-pose]').all()) {
    await button.click();
    assert(await page.evaluate(async () => {
      const T = await import('/node_modules/three/build/three.module.js');
      zack.root.updateMatrixWorld(true); zack.skeleton.update();
      return zack.root.userData.clothingSeamCorrection.repairs.every(({ vertices }) => {
        const first = zack.mesh.getVertexPosition(vertices[0], new T.Vector3());
        return vertices.every(v => first.distanceTo(zack.mesh.getVertexPosition(v, new T.Vector3())) < 1e-8);
      });
    }), 'Clothing seams must remain joined in every pose');
  }
  await page.click('[data-pose="down"]');
  await page.evaluate(async () => {
    const T = await import('/node_modules/three/build/three.module.js');
    const p = zack.geometry.attributes.position, box = new T.Box3();
    for (const i of [6186, 6218, 320, 6196])
      box.expandByPoint(zack.mesh.getVertexPosition(i, new T.Vector3()).applyMatrix4(zack.mesh.matrixWorld));
    const target = box.getCenter(new T.Vector3());
    studio.controls.enableDamping = false; studio.controls.minDistance = .01;
    studio.controls.target.copy(target);
    studio.camera.position.copy(target).add(new T.Vector3(0, .01, .14));
    studio.controls.update();
  });
  await page.screenshot({ path: 'artifacts/clothing-repaired.png' });
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
console.log('Clothing seams: all three joined, UVs preserved, all poses passed, ground off by default, no browser errors.');
