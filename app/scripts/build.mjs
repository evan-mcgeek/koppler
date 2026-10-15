// Builds dist/, the folder Koppler runs from: the TypeScript compiled, and the canvas page built beside it.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { build as buildPage, createLogger } from 'vite';
import { fileURLToPath } from 'node:url';

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
  src = path.join(app, 'src'),
  dist = path.join(app, 'dist'),
  next = path.join(app, 'dist.next'),
  previous = path.join(app, 'dist.previous');
// Read as they are, not compiled.
const asIs = name => /\.go$/.test(name);

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
// A warning from the page build fails it, so none reaches whoever runs `koppler canvas`.
const warnings = [];
const logger = createLogger('warn');
logger.warn = message => warnings.push(message);
await buildPage({
  root: path.join(app, 'canvas'),
  configFile: path.join(app, 'canvas', 'vite.config.ts'),
  base: './',
  logLevel: 'warn',
  customLogger: logger,
  build: { outDir: path.join(next, 'page'), emptyOutDir: true },
});
if (warnings.length) {
  fs.rmSync(next, { recursive: true, force: true });
  console.error(warnings.join('\n'));
  process.exit(1);
}
fs.chmodSync(path.join(next, 'koppler.mjs'), 0o755);
// Read by the development launcher to tell whether the build is older than the source.
fs.writeFileSync(path.join(next, '.built'), `${new Date().toISOString()}\n`);

fs.rmSync(previous, { recursive: true, force: true });
if (fs.existsSync(dist)) fs.renameSync(dist, previous);
fs.renameSync(next, dist);
fs.rmSync(previous, { recursive: true, force: true });
