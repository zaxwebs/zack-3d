import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:5173/');
  await page.waitForFunction(() => window.zack, { timeout: 30000 });
  assert.equal(await page.locator('[data-texture-size="2048"]').getAttribute('aria-pressed'), 'true');
  await page.click('[data-texture-size="1024"]');
  await page.waitForFunction(() => window.zack.textureSize === 1024);
  assert.equal(await page.evaluate(() => window.zack.material.map.image.width), 1024);
  await page.click('[data-texture-size="2048"]');
  await page.waitForFunction(() => window.zack.textureSize === 2048);
  assert.equal(await page.evaluate(() => window.zack.material.map.image.width), 2048);
  await page.click('[data-pose="rest"]');
  const report = await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { GLTFLoader } = await import('/node_modules/three/examples/jsm/loaders/GLTFLoader.js');
    const original = await new GLTFLoader().loadAsync('/Zack%203D%20V2.glb');
    original.scene.updateMatrixWorld(true);
    let source;
    original.scene.traverse(node => { if (node.isSkinnedMesh) source = node; });
    const model = window.zack;
    model.root.updateMatrixWorld(true);
    const attributes = {};
    for (const name of ['position', 'normal', 'uv', 'skinIndex', 'skinWeight']) {
      const a = source.geometry.attributes[name].array;
      const b = model.geometry.attributes[name].array;
      attributes[name] = a.length === b.length && a.every((v, i) => v === b[i]);
    }
    const packedManifest = await fetch('/model/manifest.json').then(response => response.json());
    const packedBuffer = await fetch('/model/geometry.bin').then(response => response.arrayBuffer());
    const packedJointsLayout = packedManifest.arrays.skinIndex;
    const packedJoints = new Uint8Array(packedBuffer, packedJointsLayout.byteOffset,
      packedJointsLayout.count * packedJointsLayout.itemSize);
    const sourceJoints = source.geometry.attributes.skinIndex.array;
    const packedJointIndicesExact = sourceJoints.every((value, index) => value === packedJoints[index]);
    const packedWeightsLayout = packedManifest.arrays.skinWeight;
    const packedWeights = new Uint8Array(packedBuffer, packedWeightsLayout.byteOffset,
      packedWeightsLayout.count * packedWeightsLayout.itemSize);
    const sourceWeights = source.geometry.attributes.skinWeight.array;
    let maxWeightQuantizationError = 0;
    let packedWeightSumsExact = true;
    for (let vertex = 0; vertex < packedWeightsLayout.count; vertex++) {
      let sourceSum = 0, packedSum = 0;
      for (let slot = 0; slot < 4; slot++) {
        sourceSum += sourceWeights[vertex * 4 + slot];
        packedSum += packedWeights[vertex * 4 + slot];
      }
      packedWeightSumsExact &&= packedSum === 255;
      for (let slot = 0; slot < 4; slot++) {
        const normalizedSource = sourceWeights[vertex * 4 + slot] / sourceSum;
        const decodedPacked = packedWeights[vertex * 4 + slot] / 255;
        maxWeightQuantizationError = Math.max(maxWeightQuantizationError,
          Math.abs(normalizedSource - decodedPacked));
      }
    }
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    let maxWorldVertexError = 0;
    for (let i = 0; i < model.geometry.attributes.position.count; i++) {
      source.getVertexPosition(i, a).applyMatrix4(source.matrixWorld);
      model.mesh.getVertexPosition(i, b).applyMatrix4(model.mesh.matrixWorld);
      maxWorldVertexError = Math.max(maxWorldVertexError, a.distanceTo(b));
    }
    const sourceIndex = source.geometry.index.array;
    const shoulderPivots = {};
    for (const side of ['L', 'R']) {
      const before = source.skeleton.bones.find(bone => bone.name === `${side}_Upperarm`).getWorldPosition(new THREE.Vector3());
      const after = model.bones[`${side}_Upperarm`].getWorldPosition(new THREE.Vector3());
      const elbowBefore = source.skeleton.bones.find(bone => bone.name === `${side}_Forearm`).getWorldPosition(new THREE.Vector3());
      const elbowAfter = model.bones[`${side}_Forearm`].getWorldPosition(new THREE.Vector3());
      shoulderPivots[side] = { offset: after.sub(before).toArray(), elbowRestError: elbowBefore.distanceTo(elbowAfter) };
    }
    return { attributes, indexEqual: sourceIndex.every((v, i) => v === model.geometry.index.array[i]),
      packedJointIndicesExact,
      packedTypes: { index: packedManifest.arrays.index.type,
        skinIndex: packedManifest.arrays.skinIndex.type,
        skinWeight: packedWeightsLayout.type,
        skinWeightNormalized: packedWeightsLayout.normalized,
        geometryBytes: packedBuffer.byteLength },
      maxWeightQuantizationError, packedWeightSumsExact,
      shoulderPivots,
      maxWorldVertexError, vertices: model.geometry.attributes.position.count,
      triangles: model.geometry.index.count / 3, bones: model.skeleton.bones.length,
      texture: [model.material.map.image.width, model.material.map.image.height],
      bounds: new THREE.Box3().setFromObject(model.root, true).getSize(new THREE.Vector3()).toArray() };
  });
  for (const name of ['position', 'normal', 'uv']) assert(report.attributes[name]);
  assert.equal(report.attributes.skinWeight, false, 'Chest skin weights should differ from the source auto-rig');
  assert(report.packedJointIndicesExact, 'Packed joint indices must match the source');
  assert.deepEqual(report.packedTypes, { index: 'Uint16Array', skinIndex: 'Uint8Array',
    skinWeight: 'Uint8Array', skinWeightNormalized: true, geometryBytes: 983744 });
  assert(report.packedWeightSumsExact, 'Packed weights must sum to 255 per vertex');
  assert(report.maxWeightQuantizationError < 1 / 255,
    `Skin weight quantization error too large: ${report.maxWeightQuantizationError}`);
  assert(report.indexEqual);
  assert(report.maxWorldVertexError < 1e-6, `World vertex mismatch: ${report.maxWorldVertexError}`);
  for (const side of ['L', 'R']) {
    const result = report.shoulderPivots[side];
    assert(Math.abs(result.offset[0] - (side === 'L' ? 0.03 : -0.03)) < 1e-6);
    assert(result.elbowRestError < 1e-6);
  }
  await mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/zack-preview.png' });
  await page.selectOption('#surface', 'clay');
  await page.screenshot({ path: 'artifacts/zack-clay.png' });
  await page.locator('#head').fill('30');
  await page.locator('#head').dispatchEvent('input');
  assert(await page.evaluate(() => Math.abs(window.zack.bones.Head.quaternion.x) > 0));
  await page.click('#reset');
  assert.equal(await page.locator('#head').inputValue(), '0');
  const downloadPromise = page.waitForEvent('download');
  await page.click('#export');
  const download = await downloadPromise;
  await download.saveAs('artifacts/zack.three.json');
  // Check a native ObjectLoader round trip retains the skinned model.
  const roundTrip = await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const copy = await new THREE.ObjectLoader().parseAsync(window.zack.root.toJSON());
    let mesh; copy.traverse(node => { if (node.isSkinnedMesh) mesh = node; });
    return { vertices: mesh.geometry.attributes.position.count, bones: mesh.skeleton.bones.length };
  });
  assert.equal(roundTrip.vertices, report.vertices); assert.equal(roundTrip.bones, report.bones);
  assert.deepEqual(errors, []);
  await writeFile('artifacts/verification.json', JSON.stringify({ ...report, controls: 'passed', exportRoundTrip: roundTrip, browserErrors: errors }, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
await import('./inspect-poses.mjs');
await import('./verify-rig.mjs');
await import('./verify-gentle.mjs');
