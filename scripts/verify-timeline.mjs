import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 850 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:5173');
  await page.waitForFunction(() => window.studio?.mocapController.motions.size > 0);
  assert(await page.locator('#timelinePlay').isDisabled());
  await page.locator('[data-animation="angry_01.001"]').click();
  await page.waitForFunction(() => studio.mocapController.playback.playing);
  assert.equal(await page.locator('#timelineName').textContent(), 'Angry 01');
  await page.getByRole('button', { name: 'Pause animation', exact: true }).click();
  const paused = await page.evaluate(() => studio.mocapController.playback.time);
  await page.evaluate(() => new Promise(resolve => {
    let frames = 0;
    const next = () => ++frames >= 8 ? resolve() : requestAnimationFrame(next);
    requestAnimationFrame(next);
  }));
  assert.equal(await page.evaluate(() => studio.mocapController.playback.time), paused);

  await page.locator('#timelineZoomIn').click();
  const dimensions = await page.locator('#timelineScroll').evaluate(node => ({ width: node.clientWidth, total: node.scrollWidth }));
  assert(dimensions.total > dimensions.width, 'Zoomed ruler must scroll horizontally');
  await page.locator('#timelineScroll').hover();
  await page.mouse.wheel(0, 250);
  await page.waitForFunction(() => document.querySelector('#timelineScroll').scrollLeft > 100);
  await page.locator('#timelineScroll').evaluate(node => node.scrollLeft = 0);
  const scrubber = page.locator('#timelineScrubber');
  const bounds = await scrubber.boundingBox();
  await page.mouse.click(bounds.x + bounds.width * 0.25, bounds.y + 45);
  const scrubbed = await page.evaluate(() => studio.mocapController.playback);
  assert(Math.abs(scrubbed.time - scrubbed.duration * 0.25) < 0.03, 'Pointer scrubbing should select the clicked time');
  assert.equal(scrubbed.playing, false, 'Scrubbing must preserve pause');
  const armBefore = await page.evaluate(() => zack.bones.L_Upperarm.quaternion.toArray());
  await scrubber.press('Home');
  assert.equal(await page.evaluate(() => studio.mocapController.playback.time), 0);
  assert.notDeepEqual(await page.evaluate(() => zack.bones.L_Upperarm.quaternion.toArray()), armBefore);
  await scrubber.press('End');
  const atEnd = await page.evaluate(() => {
    const controller = studio.mocapController;
    const track = controller.activeAction.getClip().tracks.find(track => track.name === '.bones[L_Upperarm].quaternion');
    return { time: controller.playback.time, duration: controller.playback.duration,
      actual: zack.bones.L_Upperarm.quaternion.toArray(), expected: Array.from(track.values.slice(-4)) };
  });
  assert.equal(atEnd.time, atEnd.duration, 'End should retain the exact final frame');
  atEnd.actual.forEach((value, i) => assert(Math.abs(value - atEnd.expected[i]) < 1e-6));
  await page.getByRole('button', { name: 'Play animation', exact: true }).click();
  await page.waitForFunction(() => studio.mocapController.playback.time < 0.5);
  await page.locator('#viewport').click({ position: { x: 25, y: 100 } });
  await page.keyboard.press('Space');
  assert.equal(await page.evaluate(() => studio.mocapController.playback.playing), false);
  await page.locator('[data-animation="idle.001"]').click();
  await page.waitForFunction(() => studio.mocapController.playback.label === 'Idle');
  assert.equal(await page.evaluate(() => studio.mocapController.playback.playing), true);
  await page.locator('[data-animation="static"]').click();
  await page.waitForFunction(() => document.querySelector('#timelineScrubber').disabled);
  assert(await page.locator('#timelinePlay').isDisabled());
  assert.equal(await page.locator('#timelineTime').textContent(), '0.00 / 0.00 s');

  await page.locator('[data-animation="angry_01.001"]').click();
  await page.waitForFunction(() => studio.mocapController.playback.label === 'Angry 01');
  await page.getByRole('button', { name: 'Pause animation', exact: true }).click();
  await scrubber.evaluate(node => { node.value = '1'; node.dispatchEvent(new Event('input')); });
  await mkdir('artifacts/timeline', { recursive: true });
  await page.screenshot({ path: 'artifacts/timeline/desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const mobile = await page.evaluate(() => ({
    page: document.documentElement.scrollWidth, width: innerWidth,
    canvas: document.querySelector('#viewport').getBoundingClientRect().height,
    timeline: document.querySelector('#timeline').getBoundingClientRect().toJSON(),
  }));
  assert.equal(mobile.page, mobile.width, 'Mobile page must not overflow horizontally');
  assert(mobile.canvas > 150 && mobile.timeline.bottom < 844);
  await page.screenshot({ path: 'artifacts/timeline/mobile.png' });
  assert.deepEqual(errors, []);
  console.log('Timeline passed: play/pause, frozen poses, pointer/keyboard scrubbing, exact endpoint, looping, wheel scrolling, zoom, clip switching, static reset, and mobile layout.');
} finally { await browser.close(); }
