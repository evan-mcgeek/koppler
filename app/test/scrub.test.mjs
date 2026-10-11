import assert from 'node:assert/strict';
import { redact, scrub } from '../dist/scrub.mjs';

// Secrets are masked; what is around them stays readable.
for (const [raw, masked] of [
  ['Host=db;Password=s3cr3t!;Database=orders', 'Host=db;Password=***;Database=orders'],
  ['Host=db;Password="two words";Database=orders', 'Host=db;Password="***";Database=orders'],
  ['"client_secret": "abc123", "x": 1', '"client_secret": "***", "x": 1'],
  ['{\\"password\\":\\"two words\\",\\"x\\":1}', '{\\"password\\":\\"***\\",\\"x\\":1}'],
  ['aws_secret_access_key=wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY region eu', 'aws_secret_access_key=*** region eu'],
  ['DB_PASSWORD: hunter2', 'DB_PASSWORD: ***'],
  ['Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefgh', 'Authorization: Bearer ***jwt***'],
  ['Authorization: Bearer abcdefghijklmnop rejected', 'Authorization: Bearer *** rejected'],
  ['postgres://admin:pa55word@db.internal/orders refused', 'postgres://***:***@db.internal/orders refused'],
  ['pushed with ghp_abcdefghijklmnopqrstuv and xoxb-1234567890-abc', 'pushed with ***token*** and ***token***'],
  ['key AKIAABCDEFGHIJKLMNOP used', 'key ***aws-key*** used'],
  ['\x1b[32minfo\x1b[0m: Now listening on: http://localhost:58000', 'info: Now listening on: http://localhost:58000'],
  ['TokenCount=5, secretsmanager:GetSecretValue denied', 'TokenCount=5, secretsmanager:GetSecretValue denied'],
]) assert.equal(redact(raw), masked);

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
