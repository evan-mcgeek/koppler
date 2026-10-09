import assert from 'node:assert/strict';
import { scrub } from '../src/scrub.mjs';

const registry = {
  name: 'Acme Shop',
  apps: {
    'orders-api': { name: 'Orders API', slug: 'acme-corp/orders-service', url: 'http://localhost:5001', deployedUrl: 'https://orders.acme.dev' },
    web: { name: 'Web', slug: 'acme-corp/web', prereqs: [{ tunnel: 'db.internal.acme.dev', port: 5432 }] },
  },
  queues: { 'order-events': { name: 'Order events', type: 'sqs', envs: { prod: { queue: 'orders-prod.fifo' } } } },
};
const at = { home: '/Users/jane.doe', user: 'jane.doe' };

const out = scrub([
  'Orders API (orders-api) failed calling https://orders.acme.dev/v1 from /Users/jane.doe/src/orders-service',
  'tunnel db.internal.acme.dev:5432 for Web; Acme Shop board; queue orders-prod.fifo',
  'Password=hunter2; postgres://admin:pa55@10.1.2.3/db; Authorization: Bearer abcdefghijkl; ghp_abcdefghijklmnop',
  'branch CA-13060+fix by jane.doe <jane.doe@acme.com>, account 123456789012, local http://localhost:5001 and 127.0.0.1',
].join('\n'), registry, at);

for (const leak of ['Orders API', 'orders-api', 'acme', 'orders-service', 'jane', 'hunter2', 'pa55', 'abcdefghijkl', '10.1.2.3', 'CA-13060', '123456789012', 'orders-prod'])
  assert.ok(!out.toLowerCase().includes(leak.toLowerCase()), `leaked ${leak}:\n${out}`);
// Shape and the generic parts stay readable.
assert.match(out, /App 1 \(app-1\) failed calling https:\/\/host-\d+\.example\/v1 from ~\/src\/repo-1/);
assert.match(out, /localhost:5001 and 127\.0\.0\.1/);
assert.match(out, /my-stack-1 board/);
// Every stack on the machine counts, and a long name glued to other text is still found.
assert.equal(scrub('.NETBilling Service and orders-api', [registry, { name: 'Old', apps: { billing: { name: 'Billing Service' } } }], at), '.NETApp 3 and app-1');
// The name as code writes it ("OrdersApi", "AcmeShop.Orders") is found too.
assert.equal(scrub('src/OrdersAPI/AcmeShop.cs', registry, at), 'src/App1/my-stack-1.cs');
// Board names, from the stack's presets or the user's own saved boards.
assert.equal(scrub('opened Checkout chain', [registry, { presets: [{ name: 'Checkout chain' }] }], at), 'opened Board 1');
// The same name always gets the same placeholder.
assert.equal(scrub('orders-api orders-api', registry, at), 'app-1 app-1');
// Without a stack it still masks the generic things.
assert.equal(scrub('/Users/jane.doe/x jane.doe', null, at), '~/x user');
console.log('scrub ok');
