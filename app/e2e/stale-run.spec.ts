// The last run's apps that no longer run read as down, not as running: the header says so.
import fs from 'node:fs';
import path from 'node:path';
import { at, expect, STACK, test } from './canvas.ts';

const { web = {}, catalog = {} } = STACK.apps;
// Ports nothing listens on, so these apps cannot answer.
test.use({
  stack: {
    ...STACK,
    apps: {
      ...STACK.apps,
      web: { ...web, url: 'http://localhost:46901' },
      catalog: { ...catalog, url: 'http://localhost:46902' },
    },
  },
  board: {
    env: 'qa',
    mode: 'auto',
    nodes: { web: at(0, 0), catalog: at(420, 0) },
    edges: [{ from: 'web', to: 'catalog', fromSide: 'right', toSide: 'left' }],
  },
});

test('apps the last run started but that were stopped since count as off, not as running', async ({ page, canvas }) => {
  // What the last run left: both apps sent, though nothing runs them now.
  fs.writeFileSync(
    path.join(canvas.temp, 'live.json'),
    JSON.stringify({
      id: 'run00001',
      at: new Date().toISOString(),
      env: 'qa',
      nodes: { web: { branch: '', run: 'cli' }, catalog: { branch: '', run: 'cli' } },
      edges: [{ from: 'web', to: 'catalog' }],
    }),
  );
  await page.reload();
  await expect(page.locator('header .chip')).toHaveText('2 things are off');
});
