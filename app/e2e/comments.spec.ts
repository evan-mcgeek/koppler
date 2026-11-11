// Comments on a feature board: a thread on a card or a step, which the agent answers, with a step to keep or undo.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { at, card, expect, sent, STACK, test } from './canvas.ts';

const koppler = ({ dir, temp }: { dir: string; temp: string }, ...args: string[]) => {
  const entry = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'koppler.mjs');
  const env: Record<string, string | undefined> = {
    ...process.env,
    KOPPLER_STATE: path.join(dir, 'state'),
    KOPPLER_TEMP: temp,
    KOPPLER_CONFIG_DIR: path.join(dir, 'config'),
  };
  delete env['CLAUDE_CODE_SESSION_ID'];
  const run = spawnSync(process.execPath, [entry, ...args], { encoding: 'utf8', env });
  expect(run.status, run.stderr).toBe(0);
  return run.stdout;
};
const flow = (name: string) => ({
  name,
  version: 1,
  nodes: {},
  edges: [],
  feature: {
    request: 'How a customer pays',
    cards: [],
    phases: [
      {
        name: 'Pay',
        steps: [
          { from: 'web', to: 'orders', kind: 'call' },
          { from: 'orders', to: 'payments', kind: 'call' },
        ],
      },
    ],
  },
});
const stack = { ...STACK, presets: [...(STACK.presets ?? []), flow('Team pay')] };
test.use({
  stack,
  board: {
    env: 'qa',
    mode: 'auto',
    zoom: 1,
    pan: { x: 60, y: 60 },
    nodes: { web: at(0, 0) },
    edges: [],
    presets: [flow('My pay')],
  },
});

const open = async (page: import('@playwright/test').Page, name: string) => {
  await expect(card(page, 'web')).toBeVisible();
  await page.keyboard.press('ControlOrMeta+1');
  await page.getByRole('complementary', { name: 'Discover' }).locator('.row').filter({ hasText: name }).click();
  await expect(page.getByRole('button', { name: `Board: ${name}` })).toBeVisible();
};

test('a comment on a card goes to the agent, whose answer brings a step to keep, and Resolve hides it', async ({
  page,
  canvas,
}) => {
  await open(page, 'My pay');
  const steps = page.getByRole('complementary', { name: 'My pay' });
  await steps.getByRole('button', { name: 'Comment', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Commenting' })).toContainText('Click a card or a step');
  await card(page, 'payments').click();
  const thread = page.getByRole('complementary', { name: 'Comment on Payments API' });
  await thread
    .getByRole('textbox', { name: 'Comment' })
    .fill("The provider's webhook back to Payments API is missing.");
  await thread.getByRole('button', { name: 'Comment', exact: true }).click();
  await expect(card(page, 'payments').getByRole('button', { name: '1 comment on Payments API' })).toBeVisible();
  await expect.poll(() => sent(canvas.temp).find(one => one.tag === 'koppler-comment')?.data['comment']).toMatch(/^c/);
  const id = String(sent(canvas.temp).find(one => one.tag === 'koppler-comment')?.data['comment']);

  // The agent answers in the thread, with a step it proposes.
  koppler(
    canvas,
    'board',
    'edit',
    'My pay',
    '--reply',
    `${id}=Found it: POST /webhooks/payment.`,
    '--phase',
    'Pay',
    '--propose-step',
    'orders:catalog',
  );
  await expect(thread).toContainText('Found it: POST /webhooks/payment.');
  await thread.getByRole('button', { name: 'Keep step 1.3' }).click();
  await expect(thread.getByRole('button', { name: /^Keep step/ })).toHaveCount(0);
  await expect(steps.locator('.step').nth(2)).not.toHaveClass(/proposed/);
  await page.screenshot({ path: 'test-results/comment-thread.png' });
  await thread.getByRole('button', { name: 'Resolve' }).click();
  await expect(card(page, 'payments').getByRole('button', { name: /comment on Payments API/ })).toHaveCount(0);
});

test("a team board's comment on a step is kept in the stack for the team, and makes no copy of your own", async ({
  page,
  canvas,
}) => {
  fs.mkdirSync(path.join(canvas.dir, 'stack'), { recursive: true });
  fs.mkdirSync(path.join(canvas.dir, 'config'), { recursive: true });
  const file = path.join(canvas.dir, 'stack', 'stack.json');
  fs.writeFileSync(file, JSON.stringify(stack));
  fs.writeFileSync(
    path.join(canvas.dir, 'config', 'config.json'),
    JSON.stringify({ stack: path.join(canvas.dir, 'stack') }),
  );
  await open(page, 'Team pay');
  const steps = page.getByRole('complementary', { name: 'Team pay' });
  await steps.getByRole('button', { name: 'Comment', exact: true }).click();
  await steps.getByRole('button', { name: 'Comment on step 1.2' }).click();
  const thread = page.getByRole('complementary', { name: 'Comment on the step Orders API to Payments API in Pay' });
  await thread.getByRole('textbox', { name: 'Comment' }).fill('Which route does it take?');
  await thread.getByRole('button', { name: 'Comment', exact: true }).click();
  await expect
    .poll(
      () =>
        (
          JSON.parse(fs.readFileSync(file, 'utf8')) as {
            presets: { name: string; feature?: { comments?: unknown[] } }[];
          }
        ).presets.find(one => one.name === 'Team pay')?.feature?.comments?.length,
    )
    .toBe(1);
  await expect(steps.getByRole('button', { name: '1 comment on step 1.2' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Board: Team pay' })).toBeVisible();
  // The board menu counts it, and no "(local)" copy was made.
  await page.getByRole('button', { name: /^Board:/ }).click();
  const menu = page.getByRole('dialog', { name: 'Boards' });
  await expect(menu.locator('.row').filter({ hasText: 'Team pay' })).toHaveCount(1);
  await expect(menu.locator('.row').filter({ hasText: 'Team pay' }).locator('.talks')).toHaveText('1');
});

test('Share leaves comments out unless asked, and the page shows them to read only', async ({ page }, testInfo) => {
  await open(page, 'My pay');
  await page
    .getByRole('complementary', { name: 'My pay' })
    .getByRole('button', { name: 'Comment', exact: true })
    .click();
  await card(page, 'orders').click();
  const thread = page.getByRole('complementary', { name: 'Comment on Orders API' });
  await thread.getByRole('textbox', { name: 'Comment' }).fill('Does it keep the basket?');
  await thread.getByRole('button', { name: 'Comment', exact: true }).click();
  await page.getByRole('banner').getByRole('button', { name: 'Share', exact: true }).click();
  const pop = page.getByRole('dialog', { name: 'Share My pay, view only' });
  await expect(pop.getByRole('radio', { name: 'Leave out' })).toBeChecked();
  await pop.getByRole('radio', { name: 'Include' }).check();
  const saving = page.waitForEvent('download');
  await pop.getByRole('button', { name: 'Save the page' }).click();
  const file = testInfo.outputPath((await saving).suggestedFilename());
  await (await saving).saveAs(file);
  await page.route('**/*', route => (route.request().url().startsWith('file:') ? route.continue() : route.abort()));
  await page.goto(`file://${file}`);
  await page.locator('.card[data-id="orders"]').click();
  await expect(page.getByRole('region', { name: 'Orders API' })).toContainText('Does it keep the basket?');
  await expect(page.getByRole('textbox')).toHaveCount(0);
});
