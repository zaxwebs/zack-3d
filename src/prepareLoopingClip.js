import * as THREE from 'three';

/** Rebase a cyclic capture to its first keyed frame and add its closing sample. */
export function prepareLoopingClip(sourceState, sourceClip) {
  if (!sourceState.config.continuousLoops?.includes(sourceClip.name) || !sourceClip.tracks.length) return sourceClip;
  const dense = sourceClip.tracks.reduce((longest, track) => track.times.length > longest.times.length ? track : longest);
  const start = dense.times[0], end = dense.times.at(-1);
  if (dense.times.length < 3 || end <= start) return sourceClip;
  const frameDuration = (end - start) / (dense.times.length - 1);
  const period = end - start + frameDuration;
  const duration = Math.abs(period - sourceClip.duration) < 1e-5 ? sourceClip.duration : period;
  const hip = sourceState.source.skeleton.bones.find(bone => bone.name === sourceState.config.hip);
  const hipTrack = sourceClip.tracks.find(track => track.name === `${hip?.name}.position`);
  if (!hip || !hipTrack) return sourceClip;

  // Preserve travel, but make the vertical bounce periodic. The hip's local
  // axes are oblique, so find vertical through its animated parent transform.
  const mixer = new THREE.AnimationMixer(sourceState.source);
  mixer.clipAction(sourceClip).play(); mixer.setTime(start);
  sourceState.sourceRoot.updateMatrixWorld(true);
  const up = new THREE.Vector3(0, 1, 0).transformDirection(hip.parent.matrixWorld.clone().invert());
  mixer.stopAllAction(); mixer.uncacheRoot(sourceState.source);
  const first = new THREE.Vector3().fromArray(hipTrack.values);
  const displacement = new THREE.Vector3().fromArray(hipTrack.values, hipTrack.values.length - 3)
    .sub(first).multiplyScalar(duration / (end - start));
  displacement.addScaledVector(up, -displacement.dot(up));

  const tracks = sourceClip.tracks.map(original => {
    const track = original.clone(), size = track.getValueSize();
    track.times = new Float32Array(original.times.length + 1);
    for (let i = 0; i < original.times.length; i++) track.times[i] = Math.max(0, original.times[i] - start);
    track.times[original.times.length] = duration;
    track.values = new Float32Array(original.values.length + size);
    track.values.set(original.values);
    track.values.set(original.values.subarray(0, size), original.values.length);
    if (original === hipTrack) first.clone().add(displacement).toArray(track.values, original.values.length);
    return track;
  });
  return new THREE.AnimationClip(sourceClip.name, duration, tracks);
}
