import * as THREE from 'three';
import { createUpperDentalArch } from './upperDentalArch.js';

// The recessed separation AFTER the upper-lip roll. The higher outer ridge
// must remain on the upper face rather than travel downward with the jaw.
// Keep the established corner geometry. Its painted tips are registered with
// a separate, local UV correction rather than extending the corner cut.
const SMILE_PATH = [799, 802, 806, 8857, 8856, 8880, 8918, 16526, 16542, 16572, 2883, 2885, 2908];
const UPPER_LIP_RIDGE = [812, 8776, 8869, 8874, 8925, 15912, 16549, 16566, 2893];
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
  const colorPatches = [];
  const tint = (vertex, color) => colorPatches.push({ vertex, color: new THREE.Color(color) });
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
      const vertex = addPoint(p, { source: b.source, follow: layer === 2 ? 0.45 : 1 }, layer === 0 ? b.source : null);
      row.push(vertex);
      const palette = b.side > 0 ? ['#9d6258', '#88434d', '#572a35'] : ['#ac6b63', '#9e5963', '#713b47'];
      tint(vertex, palette[layer]);
    }
    ring.push(row);
  }
  for (let layer = 0; layer < 2; layer++) for (let i = 0; i < boundary.length; i++) {
    const j = (i + 1) % boundary.length, a = ring[layer][i], b = ring[layer][j], c = ring[layer + 1][i], d = ring[layer + 1][j];
    index.push(a, c, b, b, c, d);
  }
  const middleLower = lower[Math.floor(lower.length / 2)], cap = addPoint(new THREE.Vector3(centerX, 0.719, 0.073), { source: middleLower, follow: 0.15 });
  tint(cap, '#4b2532');
  for (let i = 0; i < boundary.length; i++) index.push(cap, ring[2][(i + 1) % boundary.length], ring[2][i]);
  const cavityEnd = index.length;
  const dentalArch = createUpperDentalArch({ centerX, halfWidth, sampleSeam, addPoint, tint });
  const gumPalateStart = index.length;
  index.push(...dentalArch.gumIndices);
  ranges.push({ start: liningStart, count: index.length - liningStart, materialIndex: 1 });

  const teethStart = index.length;
  index.push(...dentalArch.toothIndices);
  ranges.push({ start: teethStart, count: index.length - teethStart, materialIndex: 2 });

  const tongueStart = index.length, tongue = [];
  for (let layer = 0; layer < 3; layer++) {
    const row = [];
    for (let i = 0; i < 10; i++) {
      const angle = i / 10 * Math.PI * 2, radius = layer === 1 ? 0.55 : 1;
      const y = [0.7205, 0.7232, 0.7145][layer];
      const vertex = addPoint(new THREE.Vector3(centerX + Math.cos(angle) * 0.022 * radius, y, 0.110 + Math.sin(angle) * 0.009 * radius), { source: middleLower, follow: 0.35, tongue: true });
      row.push(vertex); tint(vertex, ['#a96872', '#b9737e', '#7c444f'][layer]);
    }
    tongue.push(row);
  }
  const tongueTop = addPoint(new THREE.Vector3(centerX, 0.7235, 0.110), { source: middleLower, follow: 0.35, tongue: true });
  tint(tongueTop, '#bc7b83');
  for (let i = 0; i < 10; i++) {
    const j = (i + 1) % 10;
    index.push(tongueTop, tongue[1][j], tongue[1][i],
      tongue[0][i], tongue[1][i], tongue[0][j], tongue[0][j], tongue[1][i], tongue[1][j],
      tongue[0][i], tongue[0][j], tongue[2][i], tongue[0][j], tongue[2][j], tongue[2][i]);
  }
  ranges.push({ start: tongueStart, count: index.length - tongueStart, materialIndex: 3 });
  for (const [name, attribute] of Object.entries(originalAttributes)) geometry.setAttribute(name, new THREE.BufferAttribute(new attribute.array.constructor(attributes[name]), attribute.itemSize, attribute.normalized));
  // Colors are linear values, as expected by Three.js. White on the original
  // character means only the materials with vertexColors enabled use them.
  const colors = new Float32Array(facePoints.length * 3).fill(1);
  colorPatches.forEach(({ vertex, color }) => color.toArray(colors, vertex * 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(index); geometry.clearGroups(); ranges.forEach(group => geometry.addGroup(group.start, group.count, group.materialIndex));
  const normalGeometry = geometry.clone(); normalGeometry.computeVertexNormals();
  for (let i = outerVertices; i < facePoints.length; i++) for (let k = 0; k < 3; k++) geometry.attributes.normal.array[i * 3 + k] = normalGeometry.attributes.normal.array[i * 3 + k];
  normalGeometry.dispose(); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  const liningMaterial = new THREE.MeshBasicMaterial({ color: '#ffffff', vertexColors: true, side: THREE.DoubleSide }); liningMaterial.name = 'MouthLining';
  const teethMaterial = new THREE.MeshStandardMaterial({ color: '#f4ead8', roughness: 0.68 }); teethMaterial.name = 'UpperTeeth';
  const tongueMaterial = new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: 0.96 }); tongueMaterial.name = 'Tongue';
  const innerMaterials = [liningMaterial, teethMaterial, tongueMaterial]; mesh.material = [material, ...innerMaterials];
  const report = { sourceVertices, sourceTriangles, outerVertices, seamVertices: seam.length, splitRecords,
    addedOuterTriangles: 0, addedVertices: facePoints.length - sourceVertices, addedTriangles: index.length / 3 - sourceTriangles,
    liningTriangles: ranges[1].count / 3, teethTriangles: ranges[2].count / 3, tongueTriangles: ranges[3].count / 3,
    upperLip: upper, lowerLip: lower, upperLipRidge: UPPER_LIP_RIDGE, innerRim: ring[0], liningRings: ring, liningBack: cap,
    ...dentalArch.report, cavityEnd, gumPalateStart, tongueTop, materialGroups: ranges.length };
  root.userData.mouthTopology = report;
  return { toFace, fromFace, facePoints, motion, lipSides, sampleSeam, seam, centerX, halfWidth, outerVertices, innerMaterials, report, upper, lower };
}
