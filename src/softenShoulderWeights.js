import * as THREE from 'three';

/** Share shoulder motion through an oval patch of upper hoodie, fading to the spine. */
export function softenShoulderWeights({ root, mesh, skeleton, bones, geometry }) {
  const indices = geometry.attributes.skinIndex;
  const weights = geometry.attributes.skinWeight;
  const indexOf = bone => skeleton.bones.indexOf(bone);
  const spineIndices = new Set([indexOf(bones.Spine01), indexOf(bones.Spine02)]);
  const inverseRoot = root.matrixWorld.clone().invert();
  const localPosition = bone => bone.getWorldPosition(new THREE.Vector3()).applyMatrix4(inverseRoot);
  const chestX = localPosition(bones.Spine02).x;
  const patches = Object.fromEntries(['L', 'R'].map(side => {
    const clavicle = bones[`${side}_Clavicle`];
    const upper = bones[`${side}_Upperarm`];
    return [side, {
      center: localPosition(clavicle).lerp(localPosition(upper), 0.5),
      clavicle: indexOf(clavicle), upper: indexOf(upper),
    }];
  }));
  const radii = new THREE.Vector3(0.085, 0.085, 0.14);
  const strength = 0.65;
  const point = new THREE.Vector3();
  const stats = { correctedVertices: 0, maxTransferredWeight: 0,
    radii: radii.toArray(), strength, centers: Object.fromEntries(
      Object.entries(patches).map(([side, patch]) => [side, patch.center.toArray()])) };
  for (let vertex = 0; vertex < indices.count; vertex++) {
    mesh.getVertexPosition(vertex, point).applyMatrix4(mesh.matrixWorld).applyMatrix4(inverseRoot);
    const distanceFromCenter = Math.abs(point.x - chestX);
    const patch = patches[point.x < chestX ? 'R' : 'L'];
    const distance = point.clone().sub(patch.center).divide(radii).length();
    if (distance >= 1) continue;
    // Keep the zipper/center chest fixed, and leave a smooth boundary on all
    // sides of the shoulder patch, including its lower and neckline edges.
    const blend = strength * (1 - THREE.MathUtils.smoothstep(distance, 0, 1))
      * THREE.MathUtils.smoothstep(distanceFromCenter, 0.015, 0.045);
    if (blend < 1e-6) continue;
    const influences = new Map();
    let transferred = 0;
    for (let slot = 0; slot < 4; slot++) {
      const index = indices.array[vertex * 4 + slot];
      const weight = weights.array[vertex * 4 + slot];
      const removed = spineIndices.has(index) ? weight * blend : 0;
      transferred += removed;
      influences.set(index, (influences.get(index) || 0) + weight - removed);
    }
    if (transferred < 1e-6) continue;
    // Collar motion dominates near the neck; upper-arm participation grows
    // toward the sleeve, avoiding an abrupt arm-to-spine hinge at the cap.
    const upperShare = 0.65 * THREE.MathUtils.smoothstep(distanceFromCenter, 0.025, 0.12);
    influences.set(patch.clavicle, (influences.get(patch.clavicle) || 0) + transferred * (1 - upperShare));
    influences.set(patch.upper, (influences.get(patch.upper) || 0) + transferred * upperShare);
    const strongest = [...influences].filter(([, weight]) => weight > 0)
      .sort((a, b) => b[1] - a[1]).slice(0, 4);
    const total = strongest.reduce((sum, [, weight]) => sum + weight, 0);
    for (let slot = 0; slot < 4; slot++) {
      indices.array[vertex * 4 + slot] = strongest[slot]?.[0] ?? 0;
      weights.array[vertex * 4 + slot] = (strongest[slot]?.[1] ?? 0) / total;
    }
    stats.correctedVertices++;
    stats.maxTransferredWeight = Math.max(stats.maxTransferredWeight, transferred);
  }
  return stats;
}
