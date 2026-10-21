import './sandbox.mjs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { configDir, stateDir, tempDir } from '../dist/paths.js';

const app = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const sandbox = process.env.KOPPLER_TEST_SANDBOX;

test('Every test run loads the sandbox before anything else.', () => {
  for (const file of fs.readdirSync(path.join(app, 'test')).filter(name => name.endsWith('.test.mjs'))) {
    const first = fs.readFileSync(path.join(app, 'test', file), 'utf8').match(/^import .*$/m)?.[0];
    assert.equal(first, "import './sandbox.mjs';", `${file} imports the sandbox first`);
  }
  for (const config of ['playwright.config.ts', 'screenshots.config.ts'])
    assert.match(fs.readFileSync(path.join(app, config), 'utf8').match(/^import .*$/m)?.[0] ?? '', /^import '\.\/test\/sandbox\.mjs';$/, config);
  assert.match(fs.readFileSync(path.join(app, 'vitest.config.ts'), 'utf8'), /setupFiles: \['test\/sandbox\.mjs'\]/);
});

test('Home, state, run and config folders all lie in the sandbox.', () => {
  for (const dir of [os.homedir(), stateDir(), tempDir(), configDir()]) assert.ok(dir.startsWith(sandbox + path.sep), dir);
});

test('Under test, a folder pointed at the user\'s own state or config is refused before anything is read or written.', () => {
  const own = os.userInfo().homedir;
  for (const [name, dir] of [['KOPPLER_STATE', '.local/state/koppler'], ['KOPPLER_TEMP', '.local/state/koppler/run'], ['KOPPLER_CONFIG_DIR', '.config/koppler']]) {
    const code = `import('${path.join(app, 'dist', 'paths.js')}').then(p => { try { p.stateDir(); p.tempDir(); p.configDir(); } catch (e) { console.log(e.message); } })`;
    const r = spawnSync('node', ['-e', code], { env: { ...process.env, [name]: path.join(own, dir) }, encoding: 'utf8' });
    assert.match(r.stdout, /a test reached .*; tests keep to their sandbox/, name);
  }
});

test('A run filtered by name leaves the stack in use and its run files in the home it was given as they were.', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-home-'));
  const put = (file, text) => { fs.mkdirSync(path.dirname(path.join(home, file)), { recursive: true }); fs.writeFileSync(path.join(home, file), text); };
  const stack = JSON.stringify({ name: 'Shop', envs: ['qa'], apps: {} });
  put('.config/koppler/config.json', JSON.stringify({ stack: path.join(home, '.config/koppler/stacks/shop') }));
  put('.config/koppler/stacks/shop/stack.json', stack);
  put('.local/state/koppler/run/registry.json', stack);
  put('.local/state/koppler/run/state.json', '{"env":"qa","nodes":{}}');
  put('.local/state/koppler/run/history.jsonl', '');
  const files = () => fs.readdirSync(home, { recursive: true }).sort().map(file => [file, fs.statSync(path.join(home, file)).isFile() ? fs.readFileSync(path.join(home, file), 'utf8') : '']);
  const before = files();
  const env = { ...process.env, HOME: home };
  for (const name of ['KOPPLER_TEST_SANDBOX', 'KOPPLER_STATE', 'KOPPLER_TEMP', 'KOPPLER_LOGS', 'KOPPLER_CONFIG_DIR', 'XDG_STATE_HOME', 'XDG_CONFIG_HOME', 'NODE_TEST_CONTEXT']) delete env[name];
  try {
    // Each of these once moved the run files aside or rewrote the registry when run on its own.
    for (const [pattern, file] of [['A new stack', 'sync'], ['Stacks already on the Mac', 'sync'], ['Only known fields are kept', 'runs']])
      spawnSync('node', ['--test', `--test-name-pattern=${pattern}`, `test/${file}.test.mjs`], { cwd: app, env, encoding: 'utf8' });
    assert.deepEqual(files(), before);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
