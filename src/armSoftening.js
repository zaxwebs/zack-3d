import * as THREE from 'three';

/** A rest-preserving smoothing pass evaluated on the actual posed arm surface. */
export function createArmSoftening({ root, mesh, geometry, skeleton, bones, material }) {
  root.updateMatrixWorld(true);
  const position = geometry.attributes.position, normal = geometry.attributes.normal;
  const indices = geometry.attributes.skinIndex, weights = geometry.attributes.skinWeight;
  const groups = [], byPosition = new Map(), vertexGroup = [];
  const inverseRoot = root.matrixWorld.clone().invert();
  for (let vertex = 0; vertex < position.count; vertex++) {
    const key = `${position.getX(vertex)},${position.getY(vertex)},${position.getZ(vertex)}`;
    if (!byPosition.has(key)) {
      byPosition.set(key, groups.length);
      groups.push({ vertices: [], neighbors: new Set(), rest: mesh.getVertexPosition(vertex, new THREE.Vector3())
        .applyMatrix4(mesh.matrixWorld).applyMatrix4(inverseRoot) });
    }
    const group = byPosition.get(key);
    groups[group].vertices.push(vertex); vertexGroup.push(group);
  }
  const triangles = Array.from(geometry.index.array, vertex => vertexGroup[vertex]);
  for (let i = 0; i < triangles.length; i += 3) for (let k = 0; k < 3; k++) {
    const a = triangles[i + k], b = triangles[i + (k + 1) % 3];
    if (a !== b) { groups[a].neighbors.add(b); groups[b].neighbors.add(a); }
  }
  const centerX = bones.Spine02.getWorldPosition(new THREE.Vector3()).applyMatrix4(inverseRoot).x;
  const family = new Set(skeleton.bones.flatMap((bone, i) => /Spine0|Clavicle|Upperarm|Forearm|Elbow/.test(bone.name) ? [i] : []));
  const masks = groups.map(group => {
    const vertex = group.vertices[0], point = group.rest, x = Math.abs(point.x - centerX);
    let mass = 0;
    for (let slot = 0; slot < 4; slot++) if (family.has(indices.array[vertex * 4 + slot])) mass += weights.array[vertex * 4 + slot];
    return THREE.MathUtils.smoothstep(mass, 0.65, 0.95)
      * THREE.MathUtils.smoothstep(x, 0.045, 0.08) * (1 - THREE.MathUtils.smoothstep(x, 0.255, 0.285))
      * THREE.MathUtils.smoothstep(point.y, 0.535, 0.575) * (1 - THREE.MathUtils.smoothstep(point.y, 0.67, 0.705));
  });
  const active = masks.flatMap((mask, i) => mask > 1e-6 ? [i] : []), neededSet = new Set(active);
  for (const i of active) for (const j of groups[i].neighbors) neededSet.add(j);
  const needed = [...neededSet];
  const faces = [];
  for (let i = 0; i < triangles.length; i += 3) {
    if ([0, 1, 2].some(k => masks[triangles[i + k]] > 1e-6)) faces.push(...triangles.slice(i, i + 3));
  }
  const neighbors = active.map(i => [...groups[i].neighbors].map(j => ({
    index: j, weight: 1 / Math.max(0.003, groups[i].rest.distanceTo(groups[j].rest)),
  })));
  function smooth(points) {
    let current = points.slice();
    for (let iteration = 0; iteration < 8; iteration++) {
      const next = current.slice();
      active.forEach((i, k) => {
        const average = new THREE.Vector3(); let total = 0;
        for (const neighbor of neighbors[k]) { average.addScaledVector(current[neighbor.index], neighbor.weight); total += neighbor.weight; }
        if (total) next[i] = current[i].clone().lerp(average.multiplyScalar(1 / total), 0.55 * masks[i]);
      });
      current = next;
    }
    return current;
  }
  function surfaceNormals(points) {
    const result = [];
    for (const i of needed) result[i] = new THREE.Vector3();
    for (let i = 0; i < faces.length; i += 3) {
      const a = faces[i], b = faces[i + 1], c = faces[i + 2];
      const n = points[b].clone().sub(points[a]).cross(points[c].clone().sub(points[a]));
      result[a].add(n); result[b].add(n); result[c].add(n);
    }
    for (const i of needed) result[i].normalize();
    return result;
  }
  const restSmooth = smooth(groups.map(group => group.rest));
  const inverseBind = inverseRoot.clone().multiply(skeleton.bones[0].matrixWorld).multiply(skeleton.boneInverses[0]).invert();
  const correction = new THREE.Float32BufferAttribute(new Float32Array(position.count * 3), 3);
  const normalCorrection = new THREE.Float32BufferAttribute(new Float32Array(position.count * 3), 3);
  geometry.setAttribute('armSurfaceCorrection', correction);
  geometry.setAttribute('armSurfaceNormalCorrection', normalCorrection);

  const previousCompile = material.onBeforeCompile;
  const previousProgramKey = material.customProgramCacheKey();
  material.onBeforeCompile = function (shader, renderer) {
    previousCompile.call(this, shader, renderer);
    shader.vertexShader = 'attribute vec3 armSurfaceCorrection;\nattribute vec3 armSurfaceNormalCorrection;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <skinning_vertex>', 'transformed += armSurfaceCorrection;\n#include <skinning_vertex>')
      .replace('#include <skinnormal_vertex>', 'objectNormal += armSurfaceNormalCorrection;\n#include <skinnormal_vertex>');
  };
  material.customProgramCacheKey = () => `${previousProgramKey}:arm-surface-v1`;
  material.needsUpdate = true;
  const correctionVector = new THREE.Vector3();
  mesh.getVertexPosition = function (index, target) {
    THREE.Mesh.prototype.getVertexPosition.call(this, index, target);
    target.add(correctionVector.fromBufferAttribute(this.geometry.attributes.armSurfaceCorrection, index));
    return this.applyBoneTransform(index, target);
  };

  // Export the current post-skin pass as a standard relative morph. The saved
  // scene therefore needs neither the custom shader nor the live CPU driver.
  const originalToJSON = root.toJSON;
  root.toJSON = function (meta) {
    const originalGeometry = mesh.geometry, originalInfluences = mesh.morphTargetInfluences, originalDictionary = mesh.morphTargetDictionary;
    const copy = originalGeometry.clone();
    copy.deleteAttribute('armSurfaceCorrection'); copy.deleteAttribute('armSurfaceNormalCorrection');
    const delta = correction.clone(); delta.name = 'ArmSurfaceSnapshot';
    const normalDelta = normalCorrection.clone(); normalDelta.name = delta.name;
    const index = copy.morphAttributes.position.length;
    copy.morphAttributes.position.push(delta); copy.morphAttributes.normal.push(normalDelta);
    mesh.geometry = copy;
    mesh.morphTargetInfluences = [...originalInfluences, 1];
    mesh.morphTargetDictionary = { ...originalDictionary, [delta.name]: index };
    try { return originalToJSON.call(this, meta); }
    finally {
      mesh.geometry = originalGeometry; mesh.morphTargetInfluences = originalInfluences; mesh.morphTargetDictionary = originalDictionary;
      copy.dispose();
    }
  };

  let enabled = true, lastSignature = null, lastMaxDisplacement = 0;
  function reset() {
    correction.array.fill(0); normalCorrection.array.fill(0);
    correction.needsUpdate = normalCorrection.needsUpdate = true;
    lastSignature = null; lastMaxDisplacement = 0;
  }
  function update() {
    if (!enabled) return;
    root.updateMatrixWorld(true);
    const signature = [position.version, normal.version, indices.version, weights.version,
      ...root.matrixWorld.elements, ...mesh.morphTargetInfluences];
    for (const bone of skeleton.bones) signature.push(...bone.matrixWorld.elements);
    if (lastSignature && signature.every((value, i) => value === lastSignature[i])) return;
    lastSignature = signature;
    const boneMatrices = skeleton.bones.map((bone, i) => bone.matrixWorld.clone().multiply(skeleton.boneInverses[i]));
    const left = root.matrixWorld.clone().invert().multiply(mesh.matrixWorld).multiply(mesh.bindMatrixInverse);
    const morphs = mesh.morphTargetInfluences.flatMap((weight, i) => weight ? [{ weight,
      position: geometry.morphAttributes.position[i], normal: geometry.morphAttributes.normal[i] }] : []);
    const posed = [], skinMatrices = [];
    for (const i of needed) {
      const vertex = groups[i].vertices[0], raw = new THREE.Vector3().fromBufferAttribute(position, vertex);
      for (const morph of morphs) raw.addScaledVector(new THREE.Vector3().fromBufferAttribute(morph.position, vertex), morph.weight);
      const matrix = new THREE.Matrix4(); matrix.elements.fill(0);
      for (let slot = 0; slot < 4; slot++) {
        const index = indices.array[vertex * 4 + slot], weight = weights.array[vertex * 4 + slot];
        for (let k = 0; k < 16; k++) matrix.elements[k] += boneMatrices[index].elements[k] * weight;
      }
      skinMatrices[i] = left.clone().multiply(matrix).multiply(mesh.bindMatrix);
      posed[i] = raw.applyMatrix4(skinMatrices[i]);
    }
    const smoothed = smooth(posed), desired = posed.slice();
    lastMaxDisplacement = 0;
    for (const i of active) {
      const rotation = new THREE.Quaternion(), translation = new THREE.Vector3(), scale = new THREE.Vector3();
      skinMatrices[i].clone().multiply(inverseBind).decompose(translation, rotation, scale); rotation.normalize();
      const detail = groups[i].rest.clone().sub(restSmooth[i]).applyQuaternion(rotation);
      const delta = smoothed[i].clone().add(detail).sub(posed[i]).clampLength(0, 0.025);
      if (delta.length() < 1e-7) delta.set(0, 0, 0);
      lastMaxDisplacement = Math.max(lastMaxDisplacement, delta.length());
      desired[i] = posed[i].clone().add(delta);
    }
    const beforeNormals = surfaceNormals(posed), afterNormals = surfaceNormals(desired);
    correction.array.fill(0); normalCorrection.array.fill(0);
    for (const i of active) {
      if (desired[i].distanceToSquared(posed[i]) < 1e-14 || Math.abs(skinMatrices[i].determinant()) < 1e-7) continue;
      const normalMatrix = new THREE.Matrix3().setFromMatrix4(skinMatrices[i]), inverseNormal = normalMatrix.clone().invert();
      const rawDelta = desired[i].clone().sub(posed[i]).applyMatrix3(inverseNormal);
      const rotation = new THREE.Quaternion().setFromUnitVectors(beforeNormals[i], afterNormals[i]);
      for (const vertex of groups[i].vertices) {
        rawDelta.toArray(correction.array, vertex * 3);
        const rawNormal = new THREE.Vector3().fromBufferAttribute(normal, vertex);
        for (const morph of morphs) rawNormal.addScaledVector(new THREE.Vector3().fromBufferAttribute(morph.normal, vertex), morph.weight);
        const desiredNormal = rawNormal.clone().applyMatrix3(normalMatrix).normalize().applyQuaternion(rotation)
          .applyMatrix3(inverseNormal).normalize();
        desiredNormal.sub(rawNormal).toArray(normalCorrection.array, vertex * 3);
      }
    }
    correction.needsUpdate = normalCorrection.needsUpdate = true;
  }
  return { update, reset, setEnabled(value) { enabled = Boolean(value); reset(); if (enabled) update(); },
    get enabled() { return enabled; }, get maxDisplacement() { return lastMaxDisplacement; },
    report: { iterations: 8, strength: 0.55, maxOffset: 0.025,
      affectedVertices: active.reduce((sum, i) => sum + groups[i].vertices.length, 0), groups: active.length } };
}
