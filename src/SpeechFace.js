import * as THREE from 'three';
import { bakeSpeechTexture } from './speechSnapshot.js';

const { clamp, smoothstep } = THREE.MathUtils;
const finite = value => Number.isFinite(value) ? clamp(value, 0, 1) : 0;

// A sealed, texture-painted face cannot reveal a real mouth cavity without
// cutting new topology. This surface mouth follows the existing skin and adds
// three small, relative face shapes without adding vertices or triangles.
export function createSpeechFace({ root, mesh, geometry, material, bones }) {
  root.updateMatrixWorld(true);
  const toFace = root.matrixWorld.clone().invert().multiply(mesh.matrixWorld)
    .multiply(mesh.bindMatrixInverse).multiply(bones.Head.matrixWorld)
    .multiply(mesh.skeleton.boneInverses[mesh.skeleton.bones.indexOf(bones.Head)])
    .multiply(mesh.bindMatrix);
  const fromFace = new THREE.Matrix3().setFromMatrix4(toFace).invert();
  const position = geometry.attributes.position;
  const points = Array.from({ length: position.count }, (_, i) =>
    new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(toFace));
  const firstTarget = geometry.morphAttributes.position?.length ?? 0;
  const targets = ['SpeechJaw', 'SpeechSpread', 'SpeechRound'];
  const activeVertices = new Set();
  const rest = geometry.clone();
  rest.computeVertexNormals();
  for (const [shape, name] of targets.entries()) {
    const offsets = new Float32Array(position.count * 3);
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const front = smoothstep(p.z, 0.065, 0.105);
      const side = 1 - smoothstep(Math.abs(p.x), 0.045, 0.095);
      const lowerFace = smoothstep(p.y, 0.655, 0.695) * (1 - smoothstep(p.y, 0.735, 0.758));
      const lip = 1 - smoothstep(Math.abs(p.y - 0.733), 0.012, 0.034);
      const weight = front * side * (shape === 0 ? lowerFace : lip);
      if (weight < 1e-7) continue;
      activeVertices.add(i);
      const delta = shape === 0 ? new THREE.Vector3(0, -0.009 * weight, -0.0015 * weight)
        : new THREE.Vector3(p.x * (shape === 1 ? 0.10 : -0.16) * weight, 0, shape === 2 ? 0.002 * weight : 0);
      delta.applyMatrix3(fromFace).toArray(offsets, i * 3);
    }
    const attribute = new THREE.BufferAttribute(offsets, 3); attribute.name = name;
    const sculpt = rest.clone();
    const sculptPosition = sculpt.attributes.position;
    for (let i = 0; i < offsets.length; i++) sculptPosition.array[i] += offsets[i];
    sculpt.computeVertexNormals();
    const normalOffsets = new Float32Array(offsets.length);
    for (let i = 0; i < offsets.length; i++) normalOffsets[i] = sculpt.attributes.normal.array[i] - rest.attributes.normal.array[i];
    const normalAttribute = new THREE.BufferAttribute(normalOffsets, 3); normalAttribute.name = name;
    (geometry.morphAttributes.position ??= []).push(attribute);
    (geometry.morphAttributes.normal ??= []).push(normalAttribute);
    sculpt.dispose();
  }
  rest.dispose();
  geometry.morphTargetsRelative = true;
  const previousInfluences = mesh.morphTargetInfluences?.slice() ?? [];
  mesh.updateMorphTargets();
  previousInfluences.forEach((value, i) => { mesh.morphTargetInfluences[i] = value; });

  const state = { open: 0, spread: 0, round: 0 };
  const mouth = { value: new THREE.Vector3() };
  const faceMatrix = { value: toFace };
  const previousCompile = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey();
  material.onBeforeCompile = function (shader, renderer) {
    previousCompile.call(this, shader, renderer);
    shader.uniforms.speechMouth = mouth;
    shader.uniforms.speechFaceMatrix = faceMatrix;
    shader.vertexShader = 'uniform mat4 speechFaceMatrix; varying vec3 speechFacePoint;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>',
      '#include <begin_vertex>\nspeechFacePoint = (speechFaceMatrix * vec4(position, 1.0)).xyz;');
    shader.fragmentShader = 'uniform vec3 speechMouth; varying vec3 speechFacePoint;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
      #include <map_fragment>
      #ifdef USE_MAP
        float speechOpen = speechMouth.x;
        if (speechOpen > 0.0001 && speechFacePoint.z > 0.085) {
          float sx = speechFacePoint.x;
          float sy = speechFacePoint.y;
          float smileY = 0.7325 + 5.2 * sx * sx;
          float erase = (1.0 - smoothstep(0.038, 0.045, abs(sx)))
            * (1.0 - smoothstep(0.003, 0.007, abs(sy - smileY)));
          float presence = smoothstep(0.0, 0.10, speechOpen);
          // Sample unpainted skin just below the smile in the original atlas.
          vec3 skin = texture2D(map, vMapUv + vec2(0.0, -0.013)).rgb;
          diffuseColor.rgb = mix(diffuseColor.rgb, skin, erase * presence);
          float width = mix(0.036 + 0.007 * speechMouth.y, 0.021, speechMouth.z);
          float height = 0.001 + 0.016 * speechOpen;
          float mx = sx / width;
          float my = (sy - 0.7325 - 0.004 * mx * mx + 0.004 * speechOpen) / height;
          float distanceToLip = pow(abs(mx), 2.6) + my * my;
          float edge = max(0.045, fwidth(distanceToLip));
          float inside = 1.0 - smoothstep(1.0 - edge, 1.0 + edge, distanceToLip);
          float rim = (1.0 - smoothstep(1.05, 1.40, distanceToLip)) * presence;
          diffuseColor.rgb = mix(diffuseColor.rgb, skin * vec3(0.76, 0.50, 0.38), rim * 0.36);
          vec3 cavity = mix(vec3(0.025, 0.005, 0.004), vec3(0.10, 0.018, 0.014), clamp(-my * 0.45 + 0.3, 0.0, 1.0));
          float teeth = smoothstep(0.34, 0.42, my) * (1.0 - smoothstep(0.76, 0.90, my))
            * (1.0 - smoothstep(0.72, 0.90, abs(mx))) * (1.0 - speechMouth.z * 0.8);
          cavity = mix(cavity, vec3(0.89, 0.81, 0.65), teeth);
          float tongue = (1.0 - smoothstep(0.60, 0.77, abs(mx)))
            * (1.0 - smoothstep(-0.50, -0.28, my)) * smoothstep(-0.95, -0.75, my);
          cavity = mix(cavity, vec3(0.38, 0.075, 0.065), tongue * speechOpen * 0.85);
          diffuseColor.rgb = mix(diffuseColor.rgb, cavity, inside * presence);
        }
      #endif
    `);
  };
  material.customProgramCacheKey = () => `${previousKey}:speech-face-v1`;
  material.needsUpdate = true;

  function setPose({ open = 0, spread = 0, round = 0 } = {}) {
    state.open = finite(open); state.spread = finite(spread); state.round = finite(round);
    mouth.value.set(state.open, state.spread, state.round);
    mesh.morphTargetInfluences[firstTarget] = state.open;
    mesh.morphTargetInfluences[firstTarget + 1] = state.spread * state.open;
    mesh.morphTargetInfluences[firstTarget + 2] = state.round * state.open;
  }
  const anchor = bones.Head.worldToLocal(new THREE.Vector3(0, 0.80, 0.07).applyMatrix4(root.matrixWorld));
  const report = { technique: 'surface mouth with three relative face shapes', addedVertices: 0, addedTriangles: 0,
    vertices: position.count, triangles: geometry.index.count / 3, firstTarget, targets, affectedVertices: activeVertices.size };
  root.userData.speechFace = report;
  const previousToJSON = root.toJSON;
  root.toJSON = function (meta) {
    if (state.open < 0.0001 || !material.map) return previousToJSON.call(this, meta);
    const originalMap = material.map;
    const snapshot = bakeSpeechTexture(originalMap, geometry, points, state);
    material.map = snapshot;
    try { return previousToJSON.call(this, meta); }
    finally { material.map = originalMap; snapshot.dispose(); }
  };
  return { setPose, reset: () => setPose(), get state() { return { ...state }; }, report,
    getWorldAnchor: (target = new THREE.Vector3()) => bones.Head.localToWorld(target.copy(anchor)),
  };
}
