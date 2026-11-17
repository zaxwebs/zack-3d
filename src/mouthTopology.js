import * as THREE from 'three';

// Authored landmarks along the existing smile, checked against welded adjacency.
const SMILE_PATH = [799, 802, 812, 8776, 8869, 8874, 8925, 15912, 16549, 16566, 2893, 2885, 2908];
const edgeKey = (a, b) => a < b ? `${a},${b}` : `${b},${a}`;

/** Split existing smile edges once, then construct a compact inner mouth. */
export function createMouthTopology({ root, mesh, geometry, material, skeleton, bones }) {
  root.updateMatrixWorld(true);
  const sourceVertices = geometry.attributes.position.count, sourceTriangles = geometry.index.count / 3;
  const toFace = root.matrixWorld.clone().invert().multiply(mesh.matrixWorld)
    .multiply(mesh.bindMatrixInverse).multiply(bones.Head.matrixWorld)
    .multiply(skeleton.boneInverses[skeleton.bones.indexOf(bones.Head)]).multiply(mesh.bindMatrix);
  const fromFace = toFace.clone().invert();
  const attributes = Object.fromEntries(Object.entries(geometry.attributes).map(([name, attribute]) => [name, Array.from(attribute.array)]));
  const originalAttributes = { ...geometry.attributes };
  const position = geometry.attributes.position;
  const groups = [], groupByPosition = new Map(), vertexGroup = [];
  const facePoints = [], motion = [], lipSides = [];
  for (let i = 0; i < sourceVertices; i++) {
    const p = new THREE.Vector3().fromBufferAttribute(position, i), key = p.toArray().join(',');
    if (!groupByPosition.has(key)) { groupByPosition.set(key, groups.length); groups.push({ vertices: [], faces: [] }); }
    const group = groupByPosition.get(key); vertexGroup[i] = group; groups[group].vertices.push(i);
    facePoints.push(p.applyMatrix4(toFace)); lipSides.push(0); motion.push(null);
  }
  const index = Array.from(geometry.index.array), faces = [], edges = new Map();
  for (let offset = 0; offset < index.length; offset += 3) {
    const face = index.slice(offset, offset + 3).map(i => vertexGroup[i]), f = faces.length; faces.push(face);
    for (const g of face) groups[g].faces.push(f);
    for (let k = 0; k < 3; k++) {
      const key = edgeKey(face[k], face[(k + 1) % 3]);
      if (!edges.has(key)) edges.set(key, []); edges.get(key).push(f);
    }
  }
  const path = SMILE_PATH.map(i => vertexGroup[i]), seam = SMILE_PATH.map(i => facePoints[i].clone());
  if (seam.some(p => p.z < 0.10 || p.y < 0.728 || p.y > 0.745 || Math.abs(p.x) > 0.044)) {
    throw new Error('The mouth landmarks no longer match Zack’s smile. Inspect the source topology before rebuilding.');
  }
  const cuts = new Set(path.slice(1).map((g, i) => edgeKey(path[i], g)));
  for (const cut of cuts) if (edges.get(cut)?.length !== 2) throw new Error(`Mouth seam edge ${cut} must have exactly two incident faces.`);
  const sampleSeam = x => {
    let segment = seam.length - 2;
    for (let i = 0; i < seam.length - 1; i++) if (x <= seam[i + 1].x) { segment = i; break; }
    const a = seam[segment], b = seam[segment + 1], t = THREE.MathUtils.clamp((x - a.x) / (b.x - a.x), 0, 1);
    return a.clone().lerp(b, t);
  };
  const duplicate = source => {
    const vertex = facePoints.length;
    for (const [name, attribute] of Object.entries(originalAttributes)) attributes[name].push(...attributes[name].slice(source * attribute.itemSize, (source + 1) * attribute.itemSize));
    facePoints.push(facePoints[source].clone()); lipSides.push(-1); motion.push(null);
    return vertex;
  };
  const upper = [], lower = [], splitRecords = [];
  path.forEach((group, j) => {
    if (j === 0 || j === path.length - 1) { upper.push(SMILE_PATH[j]); lower.push(SMILE_PATH[j]); return; }
    const pending = new Set(groups[group].faces), fans = [];
    while (pending.size) {
      const queue = [pending.values().next().value], component = []; pending.delete(queue[0]);
      while (queue.length) {
        const f = queue.pop(); component.push(f);
        for (const neighbor of faces[f]) {
          if (neighbor === group || cuts.has(edgeKey(group, neighbor))) continue;
          for (const next of edges.get(edgeKey(group, neighbor)) || []) if (pending.delete(next)) queue.push(next);
        }
      }
      fans.push(component);
    }
    if (fans.length !== 2) throw new Error(`Smile vertex ${SMILE_PATH[j]} does not have two separable surface fans.`);
    const side = fan => fan.reduce((sum, f) => sum + faces[f].reduce((s, g) => {
      const p = facePoints[groups[g].vertices[0]]; return s + p.y - sampleSeam(p.x).y;
    }, 0), 0) / fan.length;
    fans.sort((a, b) => side(b) - side(a));
    if (side(fans[0]) <= 0 || side(fans[1]) >= 0) throw new Error('The lip fans must lie on opposite sides of the smile.');
    const copies = new Map();
    for (const vertex of groups[group].vertices) lipSides[vertex] = 1;
    for (const f of fans[1]) for (let k = 0; k < 3; k++) {
      if (faces[f][k] !== group) continue;
      const source = index[f * 3 + k];
      if (!copies.has(source)) { const copy = duplicate(source); copies.set(source, copy); splitRecords.push({ source, copy }); }
      index[f * 3 + k] = copies.get(source);
    }
    const f = fans[0][0];
    upper.push(index[f * 3 + faces[f].indexOf(group)]); lower.push(copies.values().next().value);
  });
  const outerVertices = facePoints.length, headIndex = skeleton.bones.indexOf(bones.Head);
  function addPoint(point, movement = null, source = null) {
    const vertex = facePoints.length, raw = point.clone().applyMatrix4(fromFace);
    for (const [name, attribute] of Object.entries(originalAttributes)) {
      if (source !== null) attributes[name].push(...attributes[name].slice(source * attribute.itemSize, (source + 1) * attribute.itemSize));
      else for (let k = 0; k < attribute.itemSize; k++) attributes[name].push(name === 'skinIndex' && k === 0 ? headIndex : name === 'skinWeight' && k === 0 ? 1 : 0);
    }
    raw.toArray(attributes.position, vertex * 3); facePoints.push(point.clone()); motion.push(movement); lipSides.push(0);
    return vertex;
  }
  const ranges = [{ start: 0, count: index.length, materialIndex: 0 }];
  const boundary = [...upper.map((source, i) => ({ source, side: 1, i })), ...lower.slice(1, -1).map((source, i) => ({ source, side: -1, i: i + 1 })).reverse()];
  const centerX = (seam[0].x + seam.at(-1).x) / 2, halfWidth = (seam.at(-1).x - seam[0].x) / 2;
  const ring = [], liningStart = index.length;
  for (let layer = 0; layer < 3; layer++) {
    const row = [];
    for (const b of boundary) {
      const p = facePoints[b.source].clone(), t = (p.x - centerX) / halfWidth, profile = Math.max(0, 1 - t * t) ** 0.8;
      if (layer === 1) { p.z -= 0.002; p.y += b.side * 0.00045 * profile; }
      if (layer === 2) { p.x = centerX + (p.x - centerX) * 0.90; p.z -= 0.024; p.y += (b.side > 0 ? 0.003 : -0.018) * profile; }
      row.push(addPoint(p, { source: b.source, follow: layer === 2 ? 0.45 : 1 }, layer === 0 ? b.source : null));
    }
    ring.push(row);
  }
  for (let layer = 0; layer < 2; layer++) for (let i = 0; i < boundary.length; i++) {
    const j = (i + 1) % boundary.length, a = ring[layer][i], b = ring[layer][j], c = ring[layer + 1][i], d = ring[layer + 1][j];
    index.push(a, c, b, b, c, d);
  }
  const middleLower = lower[Math.floor(lower.length / 2)], cap = addPoint(new THREE.Vector3(centerX, 0.719, 0.073), { source: middleLower, follow: 0.15 });
  for (let i = 0; i < boundary.length; i++) index.push(cap, ring[2][(i + 1) % boundary.length], ring[2][i]);
  ranges.push({ start: liningStart, count: index.length - liningStart, materialIndex: 1 });

  // A single curved upper tooth band is seated into the upper lip. Its top is
  // hidden inside the face; teeth stay on the upper jaw as lips change width.
  const teethStart = index.length, toothRows = [], columns = 11;
  for (let i = 0; i < columns; i++) {
    const x = centerX + halfWidth * 0.83 * (i / (columns - 1) * 2 - 1), p = sampleSeam(x);
    toothRows.push([[0.0017, -0.0058], [0.0017, -0.0095], [-0.0052, -0.0095], [-0.0052, -0.0058]]
      .map(([y, z]) => addPoint(new THREE.Vector3(x, p.y + y, p.z + z), { toothAnchor: p.clone() })));
  }
  for (let i = 0; i < columns - 1; i++) for (let k = 0; k < 4; k++) {
    const j = (k + 1) % 4, a = toothRows[i][k], b = toothRows[i + 1][k], c = toothRows[i][j], d = toothRows[i + 1][j];
    index.push(a, b, c, b, d, c);
  }
  index.push(toothRows[0][0], toothRows[0][1], toothRows[0][2], toothRows[0][0], toothRows[0][2], toothRows[0][3]);
  const last = toothRows.at(-1); index.push(last[0], last[2], last[1], last[0], last[3], last[2]);
  ranges.push({ start: teethStart, count: index.length - teethStart, materialIndex: 2 });

  const tongueStart = index.length, tongue = [];
  for (let layer = 0; layer < 2; layer++) {
    const row = [];
    for (let i = 0; i < 10; i++) {
      const angle = i / 10 * Math.PI * 2;
      row.push(addPoint(new THREE.Vector3(centerX + Math.cos(angle) * 0.022, layer ? 0.712 : 0.718, 0.108 + Math.sin(angle) * 0.009), { source: middleLower, follow: 0.35 }));
    }
    tongue.push(row);
  }
  const tongueTop = addPoint(new THREE.Vector3(centerX, 0.721, 0.108), { source: middleLower, follow: 0.35 });
  for (let i = 0; i < 10; i++) {
    const j = (i + 1) % 10;
    index.push(tongueTop, tongue[0][j], tongue[0][i], tongue[0][i], tongue[0][j], tongue[1][i], tongue[0][j], tongue[1][j], tongue[1][i]);
  }
  ranges.push({ start: tongueStart, count: index.length - tongueStart, materialIndex: 3 });
  for (const [name, attribute] of Object.entries(originalAttributes)) geometry.setAttribute(name, new THREE.BufferAttribute(new attribute.array.constructor(attributes[name]), attribute.itemSize, attribute.normalized));
  geometry.setIndex(index); geometry.clearGroups(); ranges.forEach(group => geometry.addGroup(group.start, group.count, group.materialIndex));
  const normalGeometry = geometry.clone(); normalGeometry.computeVertexNormals();
  for (let i = outerVertices; i < facePoints.length; i++) for (let k = 0; k < 3; k++) geometry.attributes.normal.array[i * 3 + k] = normalGeometry.attributes.normal.array[i * 3 + k];
  normalGeometry.dispose(); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  const liningMaterial = new THREE.MeshBasicMaterial({ color: '#250a10', side: THREE.DoubleSide }); liningMaterial.name = 'MouthLining';
  const teethMaterial = new THREE.MeshStandardMaterial({ color: '#fff0d8', roughness: 0.78 }); teethMaterial.name = 'UpperTeeth';
  const tongueMaterial = new THREE.MeshStandardMaterial({ color: '#a95860', roughness: 1 }); tongueMaterial.name = 'Tongue';
  const innerMaterials = [liningMaterial, teethMaterial, tongueMaterial]; mesh.material = [material, ...innerMaterials];
  const report = { sourceVertices, sourceTriangles, outerVertices, seamVertices: seam.length, splitRecords,
    addedOuterTriangles: 0, addedVertices: facePoints.length - sourceVertices, addedTriangles: index.length / 3 - sourceTriangles,
    liningTriangles: ranges[1].count / 3, teethTriangles: ranges[2].count / 3, tongueTriangles: ranges[3].count / 3,
    upperLip: upper, lowerLip: lower, innerRim: ring[0], materialGroups: ranges.length };
  root.userData.mouthTopology = report;
  return { toFace, fromFace, facePoints, motion, lipSides, sampleSeam, seam, centerX, halfWidth, outerVertices, innerMaterials, report, upper, lower };
}
