import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import { awsProfiles, cloneChoices } from './choices.ts';

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-choices-'));

test('AWS profiles are read by name only, each once', () => {
  const file = path.join(temp(), 'config');
  fs.writeFileSync(
    file,
    '[default]\nregion = eu-west-1\n[profile acme-dev]\nsso_account_id = 123456789012\n[profile acme-dev]\n[sso-session acme]\n',
  );
  expect(awsProfiles(file)).toEqual(['acme-dev', 'default']);
  expect(awsProfiles(path.join(temp(), 'none'))).toEqual([]);
});

test("a clone offers its tracked files, launch profiles and package scripts, and nothing of a file's content", () => {
  const dir = temp();
  const write = (file: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), text);
  };
  write(
    'src/Api/Properties/launchSettings.json',
    '﻿{"profiles":{"Local":{},"Qa":{"environmentVariables":{"KEY":"s3cret"}}}}',
  );
  write('package.json', '{"scripts":{"dev":"vite","start:qa":"node ."}}');
  write('untracked.txt', 'x');
  execFileSync('git', ['-C', dir, 'init', '-q']);
  execFileSync('git', ['-C', dir, 'add', 'src', 'package.json']);
  const found = cloneChoices(dir);
  expect(found.files).toEqual(['package.json', 'src/Api/Properties/launchSettings.json']);
  expect(found.profiles).toEqual({ 'src/Api/Properties/launchSettings.json': ['Local', 'Qa'] });
  expect(found.scripts).toEqual({ 'package.json': ['dev', 'start:qa'] });
  expect(JSON.stringify(found)).not.toContain('s3cret');
  expect(cloneChoices(undefined).files).toEqual([]);
  expect(cloneChoices(path.join(dir, 'missing')).files).toEqual([]);
});
