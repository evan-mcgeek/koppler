#!/usr/bin/env node
// Koppler from this checkout: installs what a pull added and builds dist/ first when the source is newer, then runs it. Link it as `koppler` while
// working on Koppler itself; an installed Koppler runs dist/koppler.mjs directly.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const app = path.resolve(path.dirname(fs.realpathSync(fileURLToPath(import.meta.url))), '..');
const newest = dir =>
  Math.max(
    0,
    ...fs
      .readdirSync(dir, { withFileTypes: true })
      .map(e => (e.isDirectory() ? newest(path.join(dir, e.name)) : fs.statSync(path.join(dir, e.name)).mtimeMs)),
  );
const changed = file => fs.statSync(path.join(app, file), { throwIfNoEntry: false })?.mtimeMs ?? 0;
if (changed('package-lock.json') > changed('node_modules/.package-lock.json')) {
  const install = spawnSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: app, stdio: ['ignore', 2, 2] });
  if (install.status !== 0) process.exit(install.status ?? 1);
}
const built = changed('dist/.built');
if (Math.max(newest(path.join(app, 'src')), newest(path.join(app, 'canvas'))) > built) {
  const build = spawnSync(process.execPath, [path.join(app, 'scripts', 'build.mjs')], { stdio: ['ignore', 2, 2] });
  if (build.status !== 0) process.exit(build.status ?? 1);
}
const run = spawnSync(process.execPath, [path.join(app, 'dist', 'koppler.mjs'), ...process.argv.slice(2)], {
  stdio: 'inherit',
});
process.exit(run.status ?? 1);
