import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import * as THREE from 'three';
import { createZackModel } from '../src/ZackModel.js';

const bytes = await readFile('public/model/geometry.bin');
const manifest = JSON.parse(await readFile('public/model/manifest.json'));
const model = createZackModel(manifest, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
const { root, mesh, geometry, bones, skeleton, shoulderCorrectives } = model;
model.elbowCorrectives.setEnabled(false);
const vertex = i => mesh.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld);
const targets = geometry.morphAttributes.position.filter(attribute => attribute.name.includes('_Shoulder_'));
assert.equal(targets.length, 18);
const restPoints = Array.from({ length: geometry.attributes.position.count }, (_, i) => vertex(i));
const affected = [], protectedVertices = [];
for (let i = 0; i < restPoints.length; i++) {
  const active = targets.some(attribute => attribute.getX(i) !== 0 || attribute.getY(i) !== 0 || attribute.getZ(i) !== 0);
  if (active) affected.push(i);
  else if (i % 29 === 0 || (Math.abs(restPoints[i].x - 0.002) < 0.04 && restPoints[i].y > 0.4 && restPoints[i].y < 0.7)) protectedVertices.push(i);
}
assert(affected.length > 400 && affected.length < 2500);
const base = Object.fromEntries(Object.entries(geometry.attributes).map(([name, attribute]) => [name, attribute.array.slice()]));
const topology = geometry.index.array.slice();
const report = { ...shoulderCorrectives.report, affectedVertices: affected.length, samples: [], maxProtectedMotion: 0 };
for (const rootAngle of [0, 0.7]) for (const side of ['L', 'R']) for (const elevation of [100, 120, 145, 170]) for (const reach of [-60, 0, 60]) {
  model.reset(); root.rotation.y = rootAngle; root.updateMatrixWorld(true);
  const sign = side === 'L' ? 1 : -1;
  const clavicle = bones[`${side}_Clavicle`], upper = bones[`${side}_Upperarm`], forearm = bones[`${side}_Forearm`];
  const rootRotation = root.getWorldQuaternion(new THREE.Quaternion());
  const lift = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1).applyQuaternion(rootRotation),
    sign * THREE.MathUtils.degToRad(Math.min(35, (elevation - 90) * 0.55)));
  const clavicleWorld = clavicle.getWorldQuaternion(new THREE.Quaternion());
  clavicle.quaternion.copy(clavicle.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(lift.multiply(clavicleWorld)));
  root.updateMatrixWorld(true);
  const e = THREE.MathUtils.degToRad(elevation), r = THREE.MathUtils.degToRad(reach);
  const direction = new THREE.Vector3(sign * Math.sin(e) * Math.cos(r), -Math.cos(e), Math.sin(e) * Math.sin(r)).applyQuaternion(rootRotation);
  const current = forearm.getWorldPosition(new THREE.Vector3()).sub(upper.getWorldPosition(new THREE.Vector3())).normalize();
  const world = upper.getWorldQuaternion(new THREE.Quaternion());
  upper.quaternion.copy(upper.parent.getWorldQuaternion(new THREE.Quaternion()).invert()
    .multiply(new THREE.Quaternion().setFromUnitVectors(current, direction).multiply(world)));
  root.updateMatrixWorld(true); model.armTwist.update();
  shoulderCorrectives.setEnabled(false);
  const before = new Map([...affected, ...protectedVertices].map(i => [i, vertex(i)]));
  const transforms = skeleton.bones.map(bone => ({ p: bone.position.clone(), q: bone.quaternion.clone(), s: bone.scale.clone() }));
  shoulderCorrectives.setEnabled(true);
  let maxDisplacement = 0;
  for (const i of affected) {
    const point = vertex(i);
    assert(point.toArray().every(Number.isFinite));
    maxDisplacement = Math.max(maxDisplacement, point.distanceTo(before.get(i)));
  }
  for (const i of protectedVertices) report.maxProtectedMotion = Math.max(report.maxProtectedMotion, vertex(i).distanceTo(before.get(i)));
  skeleton.bones.forEach((bone, i) => assert(bone.position.equals(transforms[i].p)
    && bone.quaternion.equals(transforms[i].q) && bone.scale.equals(transforms[i].s), 'Correctives changed an animation joint'));
  assert(maxDisplacement > 1e-5 && maxDisplacement < 0.08);
  const first = mesh.morphTargetInfluences.slice(); shoulderCorrectives.update();
  assert.deepEqual(mesh.morphTargetInfluences, first);
  assert(mesh.morphTargetInfluences.every(weight => Number.isFinite(weight) && weight >= 0 && weight <= 1));
  report.samples.push({ rootAngle, side, elevation, reach, maxDisplacement });
}
assert(report.maxProtectedMotion < 1e-10, 'The zipper, center chest, and unrelated surfaces must stay anchored');
model.reset(); root.rotation.y = 0; root.updateMatrixWorld(true); shoulderCorrectives.update();
assert(mesh.morphTargetInfluences.every(weight => weight < 1e-10), 'The shoulder rest pose must remain unchanged');
for (const [name, values] of Object.entries(base)) assert.deepEqual(geometry.attributes[name].array, values, `Base ${name} changed`);
assert.deepEqual(geometry.index.array, topology);
await mkdir('artifacts/dance04-shoulder', { recursive: true });
await writeFile('artifacts/dance04-shoulder/checks.json', JSON.stringify(report, null, 2));
console.log('Shoulder correctives passed: 48 elevation/reach/root cases, anchored center chest, stable joints, exact rest/base mesh, and repeatability.');
model.dispose();
