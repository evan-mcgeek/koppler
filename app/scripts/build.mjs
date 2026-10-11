// Builds dist/, the folder Koppler runs from: the TypeScript compiled, and the files the page is served as they are.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
  src = path.join(app, 'src'),
  dist = path.join(app, 'dist');
// Shared modules the page still loads as plain scripts, each under the global name the page calls it by. Gone once the
// page is built from the same modules.
const forPage = { plan: 'KopplerPlan', ports: 'KopplerPorts', presets: 'KopplerPresets', logfmt: 'KopplerLog' };
// Served or read as they are, not compiled.
const asIs = name => /\.(html|cjs|go)$/.test(name) || name === 'fonts';

fs.rmSync(dist, { recursive: true, force: true });
execFileSync(
  process.execPath,
  [path.join(app, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', path.join(app, 'tsconfig.build.json')],
  { stdio: 'inherit' },
);
for (const name of fs.readdirSync(src).filter(asIs))
  fs.cpSync(path.join(src, name), path.join(dist, name), { recursive: true });
for (const [name, globalName] of Object.entries(forPage)) {
  await build({
    entryPoints: [path.join(src, 'core', `${name}.ts`)],
    outfile: path.join(dist, 'page', `${name}.js`),
    bundle: true,
    format: 'iife',
    globalName,
    target: 'es2022',
    logLevel: 'warning',
  });
}
fs.chmodSync(path.join(dist, 'koppler.mjs'), 0o755);
// Read by the development launcher to tell whether the build is older than the source.
fs.writeFileSync(path.join(dist, '.built'), `${new Date().toISOString()}\n`);
