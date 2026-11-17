import * as THREE from 'three';

/** Round the outer elbow while allowing the inside of the sleeve to fold together. */
export function refineElbowWeights({ root, mesh, skeleton, bones, geometry }) {
  const indices = geometry.attributes.skinIndex, weights = geometry.attributes.skinWeight;
  const inverseRoot = root.matrixWorld.clone().invert();
  const localPosition = bone => bone.getWorldPosition(new THREE.Vector3()).applyMatrix4(inverseRoot);
  const report = [];
  for (const side of ['L', 'R']) {
    const upper = bones[`${side}_Upperarm`], forearm = bones[`${side}_Forearm`];
    const parent = skeleton.bones.indexOf(upper), child = skeleton.bones.indexOf(forearm);
    const pivot = localPosition(forearm), axis = pivot.clone().sub(localPosition(upper)).normalize();
    const stats = { side, correctedVertices: 0, maxTransferredWeight: 0 };
    for (let vertex = 0; vertex < weights.count; vertex++) {
      const influences = new Map();
      for (let slot = 0; slot < 4; slot++) {
        const index = indices.array[vertex * 4 + slot], weight = weights.array[vertex * 4 + slot];
        if (weight > 0) influences.set(index, (influences.get(index) || 0) + weight);
      }
      const mass = (influences.get(parent) || 0) + (influences.get(child) || 0);
      if (mass < 0.8 || [...influences.keys()].filter(index => index !== parent && index !== child).length > 2) continue;
      const offset = mesh.getVertexPosition(vertex, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld)
        .applyMatrix4(inverseRoot).sub(pivot);
      const along = offset.dot(axis);
      const radial = offset.addScaledVector(axis, -along), radius = radial.length();
      const brush = (1 - THREE.MathUtils.smoothstep(Math.abs(along), 0.04, 0.085))
        * (1 - THREE.MathUtils.smoothstep(radius, 0.05, 0.07));
      if (brush < 1e-6) continue;
      const original = (influences.get(child) || 0) / mass;
      // Both elbow hinges flex toward character-forward. A wide outer blend
      // rounds the turn; the narrow inner blend lets the sleeves overlap at
      // the crease instead of stretching their inside walls into a notch.
      const inner = THREE.MathUtils.smoothstep(radial.z, -0.035, 0.035);
      const halfWidth = THREE.MathUtils.lerp(0.05, 0.04, inner);
      const target = THREE.MathUtils.smoothstep(along, -halfWidth, halfWidth);
      // Forearm influence must end before the sleeve cap. Otherwise splitting
      // it into twist frames consumes a fifth slot and drops the torso anchor.
      const keepForearm = THREE.MathUtils.smoothstep(along, -0.055, -0.025);
      const childWeight = (mass * original + (target - original) * brush * mass) * keepForearm;
      const change = childWeight - mass * original;
      if (Math.abs(change) < 1e-6) continue;
      influences.set(child, childWeight);
      influences.set(parent, mass - childWeight);
      const entries = [...influences].filter(([, weight]) => weight > 0).sort((a, b) => b[1] - a[1]);
      const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
      for (let slot = 0; slot < 4; slot++) {
        indices.array[vertex * 4 + slot] = entries[slot]?.[0] ?? 0;
        weights.array[vertex * 4 + slot] = (entries[slot]?.[1] ?? 0) / total;
      }
      stats.correctedVertices++;
      stats.maxTransferredWeight = Math.max(stats.maxTransferredWeight, Math.abs(change));
    }
    report.push(stats);
  }
  return { outerHalfWidth: 0.05, innerHalfWidth: 0.04, proximalForearmFade: [-0.055, -0.025], strength: 1, joints: report };
}
