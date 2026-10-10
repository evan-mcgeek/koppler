import assert from 'node:assert/strict';
import ports from '../src/ports.js';
const { planTunnels, describePlan, planSteps, tunnelKind, aliasReady } = ports;

assert.equal(tunnelKind({ tunnel: 'valkey-connect-cc-dev.internal' }), 'Cache (Valkey)');
assert.equal(tunnelKind({ tunnel: 'db-atlantis-academics-qa.internal' }), 'Database');
assert.equal(tunnelKind({ tunnel: 'aurora-acme-dev.internal' }), 'Database (Aurora)');
assert.equal(tunnelKind({ tunnel: 'feedback.internal' }), 'Tunnel');
assert.equal(tunnelKind({ tunnel: 'x', what: 'Search (OpenSearch)' }), 'Search (OpenSearch)');

// Same host and port: one shared tunnel.
let plan = planTunnels([{ app: 'a', tunnel: 'db.x', port: 5432 }, { app: 'b', tunnel: 'db.x', port: 5432 }]);
assert.equal(plan.length, 1);
assert.deepEqual(plan[0].apps, ['a', 'b']);
assert.match(describePlan(plan)[0], /share one database tunnel/);

// Different hosts on one port: the one that cannot move keeps it, the movable one moves to a free port.
plan = planTunnels([
  { app: 'academics', tunnel: 'db-academics', port: 5432, env: 'AppSettings__dbUrlAcademics' },
  { app: 'accounts', tunnel: 'aurora', port: 5432 },
], [5434]);
const academics = plan.find(t => t.host === 'db-academics'), accounts = plan.find(t => t.host === 'aurora');
assert.equal(accounts.port, 5432);
assert.equal(academics.port, 5435);
assert.deepEqual(academics.settings, [{ app: 'academics', env: 'AppSettings__dbUrlAcademics', value: 'localhost:5435' }]);
assert.equal(planSteps(academics).name, 'tunnel-db-academics-5435');
assert.equal(planSteps(academics).tunnel, 'cloudflared access tcp --hostname db-academics --url localhost:5435');

// Neither can move: the second keeps the port on its own loopback address.
plan = planTunnels([{ app: 'a', tunnel: 'h1', port: 5432 }, { app: 'b', tunnel: 'h2', port: 5432 }]);
const aliased = plan.find(t => t.needsAlias);
assert.equal(aliased.bind, '127.0.0.2');
assert.equal(aliased.port, 5432);
assert.deepEqual(planSteps(aliased).sudo, ['sudo ifconfig lo0 alias 127.0.0.2 up', "sudo sed -i .koppler.bak -E 's/[[:space:]]+h2([[:space:]]|$)/\\1/' /etc/hosts", "echo '127.0.0.2 h2' | sudo tee -a /etc/hosts"]);
assert.deepEqual(planSteps(aliased).undo, ['sudo mv /etc/hosts.koppler.bak /etc/hosts', 'sudo ifconfig lo0 -alias 127.0.0.2']);
// Two tunnels on one port are told apart by name, and the aliased one can start once its address is in place.
assert.equal(planSteps(aliased).name, 'tunnel-h2-5432-on-127-0-0-2');
assert.notEqual(planSteps(aliased).name, planSteps(plan.find(t => !t.needsAlias)).name);
{
  const lo0 = 'lo0: flags=8049<UP,LOOPBACK,RUNNING,MULTICAST> mtu 16384\n\tinet 127.0.0.1 netmask 0xff000000\n\tinet 127.0.0.2 netmask 0xff000000\n';
  assert.equal(aliasReady(aliased, '127.0.0.1 localhost\n127.0.0.2 h2\n', lo0), true);
  assert.equal(aliasReady(aliased, '127.0.0.1 localhost\n127.0.0.2 h2\n', null), true);
  assert.equal(aliasReady(aliased, '127.0.0.1 localhost\n', lo0), false);
  assert.equal(aliasReady(aliased, '127.0.0.1 localhost h2\n127.0.0.2 h2\n', lo0), false);
  assert.equal(aliasReady(aliased, '# 127.0.0.2 h2\n', lo0), false);
  assert.equal(aliasReady(aliased, '127.0.0.2 h2\n', lo0.replace('\tinet 127.0.0.2 netmask 0xff000000\n', '')), false);
  assert.equal(aliasReady({ ...aliased, bind: '127.0.0.2' }, '127.0.0.20 h2\n', lo0), false);
}
// The app dials another name (e.g. a database endpoint from a secret): that name is the one that moves.
const dialed = planTunnels([{ app: 'a', tunnel: 'h1', port: 5432 }, { app: 'b', tunnel: 'aurora.internal', port: 5432, connectsAs: 'db.cluster.rds.amazonaws.com' }]).find(t => t.needsAlias);
assert.equal(planSteps(dialed).sudo[2], "echo '127.0.0.2 db.cluster.rds.amazonaws.com' | sudo tee -a /etc/hosts");
assert.match(planSteps(dialed).sudo[1], /db\\\.cluster\\\.rds/);
assert.equal(describePlan(plan).join(' '), "b's tunnel keeps port 5432 on its own address, 127.0.0.2, next to a's tunnel. Needs a one-time sudo step.");

// No conflict, nothing to say.
assert.deepEqual(describePlan(planTunnels([{ app: 'a', tunnel: 'h1', port: 6379 }])), []);
// The tunnel runs as a list of arguments: a host can never be read as shell syntax, even if it got past the stack check.
{
  const steps = planSteps({ host: 'db.acme.dev; touch /tmp/x #', bind: 'localhost', port: 5432 });
  assert.deepEqual(steps.tunnelArgs, ['cloudflared', 'access', 'tcp', '--hostname', 'db.acme.dev; touch /tmp/x #', '--url', 'localhost:5432']);
  assert.match(steps.tunnel, /--hostname 'db\.acme\.dev; touch \/tmp\/x #'/);
}
console.log('ok');
