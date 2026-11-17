import * as THREE from 'three';

export const POSES = Object.freeze({
  down: { label: 'Arms down', description: 'Relaxed shoulders and arms.' },
  front: { label: 'Arms forward', description: 'Shoulders reaching forward with open elbows.' },
  hi: { label: 'Right-hand wave', description: 'Right shoulder, elbow, and palm rotation.' },
  rest: { label: 'T-pose', description: 'Original rest pose for comparing joint deformation.' },
  elbows: { label: 'Bend elbows', description: 'Both elbows bend forward to 60 degrees.' },
  twist: { label: 'Torso twist', description: 'A 24-degree turn shared across the waist and spine.' },
  lean: { label: 'Side bend', description: 'A 16-degree side bend shared across the waist and spine.' },
  bow: { label: 'Bend forward', description: 'A 24-degree forward bend shared across the waist and spine.' },
  knee: { label: 'Right knee lift', description: 'Right hip lifts 40 degrees with a 60-degree knee bend.' },
});

/** Pose in character space; the imported bones have nonstandard local axes. */
export function createZackRig(model) {
  const { root, bones, mesh, skeleton } = model;
  const rest = skeleton.bones.map(b => ({ position: b.position.clone(), quaternion: b.quaternion.clone(), scale: b.scale.clone() }));
  const headRest = bones.Head.quaternion.clone();
  const armRestWorld = Object.fromEntries(['L', 'R'].map(side => [side, {
    upper: bones[`${side}_Upperarm`].getWorldQuaternion(new THREE.Quaternion()).normalize(),
    fore: bones[`${side}_Forearm`].getWorldQuaternion(new THREE.Quaternion()).normalize(),
  }]));
  const rootInverse = root.matrixWorld.clone().invert();
  const clavicleRestDirection = Object.fromEntries(['L', 'R'].map(side => [side,
    bones[`${side}_Upperarm`].getWorldPosition(new THREE.Vector3())
      .sub(bones[`${side}_Clavicle`].getWorldPosition(new THREE.Vector3()))
      .transformDirection(rootInverse),
  ]));
  let headTurn = 0;
  const gentleLimits = Object.freeze({ headYaw: 30, elbowFlex: 60, shoulderElevation: 115 });
  const limits = () => gentleLimits;
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
  function setHeadTurn(degrees) {
    if (!Number.isFinite(degrees)) throw new Error('Head turn must be a finite angle in degrees');
    headTurn = THREE.MathUtils.clamp(degrees, -limits().headYaw, limits().headYaw);
    bones.Head.quaternion.copy(headRest);
    root.updateMatrixWorld(true);
    const up = new THREE.Vector3(0, 1, 0).transformDirection(root.matrixWorld);
    rotateWorld(bones.Head, new THREE.Quaternion().setFromAxisAngle(up, THREE.MathUtils.degToRad(headTurn)));
    mesh.computeBoundingBox(); mesh.computeBoundingSphere();
  }
  function limitDirection(direction, reference, maxDegrees) {
    const target = new THREE.Vector3().fromArray(direction).normalize();
    const base = new THREE.Vector3().fromArray(reference).normalize();
    const angle = Math.acos(THREE.MathUtils.clamp(base.dot(target), -1, 1));
    const maximum = THREE.MathUtils.degToRad(maxDegrees);
    if (angle <= maximum) return target.toArray();
    const rotation = new THREE.Quaternion().setFromUnitVectors(base, target);
    rotation.slerp(new THREE.Quaternion(), 1 - maximum / angle);
    return base.applyQuaternion(rotation).normalize().toArray();
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
  function shareArmTwist(side) {
    const upper = bones[`${side}_Upperarm`], fore = bones[`${side}_Forearm`];
    const foreWorld = fore.getWorldQuaternion(new THREE.Quaternion()).normalize();
    const upperDelta = upper.getWorldQuaternion(new THREE.Quaternion()).normalize().multiply(armRestWorld[side].upper.clone().invert());
    const foreDelta = foreWorld.clone().multiply(armRestWorld[side].fore.clone().invert());
    const relative = foreDelta.multiply(upperDelta.invert()).normalize();
    if (relative.w < 0) relative.set(-relative.x, -relative.y, -relative.z, -relative.w);
    const axis = fore.getWorldPosition(v()).sub(upper.getWorldPosition(v())).normalize();
    const projected = new THREE.Vector3(relative.x, relative.y, relative.z).dot(axis);
    const angle = THREE.MathUtils.clamp(2 * Math.atan2(projected, relative.w), -THREE.MathUtils.degToRad(20), THREE.MathUtils.degToRad(20));
    // Share a small amount of the palm turn with the upper arm. Keep the
    // elbow position and the entire forearm/hand world frame unchanged.
    rotateWorld(upper, new THREE.Quaternion().setFromAxisAngle(axis, angle));
    fore.quaternion.copy(fore.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(foreWorld));
    root.updateMatrixWorld(true);
  }
  function setPose(name) {
    if (!Object.hasOwn(POSES, name)) throw new Error(`Unknown pose: ${name}`);
    skeleton.bones.forEach((b, i) => {
      b.position.copy(rest[i].position);
      b.quaternion.copy(rest[i].quaternion);
      b.scale.copy(rest[i].scale);
    });
    const rotateCharacter = (boneName, axis, degrees) => {
      const worldAxis = v().fromArray(axis).transformDirection(root.matrixWorld);
      rotateWorld(bones[boneName], new THREE.Quaternion().setFromAxisAngle(worldAxis, THREE.MathUtils.degToRad(degrees)));
    };
    if (name !== 'rest') {
      for (const side of ['L', 'R']) {
        const sign = side === 'L' ? 1 : -1;
        // The collarbone participates in reaching; avoid folding the entire
        // shoulder through a single upper-arm rotation.
        // Use the fitted bind direction as the base. The previous almost-
        // horizontal target shrugged the shoulders even in Arms down.
        const clavicleDirection = clavicleRestDirection[side].clone();
        if (name === 'front') clavicleDirection.add(new THREE.Vector3(0, 0.04, 0.15));
        else if (name === 'hi' && side === 'R') clavicleDirection.add(new THREE.Vector3(0, 0.10, 0.04));
        else clavicleDirection.y -= 0.20;
        aim(`${side}_Clavicle`, `${side}_Upperarm`, clavicleDirection.toArray());
        // Keep a little space between the sleeves and the torso.
        let upper = [sign * 0.26, -0.96, 0.05];
        let fore = [sign * 0.14, -0.98, 0.12];
        if (name === 'front') {
          upper = [sign * 0.20, -0.36, 0.91];
          fore = [sign * 0.08, 0.02, 1];
        }
        if (name === 'hi' && side === 'R') {
          // Raise the upper arm slightly so the greeting does not depend on
          // a tightly folded elbow. Keep the palm and thumb orientation.
          upper = [-0.82, 0.42, 0.38];
          fore = [-0.52, 0.74, 0.43];
        }
        if (name === 'elbows') {
          upper = [sign * 0.26, -0.96, 0];
          fore = [sign * 0.13, -0.48, 0.866];
        }
        upper = limitDirection(upper, [0, -1, 0], limits().shoulderElevation);
        fore = limitDirection(fore, upper, limits().elbowFlex);
        aim(`${side}_Upperarm`, `${side}_Forearm`, upper);
        aim(`${side}_Forearm`, `${side}_Hand`, fore);
        if (name === 'hi' && side === 'R') facePalm(side, [0, 0, 1]);
        if (name === 'hi' && side === 'R') shareArmTwist(side);
      }
    }
    if (['twist', 'lean', 'bow'].includes(name)) {
      const axis = name === 'twist' ? [0, 1, 0] : name === 'lean' ? [0, 0, 1] : [1, 0, 0];
      const degrees = name === 'lean' ? 4 : 6;
      for (const boneName of ['Waist', 'Spine01', 'Spine02']) {
        rotateCharacter(boneName, axis, boneName === 'Waist' ? degrees * 2 : degrees);
      }
    }
    if (name === 'knee') {
      rotateCharacter('R_Thigh', [1, 0, 0], -40);
      rotateCharacter('R_Calf', [1, 0, 0], 60);
    }
    setHeadTurn(headTurn);
    model.armTwist.update();
    model.elbowCorrectives.update();
    model.shoulderCorrectives.update();
    model.armSoftening.update();
    root.updateMatrixWorld(true);
    mesh.computeBoundingBox(); mesh.computeBoundingSphere();
    currentPose = name;
  }
  let currentPose = 'rest';
  return { setPose, setHeadTurn,
    get limits() { return limits(); },
    get headTurn() { return headTurn; }, get currentPose() { return currentPose; } };
}
