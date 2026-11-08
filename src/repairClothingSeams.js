import * as THREE from 'three';

/** Close only the three narrow four-edge slits at the trouser waist and hoodie pocket. */
export function repairClothingSeams(geometry) {
  const position = geometry.attributes.position;
  const normal = geometry.attributes.normal;
  const skinIndex = geometry.attributes.skinIndex;
  const skinWeight = geometry.attributes.skinWeight;
  const groups = new Map();
  const canonical = [];
  for (let vertex = 0; vertex < position.count; vertex++) {
    const key = `${position.getX(vertex)},${position.getY(vertex)},${position.getZ(vertex)}`;
    if (!groups.has(key)) groups.set(key, []);
    const group = groups.get(key);
    group.push(vertex);
    canonical.push(group[0]);
  }
  const duplicates = new Map([...groups.values()].map(group => [group[0], group]));
  const edges = new Map();
  const indices = geometry.index.array;
  for (let offset = 0; offset < indices.length; offset += 3) {
    for (let corner = 0; corner < 3; corner++) {
      const first = canonical[indices[offset + corner]];
      const second = canonical[indices[offset + (corner + 1) % 3]];
      const key = `${Math.min(first, second)},${Math.max(first, second)}`;
      if (!edges.has(key)) edges.set(key, { first, second, count: 0 });
      edges.get(key).count++;
    }
  }
  const boundary = new Map();
  for (const { first, second, count } of edges.values()) {
    if (count !== 1) continue;
    if (!boundary.has(first)) boundary.set(first, []);
    if (!boundary.has(second)) boundary.set(second, []);
    boundary.get(first).push(second);
    boundary.get(second).push(first);
  }
  const point = vertex => new THREE.Vector3().fromBufferAttribute(position, vertex);
  const visited = new Set();
  const repairs = [];
  let maxDisplacement = 0;
  for (const start of boundary.keys()) {
    if (visited.has(start)) continue;
    const component = [];
    const pending = [start];
    while (pending.length) {
      const vertex = pending.pop();
      if (visited.has(vertex)) continue;
      visited.add(vertex);
      component.push(vertex);
      pending.push(...boundary.get(vertex));
    }
    if (component.length !== 4 || component.some(vertex => boundary.get(vertex).length !== 2)) continue;
    // Source-space bounds keep intentional neck, cuff, lace and drawstring
    // openings out of this repair. Require a thin four-edge loop as well.
    if (!component.every(vertex => position.getZ(vertex) > -0.13
      && position.getZ(vertex) < 0 && position.getX(vertex) > 0.05
      && position.getX(vertex) < 0.13 && Math.abs(position.getY(vertex)) < 0.12)) continue;
    const diagonals = component.flatMap((first, offset) => component.slice(offset + 1)
      .filter(second => !boundary.get(first).includes(second))
      .map(second => ({ first, second, distance: point(first).distanceTo(point(second)) })))
      .sort((left, right) => left.distance - right.distance);
    if (diagonals.length !== 2 || diagonals[0].distance > 0.001 || diagonals[0].distance > diagonals[1].distance * 0.1) continue;
    repairs.push({ first: diagonals[0].first, second: diagonals[0].second });
  }
  // Resolve all expected slits before modifying this version of the asset.
  if (repairs.length !== 3) return { slits: 0, maxDisplacement: 0, repairs: [] };
  for (const repair of repairs) {
    const { first, second } = repair;
    const midpoint = point(first).add(point(second)).multiplyScalar(0.5);
    const vertices = [...duplicates.get(first), ...duplicates.get(second)];
    const averagedNormal = new THREE.Vector3();
    const influences = new Map();
    for (const vertex of [first, second]) {
      averagedNormal.add(new THREE.Vector3().fromBufferAttribute(normal, vertex));
      for (let slot = 0; slot < 4; slot++) {
        const joint = skinIndex.array[vertex * 4 + slot];
        influences.set(joint, (influences.get(joint) ?? 0) + skinWeight.array[vertex * 4 + slot]);
      }
    }
    averagedNormal.normalize();
    const strongest = [...influences].filter(([, weight]) => weight > 0).sort((left, right) => right[1] - left[1]).slice(0, 4);
    const total = strongest.reduce((sum, [, weight]) => sum + weight, 0);
    for (const vertex of vertices) {
      maxDisplacement = Math.max(maxDisplacement, point(vertex).distanceTo(midpoint));
      position.setXYZ(vertex, midpoint.x, midpoint.y, midpoint.z);
      normal.setXYZ(vertex, averagedNormal.x, averagedNormal.y, averagedNormal.z);
      for (let slot = 0; slot < 4; slot++) {
        skinIndex.array[vertex * 4 + slot] = strongest[slot]?.[0] ?? 0;
        skinWeight.array[vertex * 4 + slot] = (strongest[slot]?.[1] ?? 0) / total;
      }
    }
    repair.vertices = vertices;
  }
  if (repairs.length) {
    position.needsUpdate = normal.needsUpdate = skinIndex.needsUpdate = skinWeight.needsUpdate = true;
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
  }
  return { slits: repairs.length, maxDisplacement, repairs };
}
