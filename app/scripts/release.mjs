// Releases Koppler: bumps the version in app/ on a branch and opens its pull request; merging it starts the Release
// workflow, which tags and publishes it. Usage: npm run release -- <patch | minor | major | x.y.z>
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = (command, ...args) => execFileSync(command, args, { cwd: app, encoding: 'utf8' }).trim();
const git = (...args) => run('git', ...args);
const stop = message => {
  console.error(message);
  process.exit(1);
};

const bump = process.argv[2] ?? '';
if (!/^(patch|minor|major|\d+\.\d+\.\d+)$/.test(bump))
  stop('usage: npm run release -- <patch | minor | major | x.y.z>');
if (git('status', '--porcelain')) stop('there are changes that are not committed');
git('fetch', '--quiet', 'origin', 'main');
const start = git('branch', '--show-current');

// From main as it is on GitHub, wherever this checkout is.
git('switch', '--quiet', '--detach', 'origin/main');
// The package is in app/, not at the repo's root, so npm bumps it but leaves the commit to this script.
execFileSync('npm', ['version', bump, '--no-git-tag-version'], { cwd: app, stdio: 'ignore' });
const { version } = JSON.parse(fs.readFileSync(path.join(app, 'package.json'), 'utf8'));
const branch = `release/${version}`;
git('switch', '--quiet', '-c', branch);
git('commit', '--quiet', '-m', `Koppler ${version}`, '--', 'package.json', 'package-lock.json');
git('push', '--quiet', '-u', 'origin', branch);
const pr = run(
  'gh',
  'pr',
  'create',
  '--base',
  'main',
  '--title',
  `Koppler ${version}`,
  '--body',
  `Releases Koppler ${version}: merging it tags v${version} and publishes it (the Release workflow, after approval).`,
);
if (start) git('switch', '--quiet', start);
console.log(`${pr}\nMerge it to release ${version}.`);
