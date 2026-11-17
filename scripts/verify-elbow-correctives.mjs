import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import * as THREE from 'three';
import { createZackModel } from '../src/ZackModel.js';

const bytes = await readFile('public/model/geometry.bin');
const manifest = JSON.parse(await readFile('public/model/manifest.json'));
const model = createZackModel(manifest, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
const { root, mesh, bones, geometry, skeleton, elbowCorrectives } = model;
model.shoulderCorrectives.setEnabled(false);
const elbowTargets = geometry.morphAttributes.position.filter(attribute => attribute.name.includes('_Elbow_'));
const vertex = i => mesh.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld);
const base = Object.fromEntries(Object.entries(geometry.attributes).map(([name, attribute]) => [name, attribute.array.slice()]));
const topology = geometry.index.array.slice();
const restPoints = Array.from({ length: geometry.attributes.position.count }, (_, i) => vertex(i));
const affected = [], protectedVertices = [];
for (let i = 0; i < restPoints.length; i++) {
  const active = elbowTargets.some(attribute =>
    attribute.getX(i) !== 0 || attribute.getY(i) !== 0 || attribute.getZ(i) !== 0);
  if (active) affected.push(i);
  else if (i % 31 === 0) protectedVertices.push(i);
}
assert.equal(elbowTargets.length, 24);
assert(affected.length > 200 && affected.length < 1500, 'Correctives must remain local to the elbows');
for (const attributes of Object.values(geometry.morphAttributes)) for (const attribute of attributes) {
  assert.equal(attribute.count, geometry.attributes.position.count, 'Correctives must use the existing vertices');
  assert(attribute.array.every(Number.isFinite));
}
elbowCorrectives.update();
assert(mesh.morphTargetInfluences.every(weight => weight < 1e-10), 'The rest pose must not activate a corrective');
const restForearms = Object.fromEntries(['L', 'R'].map(side => [side, bones[`${side}_Forearm`].getWorldQuaternion(new THREE.Quaternion()).normalize()]));
const report = { ...elbowCorrectives.report, affectedVertices: affected.length, samples: [], maxOutsideMotion: 0, maxRestError: 0 };
for (const rootAngle of [0, 0.7]) for (const side of ['L', 'R']) for (const bend of [45, 90, 135, 160]) for (const twist of [-60, 0, 60]) {
  model.reset();
  root.rotation.y = rootAngle;
  root.updateMatrixWorld(true);
  const forearm = bones[`${side}_Forearm`], upper = bones[`${side}_Upperarm`], hand = bones[`${side}_Hand`];
  const incoming = forearm.getWorldPosition(new THREE.Vector3()).sub(upper.getWorldPosition(new THREE.Vector3())).normalize();
  const outgoingRest = hand.getWorldPosition(new THREE.Vector3()).sub(forearm.getWorldPosition(new THREE.Vector3())).normalize();
  const inside = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), rootAngle);
  inside.addScaledVector(incoming, -inside.dot(incoming)).normalize();
  const hinge = incoming.clone().cross(inside).normalize();
  const outgoing = incoming.clone().applyAxisAngle(hinge, THREE.MathUtils.degToRad(bend) + incoming.angleTo(outgoingRest));
  const rotation = new THREE.Quaternion().setFromUnitVectors(outgoingRest, outgoing);
  const desired = new THREE.Quaternion().setFromAxisAngle(outgoing, THREE.MathUtils.degToRad(twist)).multiply(rotation)
    .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rootAngle))
    .multiply(restForearms[side]);
  forearm.quaternion.copy(forearm.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(desired));
  root.updateMatrixWorld(true);
  model.armTwist.update();
  elbowCorrectives.setEnabled(false);
  const before = new Map([...affected, ...protectedVertices].map(i => [i, vertex(i)]));
  const boneTransforms = skeleton.bones.map(bone => ({ p: bone.position.clone(), q: bone.quaternion.clone(), s: bone.scale.clone() }));
  elbowCorrectives.setEnabled(true);
  let maxDisplacement = 0;
  for (const i of affected) {
    const point = vertex(i);
    assert(point.toArray().every(Number.isFinite));
    maxDisplacement = Math.max(maxDisplacement, point.distanceTo(before.get(i)));
  }
  for (const i of protectedVertices) report.maxOutsideMotion = Math.max(report.maxOutsideMotion, vertex(i).distanceTo(before.get(i)));
  skeleton.bones.forEach((bone, i) => {
    assert(bone.position.equals(boneTransforms[i].p) && bone.quaternion.equals(boneTransforms[i].q) && bone.scale.equals(boneTransforms[i].s),
      'A corrective must never change the animation joints');
  });
  assert(maxDisplacement > 1e-5 && maxDisplacement < 0.1, 'A corrective must be active and bounded');
  const first = mesh.morphTargetInfluences.slice();
  elbowCorrectives.update();
  assert.deepEqual(mesh.morphTargetInfluences, first, 'Repeated evaluation must not accumulate deformation');
  assert(mesh.morphTargetInfluences.every(weight => weight >= 0 && weight <= 1));
  report.samples.push({ rootAngle, side, bend, twist, maxDisplacement });
}
assert(report.maxOutsideMotion < 1e-10, 'The rest of the character must remain untouched');
model.reset();
root.rotation.y = 0;
root.updateMatrixWorld(true);
elbowCorrectives.update();
for (let i = 0; i < restPoints.length; i++) report.maxRestError = Math.max(report.maxRestError, restPoints[i].distanceTo(vertex(i)));
assert(report.maxRestError < 1e-7);
for (const [name, values] of Object.entries(base)) assert.deepEqual(geometry.attributes[name].array, values, `Base ${name} changed`);
assert.deepEqual(geometry.index.array, topology);
await mkdir('artifacts/corrective-elbows', { recursive: true });
await writeFile('artifacts/corrective-elbows/checks.json', JSON.stringify(report, null, 2));
console.log('Elbow correctives passed: 48 bend/twist/root cases, local and bounded deformation, stable joints, repeatability, exact rest, and unchanged base mesh/topology.');
model.dispose();
