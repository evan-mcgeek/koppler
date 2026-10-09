import assert from 'node:assert/strict';
import { clientCall, readOnlySql } from '../src/query.mjs';

const ok = (sql, type = 'postgres') => assert.equal(readOnlySql(sql, type).error, undefined, `${sql} should pass: ${readOnlySql(sql, type).error}`);
const no = (sql, type, why) => assert.match(readOnlySql(sql, type).error ?? 'passed', why, sql);

// Reading statements pass; a trailing semicolon is dropped; quoted text and names are only text.
assert.deepEqual(readOnlySql('select 1;', 'postgres'), { sql: 'select 1' });
ok("select * from t where name = 'a;b'");
ok("select 'it''s', \"update\" from t");
ok("select E'a\\'b;c'");
ok('select $$a; delete from t$$');
ok('select $x$ ; $x$');
ok('with x as (select 1) select * from x');
ok('explain select * from t');
ok('show search_path');
ok("select 'a;b', `delete` from t", 'mysql');
ok('select 1 -- why', 'postgres');

// The bypasses from the review: strings that hide a second statement, in each database's own quoting.
no("SELECT $$'$$; COMMIT; SET default_transaction_read_only=off; DELETE FROM t; SELECT $$'$$ --", 'postgres', /one statement/);
no("SELECT '\\''; DROP TABLE t; -- '", 'mysql', /one statement/);
no("select E'\\''; delete from t; --'", 'postgres', /one statement/);
no('select 1; delete from t', 'postgres', /one statement/);
// This one deleted every row through the old check: a read-write transaction opened after the hidden COMMIT.
no("SELECT $$'$$; COMMIT; BEGIN READ WRITE; DELETE FROM t; COMMIT; SELECT $$'$$ --", 'postgres', /one statement/);
// Client commands and executable comments.
no('\\! env', 'mysql', /client commands|only reading/);
no('select 1 \\g', 'postgres', /client commands/);
no('select /*! 1; drop table t */ 1', 'mysql', /executable comments/);
// Writing or session words anywhere, also inside a CTE or EXPLAIN ANALYZE.
no('with x as (delete from t returning *) select * from x', 'postgres', /DELETE/);
no('explain analyze delete from t', 'postgres', /ANALYZE|DELETE/);
no('select * into copy_of_t from t', 'postgres', /INTO/);
no("select * from t into outfile '/tmp/x'", 'mysql', /INTO/);
no('copy t to stdout', 'postgres', /only reading/);
no('commit', 'postgres', /only reading/);
// Functions with side effects, even in a read-only transaction.
no('select pg_terminate_backend(42)', 'postgres', /pg_terminate_backend/);
no("select dblink_exec('db', 'delete from t')", 'postgres', /dblink_exec/);
no("select load_file('/etc/passwd')", 'mysql', /load_file/);
no('select sleep(100)', 'mysql', /sleep/);
// Unclosed strings and comments.
no("select 'abc", 'postgres', /not closed/);
no('select $$abc', 'postgres', /not closed/);
no('select /* abc', 'postgres', /not closed/);
no('  ', 'postgres', /give the SQL/);

// Read-only both ways, the password only in the environment, and a trailing comment cannot swallow the ROLLBACK.
const pg = clientCall({ type: 'postgres', host: 'h', port: 5432, user: 'u', password: 'p@ss', database: 'd' }, 'select 1 -- x');
assert.match(pg.env.PGOPTIONS, /default_transaction_read_only=on/);
assert.equal(pg.args.at(-1), 'BEGIN TRANSACTION READ ONLY; select 1 -- x\n; ROLLBACK;');
assert.equal(pg.args.includes('p@ss'), false);
const my = clientCall({ type: 'mysql', host: 'h', port: 3306, user: 'u', password: 'p@ss', database: 'd' }, 'select 1');
assert.match(my.args.at(-1), /^SET SESSION TRANSACTION READ ONLY; START TRANSACTION READ ONLY; select 1\n; ROLLBACK;$/);
assert.equal(my.args.includes('p@ss'), false);
assert.equal(clientCall({ type: 'redis' }, 'x'), null);
console.log('query tests ok');
