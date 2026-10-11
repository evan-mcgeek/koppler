import { expect, test } from 'vitest';
import { aliasReady, describePlan, planSteps, planTunnels, tunnelKind, type Tunnel } from './ports.ts';

const must = (tunnel: Tunnel | undefined): Tunnel => {
  if (!tunnel) throw new Error('the plan has no such tunnel');
  return tunnel;
};

test('what a tunnel reaches: the stack says, or the host name hints', () => {
  expect(tunnelKind({ tunnel: 'valkey-shop-dev.internal' })).toBe('Cache (Valkey)');
  expect(tunnelKind({ tunnel: 'db-orders-qa.internal' })).toBe('Database');
  expect(tunnelKind({ tunnel: 'aurora-acme-dev.internal' })).toBe('Database (Aurora)');
  expect(tunnelKind({ tunnel: 'feedback.internal' })).toBe('Tunnel');
  expect(tunnelKind({ tunnel: 'x', what: 'Search (OpenSearch)' })).toBe('Search (OpenSearch)');
});

test('apps that need the same host and port share one tunnel', () => {
  const plan = planTunnels([
    { app: 'a', tunnel: 'db.x', port: 5432 },
    { app: 'b', tunnel: 'db.x', port: 5432 },
  ]);
  expect(plan).toHaveLength(1);
  expect(plan[0]?.apps).toEqual(['a', 'b']);
  expect(describePlan(plan)[0]).toMatch(/share one database tunnel/);
  expect(describePlan(planTunnels([{ app: 'a', tunnel: 'h1', port: 6379 }]))).toEqual([]);
});

test('two hosts on one port: the one that can move goes to a free port, and its app is told where', () => {
  const plan = planTunnels(
    [
      { app: 'orders', tunnel: 'db-orders', port: 5432, env: 'AppSettings__ordersDb' },
      { app: 'accounts', tunnel: 'aurora', port: 5432 },
    ],
    [5434],
  );
  const orders = must(plan.find(t => t.host === 'db-orders'));
  expect(must(plan.find(t => t.host === 'aurora')).port).toBe(5432);
  expect(orders.port).toBe(5435);
  expect(orders.settings).toEqual([{ app: 'orders', env: 'AppSettings__ordersDb', value: 'localhost:5435' }]);
  expect(planSteps(orders).name).toBe('tunnel-db-orders-5435');
  expect(planSteps(orders).tunnel).toBe('cloudflared access tcp --hostname db-orders --url localhost:5435');
  expect(describePlan(plan, app => app.toUpperCase())).toEqual([
    "ORDERS's database tunnel moves from port 5432 to 5435, to make room for ACCOUNTS's database tunnel.",
  ]);
});

test('neither can move: the second keeps the port on an address of its own', () => {
  const plan = planTunnels([
    { app: 'a', tunnel: 'h1', port: 5432 },
    { app: 'b', tunnel: 'h2', port: 5432 },
  ]);
  const aliased = must(plan.find(t => t.needsAlias));
  expect([aliased.bind, aliased.port]).toEqual(['127.0.0.2', 5432]);
  expect(planSteps(aliased).sudo).toEqual([
    'sudo ifconfig lo0 alias 127.0.0.2 up',
    "sudo sed -i .koppler.bak -E 's/[[:space:]]+h2([[:space:]]|$)/\\1/' /etc/hosts",
    "echo '127.0.0.2 h2' | sudo tee -a /etc/hosts",
  ]);
  expect(planSteps(aliased).undo).toEqual([
    'sudo mv /etc/hosts.koppler.bak /etc/hosts',
    'sudo ifconfig lo0 -alias 127.0.0.2',
  ]);
  // Two tunnels on one port are told apart by name.
  expect(planSteps(aliased).name).toBe('tunnel-h2-5432-on-127-0-0-2');
  expect(planSteps(must(plan.find(t => !t.needsAlias))).name).toBe('tunnel-h1-5432');
  expect(describePlan(plan).join(' ')).toBe(
    "b's tunnel keeps port 5432 on its own address, 127.0.0.2, next to a's tunnel. Needs a one-time sudo step.",
  );
});

test('a tunnel on its own address can start once the address is in place', () => {
  const tunnel = { host: 'h2', bind: '127.0.0.2' };
  const lo0 =
    'lo0: flags=8049<UP,LOOPBACK,RUNNING,MULTICAST> mtu 16384\n\tinet 127.0.0.1 netmask 0xff000000\n\tinet 127.0.0.2 netmask 0xff000000\n';
  expect(aliasReady(tunnel, '127.0.0.1 localhost\n127.0.0.2 h2\n', lo0)).toBe(true);
  expect(aliasReady(tunnel, '127.0.0.1 localhost\n127.0.0.2 h2\n', null)).toBe(true);
  expect(aliasReady(tunnel, '127.0.0.1 localhost\n', lo0)).toBe(false);
  // The first line that names the host wins.
  expect(aliasReady(tunnel, '127.0.0.1 localhost h2\n127.0.0.2 h2\n', lo0)).toBe(false);
  expect(aliasReady(tunnel, '# 127.0.0.2 h2\n', lo0)).toBe(false);
  expect(aliasReady(tunnel, '127.0.0.2 h2\n', lo0.replace('\tinet 127.0.0.2 netmask 0xff000000\n', ''))).toBe(false);
  expect(aliasReady(tunnel, '127.0.0.20 h2\n', lo0)).toBe(false);
});

test('when the app dials another name, that name is the one that moves', () => {
  const plan = planTunnels([
    { app: 'a', tunnel: 'h1', port: 5432 },
    { app: 'b', tunnel: 'aurora.internal', port: 5432, connectsAs: 'db.cluster.rds.amazonaws.com' },
  ]);
  const steps = planSteps(must(plan.find(t => t.needsAlias)));
  expect(steps.sudo[2]).toBe("echo '127.0.0.2 db.cluster.rds.amazonaws.com' | sudo tee -a /etc/hosts");
  expect(steps.sudo[1]).toMatch(/db\\\.cluster\\\.rds/);
});

test('a host is never read as shell syntax, even one that got past the stack check', () => {
  const steps = planSteps({ host: 'db.acme.dev; touch /tmp/x #', bind: 'localhost', port: 5432 });
  expect(steps.tunnelArgs).toEqual([
    'cloudflared',
    'access',
    'tcp',
    '--hostname',
    'db.acme.dev; touch /tmp/x #',
    '--url',
    'localhost:5432',
  ]);
  expect(steps.tunnel).toMatch(/--hostname 'db\.acme\.dev; touch \/tmp\/x #'/);
});
