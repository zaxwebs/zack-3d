import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const output = 'artifacts/production-pose-audit';
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(process.env.ZACK_VIEWER_URL || 'http://127.0.0.1:5173');
  await page.waitForFunction(() => window.studio?.mocapController.motions.size > 0, null, { timeout: 90000 });
  const report = await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { POSES } = await import('/src/ZackRig.js');
    const model = window.zack, rig = window.zackRig, controller = window.studio.mocapController;
    const { mesh, geometry, skeleton } = model;
    window.studio.renderer.setAnimationLoop(null);
    await controller.select('static');
    rig.setHeadTurn(0);
    rig.setPose('rest');

    const points = Array.from({ length: geometry.attributes.position.count }, () => new THREE.Vector3());
    const samplePoints = () => points.forEach((point, i) => mesh.getVertexPosition(i, point).applyMatrix4(mesh.matrixWorld));
    samplePoints();
    // This rear hem edge showed the largest abdomen stretch in the baseline.
    const hemVertices = [20736, 20737];
    const hemRestLength = points[hemVertices[0]].distanceTo(points[hemVertices[1]]);
    let rearHemKick;
    const seen = new Set(), edges = [];
    const regionOf = (x, y) => {
      if (y < 0.21) return 'ankle/shoe';
      if (y < 0.425) return x < 0.04 && y > 0.29 ? 'inseam' : 'pants';
      if (y < 0.535 && x < 0.14) return 'abdomen';
      if (y < 0.715 && x < 0.20) return 'shoulder/chest';
      if (y < 0.74 && x < 0.29) return 'elbow/sleeve';
      if (y < 0.74 && x < 0.325) return 'cuff/wrist';
      if (y < 0.74 && x < 0.5) return 'hand';
      return 'other';
    };
    const index = geometry.index.array;
    for (let triangle = 0; triangle < index.length; triangle += 3) {
      for (let corner = 0; corner < 3; corner++) {
        const a = index[triangle + corner], b = index[triangle + (corner + 1) % 3];
        const key = Math.min(a, b) * points.length + Math.max(a, b);
        if (seen.has(key)) continue;
        seen.add(key);
        const length = points[a].distanceTo(points[b]);
        if (length < 0.003) continue;
        const x = Math.abs((points[a].x + points[b].x) / 2);
        const y = (points[a].y + points[b].y) / 2;
        edges.push({ a, b, length, region: regionOf(x, y) });
      }
    }
    const groups = {};
    let invalidVertices = 0;
    function record(group, label) {
      const category = groups[group] ??= { samples: 0, regions: {} };
      category.samples++;
      samplePoints();
      invalidVertices += points.filter(({ x, y, z }) => !Number.isFinite(x + y + z)).length;
      for (const { a, b, length, region } of edges) {
        const result = category.regions[region] ??= { stretch: { ratio: 0 }, compression: { ratio: Infinity } };
        const ratio = points[a].distanceTo(points[b]) / length;
        if (ratio > result.stretch.ratio) result.stretch = { ratio, label, edge: [a, b] };
        if (ratio < result.compression.ratio) result.compression = { ratio, label, edge: [a, b] };
      }
    }
    for (const pose of Object.keys(POSES)) {
      for (const yaw of [-rig.limits.headYaw, 0, rig.limits.headYaw]) {
        rig.setHeadTurn(yaw);
        rig.setPose(pose);
        record('static', `${pose} @ head ${yaw}°`);
      }
    }
    rig.setHeadTurn(0);
    rig.setPose('rest');
    const rest = skeleton.bones.map(bone => bone.quaternion.clone().normalize());
    const extremes = skeleton.bones.map(() => ({ angle: 0 }));
    const clips = [...controller.motions.keys()];
    for (const name of clips) {
      await controller.select(name);
      if (controller.playback.name !== name) throw new Error(`Could not sample ${name}`);
      controller.playing = false;
      const { duration } = controller.playback;
      for (let step = 0; step <= 16; step++) {
        const time = duration * step / 16;
        controller.seek(time);
        const label = `${name} @ ${time.toFixed(3)}s`;
        record('mocap', label);
        if (name === 'front_kick_02.001' && step === 9) {
          rearHemKick = { label, edge: hemVertices,
            ratio: points[hemVertices[0]].distanceTo(points[hemVertices[1]]) / hemRestLength };
        }
        skeleton.bones.forEach((bone, i) => {
          const orientation = bone.quaternion.clone().normalize();
          const angle = orientation.angleTo(rest[i]);
          if (angle > extremes[i].angle) extremes[i] = { angle, orientation, label };
        });
      }
    }

    await controller.select('static');
    const joints = [];
    skeleton.bones.forEach((bone, i) => {
      if (/Twist|ElbowBlend|ElbowRound/.test(bone.name)) return;
      const { angle, orientation, label } = extremes[i];
      if (angle < THREE.MathUtils.degToRad(1)) return;
      joints.push({ name: bone.name, degrees: THREE.MathUtils.radToDeg(angle), source: label });
      for (const fraction of [0.5, 1]) {
        rig.setPose('rest');
        bone.quaternion.copy(rest[i]).slerp(orientation, fraction);
        model.armTwist.update();
        model.elbowCorrectives.update();
        model.shoulderCorrectives.update();
        model.armSoftening.update();
        record('isolated', `${bone.name} @ ${fraction * 100}% of ${label}`);
      }
    });
    return { clips: clips.length, vertices: points.length, edges: edges.length, invalidVertices, rearHemKick, joints, groups };
  });
  await mkdir(output, { recursive: true });
  await writeFile(`${output}/audit.json`, JSON.stringify({ ...report, errors }, null, 2));
  assert.equal(report.invalidVertices, 0);
  assert.deepEqual(errors, []);
  assert(report.rearHemKick?.ratio < 2, 'Front Kick 02 stretches the rear hem beyond its verified range');
  console.log(`Scanned ${report.clips} clips and ${report.joints.length} isolated joints. Report at ${output}/audit.json`);
} finally {
  await browser.close();
}
