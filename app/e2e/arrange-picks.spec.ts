// Escape lets go of the pick, so Arrange, which keeps a pick, opens no panel nobody asked for.
import { expect, test } from './canvas.ts';

test.use({
  // At this size Arrange fits three cards below the zoom where a picked card's choices open beside the board.
  viewport: { width: 1440, height: 810 },
  board: { env: 'qa', mode: 'auto', zoom: 0.83, pan: { x: 40, y: 40 }, nodes: {}, edges: [] },
});

test('Escape after plugging cables lets go of the pick, and Arrange then opens no card', async ({ page }) => {
  const card = (id: string) => page.locator(`.svelte-flow__node[data-id="${id}"]`);
  const picked = page.locator('.svelte-flow__node.selected');
  for (const name of ['Web Shop', 'Orders API', 'Payments API']) {
    const row = page.getByRole('complementary').getByRole('listitem').filter({ hasText: name }).first();
    await row.hover();
    await row.getByRole('button', { name: `Add ${name} to the board` }).click();
  }
  // Pressing a card's port to draw a cable gives that card the keyboard focus.
  const plug = async (from: string, to: string) => {
    await card(from).hover();
    const port = await card(from).locator('.port.right').boundingBox();
    const onto = await card(to).boundingBox();
    if (!port || !onto) throw new Error('not on the page');
    await page.mouse.move(port.x + port.width / 2, port.y + port.height / 2);
    await page.mouse.down();
    await page.mouse.move(onto.x + onto.width / 2, onto.y + onto.height / 2, { steps: 12 });
    await page.mouse.up();
  };
  await plug('web', 'orders');
  await plug('orders', 'payments');
  await expect(page.locator('.svelte-flow__edge')).toHaveCount(2);
  // The last app added is the one picked.
  await expect(picked).toHaveAttribute('data-id', 'payments');
  await page.keyboard.press('Escape');
  await expect(picked).toHaveCount(0);

  await page.getByRole('button', { name: 'Arrange', exact: true }).click();
  await expect(page.locator('.map[data-moving]')).toHaveCount(0);
  await expect(page.locator('.zoom .percent')).toHaveText('59%');
  for (const name of ['Web Shop', 'Orders API', 'Payments API'])
    await expect(page.getByRole('complementary', { name })).toHaveCount(0);
});
