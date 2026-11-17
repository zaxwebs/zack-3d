import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as T from 'three';
import { createZackModel } from '../src/ZackModel.js';
import { createMouthTopology } from '../src/mouthTopology.js';
import { alignSmileCornerUVs } from '../src/alignSmileCornerUVs.js';
import { repairHandSeams } from '../src/repairHandSeams.js';
import { repairNonManifoldSliver } from '../src/repairNonManifoldSliver.js';
import { repairShoeSoleHoles } from '../src/repairShoeSoleHoles.js';
import { repairShoeLaceGaps } from '../src/repairShoeLaceGaps.js';
import { repairClothingSeams } from '../src/repairClothingSeams.js';

const bytes = await readFile('public/model/geometry.bin'), manifest = JSON.parse(await readFile('public/model/manifest.json'));
const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const model = createZackModel(manifest, buffer), { mesh, geometry, speechFace } = model;
const report = speechFace.report;

// Isolate the topology operation against the repaired, pre-mouth asset. This
// verifies it preserves every old attribute and only remaps the cut lip fan.
const fixture = new T.BufferGeometry(), constructors = { Float32Array, Uint16Array, Uint8Array, Uint32Array };
for (const name of ['position', 'normal', 'uv', 'skinIndex', 'skinWeight', 'index']) {
  const layout = manifest.arrays[name], raw = new constructors[layout.type](buffer, layout.byteOffset, layout.count * layout.itemSize);
  const array = layout.normalized ? Float32Array.from(raw, value => value / 255) : raw.slice();
  const attribute = new T.BufferAttribute(array, layout.itemSize);
  if (name === 'index') fixture.setIndex(attribute); else fixture.setAttribute(name, attribute);
}
repairHandSeams(fixture, model.skeleton, model.bones); repairNonManifoldSliver(fixture); repairShoeSoleHoles(fixture);
repairShoeLaceGaps(fixture); repairClothingSeams(fixture);
const before = Object.fromEntries(Object.entries(fixture.attributes).map(([name, attribute]) => [name, attribute.array.slice()]));
const beforeIndex = fixture.index.array.slice(), originalMaterials = mesh.material;
const isolated = createMouthTopology({ root: model.root, mesh, geometry: fixture, material: model.material, skeleton: model.skeleton, bones: model.bones });
mesh.material = originalMaterials;
for (const [name, values] of Object.entries(before)) assert.deepEqual(fixture.attributes[name].array.slice(0, values.length), values, `The mouth cut preserves old ${name}`);
const copySources = new Map(isolated.report.splitRecords.map(({ source, copy }) => [copy, source]));
for (let i = 0; i < beforeIndex.length; i++) assert.equal(copySources.get(fixture.index.array[i]) ?? fixture.index.array[i], beforeIndex[i], 'Outer faces retain their original triangles and order');
for (const { source, copy } of isolated.report.splitRecords) for (const [name, attribute] of Object.entries(fixture.attributes)) {
  const a = attribute.array.slice(source * attribute.itemSize, (source + 1) * attribute.itemSize);
  const b = attribute.array.slice(copy * attribute.itemSize, (copy + 1) * attribute.itemSize);
  assert.deepEqual(a, b, `A split vertex inherits ${name}`);
}
const beforeCornerUV = fixture.attributes.uv.array.slice(), cornerPositions = fixture.attributes.position.array.slice();
const cornerIndex = fixture.index, cornerCount = fixture.attributes.position.count;
const cornerUV = alignSmileCornerUVs(fixture, isolated), changedUV = new Set(cornerUV.changedVertices);
assert(changedUV.size > 20 && changedUV.size < 250);
assert.deepEqual(fixture.attributes.position.array, cornerPositions, 'Corner alignment changes only UVs');
assert.equal(fixture.index, cornerIndex); assert.equal(fixture.attributes.position.count, cornerCount);
for (let i = 0; i < fixture.attributes.uv.count; i++) {
  if (!changedUV.has(i)) assert.deepEqual(Array.from(fixture.attributes.uv.array.slice(i * 2, i * 2 + 2)), Array.from(beforeCornerUV.slice(i * 2, i * 2 + 2)), 'UVs outside the corner patches stay exact');
  else assert(cornerUV.anchors.some(anchor => isolated.facePoints[i].distanceTo(isolated.facePoints[anchor.vertex]) < cornerUV.radius), 'The UV edit stays within each corner brush');
}
for (const anchor of cornerUV.anchors) assert.deepEqual([fixture.attributes.uv.getX(anchor.vertex), fixture.attributes.uv.getY(anchor.vertex)], anchor.target, 'The existing corner samples the original painted tip');
let minCornerUVAreaRatio = Infinity;
for (let offset = 0; offset < beforeIndex.length; offset += 3) {
  const ids = Array.from(fixture.index.array.slice(offset, offset + 3));
  if (ids.every(i => !changedUV.has(i))) continue;
  const area = values => {
    const [a, b, c] = ids.map(i => [values[i * 2], values[i * 2 + 1]]);
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  };
  const previous = area(beforeCornerUV);
  if (Math.abs(previous) < 1e-10) continue;
  const ratio = area(fixture.attributes.uv.array) / previous;
  assert(ratio > 0, 'Corner registration must not invert the UV mapping'); minCornerUVAreaRatio = Math.min(minCornerUVAreaRatio, ratio);
}
isolated.innerMaterials.forEach(material => material.dispose()); fixture.dispose();

assert.equal(report.addedOuterTriangles, 0);
assert(report.addedVertices <= 320 && report.addedTriangles <= 520);
assert.equal(geometry.groups.length, 4);
assert.equal(geometry.groups.reduce((count, group) => count + group.count, 0), geometry.index.count);
assert.equal(report.toothProfileSize, 6); assert.equal(report.teethColumns, 17);
assert.equal(model.material.vertexColors, false, 'Original skin color is not tinted by oral vertex colors');
assert.equal(mesh.material[1].vertexColors, true); assert.equal(mesh.material[3].vertexColors, true);
const color = geometry.attributes.color;
const luminance = i => 0.2126 * color.getX(i) + 0.7152 * color.getY(i) + 0.0722 * color.getZ(i);
const middleRim = report.liningRings[0][Math.floor(report.upperLip.length / 2)];
assert(luminance(middleRim) > luminance(report.liningBack) * 2, 'The mouth shades from its rim into the deeper cavity');
assert(color.getX(report.liningBack) > 0.01 && color.getX(report.liningBack) > color.getY(report.liningBack) * 2, 'The deep mouth remains a muted red, not black');
for (const attribute of Object.values(geometry.attributes)) assert.equal(attribute.count, geometry.attributes.position.count);
for (const value of geometry.index.array) assert(value >= 0 && value < geometry.attributes.position.count);
const vertex = i => mesh.getVertexPosition(i, new T.Vector3()).applyMatrix4(mesh.matrixWorld);
const rest = Array.from({ length: geometry.attributes.position.count }, (_, i) => vertex(i));
// The visible front continues into two rear legs, with an open center for
// the palate. Caps belong behind the cheeks, never at the smile's ends.
const toothCenters = report.toothRows.map(row => row.reduce((sum, i) => sum.add(rest[i]), new T.Vector3()).multiplyScalar(1 / row.length));
const archMiddle = Math.floor(toothCenters.length / 2), archCenter = toothCenters[archMiddle];
for (const side of [0, toothCenters.length - 1]) {
  assert(archCenter.z - toothCenters[side].z > 0.032, 'The dental arch extends back into the mouth on both sides');
  assert(Math.abs(archCenter.x - toothCenters[side].x) > 0.030, 'The arch keeps an open center instead of a solid tooth plate');
}
for (let i = 1; i < toothCenters.length; i++) assert(toothCenters[i].distanceTo(toothCenters[i - 1]) < 0.011, 'The tooth loft is continuous around the canines');
assert(rest[report.palateRoof].y > archCenter.y + 0.009, 'The palate rises above the crowns behind the front teeth');
function closedVolume(start, end, label) {
  const edges = new Map();
  for (let offset = start; offset < end; offset += 3) for (let k = 0; k < 3; k++) {
    const a = geometry.index.array[offset + k], b = geometry.index.array[offset + (k + 1) % 3];
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    const value = edges.get(key) ?? { count: 0, orientation: 0 };
    value.count++; value.orientation += a < b ? 1 : -1; edges.set(key, value);
  }
  for (const edge of edges.values()) {
    assert.equal(edge.count, 2, `${label} has no accidental open boundary`);
    assert.equal(edge.orientation, 0, `${label} has consistently wound faces`);
  }
}
closedVolume(geometry.groups[2].start, geometry.groups[2].start + geometry.groups[2].count, 'The upper tooth arch');
closedVolume(report.gumPalateStart, geometry.groups[2].start, 'The connected gum and palate');
assert.equal(report.upperLip[0], 799); assert.equal(report.upperLip.at(-1), 2908, 'The established corner vertices are retained');
const faceTargets = geometry.morphAttributes.position.slice(report.firstTarget), normalTargets = geometry.morphAttributes.normal.slice(report.firstTarget);
for (const i of [...report.toothRows[0], ...report.toothRows.at(-1)]) for (const target of faceTargets) {
  assert.equal(target.getX(i) ** 2 + target.getY(i) ** 2 + target.getZ(i) ** 2, 0, 'Posterior teeth remain attached to the upper jaw during lip motion');
}
const dentalGeometry = new T.BufferGeometry();
dentalGeometry.setAttribute('position', new T.Float32BufferAttribute(rest.flatMap(p => p.toArray()), 3));
dentalGeometry.setIndex(Array.from(geometry.index.array.slice(geometry.groups[2].start, geometry.groups[2].start + geometry.groups[2].count)));
const dentalMaterial = new T.MeshBasicMaterial({ side: T.DoubleSide }), dentalMesh = new T.Mesh(dentalGeometry, dentalMaterial);
const dentalRay = new T.Raycaster(new T.Vector3(archCenter.x, 0.6, 0.092), new T.Vector3(0, 1, 0));
assert.equal(dentalRay.intersectObject(dentalMesh).length, 0, 'No white tooth plate fills the space reserved for the palate');
for (const i of [1, archMiddle, toothCenters.length - 2]) {
  dentalRay.ray.origin.set(toothCenters[i].x, 0.6, toothCenters[i].z);
  assert(dentalRay.intersectObject(dentalMesh).length > 0, 'The crowns continue around the front and both sides');
}
dentalGeometry.dispose(); dentalMaterial.dispose();
const nose = rest.flatMap((p, i) => i < report.sourceVertices && p.y >= 0.749 && p.y < 0.84 && p.z > 0.09 && Math.abs(p.x) < 0.05 ? [i] : []);
assert(nose.length > 100);
for (const i of nose) for (const target of [...faceTargets, ...normalTargets]) assert.equal(target.getX(i) ** 2 + target.getY(i) ** 2 + target.getZ(i) ** 2, 0, 'Nose positions and normals are protected');

let maxRimError = 0, maxNoseError = 0, maxGap = 0, minJawMotion = 0, minFrontOrientation = 1, minSurfaceNormalAgreement = 1;
let worstFace;
const middle = Math.floor(report.upperLip.length / 2);
const ray = new T.Raycaster();
function hitAt(x, y) {
  ray.set(new T.Vector3(x, y, 0.4), new T.Vector3(0, 0, -1));
  return ray.intersectObject(mesh, false)[0];
}
// Closed face: interiors must remain occluded rather than poke through cheeks.
for (let y = 0.7183; y < 0.746; y += 0.0011) for (let x = -0.0447; x < 0.046; x += 0.0023) {
  const hit = hitAt(x, y); assert(hit && hit.face.materialIndex === 0, `Closed mouth leaks an interior at ${x},${y}`);
}
const boundary = [...report.upperLip, ...report.lowerLip.slice(1, -1).reverse()];
const toothFrontFaces = [];
const oralVertices = [...new Set(geometry.index.array.slice(geometry.groups[1].start))];
const toothGroup = geometry.groups[2];
for (let offset = toothGroup.start; offset < toothGroup.start + toothGroup.count; offset += 3) {
  const ids = Array.from(geometry.index.array.slice(offset, offset + 3));
  const n = rest[ids[1]].clone().sub(rest[ids[0]]).cross(rest[ids[2]].clone().sub(rest[ids[0]])).normalize();
  if (n.z > 0.5) toothFrontFaces.push(ids);
}
function lipYAt(vertices, x) {
  for (let i = 0; i < vertices.length - 1; i++) if (x <= vertices[i + 1].x) {
    const a = vertices[i], b = vertices[i + 1]; return a.y + (b.y - a.y) * (x - a.x) / (b.x - a.x);
  }
  return vertices.at(-1).y;
}
const cases = [];
for (const open of [0.05, 0.25, 0.5, 0.75, 1]) for (const spread of [0, 0.5, 1]) for (const round of [0, 0.5, 1]) {
  speechFace.setPose({ open, spread, round });
  const upper = vertex(report.upperLip[middle]), lower = vertex(report.lowerLip[middle]);
  const gap = upper.y - lower.y; maxGap = Math.max(maxGap, gap);
  assert(gap > open * 0.020, 'The actual lip mesh separates');
  const hit = hitAt((upper.x + lower.x) / 2, (upper.y + lower.y) / 2);
  assert(hit && hit.face.materialIndex !== 0, 'The aperture exposes actual interior geometry');
  // No dark strip above the teeth: within 1.2 mm of the upper edge, a ray
  // must find the seated tooth band on an opening large enough to reveal it.
  if (open >= 0.25) {
    let toothSeen = false;
    for (let offset = 0.0002; offset <= 0.0012; offset += 0.0002) if (hitAt(upper.x, upper.y - offset)?.face.materialIndex === 2) toothSeen = true;
    assert(toothSeen, `Teeth must meet the upper lip: ${open}, ${spread}, ${round}`);
  }
  if (spread === 0 && round === 1 || spread === 1 && round === 0) {
    const top = report.upperLip.map(vertex), bottom = report.lowerLip.map(vertex);
    for (const ids of toothFrontFaces) {
      const p = ids.reduce((sum, i) => sum.add(vertex(i)), new T.Vector3()).multiplyScalar(1 / 3);
      const outside = p.x < top[0].x || p.x > top.at(-1).x || p.y > lipYAt(top, p.x) + 0.0001 || p.y < lipYAt(bottom, p.x) - 0.0001;
      if (outside) assert.equal(hitAt(p.x, p.y)?.face.materialIndex, 0, 'Teeth must not poke through the skin outside the aperture');
    }
    for (const i of oralVertices) {
      const p = vertex(i);
      const outside = p.x < top[0].x - 0.0005 || p.x > top.at(-1).x + 0.0005
        || p.y > lipYAt(top, p.x) + 0.0005 || p.y < lipYAt(bottom, p.x) - 0.0005;
      if (outside) assert.equal(hitAt(p.x, p.y)?.face.materialIndex, 0, `Oral surface ${i} must stay behind the cheek in ${open},${spread},${round}`);
    }
  }
  for (let i = 0; i < boundary.length; i++) maxRimError = Math.max(maxRimError, vertex(boundary[i]).distanceTo(vertex(report.innerRim[i])));
  assert(maxRimError < 1e-7, 'The lining stays attached to both lips');
  for (const i of nose) maxNoseError = Math.max(maxNoseError, vertex(i).distanceTo(rest[i]));
  for (const i of [0, report.upperLip.length - 1]) assert(vertex(report.upperLip[i]).distanceTo(vertex(report.lowerLip[i])) < 1e-8, 'Mouth corners remain closed');
  const indices = geometry.index.array;
  for (let f = 0; f < report.sourceTriangles * 3; f += 3) {
    const ids = [indices[f], indices[f + 1], indices[f + 2]];
    if (ids.every(i => rest[i].y < 0.665 || rest[i].y > 0.75 || Math.abs(rest[i].x) > 0.08 || rest[i].z < 0.09)) continue;
    const a = rest[ids[0]], b = rest[ids[1]], c = rest[ids[2]], n = b.clone().sub(a).cross(c.clone().sub(a));
    if (n.lengthSq() < 1e-15 || n.clone().normalize().z < 0.2) continue;
    const pa = vertex(ids[0]), pb = vertex(ids[1]), pc = vertex(ids[2]);
    const posed = pb.sub(pa).cross(pc.sub(pa)).normalize();
    const restDirection = n.clone().normalize();
    minSurfaceNormalAgreement = Math.min(minSurfaceNormalAgreement, posed.dot(restDirection));
    // The retained upper lip has an underside. Its normal may face downward
    // and slightly back as the lip rolls; that is not a flipped skin triangle.
    // Keep the projection check for surfaces that originally faced forwards.
    if (restDirection.z < 0.65) continue;
    if (posed.z < minFrontOrientation) {
      minFrontOrientation = posed.z;
      worstFace = { f: f / 3, ids, open, spread, round, rest: ids.map(i => rest[i].toArray()), posed: ids.map(i => vertex(i).toArray()), restNormal: n.normalize().toArray(), normal: posed.toArray() };
    }
  }
  cases.push({ open, spread, round, gap });
}
assert.equal(maxNoseError, 0);
assert(minFrontOrientation > 0, `No front-facing lip triangle folds backward: ${JSON.stringify(worstFace)}`);
assert(minSurfaceNormalAgreement > 0, 'The retained lip roll must not invert in 3D');
speechFace.setPose({ open: 0.8, round: 0.5 });
const posedVertices = rest.map((_, i) => vertex(i)), vertexKeys = posedVertices.map(p => p.toArray().map(value => value.toFixed(7)).join(','));
const mouthEdges = new Map(), indexValues = geometry.index.array;
for (let offset = 0; offset < report.cavityEnd; offset += 3) for (let k = 0; k < 3; k++) {
  const a = indexValues[offset + k], b = indexValues[offset + (k + 1) % 3], keys = [vertexKeys[a], vertexKeys[b]].sort(), key = keys.join('|');
  if (!mouthEdges.has(key)) mouthEdges.set(key, { count: 0, a, b }); mouthEdges.get(key).count++;
}
let checkedEdges = 0;
for (const { count, a, b } of mouthEdges.values()) {
  const points = [posedVertices[a], posedVertices[b]];
  if (points.every(p => p.y > 0.67 && p.y < 0.75 && p.z > 0.06 && Math.abs(p.x) < 0.065)) {
    assert.equal(count, 2, 'The opened lips and recessed lining form a closed two-face edge fan'); checkedEdges++;
  }
}
assert(checkedEdges > 100);
speechFace.setPose({ open: 1 });
for (const i of report.upperLipRidge) assert(vertex(i).y - rest[i].y >= -1e-8, 'The whole upper-lip ridge stays on the upper face when the jaw opens');
const lipRidge = rest[report.upperLipRidge[Math.floor(report.upperLipRidge.length / 2)]];
const lipEnd = rest[report.upperLip[middle]];
assert(lipEnd.y < lipRidge.y - 0.002 && lipEnd.z < lipRidge.z - 0.002, 'The cut follows the recessed end of the upper lip, below and behind its outer ridge');
for (let i = 0; i < report.sourceVertices; i++) if (rest[i].y > 0.682 && rest[i].y < 0.708 && Math.abs(rest[i].x) < 0.015 && rest[i].z > 0.09) minJawMotion = Math.min(minJawMotion, vertex(i).y - rest[i].y);
assert(minJawMotion < -0.005, 'The chin can still move downward independently of the nose');
const positions = geometry.attributes.position.array.slice(), influences = mesh.morphTargetInfluences, indexReference = geometry.index;
for (let i = 0; i < 1000; i++) speechFace.setPose({ open: (i % 100) / 100, spread: 0.3, round: 0.6 });
assert.equal(geometry.index, indexReference); assert.equal(mesh.morphTargetInfluences, influences);
assert.deepEqual(geometry.attributes.position.array, positions, 'Runtime changes weights, not base buffers or topology');
model.reset();
for (let i = 0; i < rest.length; i++) assert(vertex(i).distanceTo(rest[i]) < 1e-8, 'Reset restores the closed mesh');
console.log(JSON.stringify({ passed: true, cases: cases.length, addedVertices: report.addedVertices, addedTriangles: report.addedTriangles,
  addedOuterTriangles: report.addedOuterTriangles, cornerUVRecords: changedUV.size, minCornerUVAreaRatio,
  checkedEdges, maxRimError, maxNoseError, maxGap, minJawMotion, minFrontOrientation, minSurfaceNormalAgreement }, null, 2));
model.dispose();
