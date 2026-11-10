import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { loadZackModel } from './ZackModel.js';
import { createZackRig, POSES } from './ZackRig.js';
import { MocapController } from './MocapController.js';
import { AnimationTimeline } from './AnimationTimeline.js';
import { MOCAP_CONFIG } from './mocapConfig.js';

const viewport = document.querySelector('#viewport');
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.5;
viewport.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#191919');
const pmremGenerator = new THREE.PMREMGenerator(renderer);
scene.environment = pmremGenerator.fromScene(new RoomEnvironment()).texture;
pmremGenerator.dispose();
const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 0.4;
controls.maxDistance = 30;

const ambient = new THREE.AmbientLight(0xffffff, 0.86);
scene.add(ambient);
const key = new THREE.DirectionalLight(0xffffff, 0.8 * Math.PI);
key.position.set(0.5, 0, 0.866);
camera.add(key);
scene.add(key.target);
const grid = new THREE.GridHelper(100, 100, 0x777777, 0x555555);
grid.material.transparent = true;
grid.material.opacity = 0.28;
grid.material.depthWrite = false;
grid.visible = document.querySelector('#ground').checked;
scene.add(grid);

function resizeViewport() {
  const { width, height } = viewport.getBoundingClientRect();
  if (!width || !height) return;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resizeViewport).observe(viewport);
window.addEventListener('resize', resizeViewport);
resizeViewport();

const output = selector => document.querySelector(selector);

let model;
let rig;
let helper;
let selectedPose = 'down';
let mocapController;
let timeline;
let cameraTarget = new THREE.Vector3();
const mocapFollowOffset = new THREE.Vector3();
const mocapFollowTarget = new THREE.Vector3();
let mocapFollowInitialized = false;
function frameModel() {
  if (!model) return;
  const box = new THREE.Box3().setFromObject(model.root, true);
  const size = box.getSize(new THREE.Vector3());
  cameraTarget = box.getCenter(new THREE.Vector3());
  const verticalFov = THREE.MathUtils.degToRad(camera.fov);
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
  const limitingFov = Math.min(verticalFov, horizontalFov);
  const radius = Math.max(size.x, size.y, size.z) * 0.5;
  const distance = radius / Math.sin(limitingFov / 2) * 1.12;
  controls.target.copy(cameraTarget);
  camera.position.copy(cameraTarget).add(new THREE.Vector3(0.14, 0.08, 1).normalize().multiplyScalar(distance));
  controls.minDistance = Math.max(0.25, size.y * 0.12);
  controls.maxDistance = size.y * 8;
  controls.update();
}
function resetMocapFollow() {
  if (!model) return;
  model.root.updateMatrixWorld(true);
  const hipPosition = model.bones.Hip.getWorldPosition(new THREE.Vector3());
  mocapFollowOffset.copy(cameraTarget).sub(hipPosition);
  mocapFollowInitialized = true;
}
function followMocap() {
  if (!model || !mocapController || mocapController.activeName === 'static' || !mocapFollowInitialized) return;
  model.root.updateMatrixWorld(true);
  const hipPosition = model.bones.Hip.getWorldPosition(mocapFollowTarget);
  const target = mocapFollowTarget.add(mocapFollowOffset);
  const delta = target.sub(controls.target);
  if (delta.lengthSq() < 1e-10) return;
  camera.position.add(delta);
  controls.target.add(delta);
  cameraTarget.copy(target);
}
try {
  model = await loadZackModel(`${import.meta.env.BASE_URL}model/`);
  scene.add(model.root);
  const box = new THREE.Box3().setFromObject(model.root, true);
  grid.position.y = box.min.y;
  frameModel();

  helper = new THREE.SkeletonHelper(model.root);
  helper.visible = false;
  scene.add(helper);
  let map = model.material.map;
  rig = createZackRig(model);
  resetMocapFollow();

  const textureButtons = [...document.querySelectorAll('[data-texture-size]')];
  const textureStatus = output('#textureStatus');
  let textureSwitchRequest = 0;
  const setTextureControls = (size, status) => {
    textureButtons.forEach(button => {
      button.setAttribute('aria-pressed', String(Number(button.dataset.textureSize) === size));
    });
    textureStatus.textContent = status;
  };
  setTextureControls(model.textureSize, `${model.textureSize} × ${model.textureSize}`);
  textureButtons.forEach(button => {
    button.addEventListener('click', async () => {
      const size = Number(button.dataset.textureSize);
      const request = ++textureSwitchRequest;
      setTextureControls(size, `Loading ${size} × ${size}…`);
      try {
        map = await model.setTextureSize(size);
        if (request !== textureSwitchRequest) return;
        model.material.map = output('#surface').value === 'textured' ? map : null;
        model.material.needsUpdate = true;
        setTextureControls(size, `${size} × ${size}`);
      } catch (error) {
        if (request !== textureSwitchRequest) return;
        setTextureControls(model.textureSize, `Could not load ${size}; using ${model.textureSize}.`);
      }
    });
  });

  const applyHead = () => {
    const slider = output('#head');
    rig.setHeadTurn(Number(slider.value));
    output('#headValue').value = `${slider.value}°`;
  };
  for (const [name, pose] of Object.entries(POSES)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.pose = name;
    button.textContent = pose.label;
    button.title = pose.description;
    button.setAttribute('aria-pressed', 'false');
    output('#poses').append(button);
  }
  const selectPose = name => {
    selectedPose = name;
    mocapController.select('static', { restorePose: false });
    rig.setPose(name);
    output('#poseDescription').textContent = POSES[name].description;
    applyHead();
    frameModel();
    resetMocapFollow();
    document.querySelectorAll('[data-pose]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.pose === name));
    });
  };
  document.querySelectorAll('[data-pose]').forEach(button => {
    button.addEventListener('click', () => selectPose(button.dataset.pose));
  });

  mocapController = new MocapController({
    model,
    container: output('#animations'),
    description: output('#animationDescription'),
    sourceUrl: MOCAP_CONFIG.sourceUrl,
    config: MOCAP_CONFIG,
    onStatic: () => {
      rig.setPose(selectedPose);
      applyHead();
      frameModel();
      resetMocapFollow();
    },
  });
  timeline = new AnimationTimeline(mocapController);
  selectPose('down');

  output('#surface').addEventListener('change', event => {
    model.material.map = event.target.value === 'textured' ? map : null;
    model.material.wireframe = event.target.value === 'wire';
    model.material.color.set(event.target.value === 'textured' ? '#ffffff' : '#b3b3b3');
    model.material.needsUpdate = true;
  });
  output('#rig').addEventListener('change', event => { helper.visible = event.target.checked; });
  output('#ground').addEventListener('change', event => { grid.visible = event.target.checked; });
  output('#head').addEventListener('input', () => {
    if (mocapController.activeName !== 'static') {
      mocapController.select('static');
    } else {
      applyHead();
    }
  });
  output('#reset').addEventListener('click', () => {
    model.reset();
    output('#head').value = 0;
    selectPose('down');
  });
  output('#export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(model.root.toJSON())], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'zack.three.json';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  window.zack = model;
  window.zackRig = rig;
  window.studio = { scene, camera, renderer, controls, mocapActions: mocapController.actions, mocapController };
  mocapController.load().catch(() => {});
} catch (error) {
  output('#error').textContent = error.message;
  console.error(error);
}

const animationClock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const delta = Math.min(animationClock.getDelta(), 0.05);
  mocapController?.update(delta);
  timeline?.update();
  followMocap();
  controls.update();
  key.target.position.copy(controls.target);
  renderer.render(scene, camera);
});
