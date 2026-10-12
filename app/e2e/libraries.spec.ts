// A library an app depends on, cloned here: the card can run the app with the local copy.
import { test, expect } from './canvas.ts';

test.use({
  libraries: { web: ['acme-ui'] },
  board: { env: 'qa', mode: 'auto', nodes: { web: { x: 0, y: 0, run: 'cli', branch: 'main' } }, edges: [] },
});

test('the choice to use a local library is on the saved board, for another browser too', async ({
  page,
  canvas,
  browser,
}) => {
  const local = (on: typeof page) =>
    on.locator('.node[data-id="web"]').getByRole('switch', { name: 'Use the local acme-ui' });
  await expect(local(page)).not.toBeChecked();
  const saved = page.waitForResponse(r => r.url().includes('/state?') && r.request().method() === 'POST' && r.ok());
  await local(page).check();
  await saved;
  // A browser that never had the page open has only the server's copy of the board.
  const other = await browser.newContext();
  const fresh = await other.newPage();
  await fresh.goto(canvas.url);
  await expect(local(fresh)).toBeChecked();
  await other.close();
});
