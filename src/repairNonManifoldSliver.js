import * as THREE from 'three';

/** Remove the source mesh's isolated sliver that makes one welded edge non-manifold. */
export function repairNonManifoldSliver(geometry) {
  const position = geometry.attributes.position;
  const index = geometry.index.array;
  const canonicalByPosition = new Map();
  const canonical = new Uint32Array(position.count);
  for (let vertex = 0; vertex < position.count; vertex++) {
    const key = `${position.getX(vertex)},${position.getY(vertex)},${position.getZ(vertex)}`;
    if (!canonicalByPosition.has(key)) canonicalByPosition.set(key, vertex);
    canonical[vertex] = canonicalByPosition.get(key);
  }

  const edges = new Map();
  for (let offset = 0; offset < index.length; offset += 3) {
    for (let corner = 0; corner < 3; corner++) {
      const from = canonical[index[offset + corner]];
      const to = canonical[index[offset + (corner + 1) % 3]];
      if (from === to) continue;
      const key = `${Math.min(from, to)},${Math.max(from, to)}`;
      if (!edges.has(key)) edges.set(key, []);
      edges.get(key).push({ triangle: offset / 3, from, to });
    }
  }

  const nonManifold = [...edges].filter(([, incidents]) => incidents.length > 2);
  if (nonManifold.length !== 1 || nonManifold[0][1].length !== 3) {
    return { removedTriangles: [], nonManifoldEdgesBefore: nonManifold.length };
  }

  const [sharedKey, incidents] = nonManifold[0];
  const [edgeA, edgeB] = sharedKey.split(',').map(Number);
  const point = vertex => new THREE.Vector3().fromBufferAttribute(position, vertex);
  const edgeLength = point(edgeA).distanceTo(point(edgeB));
  if (edgeLength === 0) return { removedTriangles: [], nonManifoldEdgesBefore: 1 };

  const candidates = incidents.filter(({ triangle }) => {
    const offset = triangle * 3;
    const vertices = [canonical[index[offset]], canonical[index[offset + 1]], canonical[index[offset + 2]]];
    const third = vertices.find(vertex => vertex !== edgeA && vertex !== edgeB);
    if (third === undefined) return false;

    const otherEdges = [];
    for (let corner = 0; corner < 3; corner++) {
      const from = vertices[corner];
      const to = vertices[(corner + 1) % 3];
      if (from === to || (Math.min(from, to) === edgeA && Math.max(from, to) === edgeB)) continue;
      otherEdges.push(edges.get(`${Math.min(from, to)},${Math.max(from, to)}`)?.length ?? 0);
    }
    if (otherEdges.length !== 2 || otherEdges.some(count => count !== 1)) return false;

    const a = point(edgeA), b = point(edgeB), c = point(third);
    const height = b.clone().sub(a).cross(c.clone().sub(a)).length() / edgeLength;
    return height / edgeLength < 0.06;
  });

  if (candidates.length !== 1) {
    return { removedTriangles: [], nonManifoldEdgesBefore: 1 };
  }

  const retained = incidents.filter(incident => incident !== candidates[0]);
  if (retained[0].from !== retained[1].to || retained[0].to !== retained[1].from) {
    return { removedTriangles: [], nonManifoldEdgesBefore: 1 };
  }

  const removedTriangle = candidates[0].triangle;
  const nextIndex = new index.constructor(index.length - 3);
  let destination = 0;
  for (let triangle = 0; triangle < index.length / 3; triangle++) {
    if (triangle === removedTriangle) continue;
    nextIndex.set(index.subarray(triangle * 3, triangle * 3 + 3), destination);
    destination += 3;
  }
  geometry.setIndex(new THREE.BufferAttribute(nextIndex, 1));
  return {
    removedTriangles: [removedTriangle],
    nonManifoldEdgesBefore: 1,
    edge: [point(edgeA).toArray(), point(edgeB).toArray()],
  };
}
