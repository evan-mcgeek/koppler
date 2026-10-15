import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import { claudeTitle } from './claude-title.ts';

const session = '2a98c5cd-14c0-4af0-bf1f-d51d26a1f8e3';
const home = () => fs.mkdtempSync(path.join(os.tmpdir(), 'claude-home-'));
const write = (dir: string, records: object[]) => {
  fs.mkdirSync(path.join(dir, 'projects', '-Users-me-src'), { recursive: true });
  const text = records.map(record => JSON.stringify(record)).join('\n');
  fs.writeFileSync(path.join(dir, 'projects', '-Users-me-src', `${session}.jsonl`), text);
};

test('the newest title of the session, a name given with /rename before the one Claude Code made up', () => {
  const dir = home();
  write(dir, [
    { type: 'ai-title', aiTitle: 'Old title', sessionId: session },
    { type: 'user', message: 'the ai-title said "x"' },
    { type: 'ai-title', aiTitle: 'Fixing the cable check', sessionId: session },
  ]);
  expect(claudeTitle(session, dir)).toBe('Fixing the cable check');
  write(dir, [
    { type: 'custom-title', customTitle: 'Koppler release', sessionId: session },
    { type: 'ai-title', aiTitle: 'Fixing the cable check', sessionId: session },
  ]);
  expect(claudeTitle(session, dir)).toBe('Koppler release');
});

test('nothing for a session it cannot find, or an id that is not one', () => {
  const dir = home();
  expect(claudeTitle(session, dir)).toBeUndefined();
  write(dir, [{ type: 'user', message: 'hi' }]);
  expect(claudeTitle(session, dir)).toBeUndefined();
  expect(claudeTitle('../../etc/passwd', dir)).toBeUndefined();
});
