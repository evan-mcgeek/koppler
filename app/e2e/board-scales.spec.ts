// Zoomed across, the board only scales: no card moves, short ones sit in the middle of their full form's room, and a
// card that came out wider than its place moves off the app card it would cover.
import type { Page } from '@playwright/test';
import { at, expect, STACK, test } from './canvas.ts';

test.use({
  stack: {
    ...STACK,
    apps: {
      ...STACK.apps,
      psp: { name: 'Pay Provider', kind: 'other', outside: 'sends webhooks', consumes: { orders: {} } },
    },
  },
  board: {
    env: 'qa',
    mode: 'auto',
    zoom: 1,
    pan: { x: 40, y: 40 },
    nodes: {
      web: at(0, 0),
      orders: { ...at(520, 0), note: 'Seed two test orders after it starts, and keep the sandbox webhook here.' },
      payments: at(520, 700),
    },
    edges: [{ from: 'web', to: 'orders', fromSide: 'right', toSide: 'left' }],
    // Laid out when the outside card was narrower: as drawn now it would lie on Orders API.
    infra: { 'outside:psp': { x: 400, y: 0 } },
  },
});

/** Each card's middle, on the board. */
const middles = (page: Page) =>
  page.evaluate((): Record<string, [number, number]> => {
    const view = document.querySelector<HTMLElement>('.svelte-flow__viewport');
    const pane = view?.closest('.svelte-flow')?.getBoundingClientRect();
    const [, x = 0, y = 0, k = 1] =
      /translate\(([-\d.]+)px, *([-\d.]+)px\) scale\(([\d.]+)\)/.exec(view?.style.transform ?? '')?.map(Number) ?? [];
    return Object.fromEntries(
      [...document.querySelectorAll('.svelte-flow__node')].map(node => {
        const box = node.getBoundingClientRect();
        const middle = (at: number, size: number, from: number, by: number) =>
          Math.round((at + size / 2 - from - by) / k);
        return [
          node.getAttribute('data-id') ?? '',
          [middle(box.x, box.width, pane?.x ?? 0, x), middle(box.y, box.height, pane?.y ?? 0, y)],
        ];
      }),
    );
  });

test('zoomed out and back in, every card stays where it is, and none lies on another', async ({ page }) => {
  await expect(page.locator('.svelte-flow__node')).toHaveCount(5);
  const outside = page.locator('.svelte-flow__node[data-id="outside:psp"]');
  const orders = page.locator('.svelte-flow__node[data-id="orders"]');
  await expect
    .poll(async () => {
      const [a, b] = [await outside.boundingBox(), await orders.boundingBox()];
      return !!a && !!b && a.x + a.width <= b.x;
    }, 'the outside card moved off Orders API')
    .toBe(true);
  const close = await middles(page);
  const percent = page.getByTitle('Reset to 100%');
  // Each step waits for the one before it to land.
  const zoom = async (button: string, to: string[]) => {
    for (const want of to) {
      await page.getByRole('button', { name: button }).click();
      await expect(percent).toHaveText(want);
    }
  };
  await zoom('Zoom out', ['83%', '69%', '58%', '48%', '40%']);
  await expect(page.locator('.svelte-flow__node-app .short').first()).toBeVisible();
  const far = await middles(page);
  for (const [id, [x, y]] of Object.entries(close)) {
    expect(Math.abs((far[id]?.[0] ?? 0) - x), `${id} across`).toBeLessThanOrEqual(1);
    expect(Math.abs((far[id]?.[1] ?? 0) - y), `${id} down`).toBeLessThanOrEqual(1);
  }
  await zoom('Zoom in', ['48%', '58%', '69%', '83%', '100%']);
  await expect.poll(() => middles(page)).toEqual(close);
});
