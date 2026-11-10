import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createZackModel } from '../src/ZackModel.js';

const bytes = await readFile('public/model/geometry.bin');
const model = createZackModel(JSON.parse(await readFile('public/model/manifest.json', 'utf8')),
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
const report = model.root.userData.jointWeightTransitions;
assert.equal(report.joints.length, 10);
for (const joint of report.joints) {
  assert(joint.changedVertices > 0, `${joint.joint}: no transition was adjusted`);
  assert(joint.afterEnergy < joint.beforeEnergy, `${joint.joint}: neighboring weight transitions did not improve`);
  assert(joint.maxTransferredWeight <= 0.120001, `${joint.joint}: correction exceeded its bound`);
}
const indices = model.geometry.attributes.skinIndex, weights = model.geometry.attributes.skinWeight;
let maxWeightSumError = 0;
for (let i = 0; i < indices.count; i++) {
  let sum = 0;
  for (let slot = 0; slot < 4; slot++) {
    const joint = indices.array[i * 4 + slot], weight = weights.array[i * 4 + slot];
    assert(Number.isInteger(joint) && joint >= 0 && joint < model.skeleton.bones.length);
    assert(Number.isFinite(weight) && weight >= 0);
    sum += weight;
  }
  maxWeightSumError = Math.max(maxWeightSumError, Math.abs(sum - 1));
}
assert(maxWeightSumError < 1e-6);
await mkdir('artifacts/joint-softening', { recursive: true });
await writeFile('artifacts/joint-softening/audit.json', JSON.stringify({ ...report, maxWeightSumError }, null, 2));
console.log(JSON.stringify({ ...report, maxWeightSumError }, null, 2));
model.dispose();
