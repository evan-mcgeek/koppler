// Builds dist/, the folder Koppler runs from: the TypeScript compiled, and the files the page is served as they are.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
  src = path.join(app, 'src'),
  dist = path.join(app, 'dist');
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
fs.chmodSync(path.join(dist, 'koppler.mjs'), 0o755);
// Read by the development launcher to tell whether the build is older than the source.
fs.writeFileSync(path.join(dist, '.built'), `${new Date().toISOString()}\n`);
