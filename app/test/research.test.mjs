import assert from 'node:assert/strict';
import { find, score, words } from '../src/research.mjs';

assert.deepEqual(words('PushNotification-Service'), ['push', 'notification']);
assert.equal(score('push notification service', 'push-notification-service'), 1);
assert.ok(score('push notifications', 'acme-scheduledtask-pushnotifications') > score('push notifications', 'Legacy-WinService-PushVisits'));
assert.ok(score('wallet api', 'acme-wallet-api') >= 0.5);
assert.equal(score('wallet', 'payments'), 0);

// The stack first, then this Mac's clones; GitHub only when asked (not in tests).
const registry = { apps: { 'acme-wallet-api': { name: 'Acme Wallet API', slug: 'acme/acme-wallet-api' } } };
const index = { repos: [{ path: process.cwd(), keys: ['github.com/acme/push-notification-service'] }, { path: '/definitely/missing', keys: ['github.com/acme/push-gone'] }] };
const [wallet, push, none] = await find(['wallet', 'push notifications', 'kafka'], { registry, index, github: false });
assert.deepEqual(wallet.candidates.map(c => [c.where, c.app]), [['stack', 'acme-wallet-api']]);
assert.deepEqual(push.candidates.map(c => [c.where, c.slug]), [['clone', 'acme/push-notification-service']]);
assert.equal(none.candidates.length, 0);
console.log('research tests ok');
