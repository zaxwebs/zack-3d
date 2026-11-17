import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const output = process.env.ARM_AUDIT_DIR || 'artifacts/arm-audit/after';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
  await page.goto('http://127.0.0.1:5173');
  await page.waitForFunction(() => window.studio?.mocapController.motions.size > 0);
  await page.evaluate(async () => {
    await studio.mocapController.select('angry_01.001');
    studio.renderer.setAnimationLoop(null);
    document.querySelectorAll('header,aside,footer').forEach(node => node.style.display = 'none');
  });
  const report = await page.evaluate(() => ({
    duration: studio.mocapActions['angry_01.001'].getClip().duration,
    weights: zack.root.userData.armTwistWeights,
    forearmPivots: zack.root.userData.forearmHelperCorrections,
  }));
  for (const time of [0, 0.5, 1, 1.5, 2, 2.5, 3]) {
    await page.evaluate(time => {
      studio.mocapController.seek(time);
      zack.root.updateMatrixWorld(true);
      studio.controls.target.set(0, 0.7, 0);
      studio.camera.position.set(0, 0.73, 1.25);
      studio.controls.update();
      studio.renderer.render(studio.scene, studio.camera);
    }, time);
    await page.screenshot({ path: `${output}/angry-${time}.png` });
  }
  for (const [name, position] of [['side', [1.25, 0.73, 0.2]], ['back', [0, 0.73, -1.25]]]) {
    await page.evaluate(position => {
      studio.mocapController.mixer.setTime(1);
      zack.root.updateMatrixWorld(true);
      studio.camera.position.fromArray(position);
      studio.controls.update();
      studio.renderer.render(studio.scene, studio.camera);
    }, position);
    await page.screenshot({ path: `${output}/angry-1-${name}.png` });
  }
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  console.log(`Saved Angry 01 pose captures to ${output}.`);
} finally { await browser.close(); }
