import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:5173');
  await page.waitForFunction(() => window.studio?.mocapController.motions.size > 0);
  await page.evaluate(() => studio.renderer.setAnimationLoop(null));
  const report = await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { retargetClip } = await import('/node_modules/three/examples/jsm/utils/SkeletonUtils.js');
    const controller = studio.mocapController, state = controller.sourceState;
    const reports = [];
    const worldVertex = (mesh, i) => mesh.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld);
    for (const motion of controller.motions.values()) {
      // Independently run the original retargeter and compare all main tracks.
      zack.reset();
      const raw = retargetClip(zack.mesh, state.source, motion.sourceClip, {
        names: state.config.targetToSource, hip: state.config.hip, scale: state.scale,
        preserveBonePositions: true, preserveBoneMatrix: false, useFirstFramePosition: true,
      });
      const rawHip = raw.tracks.find(track => track.name === '.bones[Hip].position');
      if (rawHip) for (let i = 0; i < rawHip.values.length; i += 3) {
        rawHip.values[i] += state.restHipPosition.x;
        rawHip.values[i + 1] += state.restHipPosition.y;
        rawHip.values[i + 2] += state.restHipPosition.z;
      }
      zack.reset();
      await controller.select(motion.name);
      const clip = controller.actions[motion.name].getClip();
      if (clip.duration !== raw.duration) throw new Error('Animation duration changed');
      let error = 0, step = 0, helperTracks = 0;
      for (const track of clip.tracks) {
        if (/(?:Upperarm|Forearm)Twist|ElbowBlend|ElbowRound/.test(track.name)) {
          helperTracks++;
          for (let i = 4; i < track.values.length; i += 4) {
            const a = new THREE.Quaternion().fromArray(track.values, i - 4).normalize();
            const b = new THREE.Quaternion().fromArray(track.values, i).normalize();
            step = Math.max(step, a.angleTo(b));
          }
          continue;
        }
        const original = raw.tracks.find(item => item.name === track.name);
        if (!original || original.values.length !== track.values.length
          || original.times.length !== track.times.length) throw new Error('Changed main animation tracks');
        for (let i = 0; i < track.values.length; i++) error = Math.max(error, Math.abs(track.values[i] - original.values[i]));
        for (let i = 0; i < track.times.length; i++) error = Math.max(error, Math.abs(track.times[i] - original.times[i]));
      }
      controller.mixer.stopAllAction();
      controller.actions[motion.name].reset().play();
      let maxExportError = 0;
      for (const fraction of [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9]) {
        controller.mixer.setTime(clip.duration * fraction);
        zack.root.updateMatrixWorld(true);
        for (let i = 0; i < zack.geometry.attributes.position.count; i++) {
          if (!worldVertex(zack.mesh, i).toArray().every(Number.isFinite)) throw new Error('Invalid skinned point');
        }
        if (motion.name === 'angry_01.001' && fraction === 0.3) {
          const copy = new THREE.ObjectLoader().parse(zack.root.toJSON());
          copy.updateMatrixWorld(true);
          let mesh;
          copy.traverse(node => { if (node.isSkinnedMesh) mesh = node; });
          for (let i = 0; i < zack.geometry.attributes.position.count; i++) {
            maxExportError = Math.max(maxExportError, worldVertex(zack.mesh, i).distanceTo(worldVertex(mesh, i)));
          }
        }
      }
      reports.push({ name: motion.name, mainTrackError: error, helperTracks,
        maxHelperStepDegrees: THREE.MathUtils.radToDeg(step), maxExportError });
    }
    await controller.select('angry_01.001');
    controller.update(0.1);
    await controller.select('swim.001');
    controller.update(0.3);
    const cached = controller.actions['angry_01.001'];
    await controller.select('angry_01.001');
    const cacheReused = cached === controller.actions['angry_01.001'];
    controller.update(0.3);
    for (let i = 0; i < zack.geometry.attributes.position.count; i++) {
      if (!worldVertex(zack.mesh, i).toArray().every(Number.isFinite)) throw new Error('Invalid crossfade point');
    }
    await controller.select('static');
    zackRig.setPose('rest');
    return { clips: reports, cacheReused, activeName: controller.activeName };
  });
  assert(report.cacheReused);
  assert.equal(report.activeName, 'static');
  assert.deepEqual(errors, []);
  for (const clip of report.clips) {
    assert.equal(clip.mainTrackError, 0, clip.name);
    assert.equal(clip.helperTracks, 12, clip.name);
    assert(clip.maxExportError < 1e-6);
    assert(clip.maxHelperStepDegrees < 60, `${clip.name}: helper rotation jumps ${clip.maxHelperStepDegrees}`);
  }
  await mkdir('artifacts/arm-audit', { recursive: true });
  await writeFile('artifacts/arm-audit/mocap.json', JSON.stringify(report, null, 2));
  console.log(`All ${report.clips.length} clips preserve main animation tracks, have finite skinning and continuous helper motion; cached transitions and posed export pass.`);
} finally { await browser.close(); }
