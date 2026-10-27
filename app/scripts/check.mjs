// Every check CI runs, from its own npm scripts, side by side where they do not depend on each other: lint, types and
// format from the start; the unit, command and browser tests at once as soon as the build is there.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const logs = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-check-'));
const run = (name, args) =>
  new Promise(resolve => {
    const started = Date.now();
    const log = path.join(logs, `${name}.log`);
    const out = fs.openSync(log, 'w');
    const child = spawn(args[0], args.slice(1), {
      stdio: ['ignore', out, out],
      env: { ...process.env, FORCE_COLOR: '0' },
    });
    child.on('exit', code => {
      fs.closeSync(out);
      const seconds = Math.round((Date.now() - started) / 1000);
      console.log(`${code === 0 ? 'ok  ' : 'FAIL'} ${name.padEnd(9)} ${String(seconds).padStart(4)}s`);
      resolve({ name, ok: code === 0, log });
    });
  });
const npm = script => ['npm', 'run', '--silent', script];

const started = Date.now();
const checks = [run('lint', npm('lint')), run('types', npm('types')), run('format', npm('format:check'))];
const build = await run('build', npm('build'));
const tests = build.ok
  ? [
      run('unit', npm('test:unit')),
      run('commands', npm('test:commands')),
      run('browser', ['npx', 'playwright', 'test']),
    ]
  : [];
const steps = [build, ...(await Promise.all([...checks, ...tests]))];
const built = build.ok;
const failed = steps.filter(step => !step.ok);
for (const step of failed) {
  console.log(`\n--- ${step.name}: the end of ${step.log}`);
  console.log(fs.readFileSync(step.log, 'utf8').trimEnd().split('\n').slice(-30).join('\n'));
}
if (!built) console.log('\nThe tests did not run: the build failed.');
console.log(
  `\n${failed.length ? 'FAILED' : 'All passed'} in ${String(Math.round((Date.now() - started) / 1000))}s. Logs: ${logs}`,
);
process.exit(failed.length || !built ? 1 : 0);
