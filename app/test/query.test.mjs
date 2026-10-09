import assert from 'node:assert/strict';
import { clientCall, oneStatement } from '../src/query.mjs';

// One statement at a time, so nothing can end the read-only transaction; semicolons inside quotes are text.
assert.deepEqual(oneStatement('select 1;'), { sql: 'select 1' });
assert.equal(oneStatement("select * from t where name = 'a;b'").sql, "select * from t where name = 'a;b'");
assert.equal(oneStatement('select 1; delete from t').error, 'one statement at a time');
assert.equal(oneStatement('commit; delete from t').error, 'one statement at a time');
assert.match(oneStatement('  ').error, /give the SQL/);

// Read-only both ways, and the password only in the environment.
const pg = clientCall({ type: 'postgres', host: 'h', port: 5432, user: 'u', password: 'p@ss', database: 'd' }, 'select 1');
assert.match(pg.env.PGOPTIONS, /default_transaction_read_only=on/);
assert.equal(pg.args.at(-1), 'BEGIN TRANSACTION READ ONLY; select 1; ROLLBACK;');
assert.equal(pg.args.includes('p@ss'), false);
const my = clientCall({ type: 'mysql', host: 'h', port: 3306, user: 'u', password: 'p@ss', database: 'd' }, 'select 1');
assert.match(my.args.at(-1), /^SET SESSION TRANSACTION READ ONLY; START TRANSACTION READ ONLY; select 1; ROLLBACK;$/);
assert.equal(my.args.includes('p@ss'), false);
assert.equal(clientCall({ type: 'redis' }, 'x'), null);
console.log('query tests ok');
