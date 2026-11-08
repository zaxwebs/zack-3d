import * as THREE from 'three';

/** Cap the two open, nearly planar sole loops in the source character mesh. */
export function repairShoeSoleHoles(geometry) {
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
      const fromIndex = index[offset + corner];
      const toIndex = index[offset + (corner + 1) % 3];
      const from = canonical[fromIndex];
      const to = canonical[toIndex];
      if (from === to) continue;
      const key = `${Math.min(from, to)},${Math.max(from, to)}`;
      if (!edges.has(key)) edges.set(key, []);
      edges.get(key).push({ from, to, fromIndex, toIndex });
    }
  }

  const boundary = [...edges.values()].filter(incidents => incidents.length === 1).map(incidents => incidents[0]);
  const adjacency = new Map();
  for (const edge of boundary) {
    if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
    if (!adjacency.has(edge.to)) adjacency.set(edge.to, []);
    adjacency.get(edge.from).push(edge);
    adjacency.get(edge.to).push(edge);
  }

  const point = vertex => new THREE.Vector3().fromBufferAttribute(position, vertex);
  const visited = new Set();
  const loops = [];
  for (const start of adjacency.keys()) {
    if (visited.has(start)) continue;
    const component = [];
    const pending = [start];
    while (pending.length) {
      const vertex = pending.pop();
      if (visited.has(vertex)) continue;
      visited.add(vertex);
      component.push(vertex);
      for (const edge of adjacency.get(vertex)) pending.push(edge.from === vertex ? edge.to : edge.from);
    }

    if (component.length !== 12 || component.some(vertex => adjacency.get(vertex).length !== 2)) continue;
    const componentSet = new Set(component);
    const componentEdges = boundary.filter(edge => componentSet.has(edge.from) && componentSet.has(edge.to));
    if (componentEdges.length !== 12) continue;

    const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    const center = [0, 0, 0];
    for (const vertex of component) {
      const xyz = point(vertex).toArray();
      xyz.forEach((value, axis) => {
        bounds.min[axis] = Math.min(bounds.min[axis], value);
        bounds.max[axis] = Math.max(bounds.max[axis], value);
        center[axis] += value / component.length;
      });
    }
    const extent = bounds.max.map((value, axis) => value - bounds.min[axis]);
    // These mirrored, flat loops sit on the source shoes' underside. Other
    // shoe boundaries around the laces and ankle are intentionally untouched.
    if (extent[2] > 0.003 || extent[0] < 0.05 || extent[1] < 0.04
      || Math.abs(center[0] - 0.0266) > 0.015 || Math.abs(center[2] + 0.4248) > 0.01
      || Math.abs(center[1]) < 0.04 || Math.abs(center[1]) > 0.10) continue;

    const outgoing = new Map();
    for (const edge of componentEdges) {
      if (outgoing.has(edge.from)) {
        outgoing.set(edge.from, null);
      } else {
        outgoing.set(edge.from, edge);
      }
    }
    if (component.some(vertex => !outgoing.get(vertex))) continue;

    const loop = [];
    let edge = outgoing.get(componentEdges[0].from);
    const first = edge.from;
    while (edge && loop.length < component.length) {
      loop.push({ vertex: edge.from, source: edge.fromIndex });
      edge = outgoing.get(edge.to);
      if (edge?.from === first) break;
    }
    if (loop.length !== 12 || edge?.from !== first) continue;
    loops.push({ loop, center });
  }

  if (loops.length !== 2) return { cappedLoops: 0, addedVertices: 0, addedTriangles: 0 };

  const attributeNames = ['position', 'normal', 'uv', 'skinIndex', 'skinWeight'];
  const additions = Object.fromEntries(attributeNames.map(name => [name, []]));
  const addedIndices = [];
  const addedLoops = [];
  let nextVertex = position.count;
  for (const { loop, center } of loops) {
    const capVertices = [];
    const contour = loop.map(({ source }) => new THREE.Vector2(position.getX(source), position.getY(source)));
    for (const { source } of loop) {
      for (const name of attributeNames) {
        const attribute = geometry.attributes[name];
        const values = additions[name];
        for (let item = 0; item < attribute.itemSize; item++) {
          values.push(name === 'normal' ? [0, 0, -1][item] : attribute.array[source * attribute.itemSize + item]);
        }
      }
      capVertices.push(nextVertex++);
    }

    const polygonArea = contour.reduce((sum, a, i) => {
      const b = contour[(i + 1) % contour.length];
      return sum + a.x * b.y - b.x * a.y;
    }, 0);
    if (Math.abs(polygonArea) < 1e-8) continue;
    const desiredSign = -Math.sign(polygonArea);
    const triangles = THREE.ShapeUtils.triangulateShape(contour, []);
    for (const triangle of triangles) {
      let [a, b, c] = triangle;
      const pA = contour[a], pB = contour[b], pC = contour[c];
      const sign = Math.sign((pB.x - pA.x) * (pC.y - pA.y) - (pB.y - pA.y) * (pC.x - pA.x));
      if (sign !== desiredSign) [b, c] = [c, b];
      addedIndices.push(capVertices[a], capVertices[b], capVertices[c]);
    }
    addedLoops.push({ center, triangles: triangles.length });
  }

  if (addedLoops.length !== 2 || addedIndices.length !== 60) {
    return { cappedLoops: 0, addedVertices: 0, addedTriangles: 0 };
  }

  for (const name of attributeNames) {
    const attribute = geometry.attributes[name];
    const values = additions[name];
    const array = new attribute.array.constructor(attribute.array.length + values.length);
    array.set(attribute.array);
    array.set(values, attribute.array.length);
    geometry.setAttribute(name, new THREE.BufferAttribute(array, attribute.itemSize, attribute.normalized));
  }

  const nextIndex = new index.constructor(index.length + addedIndices.length);
  nextIndex.set(index);
  nextIndex.set(addedIndices, index.length);
  geometry.setIndex(new THREE.BufferAttribute(nextIndex, 1));
  return { cappedLoops: 2, addedVertices: 24, addedTriangles: 20, loops: addedLoops };
}
