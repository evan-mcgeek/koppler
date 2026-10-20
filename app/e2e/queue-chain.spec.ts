// A topic only one app on the board publishes is that app's own card and moves with it, unless it feeds another queue
// on the board: then it is part of the flow between apps, and stays where it is.
import type { Page } from '@playwright/test';
import { card, expect, STACK, test } from './canvas.ts';

const queue = (page: Page, name: string) => page.locator('.svelte-flow__node-queue').filter({ hasText: name });
const at = (x: number, y: number) => ({ x, y, run: 'cli', branch: 'main', showQueues: true });
test.use({
  stack: {
    ...STACK,
    queues: {
      'catalog-topic': { name: 'Catalog topic', type: 'kafka', feeds: { 'catalog-bus': { via: 'pipe' } } },
      'catalog-bus': { name: 'Catalog bus', type: 'eventbridge' },
      'web-only': { name: 'Web only', type: 'kafka' },
    },
    apps: {
      ...STACK.apps,
      web: { ...STACK.apps['web'], publishes: { 'catalog-topic': {}, 'web-only': {} } },
      catalog: { ...STACK.apps['catalog'], reads: { 'catalog-bus': {} } },
    },
  },
  board: {
    env: 'qa',
    mode: 'auto',
    zoom: 0.7,
    pan: { x: 60, y: 200 },
    nodes: { web: at(0, 0), catalog: at(900, 0) },
    edges: [],
  },
});

test('dragging the app that publishes a topic leaves the topic that feeds another queue, and takes its own', async ({
  page,
}) => {
  const chained = queue(page, 'Catalog topic');
  const own = queue(page, 'Web only');
  await expect(chained).toBeVisible();
  await expect(own).toBeVisible();
  const [chainedBefore, ownBefore, app] = await Promise.all([
    chained.boundingBox(),
    own.boundingBox(),
    card(page, 'web').boundingBox(),
  ]);
  if (!chainedBefore || !ownBefore || !app) throw new Error('not on the page');
  await page.mouse.move(app.x + 80, app.y + 14);
  await page.mouse.down();
  await page.mouse.move(app.x + 80, app.y + 114, { steps: 8 });
  await page.mouse.up();
  const moved = async () => Math.round(((await card(page, 'web').boundingBox())?.y ?? 0) - app.y);
  await expect.poll(moved).toBeGreaterThan(40);
  const by = await moved();
  await expect.poll(async () => Math.round(((await own.boundingBox())?.y ?? 0) - ownBefore.y)).toBe(by);
  expect(await chained.boundingBox()).toEqual(chainedBefore);
});
