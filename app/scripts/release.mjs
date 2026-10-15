// Releases Koppler: bumps the version in app/, commits and tags it on main, and pushes both; the tag starts the Release
// workflow, which checks and publishes it. Usage: npm run release -- <patch | minor | major | x.y.z>
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const git = (...args) => execFileSync('git', args, { cwd: app, encoding: 'utf8' }).trim();
const stop = message => {
  console.error(message);
  process.exit(1);
};

const bump = process.argv[2] ?? '';
if (!/^(patch|minor|major|\d+\.\d+\.\d+)$/.test(bump))
  stop('usage: npm run release -- <patch | minor | major | x.y.z>');
if (git('branch', '--show-current') !== 'main') stop('releases are made from main');
if (git('status', '--porcelain')) stop('main has changes that are not committed');
git('fetch', '--quiet', 'origin', 'main');
if (git('rev-parse', 'HEAD') !== git('rev-parse', 'origin/main'))
  stop('main is not the same as origin/main: pull first');

// The package is in app/, not at the repo's root, so npm bumps it but leaves the commit and the tag to this script.
execFileSync('npm', ['version', bump, '--no-git-tag-version'], { cwd: app, stdio: 'ignore' });
const { version } = JSON.parse(fs.readFileSync(path.join(app, 'package.json'), 'utf8'));
const tag = `v${version}`;
git('commit', '--quiet', '-m', `Koppler ${version}`, '--', 'package.json', 'package-lock.json');
git('tag', '-a', tag, '-m', `Koppler ${version}`);
git('push', '--quiet', 'origin', 'main', tag);
console.log(`${tag} pushed: the Release workflow checks and publishes it (gh run watch, or the Actions tab).`);
