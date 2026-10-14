import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import { APP_ID } from '../ids.ts';
import { LOGS } from '../paths.ts';
import { tail } from './logs.ts';
import { logFile } from './status.ts';

test('an id never reads as a flag', () => {
  expect(APP_ID.test('orders-api')).toBe(true);
  for (const flag of ['--secrets', '-x', '', 'Orders', 'a'.repeat(65)]) expect(APP_ID.test(flag)).toBe(false);
});

test("an app's log is read only from a file that is a log", () => {
  expect(logFile('orders', '/tmp/run/orders.log')).toBe('/tmp/run/orders.log');
  const own = path.join(LOGS, 'orders.log');
  for (const named of ['/Users/jane/.ssh/id_ed25519', '/etc/passwd', 'relative.log', null, 7])
    expect(logFile('orders', named)).toBe(own);
});

test('a tail that starts mid-line drops that piece, so a value never shows without its name', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-tail-')), 'app.log');
  fs.writeFileSync(file, 'Db__Password=hunter2-and-more\nready\n');
  expect(tail(file, 20)).toBe('ready');
  expect(tail(file)).toBe('Db__Password=***\nready');
});
