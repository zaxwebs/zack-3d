import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import * as THREE from 'three';
import { createZackModel } from '../src/ZackModel.js';

const bytes = await readFile('public/model/geometry.bin');
const manifest = JSON.parse(await readFile('public/model/manifest.json'));
const model = createZackModel(manifest, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
const { bones, root, geometry, mesh, skeleton } = model;
const vertex = i => mesh.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld);
const rest = Array.from({ length: geometry.attributes.position.count }, (_, i) => vertex(i));
const report = { segments: root.userData.armTwistWeights.segments, restError: 0, rotationChecks: [] };
model.armTwist.update();
for (let i = 0; i < rest.length; i++) report.restError = Math.max(report.restError, rest[i].distanceTo(vertex(i)));
assert(report.restError < 1e-6, 'Helpers must not move the rest surface');

for (const rootAngle of [0, 0.7]) for (const side of ['L', 'R']) for (const segment of ['Upperarm', 'Forearm']) {
  model.reset();
  root.rotation.y = rootAngle;
  root.updateMatrixWorld(true);
  const bone = bones[`${side}_${segment}`];
  const child = bones[`${side}_${segment === 'Upperarm' ? 'Forearm' : 'Hand'}`];
  const helper = bones[`${side}_${segment}Twist01`];
  const axis = child.position.clone().normalize();
  const jointRest = skeleton.bones.map(b => ({ position: b.position.clone(), scale: b.scale.clone() }));
  const pivot = bone.getWorldPosition(new THREE.Vector3());
  const along = child.getWorldPosition(new THREE.Vector3()).sub(pivot).normalize();
  const base = helper.getWorldQuaternion(new THREE.Quaternion());
  const rotation = new THREE.Quaternion().setFromAxisAngle(axis, 2 * Math.PI / 3);
  if (segment === 'Upperarm') bone.quaternion.multiply(rotation);
  else child.quaternion.premultiply(rotation);
  root.updateMatrixWorld(true);
  const before = skeleton.bones.map(b => ({
    position: b.getWorldPosition(new THREE.Vector3()), quaternion: b.getWorldQuaternion(new THREE.Quaternion()),
  }));
  model.armTwist.update();
  skeleton.bones.forEach((b, i) => {
    if (/(?:Upperarm|Forearm)Twist|ElbowBlend|ElbowRound/.test(b.name)) return;
    assert(b.getWorldPosition(new THREE.Vector3()).distanceTo(before[i].position) < 1e-8, `${b.name} moved`);
    const orientation = b.getWorldQuaternion(new THREE.Quaternion()).normalize();
    assert(orientation.angleTo(before[i].quaternion.normalize()) < 1e-6, `${b.name} rotated`);
    assert(b.position.equals(jointRest[i].position) && b.scale.equals(jointRest[i].scale),
      'Joint translations and scales must be retained');
  });
  const roll = helper.getWorldQuaternion(new THREE.Quaternion()).normalize().multiply(base.normalize().invert());
  const expected = segment === 'Upperarm' ? new THREE.Quaternion()
    : new THREE.Quaternion().setFromAxisAngle(along, Math.PI / 3);
  assert(roll.angleTo(expected) < 1e-6, 'Axial rotation should be spread without adding swing');
  report.rotationChecks.push({ rootAngle, side, segment,
    helperRollDegrees: THREE.MathUtils.radToDeg(roll.angleTo(new THREE.Quaternion())) });
}
model.reset();
// A forearm roll must begin after the elbow, while the wrist retains the
// complete turn. This catches a twisted sleeve seam that hand-only tests miss.
for (const side of ['L', 'R']) {
  model.reset();
  root.updateMatrixWorld(true);
  const forearm = bones[`${side}_Forearm`], hand = bones[`${side}_Hand`];
  const names = ['ElbowBlend', 'ForearmTwist01', 'ForearmTwist02'];
  const baseline = names.map(name => bones[`${side}_${name}`].getWorldQuaternion(new THREE.Quaternion()).normalize());
  const axis = hand.position.clone().normalize();
  const worldAxis = axis.clone().applyQuaternion(forearm.getWorldQuaternion(new THREE.Quaternion())).normalize();
  forearm.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(axis, 2 * Math.PI / 3));
  hand.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, Math.PI / 6));
  root.updateMatrixWorld(true);
  const mainBefore = skeleton.bones.map(bone => bone.getWorldQuaternion(new THREE.Quaternion()).normalize());
  model.armTwist.update();
  names.forEach((name, i) => {
    const delta = bones[`${side}_${name}`].getWorldQuaternion(new THREE.Quaternion()).normalize().multiply(baseline[i].clone().invert());
    const expected = new THREE.Quaternion().setFromAxisAngle(worldAxis, i * 5 * Math.PI / 12);
    assert(delta.angleTo(expected) < 1e-6, `${side}: elbow/forearm/wrist roll should be 0/75/150 degrees`);
  });
  skeleton.bones.forEach((bone, i) => {
    if (/(?:Upperarm|Forearm)Twist|ElbowBlend|ElbowRound/.test(bone.name)) return;
    assert(bone.getWorldQuaternion(new THREE.Quaternion()).normalize().angleTo(mainBefore[i]) < 1e-6,
      'Distributing roll must preserve the main animation joints');
  });
  const posed = names.map(name => bones[`${side}_${name}`].getWorldQuaternion(new THREE.Quaternion()).normalize());
  for (const bone of [forearm, hand]) {
    const q = bone.quaternion;
    q.set(-q.x, -q.y, -q.z, -q.w);
    model.armTwist.update();
    names.forEach((name, i) => {
      assert(bones[`${side}_${name}`].getWorldQuaternion(new THREE.Quaternion()).normalize().angleTo(posed[i]) < 1e-6,
        `${side}: equivalent ${bone.name} rotation changed ${name}`);
    });
  }
}
model.reset();
const totals = new Array(skeleton.bones.length).fill(0);
for (let i = 0; i < geometry.attributes.skinWeight.array.length; i++) {
  totals[geometry.attributes.skinIndex.array[i]] += geometry.attributes.skinWeight.array[i];
}
for (const bone of skeleton.bones.filter(b => /(?:Upperarm|Forearm)Twist|ElbowBlend|ElbowRound/.test(b.name))) {
  assert(totals[skeleton.bones.indexOf(bone)] > 1, `${bone.name} should deform the sleeve`);
}
await mkdir('artifacts/arm-audit', { recursive: true });
await writeFile('artifacts/arm-audit/checks.json', JSON.stringify(report, null, 2));
console.log('Arm twist checks passed: rest surface, both sides, rotated root, 120-degree axial turns, stable main joints, and weighted helpers.');
model.dispose();
