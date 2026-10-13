// The new canvas with no stack yet, and what the stack menu offers beyond switching: setting one up, a linked
// stack's updates and changes, and what the repos say.
import type { Page } from '@playwright/test';
import { test, expect, STACK } from './canvas.ts';

const posts = async (page: Page, route: string, answer: object = { ok: true }) => {
  const asked: unknown[] = [];
  await page.route(`**/${route}?*`, async one => {
    asked.push(one.request().postDataJSON());
    await one.fulfill({ json: answer });
  });
  return asked;
};

test.describe('with no stack yet', () => {
  const found = [
    {
      dir: '/work/acme/stack',
      path: '~/work/acme/stack',
      name: 'Acme Shop',
      apps: 4,
      envs: ['qa', 'prod'],
      shared: true,
    },
  ];
  test.use({
    stack: { name: '', envs: ['dev'], apps: {}, setup: true, stacks: found } as unknown as typeof STACK,
  });

  test('the page asks for one: a shared stack found here or from a link, or a new one', async ({ page }) => {
    const setup = page.getByRole('dialog', { name: 'Set up Koppler' });
    await expect(setup).toContainText('Every app you might run. Added once.');
    await page.screenshot({ path: 'test-results/next-setup.png' });
    // There is nothing to go back to: Escape does not close it.
    await page.keyboard.press('Escape');
    await expect(setup).toBeVisible();
    const asked = await posts(page, 'stack');

    await setup.getByRole('button', { name: /Use a shared stack/ }).click();
    const join = page.getByRole('dialog', { name: 'Use a shared stack' });
    await expect(join).toContainText('shared, 4 apps, qa / prod');
    await join.getByRole('button', { name: 'Use Acme Shop' }).click();
    await expect.poll(() => asked).toEqual([{ use: '/work/acme/stack' }]);

    await page.getByRole('button', { name: /Use a shared stack/ }).click();
    await join
      .getByLabel('Link to a shared stack on GitHub')
      .fill('https://github.com/acme/stack/blob/main/stack.json');
    await join.getByLabel('Link to a shared stack on GitHub').press('Enter');
    await expect.poll(() => asked[1]).toEqual({ link: 'https://github.com/acme/stack/blob/main/stack.json' });

    await page.getByRole('button', { name: /Start a new stack/ }).click();
    const fresh = page.getByRole('dialog', { name: 'Start a new stack' });
    await fresh.getByLabel('Name').fill('Orders platform');
    const envs = fresh.getByLabel('Environments');
    await envs.fill('QA!');
    await envs.press('Enter');
    await expect(fresh.getByRole('alert')).toContainText('"QA!" will not work as a name');
    await envs.fill('qa, prod');
    await envs.press('Enter');
    await expect(fresh.locator('.tag')).toHaveText([/qa\s*default/, /prod/]);
    await page.screenshot({ path: 'test-results/next-setup-new.png' });
    await fresh.getByRole('button', { name: 'Create and add repos' }).click();
    await expect.poll(() => asked[2]).toEqual({ name: 'Orders platform', envs: ['qa', 'prod'] });
  });
});

test.describe('a stack linked from GitHub', () => {
  test('offers its updates and unshared changes, and what the repos say is reviewed before it is kept', async ({
    page,
  }) => {
    const linked = { url: 'https://github.com/acme/stack', changes: ['orders calls payments', 'web runs on 3000'] };
    await page.route('**/data/status.json', route => route.fulfill({ json: { apps: {}, linked, stacks: [] } }));
    const menu = page.getByRole('menu', { name: 'Stacks' });
    const open = async (item: string | RegExp) => {
      await page.getByRole('button', { name: 'Acme Shop', exact: true }).click();
      await menu.getByRole('menuitem', { name: item }).click();
    };
    await page.getByRole('button', { name: 'Acme Shop', exact: true }).click();
    await expect(menu.getByRole('menuitem')).toHaveText([
      /Check for updates from GitHub/,
      /Changes not shared yet\s*2/,
      /Look through the repos again/,
      /Add a stack: new, or from GitHub/,
    ]);
    await page.screenshot({ path: 'test-results/next-stack-menu.png' });
    await page.keyboard.press('Escape');

    const updates = await posts(page, 'stack-update', { updated: false, message: 'Already up to date.' });
    await open(/Check for updates/);
    await expect(page.getByRole('status')).toContainText('Already up to date.');
    expect(updates).toHaveLength(1);

    await open(/Changes not shared yet/);
    const review = page.getByRole('dialog').filter({ hasText: 'Changes not in the shared stack yet' });
    await expect(review).toContainText('Orders calls payments');
    await expect(review).toContainText('No secret values are in it.');
    await review.getByRole('button', { name: 'Discard my changes instead' }).click();
    const discard = page.getByRole('dialog').filter({ hasText: 'Discard your changes' });
    await expect(discard.getByRole('button', { name: 'Discard', exact: true })).toBeVisible();
    await discard.getByRole('button', { name: 'Cancel' }).click();

    const findings = [
      { id: 'alias:staging', kind: 'alias', value: 'staging', env: 'qa', why: 'terraform/staging.tfvars' },
      {
        id: 'address:web:qa',
        kind: 'address',
        app: 'web',
        env: 'qa',
        value: 'https://web.staging.acme.example',
        why: 'terraform/staging.tfvars',
        needs: 'alias:staging',
      },
      { id: 'call:web>payments', kind: 'call', app: 'web', to: 'payments', why: 'src/config.ts names its address' },
      { id: 'url:catalog', kind: 'url', app: 'catalog', value: 'http://localhost:5003', why: 'package.json' },
    ];
    await posts(page, 'discover', { findings });
    const applied = await posts(page, 'discover-apply');
    await open(/Look through the repos again/);
    const said = page.getByRole('dialog', { name: 'What the repos say' });
    await expect(said.getByRole('checkbox')).toHaveCount(4);
    await expect(said).toContainText('Web Shop calls Payments API');
    await page.screenshot({ path: 'test-results/next-findings.png' });
    // An address that follows from an environment name goes with it.
    await said.getByRole('checkbox').first().uncheck();
    await expect(said.getByRole('checkbox').nth(2)).toBeDisabled();
    await said.getByRole('button', { name: 'Add 2 to the stack' }).click();
    await expect.poll(() => applied).toEqual([{ ids: ['call:web>payments', 'url:catalog'] }]);
  });
});
