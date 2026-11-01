// Settings for a part of the stack, from the gear beside it: every field shown, each change checked and kept, locks.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { actions, at, expect, STACK, test, fromMenu } from './canvas.ts';

test.use({
  board: { env: 'qa', mode: 'auto', zoom: 1, pan: { x: 60, y: 60 }, nodes: { orders: at(0, 0) }, edges: [] },
});
// The stack file itself, as `koppler init` would have set it up: the panel changes it.
const stackFile = (dir: string) => {
  fs.mkdirSync(path.join(dir, 'stack'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'stack', 'stack.json'), JSON.stringify(STACK));
  fs.writeFileSync(path.join(dir, 'config', 'config.json'), JSON.stringify({ stack: path.join(dir, 'stack') }));
  return () =>
    JSON.parse(fs.readFileSync(path.join(dir, 'stack', 'stack.json'), 'utf8')) as {
      apps: Record<string, Record<string, unknown>>;
    };
};

const tabOf = (page: Page, name: string) => page.getByRole('tab', { name });

test('an app card opens its settings: edits wait for Save, a broken one is refused with where, and a lock holds', async ({
  page,
  canvas,
}) => {
  const read = stackFile(canvas.dir);
  await (await actions(page, 'orders')).getByRole('button', { name: 'Settings for Orders API' }).click();
  const panel = page.getByRole('dialog', { name: 'Orders API' });
  await expect(tabOf(page, 'Runs here')).toHaveAttribute('aria-selected', 'true');
  const url = panel.getByLabel('URL', { exact: true });
  await expect(url).toHaveValue('http://localhost:5001');
  await page.screenshot({ path: 'test-results/next-settings.png' });

  await url.fill('http://localhost:5011');
  await url.press('Tab');
  await expect(panel.getByRole('status')).toHaveText('1 change · URL');
  await expect(tabOf(page, 'Runs here')).toContainText('1');
  expect(read().apps['orders']?.['url']).toBe('http://localhost:5001');
  await panel.getByRole('button', { name: 'Discard' }).click();
  await expect(url).toHaveValue('http://localhost:5001');

  await url.fill('http://localhost:5011');
  await url.press('Tab');
  await tabOf(page, 'Identity').click();
  const name = panel.getByLabel('Name', { exact: true });
  await expect(name).toHaveValue('Orders API');
  await name.fill('');
  await name.press('Tab');
  await panel.getByRole('button', { name: 'Save' }).click();
  await expect(panel.getByRole('alert')).toContainText('required');
  await expect(panel.getByRole('status')).toHaveText('1 to fix before it can be saved');
  expect(read().apps['orders']?.['url']).toBe('http://localhost:5001');
  await name.fill('Orders API');
  await name.press('Tab');
  await panel.getByRole('button', { name: 'Save' }).click();
  await expect(panel.getByRole('status')).toHaveText('Saved');
  expect(read().apps['orders']?.['url']).toBe('http://localhost:5011');
  await tabOf(page, 'Runs here').click();

  await panel.getByRole('button', { name: 'Lock URL', exact: true }).click();
  await expect(url).toBeDisabled();
  // Locked, a change from anywhere else is refused too.
  const refused = await page.evaluate(async () => {
    const token = location.pathname.split('/')[2] ?? '';
    const answer = await fetch(`/stack-edit?token=${token}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: 'apps.orders.url', value: 'http://evil.example' }),
    });
    return answer.json() as Promise<{ error?: string }>;
  });
  expect(refused.error).toMatch(/apps\.orders\.url is locked/);
  await panel.getByRole('button', { name: 'Unlock URL', exact: true }).click();
  await expect(url).toBeEnabled();
});

test('an environment uses its own value only where it is given one', async ({ page, canvas }) => {
  const read = stackFile(canvas.dir);
  await (await actions(page, 'orders')).getByRole('button', { name: 'Settings for Orders API' }).click();
  const panel = page.getByRole('dialog', { name: 'Orders API' });
  await tabOf(page, 'Environments').click();
  const prod = panel.getByRole('region', { name: 'What PROD uses' });
  await expect(prod).toContainText('Same as QA: https://orders-api.qa.acme.example');
  await prod.getByRole('button', { name: 'Change for PROD' }).first().click();
  const own = prod.getByLabel('Deployed URL', { exact: true });
  await expect(own).toHaveValue('https://orders-api.qa.acme.example');
  await own.fill('https://orders-api.acme.example');
  await own.press('Tab');
  await page.screenshot({ path: 'test-results/next-settings-envs.png' });
  await panel.getByRole('button', { name: 'Save' }).click();
  await expect(panel.getByRole('status')).toHaveText('Saved');
  const envs = read().apps['orders']?.['envs'] as Record<string, Record<string, unknown>>;
  expect(envs['prod']?.['deployedUrl']).toBe('https://orders-api.acme.example');
  await prod.getByRole('button', { name: "Use QA's" }).first().click();
  await expect(prod).toContainText('Same as QA: https://orders-api.qa.acme.example');
});

test('a need is a row that says what it is; a new one asks its type and shows only that type', async ({
  page,
  canvas,
}) => {
  const read = stackFile(canvas.dir);
  fs.writeFileSync(path.join(canvas.dir, 'aws-config'), '[profile acme-dev]\nregion = eu-west-1\n[default]\n');
  await (await actions(page, 'orders')).getByRole('button', { name: 'Settings for Orders API' }).click();
  const panel = page.getByRole('dialog', { name: 'Orders API' });
  await tabOf(page, 'Needs first').click();
  const needs = panel.getByRole('tabpanel');
  const tunnel = needs.locator('details.rowed').filter({ hasText: 'Database (Postgres), db.qa.acme.example:5432' });
  await expect(tunnel.locator('summary')).toContainText('Tunnel');
  await tunnel.locator('summary').click();
  await expect(tunnel.getByLabel('Tunnel to', { exact: true })).toHaveValue('db.qa.acme.example');
  await expect(tunnel.getByLabel('AWS profile')).toHaveCount(0);

  await needs.getByRole('button', { name: 'Add a need' }).click();
  const types = needs.getByRole('group', { name: 'What does it need?' });
  await expect(types.getByRole('button')).toHaveText([
    /Tunnel/,
    /AWS sign-in/,
    /Hosts entry/,
    /Stack sign-in.*defines none/,
    /HTTPS certificate/,
    /Private package feed/,
    'Cancel',
  ]);
  await types.getByRole('button', { name: /AWS sign-in/ }).click();
  const fresh = needs.getByRole('group', { name: 'New in Needs first' });
  await expect(fresh.getByLabel('Tunnel to', { exact: true })).toHaveCount(0);
  // The profiles of this Mac are offered by name.
  await fresh.getByLabel('AWS profile', { exact: true }).selectOption('acme-dev');
  await fresh.getByLabel('Account', { exact: true }).fill('123456789012');
  await fresh.getByLabel('Account', { exact: true }).press('Tab');
  await page.screenshot({ path: 'test-results/next-settings-needs.png' });
  await fresh.getByRole('button', { name: 'Keep' }).click();
  await expect(needs.locator('details.rowed').filter({ hasText: 'acme-dev, account 123456789012' })).toBeVisible();
  await expect(panel.getByRole('status')).toHaveText('1 change · Needs first');
  await panel.getByRole('button', { name: 'Close' }).click();
  await expect(panel.getByRole('alert')).toHaveText('Close without saving 1 change?');
  await panel.getByRole('button', { name: 'Keep editing' }).click();
  await panel.getByRole('button', { name: 'Save' }).click();
  await expect
    .poll(() => read().apps['orders']?.['prereqs'])
    .toEqual([
      { tunnel: 'db.qa.acme.example', port: 5432, what: 'Database (Postgres)' },
      { sso: 'acme-dev', account: '123456789012' },
    ]);
});

test('what Koppler knows is picked, not typed: the kind, the launch profile from the clone, the app it calls', async ({
  page,
  canvas,
}) => {
  const read = stackFile(canvas.dir);
  const clone = path.join(canvas.dir, 'clones', 'orders');
  fs.mkdirSync(path.join(clone, 'src', 'Api', 'Properties'), { recursive: true });
  fs.writeFileSync(path.join(clone, 'src', 'Api', 'Api.csproj'), '<Project />');
  fs.writeFileSync(
    path.join(clone, 'src', 'Api', 'Properties', 'launchSettings.json'),
    JSON.stringify({ profiles: { Local: {}, Qa: {} } }),
  );
  execFileSync('git', ['-C', clone, 'init', '-q']);
  execFileSync('git', ['-C', clone, 'add', '.']);
  await (await actions(page, 'orders')).getByRole('button', { name: 'Settings for Orders API' }).click();
  const panel = page.getByRole('dialog', { name: 'Orders API' });

  await tabOf(page, 'Identity').click();
  const kind = panel.getByLabel('Kind', { exact: true });
  await expect(kind).toHaveText('.NET');
  await kind.click();
  await page.screenshot({ path: 'test-results/next-settings-kind.png' });
  await panel.getByRole('option', { name: 'Node' }).click();
  await expect(kind).toHaveText('Node');
  await kind.click();
  await panel.getByRole('option', { name: '.NET' }).click();

  // Its own kind's fields; those of other kinds are folded away below.
  await tabOf(page, 'Runs here').click();
  const runs = panel.locator('.body > .field');
  await runs.getByLabel('Project', { exact: true }).selectOption('src/Api/Api.csproj');
  await panel.getByLabel('Launch settings', { exact: true }).selectOption('src/Api/Properties/launchSettings.json');
  await expect(panel.getByLabel('Base profile', { exact: true }).locator('option')).toHaveText([
    'Not set',
    'Local',
    'Qa',
    'Other…',
  ]);
  await panel.getByLabel('Base profile', { exact: true }).selectOption('Qa');
  const url = panel.getByLabel('URL', { exact: true });
  await expect(panel.getByText('Answers on port 5001 of this Mac')).toBeVisible();
  await url.fill('localhost:5001');
  await url.press('Tab');
  await expect(panel.getByText('Start it with http:// or https://')).toBeVisible();
  await url.fill('http://localhost:5001');
  await url.press('Tab');
  const ready = panel.getByRole('group', { name: 'Ready' });
  await ready.getByLabel('Path', { exact: true }).fill('/health');
  await ready.getByLabel('Path', { exact: true }).press('Tab');
  await ready.getByLabel('Status', { exact: true }).fill('200');
  await ready.getByLabel('Status', { exact: true }).press('Tab');
  await page.screenshot({ path: 'test-results/next-settings-runs.png' });

  await tabOf(page, 'Calls').click();
  const calls = panel.getByRole('tabpanel');
  const payments = calls.locator('details.rowed').filter({ hasText: 'Payments API' });
  await expect(payments.locator('summary')).toContainText('found by the setting Payments__Url');
  await payments.locator('summary').click();
  await payments.getByLabel('Finds it by', { exact: true }).selectOption({ label: 'An edit to its code' });
  await expect(payments.locator('summary')).toContainText('found by an edit to its code');
  await expect(payments.getByLabel('File', { exact: true })).toBeVisible();
  await expect(calls.getByLabel('Add to Calls').locator('option')).toHaveText(['Add an app it calls…', 'Web Shop']);
  await page.screenshot({ path: 'test-results/next-settings-calls.png' });

  await panel.getByRole('button', { name: 'Save' }).click();
  await expect(panel.getByRole('status')).toHaveText('Saved');
  const orders = read().apps['orders'] ?? {};
  expect(orders['baseProfile']).toBe('Qa');
  expect(orders['project']).toBe('src/Api/Api.csproj');
  expect(orders['ready']).toEqual({ path: '/health', status: 200 });
  expect((orders['consumes'] as Record<string, { how: string }>)['payments']?.how).toBe('edit');
});

test("the agent is asked to fill in an app's empty settings, leaving locked ones alone", async ({ page, canvas }) => {
  stackFile(canvas.dir);
  const sent: { tag?: string; text?: string; data?: { app?: string } }[] = [];
  await page.route('**/prompt?*', async route => {
    sent.push(route.request().postDataJSON() as (typeof sent)[number]);
    await route.fulfill({ json: { ok: true } });
  });
  await (await actions(page, 'orders')).getByRole('button', { name: 'Settings for Orders API' }).click();
  const panel = page.getByRole('dialog', { name: 'Orders API' });
  await tabOf(page, 'Deployed').click();
  await panel.getByRole('button', { name: 'Lock Deployed URL', exact: true }).click();
  // Asked once the lock is kept, so the request knows the field is locked.
  await expect(panel.getByRole('button', { name: 'Unlock Deployed URL', exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Ask the agent to fill in' }).click();
  await expect(panel.getByRole('button', { name: 'Asked the agent' })).toBeDisabled();
  expect(sent).toHaveLength(1);
  expect(sent[0]?.tag).toBe('koppler-facts');
  expect(sent[0]?.text).toContain('APP Orders API (orders)');
  expect(sent[0]?.text).toMatch(/EMPTY .*start/);
  expect(sent[0]?.text).toContain('LOCKED apps.orders.deployedUrl');
});

test('the stack has its own settings, in the Settings menu, with its apps a click away', async ({ page, canvas }) => {
  const read = stackFile(canvas.dir);
  await fromMenu(page, 'Settings', 'Stack settings');
  const panel = page.getByRole('dialog', { name: 'Acme Shop settings' });
  await tabOf(page, 'Identity').click();
  const name = panel.getByLabel('Name', { exact: true });
  await expect(name).toHaveValue('Acme Shop');
  await name.fill('Acme Store');
  await name.press('Tab');
  await panel.getByRole('button', { name: 'Save' }).click();
  await expect.poll(() => (read() as unknown as { name: string }).name).toBe('Acme Store');
  await tabOf(page, 'Apps').click();
  await page.screenshot({ path: 'test-results/next-stack-settings.png' });
  // An app's settings open in the same panel: never over changes that are not saved yet.
  await tabOf(page, 'Identity').click();
  await name.fill('Acme Shop 2');
  await name.press('Tab');
  await tabOf(page, 'Apps').click();
  const toOrders = panel
    .getByRole('listitem')
    .filter({ hasText: 'Orders API' })
    .getByRole('button', { name: 'Settings' });
  await expect(toOrders).toBeDisabled();
  await panel.getByRole('button', { name: 'Discard' }).click();
  await panel.getByRole('listitem').filter({ hasText: 'Orders API' }).getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('dialog', { name: 'Orders API' })).toBeVisible();
});

test('environments are chips in their order, and the protected ones are ticked', async ({ page, canvas }) => {
  const read = stackFile(canvas.dir);
  await fromMenu(page, 'Settings', 'Stack settings');
  const panel = page.getByRole('dialog', { name: 'Acme Shop settings' });
  const envs = panel.getByRole('list', { name: 'Environments' });
  await expect(envs.getByRole('listitem')).toHaveText([/qa\s+runs by default/, /prod/, '']);
  await envs.getByLabel('Add to Environments').fill('staging');
  await envs.getByLabel('Add to Environments').press('Enter');
  await envs.getByRole('button', { name: 'Move staging earlier' }).click();
  const guarded = panel.getByRole('group', { name: 'Protected' });
  // With nothing said, every environment but the first is protected.
  await expect(guarded.getByLabel('PROD')).toBeChecked();
  await expect(guarded.getByLabel('QA')).not.toBeChecked();
  await guarded.getByLabel('STAGING').uncheck();
  await page.screenshot({ path: 'test-results/next-stack-envs.png' });
  await panel.getByRole('button', { name: 'Save' }).click();
  await expect(panel.getByRole('status')).toHaveText('Saved');
  const saved = read() as unknown as { envs: string[]; protected: string[] };
  expect(saved.envs).toEqual(['qa', 'staging', 'prod']);
  expect(saved.protected).toEqual(['prod']);
});

test.describe('with secrets, queues and code changes in the stack', () => {
  test.use({
    stack: {
      ...STACK,
      queues: { orders: { name: 'Order events', type: 'sqs' }, mail: { name: 'Mail out', type: 'sns' } },
      apps: {
        ...STACK.apps,
        orders: {
          ...STACK.apps['orders'],
          secrets: [{ env: 'Db__Password', type: 'postgres', when: 'on QA', fetch: { cli: 'acme-secrets pull db' } }],
          localChanges: [{ file: 'src/Program.cs', find: 'UseHttps()', replace: '// UseHttps()' }],
          publishes: { orders: {} },
        },
      },
    },
  });

  test('a secret is a row by its name, queues are ticked, and a code change reads as one line', async ({
    page,
    canvas,
    stack,
  }) => {
    const read = stackFile(canvas.dir);
    fs.writeFileSync(path.join(canvas.dir, 'stack', 'stack.json'), JSON.stringify(stack));
    await (await actions(page, 'orders')).getByRole('button', { name: 'Settings for Orders API' }).click();
    const panel = page.getByRole('dialog', { name: 'Orders API' });
    const change = panel.getByRole('group', { name: 'src/Program.cs' });
    await expect(change.getByLabel('Find', { exact: true })).toHaveValue('UseHttps()');
    await change.getByLabel('Replace', { exact: true }).fill('// no https here');
    await change.getByLabel('Replace', { exact: true }).press('Tab');
    await page.screenshot({ path: 'test-results/next-settings-changes.png' });

    await tabOf(page, 'Secrets').click();
    const secret = panel.locator('details.rowed').filter({ hasText: 'Db__Password' });
    await expect(secret.locator(':scope > summary')).toContainText('Postgres, needed on QA');
    await secret.locator(':scope > summary').click();
    await expect(secret.getByLabel('Type', { exact: true })).toHaveValue('postgres');
    await secret.getByLabel('Type', { exact: true }).selectOption('redis');
    await expect(secret.getByLabel('Command', { exact: true })).toHaveValue('acme-secrets pull db');
    await page.screenshot({ path: 'test-results/next-settings-secrets.png' });

    await tabOf(page, 'Calls').click();
    const sends = panel.getByRole('group', { name: 'Sends to queues' });
    await expect(sends.getByLabel('Order events')).toBeChecked();
    await sends.getByLabel('Mail out').check();
    await sends.getByLabel('Order events').uncheck();
    await panel.getByRole('group', { name: 'Reads from queues' }).getByLabel('Order events').check();

    await panel.getByRole('button', { name: 'Save' }).click();
    await expect(panel.getByRole('status')).toHaveText('Saved');
    const orders = read().apps['orders'] ?? {};
    expect(orders['publishes']).toEqual({ mail: {} });
    expect(orders['reads']).toEqual({ orders: {} });
    expect((orders['secrets'] as { type: string }[])[0]?.type).toBe('redis');
    expect((orders['localChanges'] as { replace: string }[])[0]?.replace).toBe('// no https here');
  });
});

test('closed after a save, the board takes what was saved without reloading the page; a click outside closes it', async ({
  page,
  canvas,
}) => {
  stackFile(canvas.dir);
  // A page reload would leave full screen; this mark would be gone after one.
  await page.evaluate(() => ((window as { stayed?: boolean }).stayed = true));
  const open = async () =>
    (await actions(page, 'orders')).getByRole('button', { name: 'Settings for Orders API' }).click();
  await open();
  const panel = page.getByRole('dialog', { name: 'Orders API' });
  await tabOf(page, 'Identity').click();
  const name = panel.getByLabel('Name', { exact: true });
  await name.fill('Orders Service');
  await name.press('Tab');
  // With a change not saved, a click outside asks first instead of closing.
  await page.mouse.click(100, 400);
  await expect(panel.getByRole('alert')).toHaveText('Close without saving 1 change?');
  await panel.getByRole('button', { name: 'Keep editing' }).click();
  await panel.getByRole('button', { name: 'Save' }).click();
  await expect(panel.getByRole('status')).toHaveText('Saved');
  await panel.getByRole('button', { name: 'Close' }).click();
  await expect(page.locator('.svelte-flow__node[data-id="orders"]')).toContainText('Orders Service');
  expect(await page.evaluate(() => (window as { stayed?: boolean }).stayed)).toBe(true);

  // Nothing changed: a click outside closes it.
  await (await actions(page, 'orders')).getByRole('button', { name: 'Settings for Orders Service' }).click();
  const again = page.getByRole('dialog', { name: 'Orders Service' });
  await expect(again).toBeVisible();
  await page.mouse.click(100, 400);
  await expect(again).toBeHidden();
});

test("a tunnel card opens the settings of its app's need for it, on the board's environment", async ({
  page,
  canvas,
}) => {
  const read = stackFile(canvas.dir);
  const tunnel = page.locator('.svelte-flow__node-tunnel').first();
  await tunnel.getByRole('button', { name: 'Settings for the Database (Postgres) tunnel' }).click();
  const panel = page.getByRole('dialog', { name: 'Database (Postgres) tunnel' });
  const port = panel.getByLabel('Port', { exact: true });
  await expect(port).toHaveValue('5432');
  // Only a tunnel's own fields, not those of every other kind of need.
  await expect(panel.getByLabel('AWS profile', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: 'test-results/next-tunnel-settings.png' });
  await port.fill('5433');
  await port.press('Tab');
  await panel.getByRole('button', { name: 'Save' }).click();
  await expect(panel.getByRole('status')).toHaveText('Saved');
  const orders = read().apps['orders'] as {
    prereqs: { port: number }[];
    envs: { prod: { prereqs: { port: number }[] } };
  };
  expect(orders.prereqs[0]?.port).toBe(5433);
  expect(orders.envs.prod.prereqs[0]?.port).toBe(5432);
});

test('an app is set to run to completion, and to start after another app picked from the stack', async ({
  page,
  canvas,
}) => {
  const read = stackFile(canvas.dir);
  await (await actions(page, 'orders')).getByRole('button', { name: 'Settings for Orders API' }).click();
  const panel = page.getByRole('dialog', { name: 'Orders API' });
  const after = panel.getByRole('group', { name: 'Starts after' });
  await after.getByRole('checkbox', { name: 'Payments API' }).check();
  await expect(after.getByRole('checkbox', { name: 'Orders API' })).toHaveCount(0);
  await page.screenshot({ path: 'test-results/next-settings-after.png' });
  await panel.getByRole('button', { name: 'Save' }).click();
  await expect(panel.getByRole('status')).toHaveText('Saved');
  expect(read().apps['orders']?.['after']).toEqual(['payments']);
});

test("an app's description is set in its settings, in Identity beside its name", async ({ page, canvas }) => {
  const read = stackFile(canvas.dir);
  await (await actions(page, 'orders')).getByRole('button', { name: 'Settings for Orders API' }).click();
  const panel = page.getByRole('dialog', { name: 'Orders API' });
  await tabOf(page, 'Identity').click();
  const description = panel.getByLabel('Description', { exact: true });
  await description.fill('Keeps every order');
  await description.press('Tab');
  await panel.getByRole('button', { name: 'Save' }).click();
  await expect(panel.getByRole('status')).toHaveText('Saved');
  expect(read().apps['orders']?.['description']).toBe('Keeps every order');
});

test('a view picked while the board reads the saved stack again stays picked', async ({ page, canvas }) => {
  stackFile(canvas.dir);
  await (await actions(page, 'orders')).getByRole('button', { name: 'Settings for Orders API' }).click();
  const panel = page.getByRole('dialog', { name: 'Orders API' });
  await tabOf(page, 'Identity').click();
  const description = panel.getByLabel('Description', { exact: true });
  await description.fill('Keeps every order');
  await description.press('Tab');
  await panel.getByRole('button', { name: 'Save' }).click();
  await expect(panel.getByRole('status')).toHaveText('Saved');
  // The stack comes back slowly, as on a busy machine; Discover is picked meanwhile.
  let answer = () => {};
  const held = new Promise<void>(resolve => (answer = resolve));
  let asked = false;
  await page.route('**/data/registry.json', async route => {
    asked = true;
    await held;
    await route.continue();
  });
  await panel.getByRole('button', { name: 'Close' }).click();
  await expect.poll(() => asked).toBe(true);
  await page
    .locator('label')
    .filter({ hasText: /^Discover$/ })
    .click();
  await expect(page.getByRole('radio', { name: 'Discover' })).toBeChecked();
  answer();
  await page.waitForResponse('**/data/registry.json');
  await page.waitForTimeout(300);
  await expect(page.getByRole('radio', { name: 'Discover' })).toBeChecked();
});
