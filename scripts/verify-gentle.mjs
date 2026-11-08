import * as THREE from 'three';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createZackModel } from '../src/ZackModel.js';
import { createZackRig } from '../src/ZackRig.js';
const binary = await readFile('public/model/geometry.bin');
const model = createZackModel(JSON.parse(await readFile('public/model/manifest.json', 'utf8')), binary.buffer.slice(binary.byteOffset, binary.byteOffset + binary.byteLength));
const rig = createZackRig(model);
const world = name => model.bones[name].getWorldPosition(new THREE.Vector3());
const vertex = i => model.mesh.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(model.mesh.matrixWorld);
const restScales = model.skeleton.bones.map(b => b.scale.clone());
rig.setPose('rest');
const elbow = world('R_Forearm');
const restAxis = world('R_Hand').sub(elbow).normalize();
const samples = [];
const unique = new Set();
for (let i = 0; i < model.geometry.attributes.position.count; i++) {
  const p = vertex(i), offset = p.clone().sub(elbow);
  const along = offset.dot(restAxis);
  const radial = offset.addScaledVector(restAxis, -along).length();
  const key = p.toArray().join(',');
  if (Math.abs(along) < 0.012 && radial < 0.06 && !unique.has(key)) { samples.push(i); unique.add(key); }
}
function section() {
  const incoming = world('R_Forearm').sub(world('R_Upperarm')).normalize();
  const outgoing = world('R_Hand').sub(world('R_Forearm')).normalize();
  const axis = incoming.clone().add(outgoing).normalize();
  const x = new THREE.Vector3(0, 1, 0).cross(axis).normalize();
  const y = axis.clone().cross(x).normalize();
  const points = samples.map(i => { const p = vertex(i).sub(world('R_Forearm')); return [p.dot(x), p.dot(y)]; });
  const mean = points.reduce((a, p) => [a[0] + p[0] / points.length, a[1] + p[1] / points.length], [0, 0]);
  let a = 0, b = 0, d = 0;
  for (const p of points) { const u = p[0] - mean[0], v = p[1] - mean[1]; a += u * u / points.length; b += u * v / points.length; d += v * v / points.length; }
  return { minorRadius: Math.sqrt(Math.max(0, (a + d - Math.hypot(a - d, 2 * b)) / 2)), flexDegrees: THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(incoming.dot(outgoing), -1, 1))) };
}
const baseline = section();
rig.setConservativeMode(false); rig.setPose('hi');
const original = section();
rig.setConservativeMode(true);
const gentle = section();
assert(gentle.flexDegrees <= rig.limits.elbowFlex + 1e-5);
assert(gentle.flexDegrees < original.flexDegrees - 15);
assert(gentle.minorRadius / baseline.minorRadius > 0.92, 'Gentle wave must retain the sampled elbow thickness');
assert(gentle.minorRadius > original.minorRadius * 1.25);
for (const pose of ['down', 'front', 'hi', 'rest']) {
  rig.setPose(pose);
  model.skeleton.bones.forEach((bone, i) => assert(bone.scale.equals(restScales[i]), `${bone.name} scale changed`));
  for (const side of ['L', 'R']) {
    const upper = world(`${side}_Forearm`).sub(world(`${side}_Upperarm`)).normalize();
    const fore = world(`${side}_Hand`).sub(world(`${side}_Forearm`)).normalize();
    const flex = THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(upper.dot(fore), -1, 1)));
    assert(flex <= rig.limits.elbowFlex + 1e-5);
    const elevation = THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(upper.dot(new THREE.Vector3(0, -1, 0)), -1, 1)));
    assert(elevation <= rig.limits.shoulderElevation + 1e-5);
  }
}
rig.setHeadTurn(90); assert.equal(rig.headTurn, 30);
rig.setHeadTurn(-90); assert.equal(rig.headTurn, -30);
const report = { samples: samples.length, baseline, original, gentle,
  originalThicknessRatio: original.minorRadius / baseline.minorRadius,
  gentleThicknessRatio: gentle.minorRadius / baseline.minorRadius,
  scalesUnchanged: true, limits: rig.limits };
await mkdir('artifacts/gentle', { recursive: true });
await writeFile('artifacts/gentle/verification.json', JSON.stringify(report, null, 2));
console.log(report);
model.dispose();
