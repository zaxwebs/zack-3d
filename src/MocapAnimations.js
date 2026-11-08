import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { retargetClip as threeRetargetClip } from 'three/addons/utils/SkeletonUtils.js';
import { MOCAP_CONFIG } from './mocapConfig.js';

function humanizeAnimationName(name) {
  return name
    .replace(/\.\d+$/, '')
    .split(/[_\s]+/)
    .filter(Boolean)
    .map(word => word[0].toUpperCase() + word.slice(1))
    .join(' ');
}

function findAnimatedMesh(root) {
  let result;
  root.traverse(node => {
    if (node.isSkinnedMesh && (!result || node.skeleton.bones.length > result.skeleton.bones.length)) {
      result = node;
    }
  });
  return result;
}

function disposeSource(root) {
  root.traverse(node => {
    if (!node.isMesh) return;
    node.geometry?.dispose();
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    materials.filter(Boolean).forEach(material => {
      Object.values(material).forEach(value => value?.isTexture && value.dispose());
      material.dispose();
    });
  });
}

function createMotion(sourceClip, config) {
  return {
    name: sourceClip.name,
    label: humanizeAnimationName(sourceClip.name),
    description: `Preset animation exported from ${config.sourceLabel}: ${humanizeAnimationName(sourceClip.name)}.`,
    sourceClip,
    clip: null,
  };
}

/**
 * Loads the source rig and clip metadata without retargeting every clip.
 * Retargeting is deliberately deferred until a user selects a preset.
 */
export async function loadMocapSource(model, url = MOCAP_CONFIG.sourceUrl, config = MOCAP_CONFIG) {
  const gltf = await new GLTFLoader().loadAsync(url);
  const source = findAnimatedMesh(gltf.scene);
  if (!source) throw new Error('The mocap source does not contain a skinned character.');

  const targetBounds = new THREE.Box3().setFromObject(model.root, true);
  const sourceBounds = new THREE.Box3().setFromObject(gltf.scene, true);
  const targetHeight = targetBounds.getSize(new THREE.Vector3()).y;
  const sourceHeight = sourceBounds.getSize(new THREE.Vector3()).y;
  const sourceClips = gltf.animations.filter(clip => !config.excludedClips.includes(clip.name));
  if (!sourceClips.length) throw new Error('No supported mocap clips were found in the source.');

  gltf.scene.traverse(node => node.visible = false);
  return {
    sourceRoot: gltf.scene,
    source,
    sourceClips,
    motions: sourceClips.map(sourceClip => createMotion(sourceClip, config)),
    model,
    config,
    scale: sourceHeight > 0 ? targetHeight / sourceHeight : 1,
    restHipPosition: model.bones.Hip.position.clone(),
  };
}

/** Retargets one source clip. The caller can cache the result for later plays. */
export function retargetMocapClip(sourceState, sourceClip) {
  const { model, source, config, scale, restHipPosition } = sourceState;
  const clip = threeRetargetClip(model.mesh, source, sourceClip, {
    names: config.targetToSource,
    hip: config.hip,
    scale,
    preserveBonePositions: true,
    // Zack's mesh node carries the source-export orientation. Let the
    // retargeter keep that matrix instead of flattening it to identity;
    // otherwise the motion arrives rotated onto its side.
    preserveBoneMatrix: false,
    useFirstFramePosition: true,
  });
  const hipTrack = clip.tracks.find(track => track.name === '.bones[Hip].position');
  if (hipTrack) {
    for (let i = 0; i < hipTrack.values.length; i += 3) {
      hipTrack.values[i] += restHipPosition.x;
      hipTrack.values[i + 1] += restHipPosition.y;
      hipTrack.values[i + 2] += restHipPosition.z;
    }
  }
  return clip;
}

export function disposeMocapSource(sourceState) {
  if (!sourceState?.sourceRoot) return;
  disposeSource(sourceState.sourceRoot);
  sourceState.sourceRoot = null;
  sourceState.source = null;
  sourceState.sourceClips = [];
  sourceState.motions = [];
}

/**
 * Eager-loading compatibility helper for other Three.js scenes. The viewer
 * uses loadMocapSource() plus retargetMocapClip() so startup stays fast.
 */
export async function loadMocapAnimations(model, url = MOCAP_CONFIG.sourceUrl, config = MOCAP_CONFIG) {
  const sourceState = await loadMocapSource(model, url, config);
  const motions = sourceState.motions.map(motion => ({
    ...motion,
    clip: retargetMocapClip(sourceState, motion.sourceClip),
  }));
  const sourceName = sourceState.source?.name;
  const scale = sourceState.scale;
  disposeMocapSource(sourceState);
  model.reset();
  return { motions, sourceName, scale };
}
