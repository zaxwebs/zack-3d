import * as THREE from 'three';

const ELEVATIONS = [110, 135, 160];
const REACHES = [-60, 0, 60];

function bracket(values, value) {
  for (let i = 1; i < values.length; i++) {
    if (value <= values[i]) return [values[i - 1], values[i], THREE.MathUtils.clamp((value - values[i - 1]) / (values[i] - values[i - 1]), 0, 1)];
  }
  return [values.at(-1), values.at(-1), 0];
}

/** Pose targets soften the shoulder hinge and lift the cap without altering topology. */
export function createShoulderCorrectives({ root, mesh, geometry, skeleton, bones, armTwist }) {
  root.updateMatrixWorld(true);
  const rest = skeleton.bones.map(bone => ({ p: bone.position.clone(), q: bone.quaternion.clone(), s: bone.scale.clone() }));
  const restore = () => {
    skeleton.bones.forEach((bone, i) => { bone.position.copy(rest[i].p); bone.quaternion.copy(rest[i].q); bone.scale.copy(rest[i].s); });
    root.updateMatrixWorld(true);
  };
  const inverseRoot = root.matrixWorld.clone().invert();
  const pointOf = bone => bone.getWorldPosition(new THREE.Vector3()).applyMatrix4(inverseRoot);
  const restSpine = bones.Spine02.getWorldQuaternion(new THREE.Quaternion()).normalize();
  const position = geometry.attributes.position, normal = geometry.attributes.normal;
  const indices = geometry.attributes.skinIndex, weights = geometry.attributes.skinWeight;
  const byPosition = new Map(), groups = [], vertexGroup = [];
  for (let vertex = 0; vertex < position.count; vertex++) {
    const key = `${position.getX(vertex)},${position.getY(vertex)},${position.getZ(vertex)}`;
    if (!byPosition.has(key)) {
      byPosition.set(key, groups.length);
      groups.push({ vertices: [], neighbors: new Set(), point: mesh.getVertexPosition(vertex, new THREE.Vector3())
        .applyMatrix4(mesh.matrixWorld).applyMatrix4(inverseRoot) });
    }
    const index = byPosition.get(key);
    groups[index].vertices.push(vertex);
    vertexGroup.push(index);
  }
  const triangles = Array.from(geometry.index.array, vertex => vertexGroup[vertex]);
  for (let i = 0; i < triangles.length; i += 3) for (let edge = 0; edge < 3; edge++) {
    const a = triangles[i + edge], b = triangles[i + (edge + 1) % 3];
    if (a !== b) { groups[a].neighbors.add(b); groups[b].neighbors.add(a); }
  }
  const restPoints = groups.map(group => group.point);
  const bind = inverseRoot.clone().multiply(skeleton.bones[0].matrixWorld).multiply(skeleton.boneInverses[0]);
  const inverseBind = bind.clone().invert();
  const centerX = pointOf(bones.Spine02).x;
  const definitions = ['L', 'R'].map(side => {
    const sign = side === 'L' ? 1 : -1;
    const clavicle = bones[`${side}_Clavicle`], upper = bones[`${side}_Upperarm`], forearm = bones[`${side}_Forearm`];
    const pivot = pointOf(upper);
    const family = new Set(skeleton.bones.flatMap((bone, i) => /^(Spine01|Spine02)$/.test(bone.name)
      || bone.name === `${side}_Clavicle` || bone.name.startsWith(`${side}_Upperarm`) ? [i] : []));
    const masks = groups.map(group => {
      const vertex = group.vertices[0], point = group.point;
      let mass = 0;
      for (let slot = 0; slot < 4; slot++) if (family.has(indices.array[vertex * 4 + slot])) mass += weights.array[vertex * 4 + slot];
      const armFade = THREE.MathUtils.smoothstep(mass, 0.65, 0.95);
      if (!armFade) return 0;
      const x = sign * (point.x - centerX);
      return THREE.MathUtils.smoothstep(x, 0.045, 0.075) * (1 - THREE.MathUtils.smoothstep(x, 0.145, 0.185))
        * THREE.MathUtils.smoothstep(point.y, 0.555, 0.595) * (1 - THREE.MathUtils.smoothstep(point.y, 0.665, 0.70))
        * (1 - THREE.MathUtils.smoothstep(Math.abs(point.z - pivot.z), 0.07, 0.11)) * armFade;
    });
    const active = masks.flatMap((mask, i) => mask > 1e-6 ? [i] : []);
    return { side, sign, clavicle, upper, forearm, pivot, masks, active, targets: new Map() };
  });

  function smooth(points, d) {
    let current = points.map(point => point.clone());
    // Alternating smoothing and inflation reduce a hinge without shrinking the sleeve.
    for (let iteration = 0; iteration < 6; iteration++) for (const strength of [0.5, -0.53]) {
      const next = current.slice();
      for (const i of d.active) {
        const average = new THREE.Vector3();
        let total = 0;
        for (const j of groups[i].neighbors) {
          const weight = 1 / Math.max(0.003, restPoints[i].distanceTo(restPoints[j]));
          average.addScaledVector(current[j], weight); total += weight;
        }
        if (total) next[i] = current[i].clone().lerp(average.multiplyScalar(1 / total), strength * d.masks[i]);
      }
      current = next;
    }
    return current;
  }
  function surfaceNormals(points) {
    const normals = groups.map(() => new THREE.Vector3());
    for (let i = 0; i < triangles.length; i += 3) {
      const a = triangles[i], b = triangles[i + 1], c = triangles[i + 2];
      const n = points[b].clone().sub(points[a]).cross(points[c].clone().sub(points[a]));
      normals[a].add(n); normals[b].add(n); normals[c].add(n);
    }
    return normals.map(n => n.normalize());
  }
  const morphPositions = geometry.morphAttributes.position;
  const morphNormals = geometry.morphAttributes.normal;
  const firstTarget = morphPositions.length;
  let maxBindDelta = 0;
  for (const d of definitions) {
    const restSmooth = smooth(restPoints, d);
    for (const elevation of ELEVATIONS) for (const reach of REACHES) {
      restore();
      const lift = THREE.MathUtils.degToRad(THREE.MathUtils.clamp((elevation - 90) * 0.55, -8, 30));
      const clavicleRotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), d.sign * lift);
      const clavicleWorld = d.clavicle.getWorldQuaternion(new THREE.Quaternion());
      d.clavicle.quaternion.copy(d.clavicle.parent.getWorldQuaternion(new THREE.Quaternion()).invert()
        .multiply(clavicleRotation.multiply(clavicleWorld)));
      root.updateMatrixWorld(true);
      const e = THREE.MathUtils.degToRad(elevation), a = THREE.MathUtils.degToRad(reach);
      const direction = new THREE.Vector3(d.sign * Math.sin(e) * Math.cos(a), -Math.cos(e), Math.sin(e) * Math.sin(a));
      const current = pointOf(d.forearm).sub(pointOf(d.upper)).normalize();
      const world = d.upper.getWorldQuaternion(new THREE.Quaternion());
      d.upper.quaternion.copy(d.upper.parent.getWorldQuaternion(new THREE.Quaternion()).invert()
        .multiply(new THREE.Quaternion().setFromUnitVectors(current, direction).multiply(world)));
      root.updateMatrixWorld(true);
      armTwist.update();
      const boneMatrices = skeleton.bones.map((bone, i) => bone.matrixWorld.clone().multiply(skeleton.boneInverses[i]));
      const left = root.matrixWorld.clone().invert().multiply(mesh.matrixWorld).multiply(mesh.bindMatrixInverse);
      const skinMatrices = groups.map(group => {
        const matrix = new THREE.Matrix4(); matrix.elements.fill(0);
        const vertex = group.vertices[0];
        for (let slot = 0; slot < 4; slot++) {
          const index = indices.array[vertex * 4 + slot], weight = weights.array[vertex * 4 + slot];
          for (let k = 0; k < 16; k++) matrix.elements[k] += boneMatrices[index].elements[k] * weight;
        }
        return left.clone().multiply(matrix).multiply(mesh.bindMatrix);
      });
      const posed = groups.map((group, i) => new THREE.Vector3().fromBufferAttribute(position, group.vertices[0]).applyMatrix4(skinMatrices[i]));
      const smoothed = smooth(posed, d), desired = posed.slice();
      const raise = THREE.MathUtils.smoothstep(elevation, 90, 155);
      for (const i of d.active) {
        const rotationMatrix = skinMatrices[i].clone().multiply(inverseBind);
        const rotation = new THREE.Quaternion(), translation = new THREE.Vector3(), scale = new THREE.Vector3();
        rotationMatrix.decompose(translation, rotation, scale); rotation.normalize();
        const detail = restPoints[i].clone().sub(restSmooth[i]).applyQuaternion(rotation);
        const target = smoothed[i].clone().add(detail);
        const p = restPoints[i], x = d.sign * (p.x - centerX);
        const cap = THREE.MathUtils.smoothstep(p.y, d.pivot.y - 0.005, d.pivot.y + 0.025)
          * (1 - THREE.MathUtils.smoothstep(x, 0.12, 0.17));
        target.y += 0.018 * raise * cap * d.masks[i];
        const delta = target.sub(posed[i]).clampLength(0, 0.03);
        desired[i] = posed[i].clone().add(delta);
      }
      const beforeNormals = surfaceNormals(posed), afterNormals = surfaceNormals(desired);
      const deltas = new Float32Array(position.count * 3), normalDeltas = new Float32Array(position.count * 3);
      for (const i of d.active) {
        const skin = skinMatrices[i];
        if (Math.abs(skin.determinant()) < 1e-7) continue;
        const nMatrix = new THREE.Matrix3().setFromMatrix4(skin), inverseNormal = nMatrix.clone().invert();
        const normalRotation = new THREE.Quaternion().setFromUnitVectors(beforeNormals[i], afterNormals[i]);
        for (const vertex of groups[i].vertices) {
          const base = new THREE.Vector3().fromBufferAttribute(position, vertex);
          const delta = desired[i].clone().applyMatrix4(skin.clone().invert()).sub(base).clampLength(0, 0.05);
          maxBindDelta = Math.max(maxBindDelta, delta.length());
          delta.toArray(deltas, vertex * 3);
          const n = new THREE.Vector3().fromBufferAttribute(normal, vertex);
          const authored = n.clone().applyMatrix3(nMatrix).normalize().applyQuaternion(normalRotation)
            .applyMatrix3(inverseNormal).normalize();
          authored.sub(n).multiplyScalar(d.masks[i]).toArray(normalDeltas, vertex * 3);
        }
      }
      const name = `${d.side}_Shoulder_E${elevation}_R${reach}`;
      const attribute = new THREE.BufferAttribute(deltas, 3); attribute.name = name;
      const normalAttribute = new THREE.BufferAttribute(normalDeltas, 3); normalAttribute.name = name;
      d.targets.set(`${elevation},${reach}`, morphPositions.length);
      morphPositions.push(attribute); morphNormals.push(normalAttribute);
    }
  }
  restore();
  mesh.updateMorphTargets();
  const targetCount = morphPositions.length - firstTarget;
  let enabled = true;
  function reset() { mesh.morphTargetInfluences.fill(0, firstTarget, firstTarget + targetCount); }
  function update() {
    reset();
    if (!enabled) return;
    root.updateMatrixWorld(true);
    const bodyInverse = bones.Spine02.getWorldQuaternion(new THREE.Quaternion()).normalize().multiply(restSpine.clone().invert()).invert();
    for (const d of definitions) {
      const direction = d.forearm.getWorldPosition(new THREE.Vector3()).sub(d.upper.getWorldPosition(new THREE.Vector3()))
        .normalize().applyQuaternion(bodyInverse);
      const elevation = THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(-direction.y, -1, 1)));
      const reach = THREE.MathUtils.radToDeg(Math.atan2(direction.z, d.sign * direction.x))
        * THREE.MathUtils.smoothstep(elevation, 0, 12)
        * (1 - THREE.MathUtils.smoothstep(elevation, 160, 179.5));
      const reachFade = 1 - THREE.MathUtils.smoothstep(Math.abs(reach), 75, 120);
      const [e0, e1, et] = bracket([90, ...ELEVATIONS], elevation);
      const [r0, r1, rt] = bracket(REACHES, reach);
      for (const [e, ew] of [[e0, 1 - et], [e1, et]]) for (const [r, rw] of [[r0, 1 - rt], [r1, rt]]) {
        const index = d.targets.get(`${e},${r}`);
        if (index !== undefined) mesh.morphTargetInfluences[index] += ew * rw * reachFade;
      }
    }
  }
  return { update, reset, setEnabled(value) { enabled = Boolean(value); update(); }, get enabled() { return enabled; },
    report: { elevations: ELEVATIONS, reaches: REACHES, targets: targetCount, firstTarget, maxBindDelta,
      vertices: definitions.map(d => ({ side: d.side, count: d.active.reduce((sum, i) => sum + groups[i].vertices.length, 0) })) } };
}
