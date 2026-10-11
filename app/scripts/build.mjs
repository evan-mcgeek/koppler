// Builds dist/, the folder Koppler runs from: the TypeScript compiled, and the files the page is served as they are.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
  src = path.join(app, 'src'),
  dist = path.join(app, 'dist'),
  next = path.join(app, 'dist.next'),
  previous = path.join(app, 'dist.previous');
// Shared modules the page still loads as plain scripts, each under the global name the page calls it by. Gone once the
// page is built from the same modules.
const forPage = {
  kinds: 'KopplerKinds',
  plan: 'KopplerPlan',
  ports: 'KopplerPorts',
  presets: 'KopplerPresets',
  logfmt: 'KopplerLog',
};
// Served or read as they are, not compiled.
const asIs = name => /\.(html|go)$/.test(name) || name === 'fonts';

// Built beside the folder in use and swapped in whole at the end: a Koppler that is running keeps its files until
// then, and a build that fails leaves it as it was.
fs.rmSync(next, { recursive: true, force: true });
execFileSync(
  process.execPath,
  [
    path.join(app, 'node_modules', 'typescript', 'bin', 'tsc'),
    '-p',
    path.join(app, 'tsconfig.build.json'),
    '--outDir',
    next,
  ],
  { stdio: 'inherit' },
);
for (const name of fs.readdirSync(src).filter(asIs))
  fs.cpSync(path.join(src, name), path.join(next, name), { recursive: true });
for (const [name, globalName] of Object.entries(forPage)) {
  await build({
    entryPoints: [path.join(src, 'core', `${name}.ts`)],
    outfile: path.join(next, 'page', `${name}.js`),
    bundle: true,
    format: 'iife',
    globalName,
    target: 'es2022',
    logLevel: 'warning',
  });
}
fs.chmodSync(path.join(next, 'koppler.mjs'), 0o755);
// Read by the development launcher to tell whether the build is older than the source.
fs.writeFileSync(path.join(next, '.built'), `${new Date().toISOString()}\n`);

fs.rmSync(previous, { recursive: true, force: true });
if (fs.existsSync(dist)) fs.renameSync(dist, previous);
fs.renameSync(next, dist);
fs.rmSync(previous, { recursive: true, force: true });
