import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { createZackModel } from '../src/ZackModel.js';
import { createZackRig, POSES } from '../src/ZackRig.js';

const binary = await readFile('public/model/geometry.bin');
const manifest = JSON.parse(await readFile('public/model/manifest.json', 'utf8'));
const model = createZackModel(manifest, binary.buffer.slice(binary.byteOffset, binary.byteOffset + binary.byteLength));
const rig = createZackRig(model);
const transforms = () => model.skeleton.bones.map(bone => ({
  position: bone.position.clone(), quaternion: bone.quaternion.clone().normalize(), scale: bone.scale.clone(),
}));
const rest = transforms();
const expectedJoints = {
  elbows: ['L_Forearm', 'R_Forearm'],
  twist: ['Waist', 'Spine01', 'Spine02'],
  lean: ['Waist', 'Spine01', 'Spine02'],
  bow: ['Waist', 'Spine01', 'Spine02'],
  knee: ['R_Thigh', 'R_Calf'],
};

for (const rootAngle of [0, 0.7]) {
  model.root.rotation.y = rootAngle;
  rig.setHeadTurn(20);
  rig.setPose('down');
  const baseline = transforms();
  const shoulderSlope = side => {
    const upper = model.bones[`${side}_Upperarm`].getWorldPosition(new THREE.Vector3());
    const clavicle = model.bones[`${side}_Clavicle`].getWorldPosition(new THREE.Vector3());
    const direction = upper.sub(clavicle).transformDirection(model.root.matrixWorld.clone().invert());
    return direction.y;
  };
  const relaxedSlopes = Object.fromEntries(['L', 'R'].map(side => [side, shoulderSlope(side)]));
  for (const name of Object.keys(POSES)) {
    rig.setPose(name);
    assert.equal(rig.currentPose, name);
    assert.equal(rig.headTurn, 20);
    const first = transforms();
    if (['down', 'elbows', 'knee'].includes(name)) {
      for (const side of ['L', 'R']) {
        const slope = shoulderSlope(side);
        assert(slope < -0.2 && slope > -0.55, `${name}: ${side} shoulder should have a relaxed downward slope`);
      }
    }
    if (name === 'front') for (const side of ['L', 'R']) {
      assert(shoulderSlope(side) > relaxedSlopes[side] + 0.1, 'Reaching should lift the shoulder from its relaxed position');
    }
    if (name === 'hi') {
      assert(shoulderSlope('R') > relaxedSlopes.R + 0.1, 'The waving shoulder should lift');
      assert(Math.abs(shoulderSlope('L') - relaxedSlopes.L) < 1e-6, 'The non-waving shoulder should stay relaxed');
    }
    for (const boneName of expectedJoints[name] ?? []) {
      const index = model.skeleton.bones.indexOf(model.bones[boneName]);
      assert(first[index].quaternion.angleTo(baseline[index].quaternion) > 0.01, `${name} must move ${boneName}`);
    }
    model.skeleton.bones.forEach((bone, index) => {
      assert(bone.position.equals(rest[index].position), `${name} must preserve ${bone.name} position`);
      assert(bone.scale.equals(rest[index].scale), `${name} must preserve ${bone.name} scale`);
    });
    for (let vertex = 0; vertex < model.geometry.attributes.position.count; vertex++) {
      const point = model.mesh.getVertexPosition(vertex, new THREE.Vector3());
      assert(point.toArray().every(Number.isFinite), `${name} has an invalid vertex`);
    }
    rig.setPose('hi');
    rig.setPose(name);
    model.skeleton.bones.forEach((bone, index) => {
      assert(bone.quaternion.clone().normalize().angleTo(first[index].quaternion) < 1e-6, `${name} must not accumulate rotations: ${bone.name}`);
    });
  }
}
rig.setHeadTurn(0);
rig.setPose('rest');
model.skeleton.bones.forEach((bone, index) => {
  assert(bone.quaternion.clone().normalize().angleTo(rest[index].quaternion) < 1e-6, `${bone.name} must reset completely`);
});
assert.throws(() => rig.setPose('invalid'), /Unknown pose/);
assert.throws(() => rig.setPose('toString'), /Unknown pose/);
for (const name of ['wrists', 'fingers', 'ankles']) {
  assert.throws(() => rig.setPose(name), /Unknown pose/);
}
model.dispose();
console.log(`All ${Object.keys(POSES).length} poses passed: joint motion, finite vertices, stable transforms, head turn, repeatability, and reset.`);
