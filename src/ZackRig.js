import * as THREE from 'three';

/** Pose in character space; the imported bones have nonstandard local axes. */
export function createZackRig(model) {
  const { root, bones, mesh, skeleton } = model;
  const rest = skeleton.bones.map(b => b.quaternion.clone());
  const v = () => new THREE.Vector3();
  function rotateWorld(bone, rotation) {
    const world = bone.getWorldQuaternion(new THREE.Quaternion());
    const parent = bone.parent.getWorldQuaternion(new THREE.Quaternion());
    bone.quaternion.copy(parent.invert().multiply(rotation.clone().multiply(world)));
    root.updateMatrixWorld(true);
  }
  function aim(name, childName, direction) {
    root.updateMatrixWorld(true);
    const bone = bones[name];
    const current = bones[childName].getWorldPosition(v()).sub(bone.getWorldPosition(v())).normalize();
    const target = v().fromArray(direction).transformDirection(root.matrixWorld);
    const delta = new THREE.Quaternion().setFromUnitVectors(current, target);
    rotateWorld(bone, delta);
  }
  function facePalm(side, direction) {
    root.updateMatrixWorld(true);
    const hand = bones[`${side}_Hand`];
    const origin = hand.getWorldPosition(v());
    const index = bones[`${side}_Index1`].getWorldPosition(v()).sub(origin);
    const pinky = bones[`${side}_Pinky1`].getWorldPosition(v()).sub(origin);
    const axis = bones[`${side}_Mid1`].getWorldPosition(v()).sub(origin).normalize();
    // Mirrored hands have opposite winding. Use the palm-facing normal,
    // not the back-of-hand normal, so the waving thumb faces the head.
    const normal = index.cross(pinky).normalize().multiplyScalar(side === 'R' ? 1 : -1);
    normal.addScaledVector(axis, -normal.dot(axis)).normalize();
    const target = v().fromArray(direction).transformDirection(root.matrixWorld);
    target.addScaledVector(axis, -target.dot(axis)).normalize();
    const angle = Math.atan2(axis.dot(normal.clone().cross(target)), normal.dot(target));
    // Turn the whole forearm frame so cuff and hand stay aligned. Rotating only
    // the hand collapses the cuff under linear skinning.
    const forearmAxis = hand.getWorldPosition(v()).sub(bones[`${side}_Forearm`].getWorldPosition(v())).normalize();
    rotateWorld(bones[`${side}_Forearm`], new THREE.Quaternion().setFromAxisAngle(forearmAxis, angle));
  }
  function setPose(name) {
    if (!['rest', 'down', 'front', 'hi'].includes(name)) throw new Error(`Unknown pose: ${name}`);
    skeleton.bones.forEach((b, i) => b.quaternion.copy(rest[i]));
    if (name !== 'rest') {
      for (const side of ['L', 'R']) {
        const sign = side === 'L' ? 1 : -1;
        // The collarbone participates in reaching; avoid folding the entire
        // shoulder through a single upper-arm rotation.
        aim(`${side}_Clavicle`, `${side}_Upperarm`, name === 'front'
          ? [sign, 0.04, 0.15]
          : name === 'hi' && side === 'R' ? [sign, 0.10, 0.04] : [sign, -0.025, 0]);
        // Keep a little space between the sleeves and the torso.
        let upper = [sign * 0.26, -0.96, 0.05];
        let fore = [sign * 0.14, -0.98, 0.12];
        if (name === 'front') {
          upper = [sign * 0.20, -0.36, 0.91];
          fore = [sign * 0.08, 0.02, 1];
        }
        if (name === 'hi' && side === 'R') {
          upper = [-0.85, -0.22, 0.35];
          fore = [-0.10, 0.98, 0.17];
        }
        aim(`${side}_Upperarm`, `${side}_Forearm`, upper);
        aim(`${side}_Forearm`, `${side}_Hand`, fore);
        if (name === 'hi' && side === 'R') facePalm(side, [0, 0, 1]);
      }
    }
    root.updateMatrixWorld(true);
    mesh.computeBoundingBox(); mesh.computeBoundingSphere();
    currentPose = name;
  }
  let currentPose = 'rest';
  return { setPose, get currentPose() { return currentPose; } };
}
