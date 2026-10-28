import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { afterEach, expect, test } from 'vitest';
import { stateDir } from '../paths.ts';
import { flutterPid } from './app-start.ts';
import { hotReload, reloadable } from './reload.ts';
import { sh } from './processes.ts';

// Koppler's record of the app, its process this test's own.
const started = (app: string) => {
  fs.mkdirSync(path.join(stateDir(), 'procs'), { recursive: true });
  const psStart = sh('ps', ['-p', String(process.pid), '-o', 'lstart=']);
  fs.writeFileSync(path.join(stateDir(), 'procs', `${app}.json`), JSON.stringify({ pid: process.pid, psStart }));
};

afterEach(() => {
  fs.rmSync(stateDir(), { recursive: true, force: true });
});

test('a Flutter app Koppler started but flutter run has not put on the device yet is still starting', () => {
  started('mobile-app');
  expect(reloadable('mobile-app')).toBe(false);
  expect(() => hotReload('mobile-app', false)).toThrow(
    'mobile-app is still starting: hot reload works once flutter run has put it on the device',
  );
  expect(() => hotReload('web', false)).toThrow('web is not a Flutter app Koppler runs');
});

test('once flutter run wrote its process id, reload signals it: SIGUSR1, or SIGUSR2 to restart', async () => {
  started('mobile-app');
  for (const [restart, signal] of [
    [false, 'SIGUSR1'],
    [true, 'SIGUSR2'],
  ] as const) {
    const flutter = spawn('sleep', ['30'], { stdio: 'ignore' });
    const ended = new Promise(resolve => flutter.once('exit', (_code, by) => resolve(by)));
    fs.mkdirSync(path.dirname(flutterPid('mobile-app')), { recursive: true });
    fs.writeFileSync(flutterPid('mobile-app'), String(flutter.pid));
    expect(reloadable('mobile-app')).toBe(true);
    expect(hotReload('mobile-app', restart)).toBe(`${restart ? 'Hot restarted' : 'Hot reloaded'} mobile-app`);
    expect(await ended).toBe(signal);
  }
  expect(reloadable('mobile-app')).toBe(false);
});
