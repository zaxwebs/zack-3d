import * as THREE from 'three';

const BENDS = [45, 90, 135, 160];
const TWISTS = [-60, 0, 60];

function bracket(values, value) {
  if (value <= values[0]) return [values[0], values[0], 0];
  for (let i = 1; i < values.length; i++) {
    if (value <= values[i]) return [values[i - 1], values[i], (value - values[i - 1]) / (values[i] - values[i - 1])];
  }
  return [values.at(-1), values.at(-1), 0];
}

/** Author rounded elbow pose targets on the existing mesh, then drive them by pose. */
export function createElbowCorrectives({ root, mesh, geometry, skeleton, bones, armTwist }) {
  root.updateMatrixWorld(true);
  const rest = skeleton.bones.map(bone => ({
    position: bone.position.clone(), quaternion: bone.quaternion.clone(), scale: bone.scale.clone(),
  }));
  const restore = () => {
    skeleton.bones.forEach((bone, i) => {
      bone.position.copy(rest[i].position);
      bone.quaternion.copy(rest[i].quaternion);
      bone.scale.copy(rest[i].scale);
    });
    root.updateMatrixWorld(true);
  };
  const inverseRoot = root.matrixWorld.clone().invert();
  const localPosition = bone => bone.getWorldPosition(new THREE.Vector3()).applyMatrix4(inverseRoot);
  const position = geometry.attributes.position, normal = geometry.attributes.normal;
  const skinIndex = geometry.attributes.skinIndex, skinWeight = geometry.attributes.skinWeight;
  const restPoints = Array.from({ length: position.count }, (_, i) =>
    mesh.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld).applyMatrix4(inverseRoot));
  const bind = inverseRoot.clone().multiply(skeleton.bones[0].matrixWorld).multiply(skeleton.boneInverses[0]);
  const bindNormal = new THREE.Matrix3().getNormalMatrix(bind);
  const definitions = ['L', 'R'].map(side => {
    const upper = bones[`${side}_Upperarm`], forearm = bones[`${side}_Forearm`], hand = bones[`${side}_Hand`];
    const pivot = localPosition(forearm), incoming = pivot.clone().sub(localPosition(upper)).normalize();
    const outgoing = localPosition(hand).sub(pivot).normalize();
    const inside = new THREE.Vector3(0, 0, 1).addScaledVector(incoming, -incoming.z).normalize();
    const hinge = incoming.clone().cross(inside).normalize();
    const family = new Set(skeleton.bones.flatMap((bone, i) =>
      bone.name.startsWith(`${side}_Upperarm`) || bone.name.startsWith(`${side}_Forearm`)
        || bone.name.startsWith(`${side}_Elbow`) ? [i] : []));
    const vertices = [];
    for (let vertex = 0; vertex < position.count; vertex++) {
      let mass = 0;
      for (let slot = 0; slot < 4; slot++) {
        if (family.has(skinIndex.array[vertex * 4 + slot])) mass += skinWeight.array[vertex * 4 + slot];
      }
      const armFade = THREE.MathUtils.smoothstep(mass, 0.65, 0.95);
      if (!armFade) continue;
      const offset = restPoints[vertex].clone().sub(pivot), along = offset.dot(incoming);
      const radial = offset.clone().addScaledVector(incoming, -along);
      const brush = (1 - THREE.MathUtils.smoothstep(Math.abs(along), 0.04, 0.07))
        * (1 - THREE.MathUtils.smoothstep(radial.length(), 0.055, 0.075)) * armFade;
      if (brush < 1e-6) continue;
      vertices.push({ vertex, along, inside: radial.dot(inside), side: radial.dot(hinge), brush });
    }
    return { side, upper, forearm, hand, pivot, incoming, outgoing, inside, hinge, vertices,
      forearmLength: localPosition(hand).distanceTo(pivot),
      restBend: incoming.angleTo(outgoing),
      restLocal: forearm.quaternion.clone(), restWorld: forearm.getWorldQuaternion(new THREE.Quaternion()),
      twistAxis: hand.position.clone().applyQuaternion(forearm.quaternion).normalize(),
      targets: new Map() };
  });
  const morphPositions = [], morphNormals = [];
  let maxDelta = 0;
  for (const d of definitions) for (const bend of BENDS) for (const twist of TWISTS) {
    restore();
    const angle = Math.min(THREE.MathUtils.degToRad(bend) + d.restBend, THREE.MathUtils.degToRad(170));
    const roll = THREE.MathUtils.degToRad(twist);
    const outgoing = d.incoming.clone().applyAxisAngle(d.hinge, angle);
    const rotation = new THREE.Quaternion().setFromUnitVectors(d.outgoing, outgoing);
    const world = new THREE.Quaternion().setFromAxisAngle(outgoing, roll).multiply(rotation).multiply(d.restWorld);
    const rootWorld = root.getWorldQuaternion(new THREE.Quaternion());
    world.premultiply(rootWorld);
    d.forearm.quaternion.copy(d.forearm.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(world));
    root.updateMatrixWorld(true);
    armTwist.update();
    const boneMatrices = skeleton.bones.map((bone, i) => bone.matrixWorld.clone().multiply(skeleton.boneInverses[i]));
    const left = root.matrixWorld.clone().invert().multiply(mesh.matrixWorld).multiply(mesh.bindMatrixInverse);
    const deltas = new Float32Array(position.count * 3), normals = new Float32Array(position.count * 3);
    const tangentDistance = 0.04;
    const radius = tangentDistance / Math.tan(angle / 2);
    const center = d.pivot.clone().addScaledVector(d.incoming, -tangentDistance).addScaledVector(d.inside, radius);
    for (const entry of d.vertices) {
      const { vertex, along, brush } = entry;
      const phase = THREE.MathUtils.clamp((along + tangentDistance) / (2 * tangentDistance), 0, 1);
      const phi = phase * angle;
      // Keep axial rotation spread down the forearm; the bend arc must not
      // concentrate the entire wristward roll into this small elbow patch.
      const rollPhase = THREE.MathUtils.smoothstep(along, 0, d.forearmLength);
      let target;
      if (along < -tangentDistance) target = d.pivot.clone().addScaledVector(d.incoming, along);
      else if (along > tangentDistance) target = d.pivot.clone().addScaledVector(outgoing, along);
      else target = center.clone().addScaledVector(d.incoming, radius * Math.sin(phi))
        .addScaledVector(d.inside, -radius * Math.cos(phi));
      const tangent = d.incoming.clone().applyAxisAngle(d.hinge, phi);
      const radial = d.inside.clone().multiplyScalar(entry.inside).addScaledVector(d.hinge, entry.side)
        .applyAxisAngle(d.hinge, phi).applyAxisAngle(tangent, roll * rollPhase);
      target.add(radial);
      const weighted = new THREE.Matrix4();
      weighted.elements.fill(0);
      for (let slot = 0; slot < 4; slot++) {
        const index = skinIndex.array[vertex * 4 + slot], weight = skinWeight.array[vertex * 4 + slot];
        for (let k = 0; k < 16; k++) weighted.elements[k] += boneMatrices[index].elements[k] * weight;
      }
      const skin = left.clone().multiply(weighted).multiply(mesh.bindMatrix);
      if (Math.abs(skin.determinant()) < 1e-7) continue;
      const base = new THREE.Vector3().fromBufferAttribute(position, vertex);
      const posed = base.clone().applyMatrix4(skin);
      const desired = posed.clone().lerp(target, brush);
      const delta = desired.applyMatrix4(skin.clone().invert()).sub(base);
      delta.clampLength(0, 0.06);
      maxDelta = Math.max(maxDelta, delta.length());
      delta.toArray(deltas, vertex * 3);
      const baseNormal = new THREE.Vector3().fromBufferAttribute(normal, vertex);
      const targetNormal = baseNormal.clone().applyMatrix3(bindNormal).normalize()
        .applyAxisAngle(d.hinge, phi).applyAxisAngle(tangent, roll * rollPhase);
      const authored = targetNormal.applyMatrix3(new THREE.Matrix3().setFromMatrix4(skin).invert()).normalize();
      authored.sub(baseNormal).multiplyScalar(brush).toArray(normals, vertex * 3);
    }
    const name = `${d.side}_Elbow_B${bend}_T${twist}`;
    const attribute = new THREE.BufferAttribute(deltas, 3);
    attribute.name = name;
    const normalAttribute = new THREE.BufferAttribute(normals, 3);
    normalAttribute.name = name;
    d.targets.set(`${bend},${twist}`, morphPositions.length);
    morphPositions.push(attribute);
    morphNormals.push(normalAttribute);
  }
  restore();
  geometry.morphTargetsRelative = true;
  geometry.morphAttributes.position = morphPositions;
  geometry.morphAttributes.normal = morphNormals;
  mesh.updateMorphTargets();
  const targetCount = morphPositions.length;
  let enabled = true;

  function reset() { mesh.morphTargetInfluences.fill(0, 0, targetCount); }
  function update() {
    reset();
    if (!enabled) return;
    root.updateMatrixWorld(true);
    for (const d of definitions) {
      const incoming = localPosition(d.forearm).sub(localPosition(d.upper)).normalize();
      const outgoing = localPosition(d.hand).sub(localPosition(d.forearm)).normalize();
      const bend = Math.max(0, THREE.MathUtils.radToDeg(incoming.angleTo(outgoing) - d.restBend));
      const delta = d.forearm.quaternion.clone().multiply(d.restLocal.clone().invert()).normalize();
      let twist = THREE.MathUtils.radToDeg(2 * Math.atan2(
        new THREE.Vector3(delta.x, delta.y, delta.z).dot(d.twistAxis), delta.w));
      twist = THREE.MathUtils.euclideanModulo(twist + 180, 360) - 180;
      // The sampled twist range is bounded. Fade toward the uncorrected skin
      // outside it, so the -180/180 wrap cannot switch between two sculpts.
      const twistFade = 1 - THREE.MathUtils.smoothstep(Math.abs(twist), 90, 180);
      const [b0, b1, bt] = bracket([0, ...BENDS], bend);
      const [t0, t1, tt] = bracket(TWISTS, twist);
      for (const [b, bw] of [[b0, 1 - bt], [b1, bt]]) for (const [t, tw] of [[t0, 1 - tt], [t1, tt]]) {
        const index = d.targets.get(`${b},${t}`);
        if (index !== undefined) mesh.morphTargetInfluences[index] += bw * tw * twistFade;
      }
    }
  }

  return { update, reset, setEnabled(value) { enabled = Boolean(value); update(); },
    get enabled() { return enabled; },
    report: { bends: BENDS, twists: TWISTS, targets: morphPositions.length, maxBindDelta: maxDelta,
      vertices: definitions.map(d => ({ side: d.side, count: d.vertices.length })) } };
}
