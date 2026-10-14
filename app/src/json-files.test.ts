import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import { readJson, whenChanged, writeJson } from './json-files.ts';

test('a file read over and over is parsed again only once it changed', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-json-')), 'stack.json');
  let reads = 0;
  const read = whenChanged(name => {
    reads++;
    return readJson(name);
  });
  expect(read(file)).toBeNull();
  writeJson(file, { name: 'acme' });
  expect(read(file)).toEqual({ name: 'acme' });
  expect(read(file)).toEqual({ name: 'acme' });
  expect(reads).toBe(2);
  writeJson(file, { name: 'acme', envs: ['qa'] });
  expect(read(file)).toEqual({ name: 'acme', envs: ['qa'] });
  fs.rmSync(file);
  expect(read(file)).toBeNull();
  expect(reads).toBe(4);
});
