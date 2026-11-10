import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import * as THREE from 'three';
import { createZackModel } from '../src/ZackModel.js';

const manifest = JSON.parse(await readFile('public/model/manifest.json', 'utf8'));
const bytes = await readFile('public/model/geometry.bin');
const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const model = createZackModel(manifest, buffer);
const { root, mesh, bones, skeleton, geometry } = model;
const vector = () => new THREE.Vector3();

// Independently reconstruct the exported node transforms. Compare effective
// bind matrices, rather than comparing rest vertices against repaired geometry.
const originalNodes = manifest.nodes.map(data => {
  const node = new THREE.Object3D();
  if (data.matrix) new THREE.Matrix4().fromArray(data.matrix).decompose(node.position, node.quaternion, node.scale);
  else {
    if (data.translation) node.position.fromArray(data.translation);
    if (data.rotation) node.quaternion.fromArray(data.rotation);
    if (data.scale) node.scale.fromArray(data.scale);
  }
  return node;
});
manifest.nodes.forEach((data, i) => data.children?.forEach(child => originalNodes[i].add(originalNodes[child])));
const originalRoot = new THREE.Group();
manifest.roots.forEach(i => originalRoot.add(originalNodes[i]));
originalRoot.updateMatrixWorld(true);
root.updateMatrixWorld(true);
const layout = manifest.arrays.inverseBindMatrices;
const originalInverses = new Float32Array(buffer, layout.byteOffset, layout.count * layout.itemSize);
const sourceWorld = bone => originalNodes[manifest.joints[skeleton.bones.indexOf(bone)]].matrixWorld;
const position = bone => bone.getWorldPosition(vector());
const sourcePosition = bone => vector().setFromMatrixPosition(sourceWorld(bone));
const weightTotals = new Array(skeleton.bones.length).fill(0);
for (let i = 0; i < geometry.attributes.skinIndex.array.length; i++) {
  weightTotals[geometry.attributes.skinIndex.array[i]] += geometry.attributes.skinWeight.array[i];
}
let maxBindMatrixError = 0;
for (let i = 0; i < skeleton.bones.length; i++) {
  const original = sourceWorld(skeleton.bones[i]).clone()
    .multiply(new THREE.Matrix4().fromArray(originalInverses, i * 16));
  const corrected = skeleton.bones[i].matrixWorld.clone().multiply(skeleton.boneInverses[i]);
  for (let k = 0; k < 16; k++) maxBindMatrixError = Math.max(maxBindMatrixError, Math.abs(original.elements[k] - corrected.elements[k]));
}
assert(maxBindMatrixError < 1e-6, 'Pivot adjustment changed the effective rest bind');

const restVertices = Array.from({ length: geometry.attributes.position.count }, (_, i) =>
  mesh.getVertexPosition(i, vector()).applyMatrix4(mesh.matrixWorld));
function sleeveCenter(x) {
  const bounds = new THREE.Box3();
  let intersections = 0;
  for (let i = 0; i < geometry.index.count; i += 3) {
    const triangle = [0, 1, 2].map(k => restVertices[geometry.index.array[i + k]]);
    // Isolate the sleeve section from the hair, head, and lower hoodie.
    if (triangle.some(p => p.y < 0.51 || p.y > 0.69)) continue;
    for (let k = 0; k < 3; k++) {
      const a = triangle[k], b = triangle[(k + 1) % 3];
      if ((a.x - x) * (b.x - x) >= 0) continue;
      bounds.expandByPoint(a.clone().lerp(b, (x - a.x) / (b.x - a.x)));
      intersections++;
    }
  }
  assert(intersections > 0, 'No sleeve cross-section found');
  return { center: bounds.getCenter(vector()), bounds: [bounds.min.toArray(), bounds.max.toArray()] };
}
const report = { maxBindMatrixError, shoulders: {}, helpers: {}, unweightedArmHelpers: [] };
for (const side of ['L', 'R']) {
  const clavicle = bones[`${side}_Clavicle`], upper = bones[`${side}_Upperarm`];
  const fore = bones[`${side}_Forearm`], hand = bones[`${side}_Hand`];
  assert.equal(upper.parent, clavicle);
  assert.equal(fore.parent, upper);
  assert.equal(hand.parent, fore);
  assert(position(fore).distanceTo(sourcePosition(fore)) < 1e-6, 'Rest elbow moved');
  assert(position(hand).distanceTo(sourcePosition(hand)) < 1e-6, 'Rest wrist moved');
  const current = position(upper), section = sleeveCenter(current.x);
  const previous = current.clone().add(new THREE.Vector3(0, 0.015, -0.004));
  const distanceYZ = p => Math.hypot(p.y - section.center.y, p.z - section.center.z);
  assert(distanceYZ(current) < distanceYZ(previous), 'Shoulder pivot did not move toward the sleeve axis');
  report.shoulders[side] = {
    source: sourcePosition(upper).toArray(), previous: previous.toArray(), corrected: current.toArray(),
    sleeveSectionCenter: section.center.toArray(), sleeveSectionBounds: section.bounds,
    previousSleeveCenterDistance: distanceYZ(previous), correctedSleeveCenterDistance: distanceYZ(current),
    restElbowError: position(fore).distanceTo(sourcePosition(fore)),
    restWristError: position(hand).distanceTo(sourcePosition(hand)),
  };
  const midpoint = bones[`${side}_UpperarmTwist01`], endpoint = bones[`${side}_UpperarmTwist02`];
  const midpointError = position(midpoint).distanceTo(current.clone().lerp(position(fore), 0.5));
  const endpointError = position(endpoint).distanceTo(position(fore));
  assert(midpointError < 1e-6 && endpointError < 1e-6, 'Upper-arm helpers are off the corrected arm axis');
  report.helpers[side] = { midpointError, endpointError };
  for (const name of ['UpperarmTwist01', 'UpperarmTwist02', 'ForearmTwist01', 'ForearmTwist02']) {
    const bone = bones[`${side}_${name}`];
    if (weightTotals[skeleton.bones.indexOf(bone)] < 1e-8) report.unweightedArmHelpers.push(bone.name);
  }
}
report.weighting = model.root.userData.chestWeightCorrection;
report.shoulderTransition = model.root.userData.shoulderWeightTransition;
// Exercise the added influence inside the sleeve boundary, independently of
// clavicle motion. The center zipper and lower hoodie must remain stationary.
report.shoulderResponse = {};
for (const side of ['L', 'R']) {
  const upper = bones[`${side}_Upperarm`];
  const saved = upper.quaternion.clone();
  const world = upper.getWorldQuaternion(new THREE.Quaternion());
  const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1),
    THREE.MathUtils.degToRad(side === 'L' ? 25 : -25));
  upper.quaternion.copy(upper.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(rotation.multiply(world)));
  root.updateMatrixWorld(true);
  let innerShoulderMotion = 0, protectedMotion = 0, samples = 0;
  const chestX = position(bones.Spine02).x;
  for (let i = 0; i < restVertices.length; i++) {
    const p = restVertices[i], x = p.x - chestX;
    const inPatch = Math.sign(x) === (side === 'L' ? 1 : -1)
      && Math.abs(x) > 0.035 && Math.abs(x) < 0.075 && p.y > 0.59 && p.y < 0.66 && p.z > 0.03;
    const protectedCenter = Math.abs(x) < 0.015 && p.y > 0.45 && p.y < 0.65;
    const protectedLower = Math.abs(x) < 0.08 && p.y > 0.43 && p.y < 0.52;
    if (!inPatch && !protectedCenter && !protectedLower) continue;
    const moved = mesh.getVertexPosition(i, vector()).applyMatrix4(mesh.matrixWorld).distanceTo(p);
    if (inPatch) { innerShoulderMotion = Math.max(innerShoulderMotion, moved); samples++; }
    if (protectedCenter || protectedLower) protectedMotion = Math.max(protectedMotion, moved);
  }
  upper.quaternion.copy(saved);
  root.updateMatrixWorld(true);
  assert(samples > 0 && innerShoulderMotion > 0.001, `Inner shoulder patch does not follow the arm: ${samples} samples, ${innerShoulderMotion} motion`);
  assert(protectedMotion < 1e-6, 'Shoulder transition pulled the zipper or lower hoodie');
  report.shoulderResponse[side] = { samples, innerShoulderMotion, protectedMotion };
}
await mkdir('artifacts/shoulder-skeleton', { recursive: true });
await writeFile('artifacts/shoulder-skeleton/audit.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
model.dispose();
