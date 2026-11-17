import * as THREE from 'three';

const { clamp, smoothstep } = THREE.MathUtils;
const finite = value => Number.isFinite(value) ? clamp(value, 0, 1) : 0;

/** Author local lip/jaw shapes on a real split, with a connected lining. */
export function createSpeechFace({ root, mesh, geometry, bones, mouthTopology: topology }) {
  const { facePoints: points, motion, lipSides, sampleSeam, centerX, halfWidth, outerVertices, fromFace, innerMaterials } = topology;
  const fromFaceDirection = new THREE.Matrix3().setFromMatrix4(fromFace);
  const firstTarget = geometry.morphAttributes.position?.length ?? 0, targets = ['SpeechJaw', 'SpeechSpread', 'SpeechRound'];
  const position = geometry.attributes.position, normal = geometry.attributes.normal, activeVertices = new Set();

  function faceDelta(point, side, shape) {
    // The nose is protected. Chin and lip motion have separate local falloffs.
    if (point.y >= 0.749 || point.y <= 0.660 || point.z <= 0.065) return new THREE.Vector3();
    const x = point.x - centerX, curveY = sampleSeam(point.x).y, distance = point.y - curveY;
    const t = x / halfWidth, profile = Math.max(0, 1 - t * t) ** 0.85;
    const front = smoothstep(point.z, 0.065, 0.105), noseLock = 1 - smoothstep(point.y, 0.742, 0.749);
    if (shape === 0) {
      const lower = side === -1 || (side !== 1 && distance < -0.000001);
      if (lower) {
        const jaw = smoothstep(point.y, 0.660, 0.694) * front * profile;
        const lip = 1 - smoothstep(Math.abs(distance), 0.004, 0.035);
        return new THREE.Vector3(0, -(0.009 + 0.014 * lip) * jaw, -0.0020 * jaw);
      }
      const upper = (1 - smoothstep(Math.abs(distance), 0.001, 0.013)) * front * profile * noseLock;
      return new THREE.Vector3(0, 0.0014 * upper, 0.0005 * upper);
    }
    const sideFade = 1 - smoothstep(Math.abs(x), halfWidth, halfWidth * 1.85);
    const lip = (1 - smoothstep(Math.abs(distance), 0.004, 0.025)) * front * noseLock * sideFade;
    const upperSide = side === 1 || (side !== -1 && distance >= -0.000001);
    const roundY = ((upperSide ? 0.004 * profile : 0) - 0.006 * (1 - profile)) * lip;
    return shape === 1 ? new THREE.Vector3(x * 0.12 * lip, 0, 0)
      : new THREE.Vector3(-x * 0.40 * lip, roundY, 0.004 * lip * Math.max(0, 1 - t * t));
  }

  // Normal transport preserves the imported shading detail and ordinary UV
  // seams. The two lip fans intentionally remain independent at the split.
  const normalGroups = [], groupByKey = new Map(), vertexGroup = [];
  for (let i = 0; i < position.count; i++) {
    const key = i < outerVertices ? `${position.getX(i)},${position.getY(i)},${position.getZ(i)}:${lipSides[i]}` : `inner:${i}`;
    if (!groupByKey.has(key)) { groupByKey.set(key, normalGroups.length); normalGroups.push([]); }
    const group = groupByKey.get(key); normalGroups[group].push(i); vertexGroup.push(group);
  }
  const neighbors = normalGroups.map(() => new Set());
  for (let i = 0; i < topology.report.sourceTriangles * 3; i += 3) for (let k = 0; k < 3; k++) {
    const a = vertexGroup[geometry.index.array[i + k]], b = vertexGroup[geometry.index.array[i + (k + 1) % 3]];
    if (a !== b) { neighbors[a].add(b); neighbors[b].add(a); }
  }
  const lipGroups = new Set([...topology.upper, ...topology.lower].map(i => vertexGroup[i]));
  const free = normalGroups.flatMap((vertices, group) => {
    const i = vertices[0], p = points[i];
    return i < outerVertices && !lipGroups.has(group) && p.y >= sampleSeam(p.x).y && p.y < 0.749 && p.z > 0.065 && Math.abs(p.x - centerX) < 0.085 ? [group] : [];
  });
  const neighborWeights = new Map(free.map(group => {
    const p = points[normalGroups[group][0]], links = [...neighbors[group]].map(other => ({ group: other,
      weight: 1 / Math.max(0.001, p.distanceTo(points[normalGroups[other][0]])) }));
    const total = links.reduce((sum, link) => sum + link.weight, 0);
    links.forEach(link => { link.weight /= total || 1; });
    return [group, links];
  }));
  function authorSurface(shape) {
    const authored = normalGroups.map(vertices => faceDelta(points[vertices[0]], lipSides[vertices[0]], shape));
    const solved = authored.map(delta => delta.clone());
    // Solve displacement on the connected skin, with fixed lip landmarks,
    // fixed nose/outer brush, and the authored lower lip. This avoids folding
    // skinny triangles between a moving lip and a pinned nose. All of this is
    // done once at model creation; playback still only writes three weights.
    for (let iteration = 0; iteration < 240; iteration++) {
      let change = 0;
      for (const group of free) {
        const average = new THREE.Vector3();
        for (const link of neighborWeights.get(group)) average.addScaledVector(solved[link.group], link.weight);
        average.multiplyScalar(0.985).addScaledVector(authored[group], 0.015);
        change = Math.max(change, average.distanceToSquared(solved[group])); solved[group].copy(average);
      }
      if (change < 1e-17) break;
    }
    return solved;
  }
  function surfaceNormals(positions) {
    const result = normalGroups.map(() => new THREE.Vector3()), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    const index = geometry.index.array;
    for (let i = 0; i < index.length; i += 3) {
      const ia = index[i], ib = index[i + 1], ic = index[i + 2];
      a.fromArray(positions, ia * 3); b.fromArray(positions, ib * 3); c.fromArray(positions, ic * 3);
      const n = b.sub(a).cross(c.sub(a)); result[vertexGroup[ia]].add(n); result[vertexGroup[ib]].add(n); result[vertexGroup[ic]].add(n);
    }
    return result.map(n => n.normalize());
  }
  const restNormals = surfaceNormals(position.array);
  for (const [shape, name] of targets.entries()) {
    const offsets = new Float32Array(position.count * 3), deltas = [], surface = authorSurface(shape);
    for (let i = 0; i < position.count; i++) {
      let delta;
      if (i < outerVertices) delta = surface[vertexGroup[i]].clone();
      else if (motion[i]?.toothAnchor) delta = faceDelta(motion[i].toothAnchor, 1, shape);
      else if (motion[i]?.source !== undefined) delta = deltas[motion[i].source].clone().multiplyScalar(motion[i].follow);
      else delta = new THREE.Vector3();
      deltas.push(delta);
      if (delta.lengthSq() > 1e-16) activeVertices.add(i);
      delta.clone().applyMatrix3(fromFaceDirection).toArray(offsets, i * 3);
    }
    const posed = Float32Array.from(position.array, (value, i) => value + offsets[i]);
    const targetNormals = surfaceNormals(posed), normalOffsets = new Float32Array(offsets.length);
    const rotations = restNormals.map((n, i) => n.lengthSq() && targetNormals[i].lengthSq() ? new THREE.Quaternion().setFromUnitVectors(n, targetNormals[i]) : new THREE.Quaternion());
    for (let i = 0; i < position.count; i++) {
      if (i < outerVertices && (points[i].y >= 0.749 || !activeVertices.has(i))) continue;
      const original = new THREE.Vector3().fromBufferAttribute(normal, i);
      original.clone().applyQuaternion(rotations[vertexGroup[i]]).sub(original).toArray(normalOffsets, i * 3);
    }
    const attribute = new THREE.BufferAttribute(offsets, 3); attribute.name = name;
    const normalAttribute = new THREE.BufferAttribute(normalOffsets, 3); normalAttribute.name = name;
    (geometry.morphAttributes.position ??= []).push(attribute); (geometry.morphAttributes.normal ??= []).push(normalAttribute);
  }
  geometry.morphTargetsRelative = true;
  const previousInfluences = mesh.morphTargetInfluences?.slice() ?? []; mesh.updateMorphTargets();
  previousInfluences.forEach((value, i) => { mesh.morphTargetInfluences[i] = value; });
  const state = { open: 0, spread: 0, round: 0 };
  let interiorVisible = true;
  function setPose({ open = 0, spread = 0, round = 0 } = {}) {
    state.open = finite(open); state.spread = finite(spread); state.round = finite(round);
    mesh.morphTargetInfluences[firstTarget] = state.open;
    mesh.morphTargetInfluences[firstTarget + 1] = state.spread * state.open;
    mesh.morphTargetInfluences[firstTarget + 2] = state.round * state.open;
    const visible = state.open > 0.0001;
    if (visible !== interiorVisible) {
      interiorVisible = visible;
      innerMaterials.forEach(material => { material.visible = visible; });
    }
  }
  setPose();
  const anchor = bones.Head.worldToLocal(new THREE.Vector3(centerX, 0.80, 0.07).applyMatrix4(root.matrixWorld));
  const report = { technique: 'split smile edges with recessed lining and upper teeth', ...topology.report,
    vertices: position.count, triangles: geometry.index.count / 3, firstTarget, targets, affectedVertices: activeVertices.size, noseLockHeight: 0.749 };
  root.userData.speechFace = report;
  return { setPose, reset: () => setPose(), get state() { return { ...state }; }, report,
    getWorldAnchor: (target = new THREE.Vector3()) => bones.Head.localToWorld(target.copy(anchor)),
    setSurface(mode) { innerMaterials.forEach(material => { material.wireframe = mode === 'wire'; }); },
    dispose() { innerMaterials.forEach(material => material.dispose()); },
  };
}
