// Drives the spike in a browser: `npx vite spike --port 4799`, then `node spike/check.mjs`. Screenshots go to spike/shots.
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

// `SPIKE=joint` checks the JointJS spike (`npx vite spike-joint --port 4797`) with the same steps.
const joint = process.env.SPIKE === 'joint';
const URL = process.env.SPIKE_URL ?? (joint ? 'http://localhost:4797/' : 'http://localhost:4799/');
const shots = joint ? 'spike-joint/shots' : 'spike/shots';
const cardSel = id => (joint ? `[data-card="${id}"]` : `.svelte-flow__node[data-id="${id}"]`);
const cableSel = id => (joint ? `[data-cable="${id}"]` : `.svelte-flow__edge[data-id="${id}"]`);
const socketSel = joint ? '.end.to' : '.ends .socket';
const zoomOutSel = joint ? '[data-zoom-out]' : '.svelte-flow__controls-zoomout';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => m.type() === 'error' && errors.push(m.text()));
const shot = name => page.screenshot({ path: `${shots}/${name}.png` });
const edges = () => page.evaluate(() => board.edges.map(e => ({ ...e, ...e.data })));
const end = (id, which) =>
  page.evaluate(
    ([id, which]) => {
      if (board.endScreen) return board.endScreen(id, which);
      const at = board.endPoint(
        board.edges.findIndex(e => e.id === id),
        which,
      );
      const { x, y } = document.querySelector('.svelte-flow__viewport').getBoundingClientRect();
      const zoom = board.zoom();
      return { x: x + at.x * zoom, y: y + at.y * zoom, flow: at };
    },
    [id, which],
  );
const centre = async id => {
  const box = await page.locator(cardSel(id)).boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
};

await page.goto(URL);
await page.waitForSelector(socketSel);
await page.waitForTimeout(400);
await shot('1-start');

// Two cables enter Orders API from above: they fan out along that side.
let a = await end('mobile>orders', 'to'),
  b = await end('web>orders', 'to');
assert.ok(a.flow.x < b.flow.x && a.flow.y === b.flow.y, 'two sockets side by side on one side');

// Sliding one socket past the other reorders them, live.
await page.mouse.move(a.x, a.y);
await page.mouse.down();
await page.mouse.move(a.x + 12, a.y, { steps: 3 });
await page.mouse.move(b.x + 20, b.y, { steps: 6 });
await shot('2-sliding');
await page.mouse.up();
a = await end('mobile>orders', 'to');
b = await end('web>orders', 'to');
assert.ok(a.flow.x > b.flow.x, 'the slid socket is now on the other side of its neighbour');
assert.equal((await edges()).length, 5, 'sliding adds no cable');

// Pulling an occupied socket away from its side starts a new cable from that port.
const web = await centre('web');
await page.mouse.move(b.x, b.y);
await page.mouse.down();
await page.mouse.move(b.x, b.y - 30, { steps: 4 });
await page.mouse.move(web.x, web.y, { steps: 8 });
await shot('3-from-occupied');
await page.mouse.up();
assert.ok(
  (await edges()).some(e => e.id === 'orders>web' && e.fromSide === 'top'),
  'a cable from the occupied port',
);

// From a free port, through two waypoints on the empty board, onto another card.
const pay = await centre('payments'),
  cat = await centre('catalog');
await page.mouse.move(pay.x, pay.y);
const port = await page.locator(`${cardSel('payments')} .port.bottom`).boundingBox();
await page.mouse.move(port.x + 8, port.y + 8);
await page.mouse.down();
await page.mouse.move(pay.x + 60, pay.box.y + pay.box.height + 70, { steps: 5 });
await page.mouse.up();
await page.mouse.move(cat.x - 120, cat.box.y + cat.box.height + 90, { steps: 5 });
await page.mouse.down();
await page.mouse.up();
await page.mouse.move(cat.x, cat.box.y + cat.box.height + 60, { steps: 5 });
await shot('4-waypoints');
await page.mouse.move(cat.x, cat.y, { steps: 5 });
await page.mouse.down();
await page.mouse.up();
const drawn = (await edges()).find(e => e.id === 'payments>catalog');
assert.equal(drawn?.points?.length, 2, 'the cable keeps its two waypoints');
await page.waitForTimeout(200);
assert.equal(
  await page.evaluate(() => board.nodes.some(n => n.selected)),
  false,
  'ending a cable on a card does not pick the card',
);
await shot('5-drawn');

// Escape cancels a cable being drawn.
await page.mouse.move(port.x + 8, port.y + 8);
await page.mouse.down();
await page.mouse.move(port.x + 200, port.y + 120, { steps: 4 });
await page.mouse.up();
await page.keyboard.press('Escape');
assert.equal(await page.evaluate(() => board.draft), null, 'Escape drops the draft');
const count = (await edges()).length;

// Keyboard: a card is reached with Tab, picked with Enter and moved with the arrows; a cable is reached with Tab and removed with Backspace.
const before = await page.evaluate(() => board.nodes.find(n => n.id === 'mobile').position);
await page.locator(cardSel('mobile')).focus();
await page.keyboard.press('Enter');
await page.keyboard.press('ArrowLeft');
await page.keyboard.press('ArrowLeft');
const after = await page.evaluate(() => board.nodes.find(n => n.id === 'mobile').position);
assert.ok(after.x < before.x, 'arrow keys move a focused card');
await page.locator(cableSel('orders>web')).focus();
await page.keyboard.press('Enter');
await page.keyboard.press('Backspace');
assert.equal((await edges()).length, count - 1, 'Backspace removes the selected cable');
await shot('6-keyboard');

// Arrange places the cards and orders the sockets.
await page.getByRole('button', { name: 'Arrange' }).click();
await page.waitForTimeout(600);
await shot('7-arranged');

// Zoomed out, a card shows its short form.
await page.locator(zoomOutSel).click();
await page.locator(zoomOutSel).click();
await page.locator(zoomOutSel).click();
await page.waitForTimeout(500);
await shot('8-far');

// Redraw cost: 60 cards and 150 cables, one card dragged across the board.
await page.goto(`${URL}?cards=60`);
await page.waitForSelector(socketSel);
await page.waitForTimeout(500);
const drag = await centre('app25');
await page.evaluate(() => {
  window.frames_ = [];
  let last = performance.now();
  const tick = now => {
    window.frames_.push(now - last);
    last = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
await page.mouse.move(drag.x, drag.box.y + 10);
await page.mouse.down();
for (let step = 0; step < 120; step++) {
  await page.mouse.move(drag.x + step * 2, drag.box.y + 10 + step);
}
await page.mouse.up();
const frames = (await page.evaluate(() => window.frames_)).sort((x, y) => x - y);
console.log(
  `60 cards: ${frames.length} frames, median ${frames[frames.length >> 1].toFixed(1)} ms, worst ${frames.at(-1).toFixed(1)} ms`,
);
await shot('9-sixty');

assert.deepEqual(errors, [], 'no errors on the page');
await browser.close();
console.log('spike check passed');
