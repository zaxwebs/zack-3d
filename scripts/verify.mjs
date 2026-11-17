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
    const handSeamCorrection = model.root.userData.handSeamCorrection;
    const repairedVertices = new Set([handSeamCorrection, model.root.userData.clothingSeamCorrection,
      model.root.userData.shoeLaceGapCorrection].flatMap(correction => correction.repairs.flatMap(repair => repair.vertices)));
    const cornerUVVertices = new Set(model.root.userData.smileCornerUVAlignment.changedVertices);
    const attributes = {};
    const unrepairedAttributes = {};
    for (const name of ['position', 'normal', 'uv', 'skinIndex', 'skinWeight']) {
      const a = source.geometry.attributes[name].array;
      const b = model.geometry.attributes[name].array;
      attributes[name] = b.length >= a.length && a.every((v, i) => v === b[i]);
      unrepairedAttributes[name] = b.length >= a.length && a.every((value, index) =>
        (name === 'uv' ? cornerUVVertices : repairedVertices).has(Math.floor(index / source.geometry.attributes[name].itemSize)) || value === b[index]);
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
    let maxRepairedWorldVertexError = 0;
    // Added sole caps, split lip records, and mouth interiors have no source
    // GLB counterpart. Compare every source record, then validate the additions.
    for (let i = 0; i < source.geometry.attributes.position.count; i++) {
      source.getVertexPosition(i, a).applyMatrix4(source.matrixWorld);
      model.mesh.getVertexPosition(i, b).applyMatrix4(model.mesh.matrixWorld);
      if (repairedVertices.has(i)) maxRepairedWorldVertexError = Math.max(maxRepairedWorldVertexError, a.distanceTo(b));
      else maxWorldVertexError = Math.max(maxWorldVertexError, a.distanceTo(b));
    }
    const expectedGeometry = source.geometry.clone();
    const [{ repairHandSeams }, { repairNonManifoldSliver }, { repairShoeSoleHoles }, { repairShoeLaceGaps }, { repairClothingSeams }] = await Promise.all([
      import('/src/repairHandSeams.js'), import('/src/repairNonManifoldSliver.js'), import('/src/repairShoeSoleHoles.js'), import('/src/repairShoeLaceGaps.js'), import('/src/repairClothingSeams.js')]);
    const sourceBones = Object.fromEntries(source.skeleton.bones.map(bone => [bone.name, bone]));
    repairHandSeams(expectedGeometry, source.skeleton, sourceBones); repairNonManifoldSliver(expectedGeometry);
    repairShoeSoleHoles(expectedGeometry); repairShoeLaceGaps(expectedGeometry); repairClothingSeams(expectedGeometry);
    const copySources = new Map(model.speechFace.report.splitRecords.map(({ source, copy }) => [copy, source]));
    const expectedIndex = expectedGeometry.index.array;
    const indexEqual = expectedIndex.every((value, i) => value === (copySources.get(model.geometry.index.array[i]) ?? model.geometry.index.array[i]));
    const additionsMatch = model.geometry.attributes.position.count === expectedGeometry.attributes.position.count + model.speechFace.report.addedVertices
      && model.geometry.index.count === expectedIndex.length + model.speechFace.report.addedTriangles * 3;
    expectedGeometry.dispose();
    const shoulderPivots = {};
    for (const side of ['L', 'R']) {
      const before = source.skeleton.bones.find(bone => bone.name === `${side}_Upperarm`).getWorldPosition(new THREE.Vector3());
      const after = model.bones[`${side}_Upperarm`].getWorldPosition(new THREE.Vector3());
      const elbowBefore = source.skeleton.bones.find(bone => bone.name === `${side}_Forearm`).getWorldPosition(new THREE.Vector3());
      const elbowAfter = model.bones[`${side}_Forearm`].getWorldPosition(new THREE.Vector3());
      shoulderPivots[side] = { offset: after.sub(before).toArray(), elbowRestError: elbowBefore.distanceTo(elbowAfter) };
    }
    return { attributes, unrepairedAttributes, handSeamCorrection, maxRepairedWorldVertexError,
      indexEqual, additionsMatch,
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
  for (const name of ['position', 'normal']) {
    assert.equal(report.attributes[name], false, `Hand seam repair should adjust ${name}`);
    assert(report.unrepairedAttributes[name], `Unrepaired ${name} must match the source`);
  }
  assert(report.unrepairedAttributes.uv, 'UVs remain exact outside the smile-corner registration');
  assert.equal(report.handSeamCorrection.slits, 2);
  assert(report.maxRepairedWorldVertexError < 0.0004);
  assert.equal(report.attributes.skinWeight, false, 'Chest skin weights should differ from the source auto-rig');
  assert(report.packedJointIndicesExact, 'Packed joint indices must match the source');
  assert.deepEqual(report.packedTypes, { index: 'Uint16Array', skinIndex: 'Uint8Array',
    skinWeight: 'Uint8Array', skinWeightNormalized: true, geometryBytes: 983744 });
  assert(report.packedWeightSumsExact, 'Packed weights must sum to 255 per vertex');
  assert(report.maxWeightQuantizationError < 1 / 255,
    `Skin weight quantization error too large: ${report.maxWeightQuantizationError}`);
  assert(report.indexEqual, 'Original triangles survive the documented repairs and lip split');
  assert(report.additionsMatch, 'Only the documented sole caps and mouth geometry are added');
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
  const { POSES } = await import('../src/ZackRig.js');
  assert.equal(await page.locator('[data-pose]').count(), Object.keys(POSES).length);
  for (const [name, pose] of Object.entries(POSES)) {
    await page.click(`[data-pose="${name}"]`);
    assert.equal(await page.evaluate(() => window.zackRig.currentPose), name);
    assert.equal(await page.locator('[data-pose][aria-pressed="true"]').count(), 1);
    assert.equal(await page.locator('#poseDescription').textContent(), pose.description);
  }
  await page.click('#reset');
  assert.equal(await page.evaluate(() => window.zackRig.currentPose), 'down');
  const downloadPromise = page.waitForEvent('download');
  await page.click('#export');
  const download = await downloadPromise;
  await download.saveAs('artifacts/zack.three.json');
  await page.selectOption('#surface', 'textured');
  await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const thumb = window.zack.bones.L_Thumb1.getWorldPosition(new THREE.Vector3());
    studio.controls.enableDamping = false;
    studio.controls.minDistance = 0.02;
    studio.controls.target.copy(thumb);
    studio.camera.position.copy(thumb).add(new THREE.Vector3(0, 0, 0.12));
    studio.controls.update();
  });
  await page.evaluate(async () => {
    const manifest = await fetch('/model/manifest.json').then(response => response.json());
    const buffer = await fetch('/model/geometry.bin').then(response => response.arrayBuffer());
    window.handSeamAttributes = {};
    for (const name of ['position', 'normal', 'skinIndex', 'skinWeight']) {
      const attribute = zack.geometry.attributes[name];
      window.handSeamAttributes[name] = attribute.array.slice();
      const layout = manifest.arrays[name];
      const constructors = { Float32Array, Uint8Array };
      const source = new constructors[layout.type](buffer, layout.byteOffset, layout.count * layout.itemSize);
      for (const { vertices } of zack.root.userData.handSeamCorrection.repairs) {
        for (const vertex of vertices) {
          for (let component = 0; component < layout.itemSize; component++) {
            const index = vertex * layout.itemSize + component;
            attribute.array[index] = source[index] / (layout.normalized ? 255 : 1);
          }
        }
      }
      attribute.needsUpdate = true;
    }
  });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.screenshot({ path: 'artifacts/hand-seam-before.png' });
  await page.evaluate(() => {
    for (const [name, values] of Object.entries(window.handSeamAttributes)) {
      zack.geometry.attributes[name].array.set(values);
      zack.geometry.attributes[name].needsUpdate = true;
    }
    delete window.handSeamAttributes;
  });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.screenshot({ path: 'artifacts/hand-seam-repair.png' });
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
await import('./verify-poses.mjs');
await import('./verify-hand-seams.mjs');
