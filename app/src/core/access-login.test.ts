import { expect, test } from 'vitest';
import { needsLogin, needsLoginLine, tooManyPrompts } from './access-login.ts';

test('three login prompts within a minute are too many; prompts spread out are not', () => {
  expect(tooManyPrompts([0, 1000], 2000)).toBe(false);
  expect(tooManyPrompts([0, 1000, 2000], 2000)).toBe(true);
  expect(tooManyPrompts([0, 70_000, 140_000], 140_000)).toBe(false);
});

test('the last line names the host to log in to, and status reads it back', () => {
  const line = needsLoginLine([
    'cloudflared',
    'access',
    'tcp',
    '--hostname',
    'db.acme.test',
    '--url',
    'localhost:5432',
  ]);
  expect(line).toContain('cloudflared access login https://db.acme.test, then koppler up again');
  expect(needsLogin(line)).toBe(true);
  expect(needsLogin('koppler: exited with 1, restarting in 2s')).toBe(false);
});
