import * as THREE from 'three';

/** Add forearm swing frames so axial roll can start after the elbow hinge. */
export function createElbowBlend({ root, mesh, skeleton, bones, geometry }) {
  const definitions = ['L', 'R'].map(side => {
    const upper = bones[`${side}_Upperarm`], forearm = bones[`${side}_Forearm`];
    const helper = new THREE.Bone();
    helper.name = `${side}_ElbowBlend`;
    helper.position.copy(forearm.position);
    helper.quaternion.copy(forearm.quaternion);
    helper.scale.copy(forearm.scale);
    upper.add(helper);
    bones[helper.name] = helper;
    skeleton.bones.push(helper);
    skeleton.boneInverses.push(skeleton.boneInverses[skeleton.bones.indexOf(forearm)].clone());
    const round = helper.clone();
    round.name = `${side}_ElbowRound`;
    upper.add(round);
    bones[round.name] = round;
    skeleton.bones.push(round);
    skeleton.boneInverses.push(skeleton.boneInverses[skeleton.bones.indexOf(forearm)].clone());
    return { side, helper, round, upper, forearm,
      upperRest: upper.getWorldQuaternion(new THREE.Quaternion()).normalize(),
      foreRest: forearm.getWorldQuaternion(new THREE.Quaternion()).normalize() };
  });
  root.updateMatrixWorld(true);
  skeleton.init();

  function updateRound() {
    for (const d of definitions) {
      const upperDelta = d.upper.getWorldQuaternion(new THREE.Quaternion()).normalize().multiply(d.upperRest.clone().invert());
      const foreDelta = d.helper.getWorldQuaternion(new THREE.Quaternion()).normalize().multiply(d.foreRest.clone().invert());
      const desired = upperDelta.slerp(foreDelta, 0.5).multiply(d.foreRest);
      d.round.quaternion.copy(d.upper.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(desired));
      d.round.updateMatrixWorld(true);
    }
  }

  function applyRoundWeights() {
    const indices = geometry.attributes.skinIndex, weights = geometry.attributes.skinWeight;
    const inverseRoot = root.matrixWorld.clone().invert();
    const localPosition = bone => bone.getWorldPosition(new THREE.Vector3()).applyMatrix4(inverseRoot);
    const report = [];
    for (const d of definitions) {
      const family = new Set(skeleton.bones.flatMap((bone, i) => bone === d.helper
        || bone.name.startsWith(`${d.side}_Upperarm`) || bone.name.startsWith(`${d.side}_Forearm`) ? [i] : []));
      const helperIndex = skeleton.bones.indexOf(d.round);
      const pivot = localPosition(d.forearm), axis = pivot.clone().sub(localPosition(d.upper)).normalize();
      let correctedVertices = 0;
      for (let vertex = 0; vertex < indices.count; vertex++) {
        const influences = new Map();
        let mass = 0;
        for (let slot = 0; slot < 4; slot++) {
          const index = indices.array[vertex * 4 + slot], weight = weights.array[vertex * 4 + slot];
          if (weight > 0) influences.set(index, (influences.get(index) || 0) + weight);
          if (family.has(index)) mass += weight;
        }
        if (mass < 0.8) continue;
        const offset = mesh.getVertexPosition(vertex, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld)
          .applyMatrix4(inverseRoot).sub(pivot);
        const along = offset.dot(axis), radial = offset.addScaledVector(axis, -along);
        const outer = 1 - THREE.MathUtils.smoothstep(radial.z, -0.025, 0.01);
        const blend = 0.6 * outer * (1 - THREE.MathUtils.smoothstep(Math.abs(along), 0, 0.045))
          * (1 - THREE.MathUtils.smoothstep(radial.length(), 0.05, 0.07));
        if (blend < 1e-6) continue;
        for (const [index, weight] of influences) if (family.has(index)) influences.set(index, weight * (1 - blend));
        influences.set(helperIndex, mass * blend);
        const entries = [...influences].filter(([, weight]) => weight > 0).sort((a, b) => b[1] - a[1]).slice(0, 4);
        const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
        for (let slot = 0; slot < 4; slot++) {
          indices.array[vertex * 4 + slot] = entries[slot]?.[0] ?? 0;
          weights.array[vertex * 4 + slot] = (entries[slot]?.[1] ?? 0) / total;
        }
        correctedVertices++;
      }
      report.push({ side: d.side, correctedVertices });
    }
    indices.needsUpdate = weights.needsUpdate = true;
    return { mode: 'swing-only-at-elbow', rollFractions: [0, 0.5, 1], outerStrength: 0.6, joints: report };
  }
  return { helpers: definitions.map(d => d.helper), roundHelpers: definitions.map(d => d.round), updateRound, applyRoundWeights };
}
