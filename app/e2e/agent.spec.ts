// The new canvas says whether an agent session listens, and how to connect one.
import { test, expect } from './canvas.ts';

test.use({
  board: { env: 'qa', mode: 'auto', nodes: { web: { x: 0, y: 0, run: 'cli', branch: 'main' } }, edges: [] },
});

test('with no agent the bar says so and shows how to connect one; a connected agent shows as such', async ({
  page,
}) => {
  const chip = page.locator('header .agent');
  const how = page.getByRole('button', { name: 'How to connect an agent' });
  await expect(chip).toHaveText('No agent');
  await how.click();
  const steps = page.getByRole('dialog', { name: 'Connect an agent' });
  await expect(steps.locator('code')).toHaveText('/koppler-run connect');
  await page.screenshot({ path: 'test-results/next-agent.png' });
  // Where the browser blocks copying, the box says so instead of claiming it copied.
  await steps.getByRole('button', { name: 'Copy' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Copy is blocked here' })).toBeVisible();
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await steps.getByRole('button', { name: 'Copy' }).click();
  await expect(steps.getByRole('button', { name: 'Copied' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('/koppler-run connect');

  // Something waits for an agent: the bar warns, with how many.
  let status: object = { apps: {}, agent: { state: 'none' }, queued: 2 };
  await page.route('**/data/status.json', route => route.fulfill({ json: status }));
  await expect(chip).toHaveText('No agent listening, 2 waiting');
  await expect(chip).toHaveAttribute('data-state', 'none');

  // One connects: the steps close by themselves and the button for them goes.
  status = { apps: {}, agent: { state: 'listening' }, queued: 0 };
  await expect(chip).toHaveText('Agent');
  await expect(chip).toHaveAttribute('title', /^Agent connected\./);
  await expect(steps).toBeHidden();
  await expect(how).toHaveCount(0);

  status = { apps: {}, agent: { state: 'busy' }, queued: 1 };
  await expect(chip).toHaveText('Agent working, 1 waiting');
  const ago = (minutes: number) => new Date(Date.now() - minutes * 60000).toISOString();
  status = { apps: {}, agent: { state: 'busy', busy: ago(3) } };
  await expect(chip).toHaveText('Agent working, 3 min');

  // Working long with no word and no listener: most likely it stopped, and the bar says how to reconnect.
  status = { apps: {}, agent: { state: 'busy', busy: ago(14) } };
  await expect(chip).toHaveText('Agent quiet, 14 min');
  await expect(chip).toHaveAttribute('data-state', 'quiet');
  await expect(chip).toHaveAttribute('title', /run \/koppler-run connect there/);
  await how.click();
  await expect(steps).toBeVisible();
  await page.screenshot({ path: 'test-results/next-agent-quiet.png' });
});
