import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { createZackModel } from '../src/ZackModel.js';
import { createZackRig, POSES } from '../src/ZackRig.js';
import { repairHandSeams } from '../src/repairHandSeams.js';

const binary = await readFile('public/model/geometry.bin');
const manifest = JSON.parse(await readFile('public/model/manifest.json', 'utf8'));
const buffer = binary.buffer.slice(binary.byteOffset, binary.byteOffset + binary.byteLength);
const model = createZackModel(manifest, buffer);
const rig = createZackRig(model);
const correction = model.root.userData.handSeamCorrection;
assert.equal(correction.slits, 2);
assert.deepEqual(correction.repairs.map(repair => repair.side).sort(), ['L', 'R']);
assert(correction.maxDisplacement > 0 && correction.maxDisplacement < 0.00025);
const repairedVertices = new Set(correction.repairs.flatMap(repair => repair.vertices));
assert.equal(repairedVertices.size, 8);
// Verify this repair's scope in isolation. The complete character also has
// sole caps, clothing repairs, and a deliberately split mouth now.
const handGeometry = new THREE.BufferGeometry();
for (const name of ['position', 'normal', 'uv', 'skinIndex', 'skinWeight', 'index']) {
  const layout = manifest.arrays[name], constructors = { Float32Array, Uint16Array, Uint32Array, Uint8Array };
  const original = new constructors[layout.type](buffer, layout.byteOffset, layout.count * layout.itemSize);
  const values = layout.normalized ? Float32Array.from(original, value => value / 255) : original.slice();
  const attribute = new THREE.BufferAttribute(values, layout.itemSize);
  if (name === 'index') handGeometry.setIndex(attribute); else handGeometry.setAttribute(name, attribute);
}
assert.equal(repairHandSeams(handGeometry, model.skeleton, model.bones).slits, 2);
for (const name of ['position', 'normal', 'uv', 'index']) {
  const layout = manifest.arrays[name];
  const constructors = { Float32Array, Uint16Array, Uint32Array };
  const original = new constructors[layout.type](buffer, layout.byteOffset, layout.count * layout.itemSize);
  const current = name === 'index' ? handGeometry.index.array : handGeometry.attributes[name].array;
  original.forEach((value, index) => {
    if (['position', 'normal'].includes(name) && repairedVertices.has(Math.floor(index / layout.itemSize))) return;
    assert.equal(current[index], value, `${name} changed outside the hand repair`);
  });
}
function boundaryEdgeCount(positions, indices) {
  const canonical = [];
  const groups = new Map();
  for (let vertex = 0; vertex < positions.length / 3; vertex++) {
    const key = Array.from(positions.slice(vertex * 3, vertex * 3 + 3)).join(',');
    if (!groups.has(key)) groups.set(key, vertex);
    canonical.push(groups.get(key));
  }
  const edges = new Map();
  for (let offset = 0; offset < indices.length; offset += 3) {
    for (let corner = 0; corner < 3; corner++) {
      const ends = [canonical[indices[offset + corner]], canonical[indices[offset + (corner + 1) % 3]]].sort((left, right) => left - right);
      const key = ends.join(',');
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  return [...edges.values()].filter(count => count === 1).length;
}
const positionLayout = manifest.arrays.position;
const originalPositions = new Float32Array(buffer, positionLayout.byteOffset, positionLayout.count * 3);
assert.equal(boundaryEdgeCount(originalPositions, handGeometry.index.array) - boundaryEdgeCount(handGeometry.attributes.position.array, handGeometry.index.array), 8);
handGeometry.dispose();
const correctedPositions = model.geometry.attributes.position.array.slice();
const correctedNormals = model.geometry.attributes.normal.array.slice();
for (const name of Object.keys(POSES)) {
  rig.setPose(name);
  for (const repair of correction.repairs) {
    const first = model.mesh.getVertexPosition(repair.vertices[0], new THREE.Vector3());
    for (const vertex of repair.vertices) {
      assert(first.distanceTo(model.mesh.getVertexPosition(vertex, new THREE.Vector3())) < 1e-9, `${name} reopens the ${repair.side} hand seam`);
    }
  }
}
model.geometry.attributes.position.setXYZ(correction.repairs[0].vertices[0], 0, 0, 0);
model.geometry.attributes.normal.setXYZ(correction.repairs[0].vertices[0], 0, 0, 0);
model.reset();
assert.deepEqual(model.geometry.attributes.position.array, correctedPositions);
assert.deepEqual(model.geometry.attributes.normal.array, correctedNormals);
assert.equal(repairHandSeams(model.geometry, model.skeleton, model.bones).slits, 0);
model.dispose();
console.log('Hand seam checks passed: both source slits closed, UVs/topology preserved, eight corrected vertices, stable across all poses and reset.');
