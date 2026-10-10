import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// koppler down: stops what Koppler runs and undoes every logged change, branch last, set-aside changes back.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-down-')), repo = path.join(dir, 'repo');
const env = { ...process.env, KOPPLER_STATE: dir, KOPPLER_TEMP: dir, KOPPLER_CONFIG_DIR: dir };
const koppler = (...args) => { const r = spawnSync('node', [path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'koppler.mjs'), ...args], { encoding: 'utf8', env }); return { out: (r.stdout + r.stderr).trim(), code: r.status }; };
const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
fs.mkdirSync(path.join(repo, 'Properties'), { recursive: true });
git('init', '-q', '-b', 'develop'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
fs.writeFileSync(path.join(repo, 'Startup.cs'), 'validate = true;\n');
fs.writeFileSync(path.join(repo, 'Properties/launchSettings.json'), JSON.stringify({ profiles: { QA: { environmentVariables: { A: '1' } } } }, null, 2) + '\n');
git('add', '.'); git('commit', '-qm', 'one'); git('branch', 'feature/x');
fs.writeFileSync(path.join(dir, 'registry.js'), `window.REGISTRY = ${JSON.stringify({ envs: ['qa'], apps: { api: { name: 'API' } } })};`);
fs.writeFileSync(path.join(dir, 'local.js'), `window.LOCAL = ${JSON.stringify({ apps: { api: { path: repo } } })};`);

// The run: branch switched over a set-aside change, then an edit, a new launch profile and an env file, all logged.
fs.writeFileSync(path.join(repo, 'mine.txt'), 'my work\n');
assert.equal(koppler('switch', 'api', 'feature/x', '--set-aside').code, 0);
const log = JSON.parse(fs.readFileSync(path.join(dir, 'actions.json'), 'utf8'));
fs.writeFileSync(path.join(repo, 'Startup.cs'), 'validate = false;\n');
const ls = path.join(repo, 'Properties/launchSettings.json'), settings = JSON.parse(fs.readFileSync(ls, 'utf8'));
settings.profiles['QA-LOCAL'] = { environmentVariables: { B: '2' } }; fs.writeFileSync(ls, JSON.stringify(settings, null, 2) + '\n');
fs.writeFileSync(path.join(repo, '.env.local'), 'API_URL=http://localhost:5001\n');
log.push({ kind: 'edit', app: 'api', file: path.join(repo, 'Startup.cs'), before: 'validate = true;', after: 'validate = false;' },
  { kind: 'profile', app: 'api', file: ls, name: 'QA-LOCAL', created: true },
  { kind: 'env-file', app: 'api', file: path.join(repo, '.env.local'), lines: ['API_URL=http://localhost:5001'], created: true });
fs.writeFileSync(path.join(dir, 'actions.json'), JSON.stringify(log));
fs.writeFileSync(path.join(dir, 'history.jsonl'), JSON.stringify({ id: 'stop00001', at: new Date().toISOString(), kind: 'stop', nodes: {}, edges: [] }) + '\n');
koppler('run', 'api', '--', 'sleep', '30');

const r = koppler('down', '--run', 'stop00001');
assert.equal(r.code, 0, r.out);
assert.match(r.out, /api: stopped/);
assert.equal(git('rev-parse', '--abbrev-ref', 'HEAD'), 'develop');
assert.equal(fs.readFileSync(path.join(repo, 'Startup.cs'), 'utf8'), 'validate = true;\n');
assert.equal(JSON.parse(fs.readFileSync(ls, 'utf8')).profiles['QA-LOCAL'], undefined);
assert.equal(fs.existsSync(path.join(repo, '.env.local')), false);
assert.equal(fs.readFileSync(path.join(repo, 'mine.txt'), 'utf8'), 'my work\n');
assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'actions.json'), 'utf8')), []);
assert.match(fs.readFileSync(path.join(dir, 'history.jsonl'), 'utf8'), /"id":"stop00001","event":"done"/);

// An edit changed since Koppler made it is not guessed: it stays for the agent, and the Stop stays open.
fs.writeFileSync(path.join(repo, 'Startup.cs'), 'someone else changed it\n');
fs.writeFileSync(path.join(dir, 'actions.json'), JSON.stringify([{ kind: 'edit', app: 'api', file: path.join(repo, 'Startup.cs'), before: 'validate = true;', after: 'validate = false;' }]));
const again = koppler('down');
assert.equal(again.code, 3, again.out);
assert.match(again.out, /Left for the agent:[\s\S]*changed since Koppler edited it/);
assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'actions.json'), 'utf8')).length, 1);
console.log('down tests ok');

// Reverting text that holds $& or $' (regexes, shell, templates) puts it back exactly, not as replacement patterns.
{
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-down-dollar-')), file = path.join(d, 'match.js');
  const e = { ...process.env, KOPPLER_STATE: d, KOPPLER_TEMP: d, KOPPLER_CONFIG_DIR: d };
  const before = "const re = /^a$/; const s = x.replace(re, '$&-$\\'');", after = 'const re = null;';
  fs.writeFileSync(file, `// top\n${after}\n// bottom\n`);
  fs.writeFileSync(path.join(d, 'registry.js'), `window.REGISTRY = ${JSON.stringify({ envs: ['qa'], apps: { api: { name: 'API' } } })};`);
  fs.writeFileSync(path.join(d, 'actions.json'), JSON.stringify([{ kind: 'edit', app: 'api', file, before, after }]));
  const out = spawnSync('node', [path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'koppler.mjs'), 'down'], { encoding: 'utf8', env: e });
  assert.equal(out.status, 0, out.stdout + out.stderr);
  assert.equal(fs.readFileSync(file, 'utf8'), `// top\n${before}\n// bottom\n`);
}

// Stop leaves the user's own work as it was: formatting, lines of their own, files they edited since, and the right branch.
{
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-down-own-')), app = path.join(d, 'app'), bin = path.join(d, 'bin');
  const e = { ...process.env, KOPPLER_STATE: d, KOPPLER_TEMP: d, KOPPLER_CONFIG_DIR: d, PATH: `${bin}:${process.env.PATH}` };
  const k = (...args) => { const r = spawnSync('node', [path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'koppler.mjs'), ...args], { encoding: 'utf8', env: e }); return { out: (r.stdout + r.stderr).trim(), code: r.status }; };
  const g = (...a) => execFileSync('git', ['-C', app, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  fs.mkdirSync(path.join(app, 'Properties'), { recursive: true }); fs.mkdirSync(bin);
  // A stand-in for npm that notes which branch it was run on.
  fs.writeFileSync(path.join(bin, 'npm'), `#!/bin/sh\ngit rev-parse --abbrev-ref HEAD > "${d}/npm-ran-on"\n`, { mode: 0o755 });
  g('init', '-q', '-b', 'develop'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('config', 'core.autocrlf', 'false');
  // As Visual Studio writes it: a byte order mark, four spaces, Windows line ends, a list on one line.
  const ls = path.join(app, 'Properties/launchSettings.json');
  const original = '﻿{\r\n    "profiles": {\r\n        "QA": {\r\n            "commandLineArgs": ["--a", "--b"],\r\n            "environmentVariables": { "A": "1" }\r\n        }\r\n    }\r\n}\r\n';
  fs.writeFileSync(ls, original);
  fs.writeFileSync(path.join(app, '.gitignore'), '.env.local\npubspec_overrides.yaml\n');
  fs.writeFileSync(path.join(app, 'package.json'), '{"name":"app"}\n');
  g('add', '.'); g('commit', '-qm', 'one'); g('branch', 'feature/x');
  fs.writeFileSync(path.join(d, 'registry.js'), `window.REGISTRY = ${JSON.stringify({ envs: ['qa'], apps: { app: { name: 'App' } } })};`);
  fs.writeFileSync(path.join(d, 'local.js'), `window.LOCAL = ${JSON.stringify({ apps: { app: { path: app } } })};`);
  assert.equal(k('switch', 'app', 'feature/x').code, 0);
  const log = JSON.parse(fs.readFileSync(path.join(d, 'actions.json'), 'utf8'));

  // A new profile and a changed one, written the way the file is.
  fs.writeFileSync(ls, original.replace('{ "A": "1" }', '{ "A": "2" }').replace('        }\r\n    }', '        },\r\n        "QA-LOCAL": {\r\n            "environmentVariables": { "B": "2" }\r\n        }\r\n    }'));
  log.push({ kind: 'profile', app: 'app', file: ls, name: 'QA', previous: { A: '1' } }, { kind: 'profile', app: 'app', file: ls, name: 'QA-LOCAL', created: true });
  // The user already had the very line Koppler added.
  const envFile = path.join(app, '.env.local');
  fs.writeFileSync(envFile, 'API_URL=http://localhost:5001\nMINE=1\nAPI_URL=http://localhost:5001\n');
  log.push({ kind: 'env-file', app: 'app', file: envFile, lines: ['API_URL=http://localhost:5001'] });
  fs.writeFileSync(path.join(d, 'actions.json'), JSON.stringify(log));
  // A local library, after which the user adds an override of their own.
  const { link } = await import('../src/libraries.mjs');
  process.env.PATH = e.PATH;
  const overrides = path.join(app, 'pubspec_overrides.yaml');
  link('app', app, [{ name: 'ui_kit', ecosystem: 'dart', path: '/libs/ui_kit' }, { name: 'left-pad', ecosystem: 'npm', path: '/libs/left-pad' }], path.join(d, 'actions.json'));
  fs.appendFileSync(overrides, '  mine:\n    path: ../mine\n');

  const r = k('down');
  assert.equal(g('rev-parse', '--abbrev-ref', 'HEAD'), 'develop', r.out);
  assert.equal(fs.readFileSync(ls, 'utf8'), original);
  assert.equal(g('status', '--porcelain'), '');
  assert.equal(fs.readFileSync(envFile, 'utf8'), 'API_URL=http://localhost:5001\nMINE=1\n');
  assert.equal(fs.readFileSync(path.join(d, 'npm-ran-on'), 'utf8').trim(), 'develop');
  // The file the user edited is theirs to sort out: it stays, and so does its entry.
  assert.match(fs.readFileSync(overrides, 'utf8'), /mine:/);
  assert.equal(r.code, 3, r.out);
  assert.match(r.out, /pubspec_overrides\.yaml changed since Koppler wrote it/);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(d, 'actions.json'), 'utf8')).map(a => a.kind), ['file']);

  // Untouched since, it goes back to how it was.
  fs.rmSync(overrides); fs.writeFileSync(path.join(d, 'actions.json'), '[]');
  link('app', app, [{ name: 'ui_kit', ecosystem: 'dart', path: '/libs/ui_kit' }], path.join(d, 'actions.json'));
  assert.equal(k('down').code, 0);
  assert.equal(fs.existsSync(overrides), false);
  console.log('down keeps the user\'s own work');
}
