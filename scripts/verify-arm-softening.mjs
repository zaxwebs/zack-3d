import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import * as THREE from 'three';
import { createZackModel } from '../src/ZackModel.js';
import { createZackRig } from '../src/ZackRig.js';
const bytes = await readFile('public/model/geometry.bin');
const model = createZackModel(JSON.parse(await readFile('public/model/manifest.json')), bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
const rig = createZackRig(model), { geometry, mesh, root, armSoftening } = model;
const originals = Object.fromEntries(['position', 'normal', 'uv', 'skinIndex', 'skinWeight'].map(name => [name, geometry.attributes[name].array.slice()]));
const topology = geometry.index.array.slice();
const vertex = i => mesh.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld);
armSoftening.update();
assert(geometry.attributes.armSurfaceCorrection.array.every(value => Math.abs(value) < 1e-7), 'The rest surface must remain unchanged');
const report = { ...armSoftening.report, poses: [], maxProtectedMotion: 0 };
for (const rootAngle of [0, 0.7]) for (const pose of ['down', 'front', 'hi', 'elbows', 'rest']) {
  root.rotation.y = rootAngle; rig.setPose(pose);
  const transforms = model.skeleton.bones.map(bone => ({ p: bone.position.clone(), q: bone.quaternion.clone(), s: bone.scale.clone() }));
  armSoftening.setEnabled(false);
  const before = Array.from({ length: geometry.attributes.position.count }, (_, i) => vertex(i));
  armSoftening.setEnabled(true);
  let maxDisplacement = 0;
  for (let i = 0; i < before.length; i++) {
    const point = vertex(i); assert(point.toArray().every(Number.isFinite));
    const displacement = point.distanceTo(before[i]);
    maxDisplacement = Math.max(maxDisplacement, displacement);
    const correction = geometry.attributes.armSurfaceCorrection;
    if (correction.getX(i) === 0 && correction.getY(i) === 0 && correction.getZ(i) === 0)
      report.maxProtectedMotion = Math.max(report.maxProtectedMotion, displacement);
  }
  assert(maxDisplacement <= 0.025001);
  assert(geometry.attributes.armSurfaceNormalCorrection.array.every(Number.isFinite));
  const values = geometry.attributes.armSurfaceCorrection.array.slice();
  armSoftening.update(); assert.deepEqual(geometry.attributes.armSurfaceCorrection.array, values, 'The cached pass must not accumulate deformation');
  model.skeleton.bones.forEach((bone, i) => assert(bone.position.equals(transforms[i].p)
    && bone.quaternion.equals(transforms[i].q) && bone.scale.equals(transforms[i].s), 'Surface relaxation must not alter animation joints'));
  report.poses.push({ rootAngle, pose, maxDisplacement });
}
assert(report.maxProtectedMotion < 1e-10);
for (const [name, values] of Object.entries(originals)) assert.deepEqual(geometry.attributes[name].array, values, `Base ${name} changed`);
assert.deepEqual(geometry.index.array, topology);
root.rotation.y = 0; model.reset(); armSoftening.update();
assert(geometry.attributes.armSurfaceCorrection.array.every(value => Math.abs(value) < 1e-7));
await mkdir('artifacts/shovel-arms', { recursive: true });
await writeFile('artifacts/shovel-arms/surface-checks.json', JSON.stringify(report, null, 2));
console.log('Arm softening passed: exact rest/base mesh, fixed topology, stable joints, bounded posed offsets, root transforms, and cached repeatability.');
model.dispose();
