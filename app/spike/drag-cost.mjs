// Redraw cost of both spikes on a slowed-down processor: 60 cards, 150 cables, one card dragged across the board.
import { chromium } from '@playwright/test';

const browser = await chromium.launch();
for (const [name, url, card] of [
  ['Svelte Flow', 'http://localhost:4799/?cards=60', '.svelte-flow__node[data-id="app25"]'],
  ['JointJS', 'http://localhost:4797/?cards=60', '[data-card="app25"]'],
  ['diagram-js', 'http://localhost:4796/?cards=60', '[data-card="app25"]'],
]) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  await page.goto(url);
  await page.waitForSelector(card);
  await page.waitForTimeout(1500);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
  const box = await page.locator(card).boundingBox();
  await page.evaluate(() => {
    window.gaps = [];
    let last = performance.now();
    const tick = now => {
      window.gaps.push(now - last);
      last = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.mouse.move(box.x + box.width / 2, box.y + 6);
  await page.mouse.down();
  for (let step = 0; step < 120; step++) await page.mouse.move(box.x + box.width / 2 + step * 2, box.y + 6 + step);
  await page.mouse.up();
  const gaps = (await page.evaluate(() => window.gaps)).sort((a, b) => a - b);
  const late = gaps.filter(gap => gap > 20).length;
  console.log(
    `${name}: median ${gaps[gaps.length >> 1].toFixed(1)} ms, worst ${gaps.at(-1).toFixed(1)} ms, ${late} of ${gaps.length} frames late`,
  );
  await page.close();
}
await browser.close();
