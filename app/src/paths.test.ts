import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

test('state lives under the XDG state folder, never inside the app', async () => {
  for (const name of ['KOPPLER_STATE', 'KOPPLER_TEMP', 'KOPPLER_LOGS', 'XDG_STATE_HOME']) vi.stubEnv(name, undefined);
  const { APP, BIN, LOGS, STATE, TEMP } = await import('./paths.ts');
  expect(STATE).toBe(path.join(os.homedir(), '.local', 'state', 'koppler'));
  expect(TEMP).toBe(path.join(STATE, 'run'));
  expect(LOGS).toBe(path.join(STATE, 'logs'));
  expect(STATE.startsWith(APP)).toBe(false);
  expect(BIN).toBe(path.join(APP, 'bin'));
});

test('each folder can be moved on its own, and the run files follow the state folder', async () => {
  vi.stubEnv('KOPPLER_STATE', '/tmp/k');
  vi.stubEnv('KOPPLER_LOGS', '/var/log/k');
  vi.stubEnv('KOPPLER_TEMP', undefined);
  const { LOGS, STATE, TEMP } = await import('./paths.ts');
  expect([STATE, TEMP, LOGS]).toEqual(['/tmp/k', '/tmp/k/run', '/var/log/k']);
});
