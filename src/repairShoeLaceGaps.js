import * as THREE from 'three';

/** Join the mirrored shoe-upper seams, including their UV-split copies. */
export function repairShoeLaceGaps(geometry) {
  const { position, normal, skinIndex, skinWeight } = geometry.attributes;
  const seams = [
    [[0.10918416827917099, 0.08817782253026962, -0.429653137922287],
      [0.10918416827917099, 0.08768930286169052, -0.4291646182537079]],
    [[0.10918416827917099, -0.08426966518163681, -0.429653137922287],
      [0.10918416827917099, -0.08378114551305771, -0.4291646182537079]],
  ];
  // Resolve both sides before editing; a different asset must remain untouched.
  const groups = seams.map(seam => seam.map(target => {
    const vertices = [];
    for (let vertex = 0; vertex < position.count; vertex++) {
      if (Math.hypot(position.getX(vertex) - target[0], position.getY(vertex) - target[1],
        position.getZ(vertex) - target[2]) < 1e-7) vertices.push(vertex);
    }
    return vertices;
  }));
  if (groups.some(seam => seam.some(vertices => !vertices.length))) {
    return { patchedGaps: 0, addedVertices: 0, addedTriangles: 0, repairs: [] };
  }

  const repairs = [];
  let maxDisplacement = 0;
  for (const seam of groups) {
    const midpoint = new THREE.Vector3();
    const averagedNormal = new THREE.Vector3();
    const influences = new Map();
    for (const [source] of seam) {
      midpoint.add(new THREE.Vector3().fromBufferAttribute(position, source));
      averagedNormal.add(new THREE.Vector3().fromBufferAttribute(normal, source));
      for (let slot = 0; slot < 4; slot++) {
        const joint = skinIndex.array[source * 4 + slot];
        influences.set(joint, (influences.get(joint) ?? 0) + skinWeight.array[source * 4 + slot]);
      }
    }
    midpoint.multiplyScalar(0.5);
    averagedNormal.normalize();
    const strongest = [...influences].filter(([, weight]) => weight > 0)
      .sort((a, b) => b[1] - a[1]).slice(0, 4);
    const total = strongest.reduce((sum, [, weight]) => sum + weight, 0);
    const vertices = seam.flat();
    for (const vertex of vertices) {
      maxDisplacement = Math.max(maxDisplacement,
        new THREE.Vector3().fromBufferAttribute(position, vertex).distanceTo(midpoint));
      position.setXYZ(vertex, midpoint.x, midpoint.y, midpoint.z);
      normal.setXYZ(vertex, averagedNormal.x, averagedNormal.y, averagedNormal.z);
      // Equal weights keep the seam closed in every pose; UVs stay independent.
      for (let slot = 0; slot < 4; slot++) {
        skinIndex.array[vertex * 4 + slot] = strongest[slot]?.[0] ?? 0;
        skinWeight.array[vertex * 4 + slot] = (strongest[slot]?.[1] ?? 0) / total;
      }
    }
    repairs.push({ vertices });
  }
  position.needsUpdate = normal.needsUpdate = skinIndex.needsUpdate = skinWeight.needsUpdate = true;
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return { patchedGaps: repairs.length, addedVertices: 0, addedTriangles: 0, maxDisplacement, repairs };
}
