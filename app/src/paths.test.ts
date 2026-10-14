import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { APP, BIN, configDir, logsDir, stateDir, tempDir } from './paths.ts';

afterEach(() => {
  vi.unstubAllEnvs();
});

test('state lives under the XDG state folder, never inside the app', () => {
  for (const name of ['KOPPLER_STATE', 'KOPPLER_TEMP', 'KOPPLER_LOGS', 'XDG_STATE_HOME', 'KOPPLER_CONFIG_DIR'])
    vi.stubEnv(name, undefined);
  const state = stateDir();
  expect(state).toBe(path.join(os.homedir(), '.local', 'state', 'koppler'));
  expect(tempDir()).toBe(path.join(state, 'run'));
  expect(logsDir()).toBe(path.join(state, 'logs'));
  expect(configDir()).toBe(path.join(os.homedir(), '.config', 'koppler'));
  expect(state.startsWith(APP)).toBe(false);
  expect(BIN).toBe(path.join(APP, 'bin'));
});

test('each folder can be moved on its own, and the run files follow the state folder, read on each call', () => {
  vi.stubEnv('KOPPLER_STATE', '/tmp/k');
  vi.stubEnv('KOPPLER_LOGS', '/var/log/k');
  vi.stubEnv('KOPPLER_TEMP', undefined);
  expect([stateDir(), tempDir(), logsDir()]).toEqual(['/tmp/k', '/tmp/k/run', '/var/log/k']);
  vi.stubEnv('KOPPLER_STATE', '/tmp/other');
  expect(tempDir()).toBe('/tmp/other/run');
});
