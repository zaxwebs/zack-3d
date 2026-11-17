import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { createZackModel } from '../src/ZackModel.js';
import { SpeechEnvelope } from '../src/SpeechAudio.js';

const samples = amplitude => Float32Array.from({ length: 1024 }, (_, i) => amplitude * Math.sin(i * 0.19));
const spectrum = hz => { const bins = new Float32Array(512).fill(-100); bins[Math.round(hz / (48000 / 1024))] = -20; return bins; };
const silence = samples(0), voice = samples(0.08), quiet = samples(0.001);
const step = (envelope, input, frequency, seconds, fps = 60) => {
  for (let i = 0; i < Math.round(seconds * fps); i++) envelope.update(input, spectrum(frequency), 48000, 1 / fps);
  return envelope.open;
};
const envelope = new SpeechEnvelope();
assert.equal(step(envelope, silence, 300, 1), 0);
assert.equal(step(envelope, quiet, 300, 1), 0, 'Room noise stays below the gate');
assert.equal(step(envelope, new Float32Array(1024).fill(0.1), 300, 1), 0, 'DC is not speech');
step(envelope, voice, 300, 0.05);
assert(envelope.open > 0.55, 'Speech must visibly attack within 50 ms of features arriving');
step(envelope, voice, 300, 0.2);
assert(envelope.round > 0.8 && envelope.spread < 0.01);
step(envelope, voice, 1500, 0.4);
assert(envelope.spread > 0.95 && envelope.round < 0.01);
step(envelope, silence, 1500, 0.6);
assert.equal(envelope.open, 0, 'Silence returns to rest without periodic flapping');
const at30 = new SpeechEnvelope(), at60 = new SpeechEnvelope();
assert(Math.abs(step(at30, voice, 300, 0.3, 30) - step(at60, voice, 300, 0.3, 60)) < 0.001);
envelope.reset(); envelope.sensitivity = 4;
assert(step(envelope, samples(0.004), 300, 0.2) > 0.2, 'Sensitivity supports quiet voices');

const manifest = JSON.parse(await readFile('public/model/manifest.json'));
const data = await readFile('public/model/geometry.bin');
const model = createZackModel(manifest, data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
const { geometry, mesh, speechFace } = model;
const base = Object.fromEntries(Object.entries(geometry.attributes).map(([name, attribute]) => [name, attribute.array.slice()]));
const indices = geometry.index.array.slice(), previousTargets = mesh.morphTargetInfluences.slice(0, speechFace.report.firstTarget);
assert.equal(geometry.attributes.position.count, speechFace.report.vertices);
assert.equal(geometry.index.count / 3, speechFace.report.triangles);
assert.equal(speechFace.report.addedOuterTriangles, 0);
assert(speechFace.report.addedVertices <= 320 && speechFace.report.addedTriangles <= 520);
const restPoints = Array.from({ length: base.position.length / 3 }, (_, i) => mesh.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld));
let moved = 0, maxDisplacement = 0;
speechFace.setPose({ open: 1, spread: 0.6, round: 0.7 });
for (let i = 0; i < restPoints.length; i++) {
  const distance = mesh.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld).distanceTo(restPoints[i]);
  maxDisplacement = Math.max(maxDisplacement, distance);
  if (distance < 1e-7) continue;
  moved++;
  const p = restPoints[i];
  assert(p.y > 0.65 && p.y < 0.77 && p.z > 0.06 && Math.abs(p.x) < 0.10, `Speech only deforms the lower face: ${i} ${p.toArray()} ${distance}`);
}
assert(moved > 50 && maxDisplacement < 0.030);
for (const [name, values] of Object.entries(base)) assert.deepEqual(geometry.attributes[name].array, values, `${name} stays unchanged`);
assert.deepEqual(geometry.index.array, indices);
assert.deepEqual(mesh.morphTargetInfluences.slice(0, speechFace.report.firstTarget), previousTargets);
model.elbowCorrectives.setEnabled(false); model.shoulderCorrectives.setEnabled(false);
assert.equal(mesh.morphTargetInfluences[speechFace.report.firstTarget], 1, 'Body toggles preserve speech');
speechFace.setPose({ open: NaN, spread: Infinity, round: -1 });
assert.deepEqual(speechFace.state, { open: 0, spread: 0, round: 0 });
model.reset();
assert.deepEqual(speechFace.state, { open: 0, spread: 0, round: 0 });
const seamDeltas = new Map();
const lowerCopies = new Set(speechFace.report.splitRecords.map(record => record.copy));
for (const attribute of geometry.morphAttributes.position.slice(speechFace.report.firstTarget)) {
  seamDeltas.clear();
  for (let i = 0; i < speechFace.report.outerVertices; i++) {
    const key = `${base.position.slice(i * 3, i * 3 + 3).join(',')}:${lowerCopies.has(i) ? 'lower' : 'upper'}`;
    const delta = [...attribute.array.slice(i * 3, i * 3 + 3)];
    if (seamDeltas.has(key)) assert.deepEqual(delta, seamDeltas.get(key), 'UV duplicates move together');
    else seamDeltas.set(key, delta);
  }
}
console.log(JSON.stringify({ passed: true, movedVertices: moved, maxDisplacement, technique: speechFace.report.technique,
  vertices: speechFace.report.vertices, triangles: speechFace.report.triangles, addedVertices: speechFace.report.addedVertices,
  addedTriangles: speechFace.report.addedTriangles, addedOuterTriangles: speechFace.report.addedOuterTriangles,
  targets: speechFace.report.targets }, null, 2));
model.dispose();
