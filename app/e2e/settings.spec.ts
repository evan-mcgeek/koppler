// Settings for a part of the stack, from the gear beside it: every field shown, each change checked and kept, locks.
import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect, STACK } from './canvas.ts';

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

test('an app card opens its settings: a change is kept, a broken one is refused, and a locked field holds', async ({
  page,
  canvas,
}) => {
  const read = stackFile(canvas.dir);
  await card(page, 'orders').getByRole('button', { name: 'Settings for Orders API' }).click();
  const panel = page.getByRole('dialog', { name: 'Orders API' });
  const url = panel.getByLabel('URL', { exact: true });
  await expect(url).toHaveValue('http://localhost:5001');
  await expect(panel.getByLabel('Deployed URL', { exact: true })).toHaveValue('https://orders-api.qa.acme.example');
  await page.screenshot({ path: 'test-results/next-settings.png' });

  await url.fill('http://localhost:5011');
  await url.press('Tab');
  await expect.poll(() => read().apps['orders']?.['url']).toBe('http://localhost:5011');

  const kind = panel.getByLabel('Kind', { exact: true });
  await kind.fill('');
  await kind.press('Tab');
  await expect(panel.getByRole('alert')).toContainText('apps.orders.kind: required');
  expect(read().apps['orders']?.['kind']).toBe('dotnet');

  await panel.getByRole('button', { name: 'Lock URL', exact: true }).click();
  await expect(url).toBeDisabled();
  await expect(panel.getByRole('button', { name: 'Unlock URL', exact: true })).toBeVisible();
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
  expect(read().apps['orders']?.['url']).toBe('http://localhost:5011');
  await panel.getByRole('button', { name: 'Unlock URL', exact: true }).click();
  await expect(url).toBeEnabled();
});

test('a group opens to add an item, which is kept once its fields are in', async ({ page, canvas }) => {
  const read = stackFile(canvas.dir);
  await card(page, 'orders').getByRole('button', { name: 'Settings for Orders API' }).click();
  const panel = page.getByRole('dialog', { name: 'Orders API' });
  const needs = panel.locator('details:has(> summary:has-text("Needs first"))').first();
  await expect(needs).toHaveAttribute('open', '');
  await needs.locator(':scope > fieldset > .add').getByRole('button', { name: 'Add', exact: true }).click();
  await expect.poll(() => (read().apps['orders']?.['prereqs'] as unknown[] | undefined)?.length).toBe(2);
});

test("the agent is asked to fill in an app's empty settings, leaving locked ones alone", async ({ page, canvas }) => {
  stackFile(canvas.dir);
  const sent: { tag?: string; text?: string; data?: { app?: string } }[] = [];
  await page.route('**/prompt?*', async route => {
    sent.push(route.request().postDataJSON() as (typeof sent)[number]);
    await route.fulfill({ json: { ok: true } });
  });
  await card(page, 'orders').getByRole('button', { name: 'Settings for Orders API' }).click();
  const panel = page.getByRole('dialog', { name: 'Orders API' });
  await panel.getByRole('button', { name: 'Lock Deployed URL', exact: true }).click();
  await panel.getByRole('button', { name: 'Ask the agent to fill in' }).click();
  await expect(panel.getByRole('button', { name: 'Asked the agent' })).toBeDisabled();
  expect(sent).toHaveLength(1);
  expect(sent[0]?.tag).toBe('koppler-facts');
  expect(sent[0]?.data?.app).toBe('orders');
  expect(sent[0]?.text).toContain('APP Orders API (orders)');
  expect(sent[0]?.text).toMatch(/EMPTY .*start/);
  expect(sent[0]?.text).toContain('LOCKED apps.orders.deployedUrl');
  expect(sent[0]?.text).toContain('koppler stack set apps.orders.<field>');
});

test('the stack has its own settings, beside its name', async ({ page, canvas }) => {
  const read = stackFile(canvas.dir);
  await page.getByRole('button', { name: 'Stack settings' }).click();
  const panel = page.getByRole('dialog', { name: 'Acme Shop settings' });
  const name = panel.getByLabel('Name', { exact: true }).first();
  await expect(name).toHaveValue('Acme Shop');
  await expect(panel.locator('summary', { hasText: 'Apps' }).first()).toBeVisible();
  await name.fill('Acme Store');
  await name.press('Tab');
  await expect.poll(() => (read() as unknown as { name: string }).name).toBe('Acme Store');
  await page.screenshot({ path: 'test-results/next-stack-settings.png' });
});
