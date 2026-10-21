import './sandbox.mjs';
import assert from 'node:assert/strict';
import net from 'node:net';
import { check, keyValues, parse } from '../dist/secret-check.mjs';
import { test } from 'node:test';

assert.deepEqual(keyValues('Host=db.acme.test; Port=5433;Password="a;b""c";User Id=app'), { host: 'db.acme.test', port: '5433', password: 'a;b"c', 'user id': 'app' });

test('What kind of connection a value is: the stack\'s type wins, else its shape.', async () => {
  const pg = parse('Host=localhost;Port=5437;Database=wallet;Username=root;Password=p;w');
  assert.deepEqual([pg.type, pg.host, pg.port, pg.user, pg.database], ['postgres', 'localhost', 5437, 'root', 'wallet']);
  assert.equal(parse('postgresql://u:p%40ss@db.acme.test/orders').password, 'p@ss');
  assert.equal(parse('server=localhost;port=3306;database=ProductCatalog;user=root;password=x').type, 'mysql');
  assert.equal(parse('Server=db;Database=x;Uid=app;Pwd=y').type, 'mysql');
  assert.equal(parse('Server=db;Database=x;User Id=app;Password=y').type, null);
  assert.equal(parse('Server=db;Database=x;User Id=app;Password=y', 'postgres').type, 'postgres');
  assert.deepEqual(parse('cache.acme.test:6380,password=s3,ssl=True,abortConnect=false'), { type: 'redis', host: 'cache.acme.test', port: 6380, user: '', password: 's3', tls: true });
  assert.deepEqual(parse('localhost:6379'), { type: 'redis', host: 'localhost', port: 6379, user: '', password: '', tls: false });
  assert.equal(parse('rediss://default:pw@cache.acme.test:6380').tls, true);
  for (const notOne of ['sk_live_abc123', 'eyJhbGciOi.payload.sig', 'just some words', '']) assert.equal(parse(notOne), null, notOne);

  assert.deepEqual(await check('sk_live_abc123'), { code: 2, message: 'cannot test: not a database or cache connection Koppler reads' });
  assert.equal((await check('Server=db;Database=x;User Id=app;Password=y')).code, 2);
  assert.match((await check('Host=x;Username=y', 'oracle')).message, /no test for type "oracle"/);
});

test('Redis and Valkey: a tiny stand-in server that wants a password.', async () => {
  const seen = [];
  const server = net.createServer(socket => {
    let authed = false;
    socket.on('data', d => {
      const parts = String(d).split('\r\n').filter(l => l && !/^[*$]/.test(l));
      seen.push(parts[0]);
      if (parts[0] === 'AUTH') { authed = parts.at(-1) === 'right'; return socket.write(authed ? '+OK\r\n' : '-WRONGPASS invalid username-password pair\r\n'); }
      socket.write(authed ? '+PONG\r\n' : '-NOAUTH Authentication required.\r\n');
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  assert.deepEqual(await check(`127.0.0.1:${port},password=right`), { code: 0, message: 'connected' });
  assert.deepEqual(await check(`127.0.0.1:${port},password=wrong`), { code: 1, message: 'failed: it refused the user name or password' });
  assert.deepEqual(await check(`127.0.0.1:${port}`, 'redis'), { code: 1, message: 'failed: it refused the user name or password' });
  assert.deepEqual(seen, ['AUTH', 'PING', 'AUTH', 'PING']);
  server.close();
  assert.deepEqual(await check(`127.0.0.1:${port},password=right`), { code: 1, message: 'failed: nothing answers at its address (is the tunnel up?)' });
});

test('Nothing listens on port 1: a plain reason, and no part of the value in it.', async () => {
  const down = await check('Host=127.0.0.1;Port=1;Database=orders;Username=app;Password=hunter2-not-real');
  if (down.code !== 2) assert.deepEqual(down, { code: 1, message: 'failed: nothing answers at its address (is the tunnel up?)' });
});
