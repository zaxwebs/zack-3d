import * as THREE from 'three';
import {
  disposeMocapSource,
  loadMocapSource,
  retargetMocapClip,
} from './MocapAnimations.js';

const STATIC_NAME = 'static';

export class MocapController {
  constructor({ model, container, description, sourceUrl, config, onStatic }) {
    this.model = model;
    this.container = container;
    this.description = description;
    this.sourceUrl = sourceUrl;
    this.config = config;
    this.onStatic = onStatic;
    this.mixer = new THREE.AnimationMixer(model.mesh);
    this.actions = Object.create(null);
    this.motions = new Map();
    this.actionPromises = new Map();
    this.sourceState = null;
    this.activeName = STATIC_NAME;
    this.playing = false;
    this.selectionId = 0;
    this.rootMotionOffset = new THREE.Vector3();
    this.appliedRootMotionOffset = new THREE.Vector3();
    this.mixer.addEventListener('loop', event => {
      if (event.action !== this.activeAction) return;
      const offset = event.action.getClip().userData?.continuousRootMotion;
      if (offset) this.rootMotionOffset.addScaledVector(new THREE.Vector3().fromArray(offset), event.loopDelta);
    });

    this.addButton({
      name: STATIC_NAME,
      label: 'Static',
      title: 'Hold the selected pose.',
    });
    this.setControls(STATIC_NAME);
  }

  addButton({ name, label, title, description }) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.animation = name;
    button.textContent = label;
    button.title = title ?? description ?? label;
    button.setAttribute('aria-pressed', 'false');
    this.container.append(button);
    button.addEventListener('click', () => { void this.select(name); });
    return button;
  }

  setControls(name) {
    const button = this.container.querySelector(`[data-animation="${name}"]`);
    this.description.textContent = button?.title ?? 'Static pose.';
    this.container.querySelectorAll('[data-animation]').forEach(item => {
      item.setAttribute('aria-pressed', String(item.dataset.animation === name));
    });
  }

  setLoadingDescription(label) {
    this.description.textContent = `Loading ${label}…`;
  }

  async load() {
    this.description.textContent = 'Loading imported mocap…';
    try {
      this.sourceState = await loadMocapSource(this.model, this.sourceUrl, this.config);
      for (const motion of this.sourceState.motions) {
        this.motions.set(motion.name, motion);
        this.addButton(motion);
      }
      this.description.textContent = 'Select a preset to preview it.';
      return this.sourceState;
    } catch (error) {
      this.description.textContent = `Could not load mocap: ${error.message}`;
      throw error;
    }
  }

  async getAction(motion) {
    if (this.actions[motion.name]) return this.actions[motion.name];
    if (this.actionPromises.has(motion.name)) return this.actionPromises.get(motion.name);
    if (!this.sourceState) throw new Error('Mocap source is still loading.');

    const promise = Promise.resolve().then(() => {
      motion.clip = retargetMocapClip(this.sourceState, motion.sourceClip);
      const action = this.mixer.clipAction(motion.clip);
      action.setLoop(THREE.LoopRepeat, Infinity);
      this.actions[motion.name] = action;
      return action;
    });
    this.actionPromises.set(motion.name, promise);
    try {
      return await promise;
    } finally {
      this.actionPromises.delete(motion.name);
    }
  }

  select(name, { restorePose = true } = {}) {
    const selectionId = ++this.selectionId;
    if (name === STATIC_NAME) {
      this.mixer.stopAllAction();
      this.activeName = STATIC_NAME;
      this.playing = false;
      this.rootMotionOffset.set(0, 0, 0);
      this.appliedRootMotionOffset.set(0, 0, 0);
      if (restorePose) this.onStatic?.();
      this.setControls(STATIC_NAME);
      return Promise.resolve();
    }

    const motion = this.motions.get(name);
    if (!motion) return Promise.resolve();
    this.setLoadingDescription(motion.label);
    return this.getAction(motion).then(next => {
      if (selectionId !== this.selectionId) return;
      this.rootMotionOffset.set(0, 0, 0);
      this.appliedRootMotionOffset.set(0, 0, 0);
      const previous = this.activeName === STATIC_NAME ? null : this.actions[this.activeName];
      if (previous && previous !== next) {
        next.reset().play();
        previous.crossFadeTo(next, this.config.fadeDuration, false);
      } else {
        this.mixer.stopAllAction();
        next.reset().play();
      }
      this.activeName = name;
      this.playing = true;
      this.setControls(name);
    }).catch(error => {
      if (selectionId === this.selectionId) {
        this.description.textContent = `Could not load ${motion.label}: ${error.message}`;
      }
      console.error(error);
    });
  }

  get activeAction() {
    return this.activeName === STATIC_NAME ? null : this.actions[this.activeName];
  }

  get playback() {
    const action = this.activeAction;
    return {
      name: this.activeName,
      label: this.motions.get(this.activeName)?.label ?? 'Select an animation',
      duration: action?.getClip().duration ?? 0,
      time: action?.time ?? 0,
      playing: Boolean(action && this.playing),
    };
  }

  togglePlayback() {
    if (this.activeAction) this.playing = !this.playing;
  }

  seek(time) {
    const action = this.activeAction;
    if (!action || !Number.isFinite(time)) return;
    const duration = action.getClip().duration;
    // Scrubbing resolves any crossfade and samples only the selected clip.
    // Sample the exact endpoint once; repeat playback resumes on the next tick.
    this.mixer.stopAllAction();
    this.rootMotionOffset.set(0, 0, 0);
    this.appliedRootMotionOffset.set(0, 0, 0);
    action.reset().setLoop(THREE.LoopOnce, 1).play();
    action.clampWhenFinished = true;
    action.time = THREE.MathUtils.clamp(time, 0, duration);
    this.mixer.update(0);
    action.setLoop(THREE.LoopRepeat, Infinity);
    action.clampWhenFinished = false;
    action.paused = false;
    this.model.root.updateMatrixWorld(true);
    this.model.elbowCorrectives.update();
    this.model.shoulderCorrectives.update();
    this.model.armSoftening.update();
  }

  update(delta) {
    if (this.activeAction && this.playing) {
      // PropertyMixer may skip writing an unchanged sample (e.g. update(0)).
      // Remove our previous offset first, so it is applied exactly once.
      this.model.bones.Hip.position.sub(this.appliedRootMotionOffset);
      this.mixer.update(delta);
      if (this.activeAction.getClip().userData?.continuousRootMotion) {
        this.model.bones.Hip.position.add(this.rootMotionOffset);
        this.appliedRootMotionOffset.copy(this.rootMotionOffset);
      }
    }
    if (this.activeAction) this.model.elbowCorrectives.update();
    if (this.activeAction) this.model.shoulderCorrectives.update();
    if (this.activeAction) this.model.armSoftening.update();
  }

  dispose() {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.model.mesh);
    disposeMocapSource(this.sourceState);
    this.sourceState = null;
  }
}
