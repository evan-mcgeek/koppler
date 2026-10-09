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
