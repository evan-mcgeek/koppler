import { expect, test, vi } from 'vitest';
import { alive, commandFor, listener, parseRun, uptime } from './processes.ts';

test('what koppler run was asked for', () => {
  expect(parseRun(['mobile-api'])).toEqual({ name: 'mobile-api', command: [], restart: false });
  expect(parseRun(['db', '--port', '5436', '--restart', '--', 'cloudflared', 'access', 'tcp'])).toEqual({
    name: 'db',
    command: ['cloudflared', 'access', 'tcp'],
    restart: true,
    port: 5436,
  });
  expect(parseRun(['web', '--cwd', '/tmp', '--', 'npm', 'start']).cwd).toBe('/tmp');
  // What follows -- is the command, whatever it looks like.
  expect(parseRun(['a', '--', 'echo', '--restart']).command).toEqual(['echo', '--restart']);
  expect(parseRun(['api', '--env', 'prod', '--device', 'ios', '--lan', '--dry-run', '--no-test'])).toMatchObject({
    env: 'prod',
    device: 'ios',
    lan: true,
    dryRun: true,
    test: false,
  });
  expect(parseRun(['tunnel-db-5432', '--bind', '127.0.0.2', '--', 'x']).bind).toBe('127.0.0.2');
});

test('what it refuses, with the reason', () => {
  expect(() => parseRun(['Bad Name', '--', 'x'])).toThrow(/name/);
  expect(() => parseRun([])).toThrow(/name/);
  expect(() => parseRun(['a', '--'])).toThrow(/nothing to run/);
  expect(() => parseRun(['a', '--port', 'abc', '--', 'x'])).toThrow(/port/);
  expect(() => parseRun(['a', '--port', '70000', '--', 'x'])).toThrow(/port/);
  expect(() => parseRun(['a', '--bind', '10.0.0.5', '--', 'x'])).toThrow(/address of this machine/);
  expect(() => parseRun(['a', '--force', '--', 'x'])).toThrow(/unknown option/);
});

test('a restart wrapper runs the command again when it ends', () => {
  expect(commandFor(['echo', 'hi'], false)).toEqual(['echo', 'hi']);
  const wrapped = commandFor(['echo', 'hi'], true);
  expect(wrapped.slice(0, 2)).toEqual(['sh', '-c']);
  expect(wrapped[2]).toMatch(/while :; do "\$@"/);
  expect(wrapped.slice(-2)).toEqual(['echo', 'hi']);
});

test('a process counts as running only when it is the one that was started', () => {
  expect(alive({ pid: process.pid, psStart: '', psCommand: 'not this process' })).toBe(false);
  expect(alive({ pid: process.pid, psStart: 'Thu Jan  1 00:00:00 1970', psCommand: '' })).toBe(false);
  expect(alive({ pid: 2 ** 22 + 12345, psStart: 'x', psCommand: 'x' })).toBe(false);
});

test('nothing listens on a port nobody opened', () => {
  expect(listener(9)).toBeNull();
});

test('how long something has been up', () => {
  vi.useFakeTimers({ now: new Date('2026-01-01T12:00:00Z') });
  expect(uptime('2026-01-01T11:48:30Z')).toBe('11m');
  expect(uptime('2026-01-01T08:55:00Z')).toBe('3h05m');
  vi.useRealTimers();
});
