import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { dataFile, readData, writeData } from './data.ts';
import { readJson, writeJson } from './json-files.ts';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-data-'));
  vi.stubEnv('KOPPLER_TEMP', dir);
});
afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a run file comes back as it was written, readable by the user alone', () => {
  expect(readData('registry')).toBeNull();
  writeData('registry', { name: 'Acme Shop', envs: ['qa'] });
  expect(readData('registry')).toEqual({ name: 'Acme Shop', envs: ['qa'] });
  expect(dataFile('registry')).toBe(path.join(dir, 'registry.json'));
  expect(fs.statSync(dataFile('registry')).mode & 0o777).toBe(0o600);
  expect(fs.readdirSync(dir)).toEqual(['registry.json']);
});

test('the run folder is looked up at each call', () => {
  writeData('state', { env: 'qa' });
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-data-'));
  vi.stubEnv('KOPPLER_TEMP', other);
  expect(readData('state')).toBeNull();
  fs.rmSync(other, { recursive: true });
});

test('a board saved in the old script form is still read, and the JSON file wins once there is one', () => {
  fs.writeFileSync(
    path.join(dir, 'state.js'),
    'window.SAVED_STATE = {\n  "env": "prod",\n  "nodes": { "web": { "x": 1 } }\n};\n',
  );
  fs.writeFileSync(
    path.join(dir, 'registry.js'),
    '// Copied from /x/stack.json by koppler sync.\nwindow.REGISTRY = {"name":"Old"};\n',
  );
  expect(readData('state')).toEqual({ env: 'prod', nodes: { web: { x: 1 } } });
  expect(readData('registry')).toEqual({ name: 'Old' });
  writeData('state', { env: 'qa' });
  expect(readData('state')).toEqual({ env: 'qa' });
});

test('what is not an object is not a run file', () => {
  for (const text of ['[1, 2]', '"text"', 'not json', '']) {
    fs.writeFileSync(dataFile('local'), text);
    expect(readData('local')).toBeNull();
  }
});

test('JSON files: a byte order mark is fine, a missing folder is made, and nothing is left beside the file', () => {
  const file = path.join(dir, 'deep', 'er', 'settings.json');
  writeJson(file, { a: 1 });
  expect(readJson(file)).toEqual({ a: 1 });
  expect(fs.readdirSync(path.dirname(file))).toEqual(['settings.json']);
  fs.writeFileSync(file, '\uFEFF{"b":2}');
  expect(readJson(file)).toEqual({ b: 2 });
  expect(readJson(path.join(dir, 'missing.json'))).toBeNull();
});
