import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { loadZackModel } from './ZackModel.js';
import { createZackRig } from './ZackRig.js';

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color('#11191e');
const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.01, 100);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
scene.add(new THREE.HemisphereLight(0xdaf2ff, 0x4b4140, 2.3));
const key = new THREE.DirectionalLight(0xfff2dd, 3.2);
key.position.set(2, 4, 3); key.castShadow = true; key.shadow.mapSize.set(2048, 2048);
scene.add(key);
const rim = new THREE.DirectionalLight(0xa9c6ff, 2);
rim.position.set(-3, 2, -2); scene.add(rim);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.ShadowMaterial({ opacity: 0.25 }));
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);

try {
  const model = await loadZackModel(`${import.meta.env.BASE_URL}model/`);
  scene.add(model.root);
  const box = new THREE.Box3().setFromObject(model.root, true);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  floor.position.y = box.min.y - 0.002;
  controls.target.copy(center);
  camera.position.copy(center).add(new THREE.Vector3(0.65, 0.15, 2.1).multiplyScalar(size.y));
  controls.update();
  const helper = new THREE.SkeletonHelper(model.root);
  helper.visible = false; scene.add(helper);
  const map = model.material.map;
  const headRest = model.bones.Head.quaternion.clone();
  const rig = createZackRig(model);
  const applyHead = () => {
    model.bones.Head.quaternion.copy(headRest).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(Number(document.querySelector('#head').value))));
    model.root.updateMatrixWorld(true);
  };
  const selectPose = name => {
    rig.setPose(name);
    applyHead();
    document.querySelectorAll('[data-pose]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.pose === name)));
  };
  document.querySelectorAll('[data-pose]').forEach(button => { button.onclick = () => selectPose(button.dataset.pose); });
  selectPose('down');
  document.querySelector('#stats').textContent = 'Three poses. Coordinated shoulders. Editable geometry.';
  document.querySelector('#surface').onchange = event => {
    model.material.map = event.target.value === 'textured' ? map : null;
    model.material.wireframe = event.target.value === 'wire';
    model.material.color.set(event.target.value === 'textured' ? '#ffffff' : '#b3c7ba');
    model.material.needsUpdate = true;
  };
  document.querySelector('#rig').onchange = event => { helper.visible = event.target.checked; };
  document.querySelector('#head').oninput = applyHead;
  document.querySelector('#reset').onclick = () => {
    model.reset();
    document.querySelector('#head').value = 0;
    selectPose('down');
  };
  document.querySelector('#export').onclick = () => {
    const blob = new Blob([JSON.stringify(model.root.toJSON())], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'zack.three.json'; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  // Expose the editable model for console exploration and verification.
  window.zack = model;
  window.zackRig = rig;
  window.studio = { scene, camera, renderer, controls };
} catch (error) {
  document.querySelector('#error').textContent = error.message;
  console.error(error);
}
window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
