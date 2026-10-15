// What a settings panel offers to pick from on this machine: AWS profile names, and what an app's clone holds
// (its files, .NET launch profiles, package scripts). Names only: no key, token or file content leaves here.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readJson } from '../json-files.ts';

const MOST_FILES = 4000;

/** The profile names in the AWS config file. The credentials file is never opened. */
export function awsProfiles(
  file = process.env['AWS_CONFIG_FILE'] ?? path.join(os.homedir(), '.aws', 'config'),
): string[] {
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const names = [...text.matchAll(/^\s*\[\s*(?:profile\s+)?([^\]\s]+)\s*\]/gm)].map(found => found[1] ?? '');
  return [...new Set(names.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

const keysOf = (value: unknown, key: string) => {
  const inner = typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[key] : null;
  return typeof inner === 'object' && inner !== null ? Object.keys(inner) : [];
};

export interface CloneChoices {
  /** The files git tracks, as paths inside the clone. */
  files: string[];
  /** The launch profiles of each launch settings file. */
  profiles: Record<string, string[]>;
  /** The scripts of each package.json. */
  scripts: Record<string, string[]>;
}
/** What a clone holds to pick from; empty when there is none. */
export function cloneChoices(dir: string | undefined): CloneChoices {
  const none: CloneChoices = { files: [], profiles: {}, scripts: {} };
  if (!dir) return none;
  let listed = '';
  try {
    listed = execFileSync('git', ['-C', dir, 'ls-files', '-z'], {
      encoding: 'utf8',
      timeout: 5000,
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return none;
  }
  const all = listed.split('\0').filter(Boolean);
  const named = (name: string) => all.filter(file => path.posix.basename(file) === name).slice(0, 40);
  const read = (files: string[], key: string) =>
    Object.fromEntries(files.map(file => [file, keysOf(readJson(path.join(dir, file)), key)]));
  return {
    files: all.slice(0, MOST_FILES),
    profiles: read(named('launchSettings.json'), 'profiles'),
    scripts: read(
      named('package.json').filter(file => !file.includes('node_modules/')),
      'scripts',
    ),
  };
}
