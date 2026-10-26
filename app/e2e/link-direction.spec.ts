// Which way a link goes: it leaves its sender as a dot and lands in the receiver's ring, a chevron pointing in.
import type { Page } from '@playwright/test';
import { card, expect, STACK, test } from './canvas.ts';

const at = (x: number, y: number) => ({ x, y, run: 'cli', branch: 'main', showQueues: true });
test.use({
  stack: {
    ...STACK,
    queues: { 'order-events': { name: 'Order events', type: 'sqs' } },
    apps: {
      ...STACK.apps,
      orders: { ...STACK.apps.orders, publishes: { 'order-events': {} } },
      payments: { ...STACK.apps.payments, reads: { 'order-events': {} } },
    },
  },
  board: {
    env: 'qa',
    mode: 'auto',
    zoom: 1,
    pan: { x: 20, y: 120 },
    nodes: { web: at(0, 0), orders: at(330, 0), payments: at(1000, 0) },
    edges: [{ from: 'web', to: 'orders' }],
  },
});

/** Where each end of a link lies, and what is drawn there, in the page's coordinates. */
const ends = (page: Page, key: string) =>
  page.locator(`.links .flow[data-link="${key}"]`).evaluate(group => {
    const at = (el: Element | null) => {
      const box = el?.getBoundingClientRect();
      return box ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : null;
    };
    return {
      start: at(group.querySelector('circle.dot')),
      ring: at(group.querySelector('circle.ring')),
      arrow: !!group.querySelector('path.arrow'),
    };
  });
const middle = async (page: Page, id: string) => {
  const box = await card(page, id).boundingBox();
  if (!box) throw new Error('not drawn');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};
type Point = { x: number; y: number };
const near = (a: Point | null, b: Point, c: Point) =>
  !!a && Math.hypot(a.x - b.x, a.y - b.y) < Math.hypot(a.x - c.x, a.y - c.y);

test('a publish lands in the queue and a read in the app, each with a chevron; a cable too', async ({ page }) => {
  const queue = page.locator('.svelte-flow__node-queue');
  await expect(queue).toBeVisible();
  const box = await queue.boundingBox();
  if (!box) throw new Error('not drawn');
  const q = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const [orders, payments] = [await middle(page, 'orders'), await middle(page, 'payments')];
  const publish = await ends(page, 'orders>queue:order-events');
  expect(publish.arrow).toBe(true);
  expect(near(publish.start, orders, q)).toBe(true);
  expect(near(publish.ring, q, orders)).toBe(true);
  const read = await ends(page, 'queue:order-events>payments');
  expect(read.arrow).toBe(true);
  expect(near(read.start, q, payments)).toBe(true);
  expect(near(read.ring, payments, q)).toBe(true);
  // A cable between two apps: a dot where it leaves, a chevron by the socket it plugs into.
  await expect(page.locator('.svelte-flow__edge[data-id="web>orders"] path.head')).toBeVisible();
  await expect(page.locator('.ends circle.plug')).toHaveAttribute('r', '3.5');
  await page.screenshot({ path: 'test-results/link-direction.png' });
});

test('picking traces: the links of the picked cards say what they do, and Shift-click adds a card', async ({
  page,
}) => {
  const queue = page.locator('.svelte-flow__node-queue');
  await queue.click({ position: { x: 40, y: 12 } });
  const verbs = page.locator('.links .flow .verb text');
  await expect(verbs).toHaveText(['publishes', 'reads']);
  await expect(page.locator('.svelte-flow__node[data-id="web"] .dimmed')).toHaveCount(1);
  await card(page, 'web')
    .locator('header')
    .click({ modifiers: ['Shift'] });
  await expect(page.locator('.svelte-flow__edge[data-id="web>orders"] .verb text')).toHaveText('calls');
  await expect(verbs).toHaveText(['publishes', 'reads']);
  await page.screenshot({ path: 'test-results/link-direction-picked.png' });
});

test('pointed at, a link says who does what', async ({ page }) => {
  await expect(page.locator('.links .flow[data-link="queue:order-events>payments"] .hit title')).toHaveText(
    'Payments API reads Order events',
  );
  await expect(page.locator('.links .flow[data-link="orders>queue:order-events"] .hit title')).toHaveText(
    'Orders API publishes to Order events',
  );
});
