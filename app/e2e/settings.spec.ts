// Settings for a part of the stack, from the gear beside it: every field shown, each change checked and kept, locks.
import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect, STACK, actions } from './canvas.ts';

const card = (page: Page, id: string) => page.locator(`.svelte-flow__node[data-id="${id}"]`);
const at = (x: number, y: number) => ({ x, y, run: 'cli', branch: 'main' });
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
  await expect(panel.getByLabel('Name', { exact: true })).toHaveValue('Orders API');
  await expect(tabOf(page, 'Runs here')).toHaveAttribute('aria-selected', 'true');
  const url = panel.getByLabel('URL', { exact: true });
  await expect(url).toHaveValue('http://localhost:5001');
  await page.screenshot({ path: 'test-results/next-settings.png' });

  await url.fill('http://localhost:5011');
  await url.press('Tab');
  await expect(panel.getByRole('status')).toHaveText('1 change, not saved yet');
  expect(read().apps['orders']?.['url']).toBe('http://localhost:5001');
  await panel.getByRole('button', { name: 'Discard' }).click();
  await expect(url).toHaveValue('http://localhost:5001');

  await url.fill('http://localhost:5011');
  await url.press('Tab');
  const kind = panel.getByLabel('Kind', { exact: true });
  await kind.fill('');
  await kind.press('Tab');
  await panel.getByRole('button', { name: 'Save' }).click();
  await expect(panel.getByRole('alert')).toContainText('required');
  await expect(panel.getByRole('status')).toHaveText('1 to fix before it can be saved');
  expect(read().apps['orders']?.['url']).toBe('http://localhost:5001');
  await kind.fill('dotnet');
  await kind.press('Tab');
  await panel.getByRole('button', { name: 'Save' }).click();
  await expect(panel.getByRole('status')).toHaveText('Saved');
  expect(read().apps['orders']?.['url']).toBe('http://localhost:5011');

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

test('a list item is added in its tab, and closing with changes asks first', async ({ page, canvas }) => {
  const read = stackFile(canvas.dir);
  await (await actions(page, 'orders')).getByRole('button', { name: 'Settings for Orders API' }).click();
  const panel = page.getByRole('dialog', { name: 'Orders API' });
  await tabOf(page, 'Needs first').click();
  await panel
    .getByRole('tabpanel')
    .locator(':scope > details > fieldset > .add')
    .getByRole('button', { name: 'Add' })
    .click();
  await expect(panel.getByRole('status')).toHaveText('1 change, not saved yet');
  await panel.getByRole('button', { name: 'Close' }).click();
  await expect(panel.getByRole('alert')).toHaveText('Close without saving 1 change?');
  await panel.getByRole('button', { name: 'Keep editing' }).click();
  await panel.getByRole('button', { name: 'Save' }).click();
  await expect.poll(() => (read().apps['orders']?.['prereqs'] as unknown[] | undefined)?.length).toBe(2);
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
  await panel.getByRole('button', { name: 'Ask the agent to fill in' }).click();
  await expect(panel.getByRole('button', { name: 'Asked the agent' })).toBeDisabled();
  expect(sent).toHaveLength(1);
  expect(sent[0]?.tag).toBe('koppler-facts');
  expect(sent[0]?.text).toContain('APP Orders API (orders)');
  expect(sent[0]?.text).toMatch(/EMPTY .*start/);
  expect(sent[0]?.text).toContain('LOCKED apps.orders.deployedUrl');
});

test('the stack has its own settings, beside its name, with its apps a click away', async ({ page, canvas }) => {
  const read = stackFile(canvas.dir);
  await page.getByRole('button', { name: 'Stack settings' }).click();
  const panel = page.getByRole('dialog', { name: 'Acme Shop settings' });
  const name = panel.getByLabel('Name', { exact: true });
  await expect(name).toHaveValue('Acme Shop');
  await name.fill('Acme Store');
  await name.press('Tab');
  await panel.getByRole('button', { name: 'Save' }).click();
  await expect.poll(() => (read() as unknown as { name: string }).name).toBe('Acme Store');
  await tabOf(page, 'Apps').click();
  await page.screenshot({ path: 'test-results/next-stack-settings.png' });
  await panel.getByRole('listitem').filter({ hasText: 'Orders API' }).getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('dialog', { name: 'Orders API' })).toBeVisible();
});
