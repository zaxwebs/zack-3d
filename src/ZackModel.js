import * as THREE from 'three';
import { repairHandSeams } from './repairHandSeams.js';
import { repairNonManifoldSliver } from './repairNonManifoldSliver.js';
import { repairShoeSoleHoles } from './repairShoeSoleHoles.js';
import { repairShoeLaceGaps } from './repairShoeLaceGaps.js';
import { repairClothingSeams } from './repairClothingSeams.js';
import { softenShoulderWeights } from './softenShoulderWeights.js';
import { softenJointWeights } from './softenJointWeights.js';
import { createArmTwist } from './armTwist.js';
import { refineElbowWeights } from './refineElbowWeights.js';
import { createElbowBlend } from './elbowBlend.js';
import { createElbowCorrectives } from './elbowCorrectives.js';
import { createShoulderCorrectives } from './shoulderCorrectives.js';
import { createArmSoftening } from './armSoftening.js';

/** Build a native, editable Three.js model without GLTFLoader or a GLB. */
export function createZackModel(manifest, buffer, texture = null) {
  const constructors = { Float32Array, Uint32Array, Uint16Array, Uint8Array };
  const read = (name) => {
    const a = manifest.arrays[name];
    const data = new constructors[a.type](buffer, a.byteOffset, a.count * a.itemSize);
    return a.normalized ? Float32Array.from(data, value => value / 255) : data.slice();
  };
  const geometry = new THREE.BufferGeometry();
  geometry.name = 'ZackGeometry';
  for (const name of ['position', 'normal', 'uv', 'skinIndex', 'skinWeight']) {
    geometry.setAttribute(name, new THREE.BufferAttribute(read(name), manifest.arrays[name].itemSize));
  }
  geometry.setIndex(new THREE.BufferAttribute(read('index'), 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const material = new THREE.MeshStandardMaterial({ ...manifest.material, map: texture });
  let activeTexture = texture;
  material.name = 'ZackMaterial';
  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.normalizeSkinWeights();
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  // Rig edits can move vertices outside the initial bounds.
  mesh.frustumCulled = false;
  const jointSet = new Set(manifest.joints);
  const nodes = manifest.nodes.map((data, index) => {
    const node = data.mesh !== undefined ? mesh : jointSet.has(index) ? new THREE.Bone() : new THREE.Group();
    node.name = data.name || `Node_${index}`;
    if (data.matrix) new THREE.Matrix4().fromArray(data.matrix).decompose(node.position, node.quaternion, node.scale);
    else {
      if (data.translation) node.position.fromArray(data.translation);
      if (data.rotation) node.quaternion.fromArray(data.rotation);
      if (data.scale) node.scale.fromArray(data.scale);
    }
    return node;
  });
  manifest.nodes.forEach((data, index) => data.children?.forEach(child => nodes[index].add(nodes[child])));
  const root = new THREE.Group();
  root.name = 'Zack';
  manifest.roots.forEach(index => root.add(nodes[index]));
  root.updateMatrixWorld(true);
  const inverses = read('inverseBindMatrices');
  const skeleton = new THREE.Skeleton(manifest.joints.map(index => nodes[index]),
    manifest.joints.map((_, index) => new THREE.Matrix4().fromArray(inverses, index * 16)));
  // glTF inverse bind matrices already contain the mesh-to-bind-space transform.
  mesh.bind(skeleton, new THREE.Matrix4());
  root.updateMatrixWorld(true);
  const bones = Object.fromEntries(skeleton.bones.map(bone => [bone.name, bone]));
  // Reposition a bind-pose pivot without moving its children or rest surface.
  function moveBindPivot(bone, target) {
    const oldWorld = bone.matrixWorld.clone();
    const original = bone.getWorldPosition(new THREE.Vector3());
    const childPositions = bone.children.map(child => child.getWorldPosition(new THREE.Vector3()));
    bone.position.copy(bone.parent.worldToLocal(target.clone()));
    root.updateMatrixWorld(true);
    bone.children.forEach((child, i) => child.position.copy(bone.worldToLocal(childPositions[i].clone())));
    root.updateMatrixWorld(true);
    const index = skeleton.bones.indexOf(bone);
    skeleton.boneInverses[index].premultiply(oldWorld).premultiply(bone.matrixWorld.clone().invert());
    return { original: original.toArray(), corrected: bone.getWorldPosition(new THREE.Vector3()).toArray() };
  }
  // The source hinges are medial to the sleeve caps and high inside them.
  // Keep the outward correction, and bring each hinge closer to the sleeve axis.
  const shoulderCorrections = {};
  const armHelperCorrections = {};
  const forearmHelperCorrections = {};
  for (const side of ['L', 'R']) {
    const upper = bones[`${side}_Upperarm`];
    const offset = new THREE.Vector3(side === 'L' ? 0.03 : -0.03, -0.015, 0.004)
      .applyQuaternion(root.getWorldQuaternion(new THREE.Quaternion()));
    shoulderCorrections[side] = moveBindPivot(upper, upper.getWorldPosition(new THREE.Vector3()).add(offset));
    // The outward hinge edit previously left the helper branch
    // off the new arm axis. Keep its midpoint and endpoint on that axis.
    const shoulder = upper.getWorldPosition(new THREE.Vector3());
    const elbow = bones[`${side}_Forearm`].getWorldPosition(new THREE.Vector3());
    armHelperCorrections[side] = {
      midpoint: moveBindPivot(bones[`${side}_UpperarmTwist01`], shoulder.clone().lerp(elbow, 0.5)),
      endpoint: moveBindPivot(bones[`${side}_UpperarmTwist02`], elbow),
    };
    const wrist = bones[`${side}_Hand`].getWorldPosition(new THREE.Vector3());
    forearmHelperCorrections[side] = {
      midpoint: moveBindPivot(bones[`${side}_ForearmTwist01`], elbow.clone().lerp(wrist, 0.5)),
      endpoint: moveBindPivot(bones[`${side}_ForearmTwist02`], wrist),
    };
  }
  root.userData.shoulderCorrections = shoulderCorrections;
  root.userData.armHelperCorrections = armHelperCorrections;
  root.userData.forearmHelperCorrections = forearmHelperCorrections;
  const elbowBlend = createElbowBlend({ root, mesh, skeleton, bones, geometry });
  root.userData.handSeamCorrection = repairHandSeams(geometry, skeleton, bones);
  root.userData.nonManifoldSliverCorrection = repairNonManifoldSliver(geometry);
  root.userData.shoeSoleCorrection = repairShoeSoleHoles(geometry);
  root.userData.shoeLaceGapCorrection = repairShoeLaceGaps(geometry);
  root.userData.clothingSeamCorrection = repairClothingSeams(geometry);
  const restTransforms = skeleton.bones.map(bone => ({ position: bone.position.clone(), quaternion: bone.quaternion.clone(), scale: bone.scale.clone() }));
  const restPositions = geometry.attributes.position.array.slice();
  const restNormals = geometry.attributes.normal.array.slice();
  const regions = {};
  const joints = geometry.attributes.skinIndex;
  const weights = geometry.attributes.skinWeight;
  // Source auto-weights leak clavicle/arm influence across the chest. Keep
  // the torso on the spine, fading arm influence back in over the sleeve cap.
  // Finish the fade before the upper sleeve: anchoring it out to 0.145
  // holds back the sleeve cap and bunches the biceps when the arm is raised.
  const armJoints = new Set();
  for (const side of ['L', 'R']) bones[`${side}_Clavicle`].traverse(bone => {
    const index = skeleton.bones.indexOf(bone);
    if (index >= 0) armJoints.add(index);
  });
  const chestCenter = root.worldToLocal(bones.Spine02.getWorldPosition(new THREE.Vector3())).x;
  const point = new THREE.Vector3();
  let correctedVertices = 0;
  for (let vertex = 0; vertex < joints.count; vertex++) {
    mesh.getVertexPosition(vertex, point).applyMatrix4(mesh.matrixWorld);
    root.worldToLocal(point);
    if (point.y < 0.35 || point.y > 0.70) continue;
    const outerBoundary = THREE.MathUtils.lerp(0.145, 0.125, THREE.MathUtils.smoothstep(point.y, 0.54, 0.59));
    const keepArm = THREE.MathUtils.smoothstep(Math.abs(point.x - chestCenter), 0.085, outerBoundary);
    if (keepArm === 1) continue;
    const influences = new Map();
    let removed = 0;
    for (let slot = 0; slot < 4; slot++) {
      const index = joints.array[vertex * 4 + slot];
      const weight = weights.array[vertex * 4 + slot];
      const retained = armJoints.has(index) ? weight * keepArm : weight;
      removed += weight - retained;
      influences.set(index, (influences.get(index) || 0) + retained);
    }
    if (removed < 1e-8) continue;
    const spine = skeleton.bones.indexOf(point.y < 0.54 ? bones.Spine01 : bones.Spine02);
    influences.set(spine, (influences.get(spine) || 0) + removed);
    const strongest = [...influences].filter(([, weight]) => weight > 0).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const total = strongest.reduce((sum, [, weight]) => sum + weight, 0);
    for (let slot = 0; slot < 4; slot++) {
      joints.array[vertex * 4 + slot] = strongest[slot]?.[0] ?? 0;
      weights.array[vertex * 4 + slot] = (strongest[slot]?.[1] ?? 0) / total;
    }
    correctedVertices++;
  }
  root.userData.chestWeightCorrection = { correctedVertices, innerBoundary: 0.085, outerBoundary: 0.145,
    shoulderOuterBoundary: 0.125, shoulderFadeStart: 0.54, shoulderFadeEnd: 0.59 };
  // The source auto-rig also assigns the hoodie pocket and abdomen to the
  // thighs. Restrict that influence to the pants/hem transition.
  const legJoints = new Set();
  for (const side of ['L', 'R']) bones[`${side}_Thigh`].traverse(bone => {
    const index = skeleton.bones.indexOf(bone);
    if (index >= 0) legJoints.add(index);
  });
  let hoodieVertices = 0;
  for (let vertex = 0; vertex < joints.count; vertex++) {
    mesh.getVertexPosition(vertex, point).applyMatrix4(mesh.matrixWorld);
    root.worldToLocal(point);
    const protect = THREE.MathUtils.smoothstep(point.y, 0.405, 0.45)
      * (1 - THREE.MathUtils.smoothstep(Math.abs(point.x - chestCenter), 0.115, 0.145));
    if (!protect) continue;
    const influences = new Map();
    let removed = 0;
    for (let slot = 0; slot < 4; slot++) {
      const index = joints.array[vertex * 4 + slot];
      const weight = weights.array[vertex * 4 + slot];
      const retained = legJoints.has(index) ? weight * (1 - protect) : weight;
      removed += weight - retained;
      influences.set(index, (influences.get(index) || 0) + retained);
    }
    if (removed < 1e-8) continue;
    const spine = skeleton.bones.indexOf(point.y < 0.51 ? bones.Waist : bones.Spine01);
    influences.set(spine, (influences.get(spine) || 0) + removed);
    const strongest = [...influences].filter(([, weight]) => weight > 0).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const total = strongest.reduce((sum, [, weight]) => sum + weight, 0);
    for (let slot = 0; slot < 4; slot++) {
      joints.array[vertex * 4 + slot] = strongest[slot]?.[0] ?? 0;
      weights.array[vertex * 4 + slot] = (strongest[slot]?.[1] ?? 0) / total;
    }
    hoodieVertices++;
  }
  root.userData.hoodieWeightCorrection = { correctedVertices: hoodieVertices, hemFadeStart: 0.405, torsoStart: 0.45 };
  root.userData.shoulderWeightTransition = softenShoulderWeights({ root, mesh, skeleton, bones, geometry });
  root.userData.jointWeightTransitions = softenJointWeights({ root, mesh, skeleton, bones, geometry });
  root.userData.elbowWeightCorrection = refineElbowWeights({ root, mesh, skeleton, bones, geometry });
  const armTwist = createArmTwist({ root, mesh, skeleton, bones, geometry, elbowBlend });
  root.userData.armTwistWeights = armTwist.report;
  root.userData.elbowBlendWeights = elbowBlend.applyRoundWeights();
  const elbowCorrectives = createElbowCorrectives({ root, mesh, skeleton, bones, geometry, armTwist });
  root.userData.elbowCorrectives = elbowCorrectives.report;
  const shoulderCorrectives = createShoulderCorrectives({ root, mesh, skeleton, bones, geometry, armTwist });
  root.userData.shoulderCorrectives = shoulderCorrectives.report;
  const armSoftening = createArmSoftening({ root, mesh, geometry, skeleton, bones, material });
  root.userData.armSoftening = armSoftening.report;
  joints.needsUpdate = weights.needsUpdate = true;
  for (let vertex = 0; vertex < joints.count; vertex++) {
    let slot = 0;
    for (let k = 1; k < 4; k++) if (weights.array[vertex * 4 + k] > weights.array[vertex * 4 + slot]) slot = k;
    const name = skeleton.bones[joints.array[vertex * 4 + slot]].name;
    (regions[name] ??= []).push(vertex);
  }
  function refreshGeometry(recomputeNormals = true) {
    geometry.attributes.position.needsUpdate = true;
    if (recomputeNormals) geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    root.updateMatrixWorld(true);
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
  }
  function reset() {
    armSoftening.reset();
    elbowCorrectives.reset();
    shoulderCorrectives.reset();
    skeleton.bones.forEach((bone, index) => {
      bone.position.copy(restTransforms[index].position);
      bone.quaternion.copy(restTransforms[index].quaternion);
      bone.scale.copy(restTransforms[index].scale);
    });
    geometry.attributes.position.array.set(restPositions);
    geometry.attributes.normal.array.set(restNormals);
    geometry.attributes.normal.needsUpdate = true;
    refreshGeometry(false);
  }
  return { root, mesh, geometry, material, skeleton, bones, regions, refreshGeometry, reset, armTwist, elbowCorrectives, shoulderCorrectives, armSoftening,
    setTexture(nextTexture) {
      if (nextTexture === activeTexture) return activeTexture;
      const previousTexture = activeTexture;
      activeTexture = nextTexture;
      material.map = nextTexture;
      material.needsUpdate = true;
      previousTexture?.dispose();
      return activeTexture;
    },
    dispose() { geometry.dispose(); material.dispose(); skeleton.dispose(); activeTexture?.dispose(); } };
}

export async function loadZackModel(baseUrl = '/model/', { textureSize = 'auto' } = {}) {
  const base = new URL(baseUrl, globalThis.location?.href ?? import.meta.url);
  if (!base.pathname.endsWith('/')) base.pathname += '/';
  const selectedTextureSize = textureSize === 'auto'
    ? (globalThis.matchMedia?.('(max-width: 700px)').matches ? 1024 : 2048)
    : textureSize;
  if (![1024, 2048, 4096].includes(selectedTextureSize)) {
    throw new Error('Texture size must be 1024, 2048, 4096, or "auto"');
  }
  const loadTexture = async size => {
    const textureFile = size === 4096
      ? 'basecolor-drawstrings.webp'
      : `basecolor-drawstrings-${size}.webp`;
    const texture = await new THREE.TextureLoader().loadAsync(new URL(textureFile, base).href);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.flipY = false;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    return texture;
  };
  async function fetchChecked(path) {
    const response = await fetch(new URL(path, base));
    if (!response.ok) throw new Error(`Could not load ${path}: HTTP ${response.status}`);
    return response;
  }
  const [manifest, buffer, texture] = await Promise.all([
    fetchChecked('manifest.json').then(r => r.json()),
    fetchChecked('geometry.bin').then(r => r.arrayBuffer()),
    loadTexture(selectedTextureSize),
  ]);
  const model = createZackModel(manifest, buffer, texture);
  model.textureSize = selectedTextureSize;
  let activeTexture = texture;
  let textureRequest = 0;
  model.setTextureSize = async size => {
    if (![1024, 2048, 4096].includes(size)) {
      throw new Error('Texture size must be 1024, 2048, or 4096');
    }
    const request = ++textureRequest;
    if (size === model.textureSize) return activeTexture;
    const nextTexture = await loadTexture(size);
    if (request !== textureRequest) {
      nextTexture.dispose();
      return activeTexture;
    }
    activeTexture = model.setTexture(nextTexture);
    model.textureSize = size;
    return activeTexture;
  };
  return model;
}
