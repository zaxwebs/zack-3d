import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const output = process.env.ELBOW_AUDIT_DIR || 'artifacts/frustrated-elbow/after';
const animation = process.env.ELBOW_ANIMATION || 'frustrated_02.001';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
try {
  const page = await browser.newPage({ viewport: { width: 800, height: 800 } });
  await page.goto('http://127.0.0.1:5173');
  await page.waitForFunction(() => window.studio?.mocapController.motions.size > 0);
  await page.evaluate(async animation => {
    await studio.mocapController.select(animation);
    studio.mocapController.playing = false;
    studio.renderer.setAnimationLoop(null);
  }, animation);
  await page.addStyleTag({ content: '.properties,#timeline{display:none}.workspace{grid-template-columns:1fr}.viewer{grid-template-rows:1fr}' });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  for (const side of ['L', 'R']) for (const time of [4.5, 5, 5.5]) {
    await page.evaluate(async ({ side, time }) => {
      const THREE = await import('/node_modules/three/build/three.module.js');
      studio.mocapController.seek(time);
      const elbow = zack.bones[`${side}_Forearm`].getWorldPosition(new THREE.Vector3());
      studio.controls.minDistance = 0.02;
      studio.controls.enableDamping = false;
      studio.controls.target.copy(elbow);
      studio.camera.position.copy(elbow).add(new THREE.Vector3(side === 'L' ? 0.32 : -0.32, 0.03, 0.24));
      studio.controls.update();
      studio.renderer.render(studio.scene, studio.camera);
    }, { side, time });
    await page.screenshot({ path: `${output}/${side}-${time}.png` });
    if (side === 'L' && time === 5) {
      await page.screenshot({ path: `${output}/5s-detail.png`, clip: { x: 90, y: 90, width: 500, height: 600 } });
    }
  }
  console.log(`Saved ${animation} elbow closeups to ${output}.`);
} finally { await browser.close(); }
