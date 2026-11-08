import * as THREE from 'three';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createZackModel } from '../src/ZackModel.js';
import { createZackRig } from '../src/ZackRig.js';

const data = await readFile('public/model/geometry.bin');
const model = createZackModel(JSON.parse(await readFile('public/model/manifest.json', 'utf8')), data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
const rig = createZackRig(model);
const report = { headTurns: [], legTests: [], seamMismatches: 0, maxWeightSumError: 0 };
function worldVertex(i) { return model.mesh.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(model.mesh.matrixWorld); }
function rotateWorld(bone, axis, angle) {
  model.root.updateMatrixWorld(true);
  const q = bone.getWorldQuaternion(new THREE.Quaternion());
  bone.quaternion.copy(bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(new THREE.Quaternion().setFromAxisAngle(axis, angle).multiply(q)));
  model.root.updateMatrixWorld(true);
}
for (const rootAngle of [0, 0.7]) {
  model.root.rotation.y = rootAngle;
  rig.setHeadTurn(0);
  const base = model.bones.Head.getWorldQuaternion(new THREE.Quaternion()).normalize();
  for (const degrees of [-45, -30, 30, 45]) {
    rig.setHeadTurn(degrees);
    const delta = model.bones.Head.getWorldQuaternion(new THREE.Quaternion()).normalize().multiply(base.clone().invert()).normalize();
    const effective = THREE.MathUtils.clamp(degrees, -rig.limits.headYaw, rig.limits.headYaw);
    const expected = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0).transformDirection(model.root.matrixWorld), THREE.MathUtils.degToRad(effective));
    const error = delta.angleTo(expected);
    assert(error < 1e-6, `Head yaw must not introduce roll: ${error}`);
    rig.setPose('hi');
    assert.equal(rig.headTurn, effective);
    report.headTurns.push({ rootAngle, requestedDegrees: degrees, degrees: effective, rotationError: error });
  }
}
model.root.rotation.set(0, 0, 0);
rig.setHeadTurn(45); assert.equal(rig.headTurn, 30);
rig.setHeadTurn(-45); assert.equal(rig.headTurn, -30);
rig.setHeadTurn(0); rig.setPose('down');
const calfPosition = model.bones.R_Calf.position.clone();
const calfScale = model.bones.R_Calf.scale.clone();
model.bones.R_Calf.position.x += 0.04;
model.bones.R_Calf.scale.setScalar(0.7);
rig.setPose('down');
assert(model.bones.R_Calf.position.equals(calfPosition));
assert(model.bones.R_Calf.scale.equals(calfScale));

for (const side of ['L', 'R']) {
  rig.setPose('down');
  const protectedVertices = [];
  for (let i = 0; i < model.geometry.attributes.position.count; i++) {
    const p = worldVertex(i);
    if (Math.abs(p.x - 0.002) < 0.08 && p.y > 0.46 && p.y < 0.61) protectedVertices.push({ i, p });
  }
  const kneeBefore = model.bones[`${side}_Calf`].getWorldPosition(new THREE.Vector3());
  rotateWorld(model.bones[`${side}_Thigh`], new THREE.Vector3(1, 0, 0), THREE.MathUtils.degToRad(-50));
  rotateWorld(model.bones[`${side}_Calf`], new THREE.Vector3(1, 0, 0), THREE.MathUtils.degToRad(65));
  let maxHoodieDisplacement = 0;
  for (const { i, p } of protectedVertices) maxHoodieDisplacement = Math.max(maxHoodieDisplacement, p.distanceTo(worldVertex(i)));
  assert(maxHoodieDisplacement < 1e-6);
  assert(kneeBefore.distanceTo(model.bones[`${side}_Calf`].getWorldPosition(new THREE.Vector3())) > 0.1, 'Leg test must actually move the knee');
  report.legTests.push({ side, sampleCount: protectedVertices.length, maxHoodieDisplacement });
}

const joints = model.geometry.attributes.skinIndex;
const weights = model.geometry.attributes.skinWeight;
const points = model.geometry.attributes.position;
const coincident = new Map();
const boneUsage = new Array(model.skeleton.bones.length).fill(0);
for (let i = 0; i < points.count; i++) {
  let sum = 0;
  for (let k = 0; k < 4; k++) {
    const index = joints.array[i * 4 + k], weight = weights.array[i * 4 + k];
    assert(Number.isInteger(index) && index >= 0 && index < model.skeleton.bones.length);
    assert(Number.isFinite(weight) && weight >= 0);
    sum += weight;
    boneUsage[index] += weight;
  }
  report.maxWeightSumError = Math.max(report.maxWeightSumError, Math.abs(sum - 1));
  const key = `${points.getX(i)},${points.getY(i)},${points.getZ(i)}`;
  const signature = [...joints.array.slice(i * 4, i * 4 + 4), ...weights.array.slice(i * 4, i * 4 + 4)].join(',');
  if (coincident.has(key) && coincident.get(key) !== signature) report.seamMismatches++;
  coincident.set(key, signature);
}
assert(report.maxWeightSumError < 1e-6);
assert.equal(report.seamMismatches, 0);

// A posed native scene must retain all corrected skin weights and transforms.
const copy = new THREE.ObjectLoader().parse(model.root.toJSON());
copy.updateMatrixWorld(true);
let mesh; copy.traverse(node => { if (node.isSkinnedMesh) mesh = node; });
let exportError = 0;
for (let i = 0; i < points.count; i++) exportError = Math.max(exportError, worldVertex(i).distanceTo(mesh.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld)));
assert(exportError < 1e-6);
report.exportError = exportError;
report.boneCount = model.skeleton.bones.length;
report.bonesWithoutDirectWeights = model.skeleton.bones.filter((bone, i) => boneUsage[i] < 1e-8).map(bone => bone.name);
report.hoodieCorrection = model.root.userData.hoodieWeightCorrection;
await mkdir('artifacts/rig-audit', { recursive: true });
await writeFile('artifacts/rig-audit/checks.json', JSON.stringify(report, null, 2));
model.dispose();
console.log('Rig checks passed: upright head yaw, complete pose reset, stable hoodie during leg flex, matching seam weights, posed JSON round trip.');
