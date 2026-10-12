// The new canvas's agent inbox: questions the agent asks about a run, answered from the page, and what it finished.
import { test, expect } from '../canvas.ts';

test.use({
  start: 'next/',
  board: { env: 'qa', mode: 'auto', nodes: { web: { x: 0, y: 0, run: 'cli', branch: 'main' } }, edges: [] },
});

test('a question opens the panel and is answered from it; results are announced and can be cleared', async ({
  page,
}) => {
  const chip = page.locator('header .agent');
  const panel = page.getByRole('dialog', { name: 'Messages from the agent' });
  await expect(chip).toHaveText('No agent');
  await chip.click();
  await expect(panel).toContainText('Nothing yet.');
  await panel.getByRole('button', { name: 'Close' }).click();
  await expect(panel).toHaveCount(0);

  const at = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
  const result = { id: 'm1', kind: 'result', at: at(9), title: 'Web Shop is running', summary: 'It answers on 3000.' };
  const question = {
    id: 'm2',
    kind: 'question',
    at: at(1),
    run: 'run12345',
    title: 'Orders API has uncommitted changes',
    summary: 'The run asks for another branch.',
    sections: [{ title: 'To look yourself', commands: ['git -C ~/work/orders status'], items: ['3 files changed'] }],
    choices: [
      { id: 'aside', label: 'Set them aside', detail: 'Back on Stop' },
      { id: 'along', label: 'Take them along' },
    ],
  };
  let messages: object[] = [];
  await page.route('**/data/status.json', route =>
    route.fulfill({ json: { apps: {}, agent: { state: 'listening' }, messages } }),
  );
  await expect(chip).toHaveText('Agent');

  // Something the agent finished is announced; the panel stays shut.
  messages = [result];
  await expect(page.getByRole('status')).toContainText('Agent: Web Shop is running');
  await expect(panel).toHaveCount(0);

  // A question opens the panel by itself and marks the bar.
  messages = [result, question];
  await expect(panel.getByRole('heading', { level: 3 }).first()).toHaveText('Orders API has uncommitted changes');
  await expect(chip).toHaveText('Agent needs you');
  await expect(panel.locator('code')).toHaveText('git -C ~/work/orders status');
  await expect(panel.getByRole('button', { name: /Set them aside/ })).toBeFocused();
  await page.screenshot({ path: 'test-results/next-inbox.png' });

  // The server knows nothing of this made-up question, so its side of the answer is stood in for.
  const sent: { tag: string; text: string; data: Record<string, unknown> }[] = [];
  await page.route('**/prompt?*', async route => {
    sent.push(route.request().postDataJSON() as (typeof sent)[number]);
    await route.fulfill({ status: 204 });
  });
  await panel.getByRole('button', { name: /Take them along/ }).click();
  await expect(panel).toContainText('You chose: Take them along');
  await expect(chip).toHaveText('Agent');
  expect(sent[0]?.tag).toBe('koppler-reply');
  expect(sent[0]?.data).toEqual({ message: 'm2', choice: 'along' });
  expect(sent[0]?.text).toBe(
    'Answer to your question "Orders API has uncommitted changes" (run run12345): Take them along',
  );

  // Clear empties what is left.
  await page.route('**/messages-clear?*', route => route.fulfill({ json: { cleared: 2 } }));
  await panel.getByRole('button', { name: 'Clear' }).click();
  await expect(panel).toContainText('Nothing yet.');
});
