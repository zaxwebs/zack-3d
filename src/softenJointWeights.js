import * as THREE from 'three';

/** Blur each joint's existing proximal/distal bone blend along connected surface edges. */
export function softenJointWeights({ root, mesh, skeleton, bones, geometry }) {
  const indices = geometry.attributes.skinIndex;
  const weights = geometry.attributes.skinWeight;
  const positions = geometry.attributes.position;
  const groups = [], byPosition = new Map(), vertexGroup = [];
  const inverseRoot = root.matrixWorld.clone().invert();
  for (let i = 0; i < positions.count; i++) {
    // Weld UV seams for the calculation only; geometry and UVs stay intact.
    const key = `${positions.getX(i)},${positions.getY(i)},${positions.getZ(i)}`;
    if (!byPosition.has(key)) {
      byPosition.set(key, groups.length);
      const influences = new Map();
      for (let slot = 0; slot < 4; slot++) {
        const index = indices.array[i * 4 + slot], weight = weights.array[i * 4 + slot];
        if (weight > 0) influences.set(index, (influences.get(index) || 0) + weight);
      }
      groups.push({ vertices: [], neighbors: new Set(), influences,
        point: mesh.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld).applyMatrix4(inverseRoot) });
    }
    const group = byPosition.get(key);
    groups[group].vertices.push(i);
    vertexGroup.push(group);
  }
  for (let i = 0; i < geometry.index.count; i += 3) for (let k = 0; k < 3; k++) {
    const a = vertexGroup[geometry.index.array[i + k]];
    const b = vertexGroup[geometry.index.array[i + (k + 1) % 3]];
    if (a !== b) { groups[a].neighbors.add(b); groups[b].neighbors.add(a); }
  }
  const definitions = [
    { name: 'elbow', parent: 'Upperarm', child: 'Forearm', width: 0.045, radius: 0.075, limit: 0.12 },
    { name: 'wrist', parent: 'Forearm', child: 'Hand', width: 0.028, radius: 0.065, limit: 0.08 },
    { name: 'hip', parent: 'Pelvis', child: 'Thigh', width: 0.065, radius: 0.08, limit: 0.08 },
    { name: 'knee', parent: 'Thigh', child: 'Calf', width: 0.055, radius: 0.065, limit: 0.12 },
    { name: 'ankle', parent: 'Calf', child: 'Foot', width: 0.035, radius: 0.065, limit: 0.08 },
  ];
  const localPosition = bone => bone.getWorldPosition(new THREE.Vector3()).applyMatrix4(inverseRoot);
  const report = [];
  const changed = new Set();
  for (const side of ['L', 'R']) for (const definition of definitions) {
    const parent = bones[definition.parent === 'Pelvis' ? 'Pelvis' : `${side}_${definition.parent}`];
    const child = bones[`${side}_${definition.child}`];
    const parentIndex = skeleton.bones.indexOf(parent), childIndex = skeleton.bones.indexOf(child);
    const pivot = localPosition(child);
    const axis = pivot.clone().sub(localPosition(definition.name === 'hip' ? bones.Hip : parent)).normalize();
    const mass = groups.map(g => (g.influences.get(parentIndex) || 0) + (g.influences.get(childIndex) || 0));
    const fraction = groups.map((g, i) => mass[i] > 0 ? (g.influences.get(childIndex) || 0) / mass[i] : 0);
    const original = fraction.slice();
    const mask = groups.map((group, i) => {
      if (mass[i] < 0.5) return 0;
      const otherInfluences = [...group.influences].filter(([index, weight]) =>
        weight > 0 && index !== parentIndex && index !== childIndex).length;
      // Preserve finger and accessory weights rather than dropping an existing
      // influence to make room for this joint's blend partner.
      if (otherInfluences + 2 > 4) return 0;
      const offset = group.point.clone().sub(pivot), along = offset.dot(axis);
      const radius = offset.addScaledVector(axis, -along).length();
      let brush = (1 - THREE.MathUtils.smoothstep(Math.abs(along), 0, definition.width))
        * (1 - THREE.MathUtils.smoothstep(radius, definition.radius * 0.65, definition.radius));
      // Pants may blend at the hip; the corrected hoodie hem must not regain leg pull.
      if (definition.name === 'hip') brush *= 1 - THREE.MathUtils.smoothstep(group.point.y, 0.39, 0.425);
      return brush;
    });
    const energy = values => {
      let total = 0, count = 0;
      groups.forEach((group, i) => {
        if (mask[i] <= 1e-6) return;
        for (const j of group.neighbors) {
          if (j <= i || mask[j] <= 1e-6) continue;
          const edgeWeight = Math.min(mask[i], mask[j]) * Math.min(mass[i], mass[j]);
          total += edgeWeight * (values[i] - values[j]) ** 2;
          count += edgeWeight;
        }
      });
      return count ? total / count : 0;
    };
    const beforeEnergy = energy(fraction);
    for (let iteration = 0; iteration < 3; iteration++) {
      const next = fraction.slice();
      groups.forEach((group, i) => {
        if (mask[i] <= 1e-6) return;
        let average = 0, total = 0;
        for (const j of group.neighbors) {
          const edgeWeight = Math.min(mask[i], mask[j]) * Math.min(mass[i], mass[j]);
          if (edgeWeight <= 1e-6) continue;
          average += fraction[j] * edgeWeight; total += edgeWeight;
        }
        if (!total) return;
        const target = THREE.MathUtils.lerp(fraction[i], average / total, 0.35 * mask[i]);
        const maximum = definition.limit / mass[i];
        next[i] = THREE.MathUtils.clamp(target, Math.max(0, original[i] - maximum), Math.min(1, original[i] + maximum));
      });
      for (let i = 0; i < fraction.length; i++) fraction[i] = next[i];
    }
    const stats = { joint: `${side}_${definition.name}`, changedVertices: 0,
      maxTransferredWeight: 0, beforeEnergy, afterEnergy: energy(fraction) };
    groups.forEach((group, i) => {
      const change = Math.abs(fraction[i] - original[i]) * mass[i];
      if (change < 1e-6) return;
      group.influences.set(parentIndex, mass[i] * (1 - fraction[i]));
      group.influences.set(childIndex, mass[i] * fraction[i]);
      changed.add(i);
      stats.changedVertices += group.vertices.length;
      stats.maxTransferredWeight = Math.max(stats.maxTransferredWeight, change);
    });
    report.push(stats);
  }
  for (const i of changed) {
    const group = groups[i];
    const strongest = [...group.influences].filter(([, weight]) => weight > 0)
      .sort((a, b) => b[1] - a[1]).slice(0, 4);
    const total = strongest.reduce((sum, [, weight]) => sum + weight, 0);
    for (const vertex of group.vertices) for (let slot = 0; slot < 4; slot++) {
      indices.array[vertex * 4 + slot] = strongest[slot]?.[0] ?? 0;
      weights.array[vertex * 4 + slot] = (strongest[slot]?.[1] ?? 0) / total;
    }
  }
  return { iterations: 3, strength: 0.35, joints: report,
    correctedVertices: [...changed].reduce((sum, i) => sum + groups[i].vertices.length, 0) };
}
