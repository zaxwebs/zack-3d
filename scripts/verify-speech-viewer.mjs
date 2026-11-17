import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const output = 'artifacts/speech';
await mkdir(output, { recursive: true });
// Browser input: 1 s quiet, 1 s voiced low band, 1 s quiet, 1 s higher band.
// No physical microphone or recorded speech is used in this regression.
const sampleRate = 48000, seconds = 4, wave = Buffer.alloc(44 + sampleRate * seconds * 2);
wave.write('RIFF', 0); wave.writeUInt32LE(wave.length - 8, 4); wave.write('WAVEfmt ', 8);
wave.writeUInt32LE(16, 16); wave.writeUInt16LE(1, 20); wave.writeUInt16LE(1, 22);
wave.writeUInt32LE(sampleRate, 24); wave.writeUInt32LE(sampleRate * 2, 28);
wave.writeUInt16LE(2, 32); wave.writeUInt16LE(16, 34); wave.write('data', 36); wave.writeUInt32LE(wave.length - 44, 40);
for (let i = 0; i < sampleRate * seconds; i++) {
  const t = i / sampleRate, segment = Math.floor(t), f = segment === 1 ? 300 : 1500;
  const amplitude = segment % 2 ? 0.20 * Math.min(1, (t % 1) * 50, (1 - t % 1) * 50) : 0;
  wave.writeInt16LE(Math.round(Math.sin(2 * Math.PI * f * t) * amplitude * 32767), 44 + i * 2);
}
const wavePath = resolve(output, 'synthetic-input.wav'); await writeFile(wavePath, wave);
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wavePath}`] });
const errors = [], report = {};
try {
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const page = await context.newPage();
  await page.route('**/favicon.ico', route => route.fulfill({ status: 204 }));
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.addInitScript(() => {
    window.micRequests = 0;
    const get = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = (...args) => { window.micRequests++; return get(...args); };
  });
  await page.goto(process.env.VIEWER_URL || 'http://127.0.0.1:5173');
  await page.waitForFunction(() => window.studio?.speech);
  assert.equal(await page.evaluate(() => window.micRequests), 0, 'No microphone request on load');
  await page.click('#speechFocus'); await page.click('#speechPreview');
  await page.waitForFunction(() => zack.speechFace.state.open > 0.2);
  assert.equal(await page.evaluate(() => window.micRequests), 0, 'Preview never requests a mic');
  await page.click('#speechPreview');
  assert.equal(await page.evaluate(() => zack.speechFace.state.open), 0);

  // Real getUserMedia -> Web Audio analyser -> face shapes, driven by fake input.
  await page.click('#speechMic');
  await page.waitForFunction(() => studio.speech.state === 'live');
  await page.waitForFunction(() => zack.speechFace.state.open > 0.4, null, { timeout: 10000 });
  report.live = await page.evaluate(() => ({ db: studio.speech.envelope.db, pose: zack.speechFace.state,
    contextState: studio.speech.context.state, fft: studio.speech.analyser.fftSize, tracks: studio.speech.stream.getAudioTracks().length }));
  await page.waitForFunction(() => studio.speech.state === 'live' && zack.speechFace.state.open === 0, null, { timeout: 10000 });
  const tracks = await page.evaluate(() => { window.liveTracks = studio.speech.stream.getTracks(); return liveTracks.length; });
  await page.click('#speechMic');
  assert(tracks > 0);
  assert(await page.evaluate(() => liveTracks.every(track => track.readyState === 'ended')));
  assert.equal(await page.evaluate(() => zack.speechFace.state.open), 0);

  // Denial is actionable, then retry is possible.
  await page.evaluate(() => { window.realGetUserMedia = navigator.mediaDevices.getUserMedia; navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Denied for test', 'NotAllowedError'); }; });
  await page.click('#speechMic'); await page.waitForFunction(() => studio.speech.state === 'error');
  assert.match(await page.locator('#speechStatus').innerText(), /denied/);
  assert.equal(await page.locator('#speechMic').innerText(), 'Start mic');

  // Cancel while permission is pending; late streams must be stopped.
  await page.evaluate(() => { navigator.mediaDevices.getUserMedia = () => new Promise(resolve => { window.resolveMic = resolve; }); });
  await page.click('#speechMic'); await page.waitForFunction(() => studio.speech.state === 'requesting');
  await page.click('#speechMic');
  await page.evaluate(async () => { const late = await realGetUserMedia({ audio: true }); window.lateTracks = late.getTracks(); resolveMic(late); });
  await page.waitForFunction(() => lateTracks.every(track => track.readyState === 'ended'));
  assert.equal(await page.evaluate(() => studio.speech.state), 'idle');
  await page.evaluate(() => { navigator.mediaDevices.getUserMedia = realGetUserMedia; });

  await page.click('#speechMic'); await page.waitForFunction(() => studio.speech.state === 'live');
  await page.evaluate(() => studio.speech.context.suspend());
  await page.waitForFunction(() => zack.speechFace.state.open === 0 && studio.speech.message.includes('paused'));
  await page.click('#speechMic');
  await page.click('#speechMic'); await page.waitForFunction(() => studio.speech.state === 'live');
  await page.evaluate(() => studio.speech.stream.getAudioTracks()[0].dispatchEvent(new Event('ended')));
  await page.waitForFunction(() => studio.speech.state === 'error');
  assert.match(await page.locator('#speechStatus').innerText(), /disconnected/);
  await page.click('#speechMic'); await page.waitForFunction(() => studio.speech.state === 'live');
  await page.evaluate(() => { window.departingTracks = studio.speech.stream.getTracks(); dispatchEvent(new Event('pagehide')); });
  assert(await page.evaluate(() => departingTracks.every(track => track.readyState === 'ended') && studio.speech.state === 'idle'));

  // Deterministic visual poses, clay/wire, head attachment and mocap layering.
  await page.evaluate(() => studio.renderer.setAnimationLoop(null));
  for (const [name, pose] of Object.entries({ rest: {}, open: { open: 0.8, spread: 0.3 }, wide: { open: 0.5, spread: 1 }, rounded: { open: 0.7, round: 1 } })) {
    await page.evaluate(pose => { zack.speechFace.setPose(pose); studio.renderer.render(studio.scene, studio.camera); }, pose);
    const calls = await page.evaluate(() => studio.renderer.info.render.calls);
    assert.equal(calls, name === 'rest' ? 1 : 4, 'The closed mouth culls all interior draw calls');
    await page.screenshot({ path: `${output}/${name}.png` });
  }
  for (const [name, mode, x] of [['clay', 'clay', 0], ['wire', 'wire', 0], ['three-quarter', 'textured', 0.43], ['profile', 'textured', 0.65]]) {
    await page.selectOption('#surface', mode);
    await page.evaluate(x => { zack.speechFace.setPose({ open: 0.75, round: 0.6 }); studio.camera.position.set(x, 0.815, x ? 0.61 : 0.81); studio.controls.update(); studio.renderer.render(studio.scene, studio.camera); }, x);
    await page.screenshot({ path: `${output}/${name}.png` });
  }
  await page.click('#speechFocus');
  await page.evaluate(() => { zackRig.setHeadTurn(25); zack.speechFace.setPose({ open: 0.6, round: 0.8 }); studio.renderer.render(studio.scene, studio.camera); });
  await page.screenshot({ path: `${output}/head-turn.png` });
  await page.waitForFunction(() => studio.mocapController.motions.size > 0);
  report.mocap = await page.evaluate(async () => {
    const c = studio.mocapController;
    await c.select('idle.001'); c.playing = false; c.seek(0.8);
    zack.speechFace.setPose({ open: 0.6, spread: 1 }); c.seek(1.2);
    const intact = zack.speechFace.state.open === 0.6 && zack.mesh.morphTargetInfluences[zack.speechFace.report.firstTarget] === 0.6;
    c.select('static'); zackRig.setPose('down'); zackRig.setHeadTurn(0);
    return { intact };
  });
  assert(report.mocap.intact);

  // The opening, teeth, lining, and shapes export as ordinary native geometry.
  report.export = await page.evaluate(async () => {
    const T = await import('/node_modules/three/build/three.module.js');
    zack.speechFace.setPose({ open: 0.8, spread: 0.3 }); zack.armSoftening.update();
    const geometry = zack.mesh.geometry, influences = zack.mesh.morphTargetInfluences, map = zack.material.map;
    const json = zack.root.toJSON();
    const snapshot = await new Promise(resolve => new T.ObjectLoader().parse(json, resolve));
    let mesh; snapshot.traverse(node => { if (node.isSkinnedMesh) mesh = node; }); snapshot.updateMatrixWorld(true);
    let maxError = 0;
    for (let i = 0; i < geometry.attributes.position.count; i++) maxError = Math.max(maxError,
      zack.mesh.getVertexPosition(i, new T.Vector3()).distanceTo(mesh.getVertexPosition(i, new T.Vector3())));
    window.speechSnapshot = snapshot; studio.scene.add(snapshot); zack.root.visible = false;
    studio.renderer.render(studio.scene, studio.camera);
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    return { maxError, restored: zack.mesh.geometry === geometry && zack.mesh.morphTargetInfluences === influences && zack.material.map === map,
      nativeMap: materials[0].map.uuid === map.uuid, materials: materials.map(material => material.name), groups: mesh.geometry.groups.length, triangles: mesh.geometry.index.count / 3 };
  });
  await page.screenshot({ path: `${output}/export.png` });
  assert(report.export.restored && report.export.nativeMap && report.export.groups === 4 && report.export.maxError < 1e-7);
  await page.evaluate(() => { studio.scene.remove(speechSnapshot); zack.root.visible = true; zack.speechFace.reset(); });
  await page.selectOption('#surface', 'clay');
  await page.evaluate(() => { zack.speechFace.setPose({ open: 0.6 }); studio.renderer.render(studio.scene, studio.camera); });
  await page.selectOption('#surface', 'wire');
  await page.evaluate(() => studio.renderer.render(studio.scene, studio.camera));
  await page.selectOption('#surface', 'textured');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.evaluate(() => studio.renderer.render(studio.scene, studio.camera));
  await page.screenshot({ path: `${output}/mobile.png` });
  assert(await page.locator('#speechMic').isVisible());
  assert(await page.evaluate(() => document.documentElement.scrollWidth === innerWidth));
  assert.deepEqual(errors, []);
  await writeFile(`${output}/verification.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: true, ...report }, null, 2));
} finally { await browser.close(); }
