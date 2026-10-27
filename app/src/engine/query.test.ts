import assert from 'node:assert/strict';
import { clientCall, readOnlySql, failure } from './query.ts';
import { test } from 'vitest';

test("only one reading statement gets through, in each database's quoting rules", async () => {
  const ok = (sql: any, type = 'postgres') =>
    assert.equal(readOnlySql(sql, type).error, undefined, `${sql} should pass: ${readOnlySql(sql, type).error}`);
  const no = (sql: any, type: any, why: any) => assert.match(readOnlySql(sql, type).error ?? 'passed', why, sql);

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
  ok('select "sleep", "a;b", "a""b", "update" from t');
  ok('select "sleep(100)", `a;b`, `a``b` from t', 'mysql');
  ok('select "sleep" + (1) from t');
  ok('select 1 -- why', 'postgres');

  // The bypasses from the review: strings that hide a second statement, in each database's own quoting.
  no(
    "SELECT $$'$$; COMMIT; SET default_transaction_read_only=off; DELETE FROM t; SELECT $$'$$ --",
    'postgres',
    /one statement/,
  );
  no("SELECT '\\''; DROP TABLE t; -- '", 'mysql', /backslash escapes/);
  no("SELECT '\\'; COMMIT; START TRANSACTION READ WRITE; DELETE FROM t; COMMIT -- '", 'mysql', /backslash escapes/);
  no("select E'\\''; delete from t; --'", 'postgres', /one statement/);
  no('select 1; delete from t', 'postgres', /one statement/);
  no('SELECT 1--1; COMMIT; START TRANSACTION READ WRITE; DELETE FROM t; COMMIT', 'mysql', /one statement/);
  no('SELECT 1--\u00a0; COMMIT; DELETE FROM t', 'mysql', /one statement/);
  no('SELECT 1 -- comment\r; COMMIT; BEGIN READ WRITE; DELETE FROM t; COMMIT', 'postgres', /one statement/);
  no('SELECT 1 # comment\r; COMMIT; DELETE FROM t', 'mysql', /one statement/);
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
  no('select "pg_terminate_backend"(42)', 'postgres', /pg_terminate_backend/);
  no('select pg_catalog."pg_read_file"(\'/etc/passwd\')', 'postgres', /pg_read_file/);
  no('select `sleep` /* wait */ (100)', 'mysql', /sleep/);
  no('select U&"pg_terminate_\\0062ackend"(42)', 'postgres', /Unicode-escaped identifiers/);
  no('select U&"pg_terminate_backend" UESCAPE \'!\'(42)', 'postgres', /Unicode-escaped identifiers/);
  // Unclosed strings and comments.
  no("select 'abc", 'postgres', /not closed/);
  no('select $$abc', 'postgres', /not closed/);
  no('select /* abc', 'postgres', /not closed/);
  no('  ', 'postgres', /give the SQL/);

  // Read-only both ways, the password only in the environment, and a trailing comment cannot swallow the ROLLBACK.
  const pg = clientCall(
    { type: 'postgres', host: 'h', port: 5432, user: 'u', password: 'p@ss', database: 'd' },
    'select 1 -- x',
  );
  assert.match(pg!.env.PGOPTIONS as any, /default_transaction_read_only=on/);
  assert.equal(pg!.args.at(-1), 'BEGIN TRANSACTION READ ONLY; select 1 -- x\n; ROLLBACK;');
  assert.equal(pg!.args.includes('p@ss'), false);
  const my = clientCall(
    { type: 'mysql', host: 'h', port: 3306, user: 'u', password: 'p@ss', database: 'd' },
    'select 1',
  );
  assert.match(
    my!.args.at(-1) as any,
    /^SET SESSION TRANSACTION READ ONLY; START TRANSACTION READ ONLY; select 1\n; ROLLBACK;$/,
  );
  assert.equal(my!.args.includes('p@ss'), false);
  assert.equal(clientCall({ type: 'redis' } as any, 'x'), null);
});

test('a failed statement says why from what the server said, never from its own echo of the statement', () => {
  // Captured from psql 16 and the mysql 8.4 client, run as Koppler runs them.
  const cases: [string, string][] = [
    [
      'ERROR:  column "nonexistent_col" does not exist\nLINE 1: BEGIN TRANSACTION READ ONLY; select nonexistent_col from pg_...\n                                            ^\n',
      'column "nonexistent_col" does not exist',
    ],
    [
      'ERROR:  column "timeout" does not exist\nLINE 1: BEGIN TRANSACTION READ ONLY; select timeout from pg_class\n                                            ^\n',
      'column "timeout" does not exist',
    ],
    [
      'ERROR:  cannot execute CREATE TABLE in a read-only transaction\n',
      'that statement writes, and this connection is read-only',
    ],
    [
      'psql: error: connection to server at "127.0.0.1", port 1 failed: Connection refused\n\tIs the server running on that host and accepting TCP/IP connections?\n',
      'nothing answers at its address (is the tunnel up?)',
    ],
    [
      'psql: error: connection to server at "127.0.0.1", port 5432 failed: FATAL:  password authentication failed for user "app"\n',
      'it refused the user name or password',
    ],
    [
      "ERROR 1054 (42S22) at line 1: Unknown column 'timeout' in 'field list'\n",
      "Unknown column 'timeout' in 'field list'",
    ],
    [
      'ERROR 1792 (25006) at line 1: Cannot execute statement in a READ ONLY transaction.\n',
      'that statement writes, and this connection is read-only',
    ],
    [
      "ERROR 2003 (HY000): Can't connect to MySQL server on '127.0.0.1:1' (111)\n",
      'nothing answers at its address (is the tunnel up?)',
    ],
    [
      "ERROR 1045 (28000): Access denied for user 'root'@'127.0.0.1' (using password: YES)\n",
      'it refused the user name or password',
    ],
  ];
  for (const [printed, why] of cases) assert.equal(failure(printed), why, printed);
});
