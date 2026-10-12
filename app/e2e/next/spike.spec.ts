// Spike only: Svelte Flow extras tried in the real canvas. Not for merging.
import type { Page } from '@playwright/test';
import { test, expect, STACK } from '../canvas.ts';

const card = (page: Page, id: string) => page.locator(`.svelte-flow__node[data-id="${id}"]`);
const at = (x: number, y: number) => ({ x, y, run: 'cli', branch: 'main' });
const board = {
  env: 'qa',
  mode: 'auto',
  zoom: 0.8,
  pan: { x: 80, y: 60 },
  nodes: { web: at(0, 0), orders: at(420, 0), payments: at(840, 120) },
  edges: [
    { from: 'web', to: 'orders', fromSide: 'right', toSide: 'left' },
    { from: 'orders', to: 'payments', fromSide: 'right', toSide: 'left' },
  ],
};

test.describe('minimap, toolbars, grid', () => {
  test.use({ start: 'next/?try=minimap,toolbar,snap', board });

  test('minimap and toolbars', async ({ page }) => {
    await expect(card(page, 'orders')).toBeVisible();
    await expect(page.locator('.svelte-flow__minimap')).toBeVisible();
    await page.screenshot({ path: 'test-results/spike-minimap.png' });
    // A picked card shows its bar; the keyboard reaches it.
    await card(page, 'orders').focus();
    await expect(page.getByRole('button', { name: 'Remove', exact: true })).toBeVisible();
    await page.screenshot({ path: 'test-results/spike-node-toolbar.png' });
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => document.activeElement?.textContent?.trim().slice(0, 40));
    console.log('SPIKE after Tab from a picked card, focus is on:', JSON.stringify(focused));
    // A picked cable shows its bar.
    await page.locator('.svelte-flow__edge[data-id="web>orders"]').focus();
    await page.keyboard.press('Enter');
    const test = page.getByRole('button', { name: 'Test', exact: true });
    await page.waitForTimeout(400);
    console.log('SPIKE edge toolbar visible:', await test.isVisible(), 'edge selected class:', await page.locator('.svelte-flow__edge[data-id="web>orders"]').getAttribute('class'));
    console.log('SPIKE toolbar nodes in DOM:', await page.locator('.svelte-flow__edge-toolbar').count());
    await page.keyboard.press('Tab');
    console.log('SPIKE after Tab from a picked cable, focus is on:', JSON.stringify(await page.evaluate(() => document.activeElement?.textContent?.trim().slice(0, 40))));
    await page.screenshot({ path: 'test-results/spike-edge-toolbar.png' });
  });

  test('grid', async ({ page }) => {
    const box = await card(page, 'web').boundingBox();
    if (!box) throw new Error('no card');
    await page.mouse.move(box.x + 60, box.y + 12);
    await page.mouse.down();
    await page.mouse.move(box.x + 60 + 37, box.y + 12 + 53, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(900);
    const kept = (await (await page.request.get(new URL('../data/state.json', page.url()).href)).json()) as {
      nodes: Record<string, { x: number; y: number }>;
    };
    console.log('SPIKE grid: web landed at', JSON.stringify(kept.nodes['web']));
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(900);
    const stepped = (await (await page.request.get(new URL('../data/state.json', page.url()).href)).json()) as typeof kept;
    console.log('SPIKE grid: after ArrowRight', JSON.stringify(stepped.nodes['web']));
  });
});

const many = Object.fromEntries(
  Array.from({ length: 60 }, (_, index) => [
    `app${String(index)}`,
    { name: `App ${String(index)}`, kind: 'node', slug: `acme/app${String(index)}`, url: `http://localhost:${String(6000 + index)}` },
  ]),
);
const bigBoard = {
  env: 'qa',
  mode: 'auto',
  zoom: 1,
  pan: { x: 0, y: 0 },
  nodes: Object.fromEntries(Object.keys(many).map((id, index) => [id, at((index % 10) * 340, Math.floor(index / 10) * 300)])),
  edges: Object.keys(many)
    .slice(1)
    .map((id, index) => ({ from: `app${String(index)}`, to: id, fromSide: 'right', toSide: 'left' })),
};
for (const mode of ['', 'visible'])
  test.describe(`60 cards ${mode || 'as today'}`, () => {
    test.use({ start: `next/?try=${mode}`, stack: { ...STACK, apps: many, presets: [] }, board: bigBoard });

    test('drawing', async ({ page }) => {
      await expect(page.locator('.svelte-flow__node-app').first()).toBeVisible();
      await page.waitForTimeout(500);
      const cards = await page.locator('.svelte-flow__node-app').count();
      const edges = await page.locator('.svelte-flow__edge').count();
      const elements = await page.evaluate(() => document.querySelectorAll('.svelte-flow *').length);
      // Pan across the board and count frames that took longer than 20 ms.
      const frames = await page.evaluate(async () => {
        const pane = document.querySelector('.svelte-flow__pane') as HTMLElement;
        const times: number[] = [];
        let last = performance.now();
        for (let step = 0; step < 90; step++) {
          pane.dispatchEvent(new WheelEvent('wheel', { deltaX: 40, deltaY: 25, bubbles: true, cancelable: true, clientX: 700, clientY: 400 }));
          await new Promise(requestAnimationFrame);
          const now = performance.now();
          times.push(now - last);
          last = now;
        }
        times.sort((a, b) => a - b);
        return { slow: times.filter(ms => ms > 20).length, p95: Math.round(times[Math.floor(times.length * 0.95)] ?? 0) };
      });
      console.log(`SPIKE 60 cards ${mode || 'as today'}: cards in DOM ${String(cards)}, cables ${String(edges)}, elements ${String(elements)}, slow frames ${String(frames.slow)}/90, p95 ${String(frames.p95)} ms`);
    });
  });
