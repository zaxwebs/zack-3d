import * as THREE from 'three';

const SIDES = ['L', 'R'];

// Extract axial rotation without Euler angles (and choose the shortest arc).
function twistOf(rotation, axis) {
  const projection = rotation.x * axis.x + rotation.y * axis.y + rotation.z * axis.z;
  const twist = new THREE.Quaternion(axis.x * projection, axis.y * projection, axis.z * projection, rotation.w);
  if (twist.lengthSq() < 1e-12) return new THREE.Quaternion();
  twist.normalize();
  if (twist.w < 0) twist.set(-twist.x, -twist.y, -twist.z, -twist.w);
  return twist;
}

/** Fit sleeve weights to existing helper frames and distribute axial rotation. */
export function createArmTwist({ root, mesh, skeleton, bones, geometry, elbowBlend }) {
  root.updateMatrixWorld(true);
  const rest = new Map(skeleton.bones.map(b => [b, {
    local: b.quaternion.clone(), world: b.getWorldQuaternion(new THREE.Quaternion()),
  }]));
  const definitions = SIDES.flatMap(side => ['Upperarm', 'Forearm'].map(segment => {
    const bone = bones[`${side}_${segment}`];
    const child = bones[`${side}_${segment === 'Upperarm' ? 'Forearm' : 'Hand'}`];
    const helpers = [1, 2].map(i => bones[`${side}_${segment}Twist0${i}`]);
    if (segment === 'Forearm') helpers.unshift(bones[`${side}_ElbowBlend`]);
    const start = bone.getWorldPosition(new THREE.Vector3());
    const direction = child.getWorldPosition(new THREE.Vector3()).sub(start);
    return { bone, child, helpers, segment, start, length: direction.length(), axis: direction.normalize(),
      localAxis: child.position.clone().normalize(), wristKey: {},
      frames: helpers.map(helper => rest.get(bone).world.clone().invert().multiply(rest.get(helper).world)),
    };
  }));
  const indices = geometry.attributes.skinIndex, weights = geometry.attributes.skinWeight;
  const point = new THREE.Vector3();
  const report = { correctedVertices: 0, segments: [] };
  const changed = new Set();
  for (const d of definitions) {
    const main = skeleton.bones.indexOf(d.bone);
    const helperIndices = d.helpers.map(b => skeleton.bones.indexOf(b));
    let count = 0;
    for (let vertex = 0; vertex < weights.count; vertex++) {
      const influences = new Map();
      for (let k = 0; k < 4; k++) {
        const j = indices.array[vertex * 4 + k], w = weights.array[vertex * 4 + k];
        if (w > 0) influences.set(j, (influences.get(j) || 0) + w);
      }
      const mass = influences.get(main) || 0;
      if (mass < 1e-6) continue;
      // Use the bind position, before any helper has been posed.
      mesh.getVertexPosition(vertex, point).applyMatrix4(mesh.matrixWorld);
      const t = THREE.MathUtils.clamp(point.sub(d.start).dot(d.axis) / d.length, 0, 1);
      const blend = THREE.MathUtils.smoothstep(t, 0, 1) * 2;
      const frames = d.segment === 'Upperarm' ? [helperIndices[0], helperIndices[1], main]
        : helperIndices;
      const span = Math.min(Math.floor(blend), 1), alpha = blend - span;
      influences.delete(main);
      for (const [j, fraction] of [[frames[span], 1 - alpha], [frames[span + 1], alpha]]) {
        if (fraction > 1e-8) influences.set(j, (influences.get(j) || 0) + mass * fraction);
      }
      const entries = [...influences].sort((a, b) => b[1] - a[1]).slice(0, 4);
      const total = entries.reduce((sum, [, w]) => sum + w, 0);
      for (let k = 0; k < 4; k++) {
        indices.array[vertex * 4 + k] = entries[k]?.[0] ?? 0;
        weights.array[vertex * 4 + k] = (entries[k]?.[1] ?? 0) / total;
      }
      count++;
      changed.add(vertex);
    }
    report.segments.push({ bone: d.bone.name, correctedVertices: count });
  }
  report.correctedVertices = changed.size;
  indices.needsUpdate = weights.needsUpdate = true;

  function update(previousAngles = new Map()) {
    const angleOf = (twist, axis, key) => {
      let angle = 2 * Math.atan2(new THREE.Vector3(twist.x, twist.y, twist.z).dot(axis), twist.w);
      const previous = previousAngles.get(key);
      if (previous !== undefined) angle += Math.round((previous - angle) / (2 * Math.PI)) * 2 * Math.PI;
      previousAngles.set(key, angle);
      return angle;
    };
    root.updateMatrixWorld(true);
    for (const d of definitions) {
      const delta = d.bone.quaternion.clone().multiply(rest.get(d.bone).local.clone().invert());
      const axis = d.localAxis.clone().applyQuaternion(rest.get(d.bone).local);
      const twist = twistOf(delta, axis);
      const base = d.bone.parent.getWorldQuaternion(new THREE.Quaternion())
        .multiply(delta.multiply(twist.clone().invert()));
      const angle = angleOf(twist, axis, d);
      const wristAngle = d.segment === 'Forearm' ? angleOf(twistOf(
        d.child.quaternion.clone().multiply(rest.get(d.child).local.clone().invert()), d.localAxis), d.localAxis, d.wristKey) : 0;
      d.helpers.forEach((helper, i) => {
        // Upper helpers carry 0/50% roll, with the main bone at 100%.
        // Forearm swing/half/full frames distribute both elbow and wrist roll.
        const fraction = i * 0.5;
        const desired = base.clone().multiply(new THREE.Quaternion().setFromAxisAngle(axis, angle * fraction));
        desired.multiply(rest.get(d.bone).local);
        if (d.segment === 'Forearm') desired.multiply(new THREE.Quaternion().setFromAxisAngle(d.localAxis, wristAngle * fraction));
        desired.multiply(d.frames[i]);
        helper.quaternion.copy(helper.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(desired));
        helper.updateMatrixWorld(true);
      });
    }
    elbowBlend.updateRound();
  }

  // Bake standard helper tracks so exported/reused clips need no frame hook.
  function bakeClip(clip) {
    const helpers = [...definitions.flatMap(d => d.helpers), ...elbowBlend.roundHelpers];
    const names = new Set(helpers.map(b => `.bones[${b.name}].quaternion`));
    const tracks = clip.tracks.filter(t => !names.has(t.name));
    const times = tracks.find(t => t.name === '.bones[L_Upperarm].quaternion')?.times;
    if (!times) return clip;
    const sampled = new THREE.AnimationClip(clip.name, clip.duration, tracks);
    const mixer = new THREE.AnimationMixer(mesh);
    const action = mixer.clipAction(sampled).setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();
    const values = helpers.map(() => new Float32Array(times.length * 4));
    const previousAngles = new Map();
    for (let frame = 0; frame < times.length; frame++) {
      mixer.setTime(times[frame]);
      update(previousAngles);
      helpers.forEach((helper, i) => helper.quaternion.toArray(values[i], frame * 4));
    }
    mixer.stopAllAction();
    mixer.uncacheRoot(mesh);
    return new THREE.AnimationClip(clip.name, clip.duration, [...tracks, ...helpers.map((helper, i) =>
      new THREE.QuaternionKeyframeTrack(`.bones[${helper.name}].quaternion`, times.slice(), values[i]))]);
  }
  return { update, bakeClip, report };
}
