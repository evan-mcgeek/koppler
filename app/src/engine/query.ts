// A read-only database query with an app's stored connection string, for checking data (e.g. after a PROD fix) without
// writing a script. The value never shows; the session and the transaction are read-only; one statement at a time.
// The rows are real data: on PROD the user runs it in their own terminal, never the agent.
// Usage: koppler query <app> [--env <env>] [--secret <NAME>] "<sql>"
import { execFile, execFileSync } from 'node:child_process';
import path from 'node:path';
import { flagValue } from '../cli/output.ts';
import { fail } from '../failure.ts';
import { readStack } from '../data.ts';
import { BIN } from '../paths.ts';
import { clientEnv, findClient } from '../safe-env.ts';
import { parse, type Connection } from '../secret-check.mts';
import { appOn, storeOf } from '../core/stack.ts';

type Checked<T> = (T & { error?: undefined }) | { error: string };
const DATABASES = ['postgres', 'mysql'];
const MAX_LINES = 500;
const REFUSED = /password authentication failed|access denied|WRONGPASS/i;
const UNREACHED =
  /connection refused|could not connect|can't connect|timeout|timed out|could not translate|unknown (mysql )?server host|ENOTFOUND/i;
const reason = (text: string) => {
  if (REFUSED.test(text)) return 'it refused the user name or password';
  if (UNREACHED.test(text)) return 'nothing answers at its address (is the tunnel up?)';
  return /read-only|read only/i.test(text) ? 'that statement writes, and this connection is read-only' : null;
};

// What only reads. The read-only transaction is a second line of defence: the statement itself must start with a
// reading keyword and hold nothing that writes, ends the transaction, changes the session or the server, or runs a
// client command. Words inside strings, quoted names and comments do not count.
const READS = new Set(['select', 'with', 'explain', 'show', 'values', 'table', 'describe', 'desc']);
const WRITES = new Set(
  (
    'insert update delete merge upsert replace drop alter create truncate rename grant revoke ' +
    'copy call do exec execute prepare deallocate set reset begin start commit rollback end abort savepoint ' +
    'release lock unlock vacuum analyze analyse cluster reindex refresh listen notify unlisten load handler ' +
    'into outfile dumpfile checkpoint discard security import kill shutdown flush install uninstall optimize repair'
  ).split(' '),
);
// Functions that change the server or reach outside it even in a read-only transaction.
const SIDE_EFFECTS =
  /^(dblink\w*|pg_terminate_backend|pg_cancel_backend|pg_reload_conf|pg_rotate_logfile|pg_advisory\w*|pg_try_advisory\w*|lo_\w+|set_config|nextval|setval|pg_read\w*file|pg_ls_dir|pg_stat_reset\w*|pg_switch_wal|pg_create_\w+|pg_drop_\w+|pg_sleep\w*|txid_current|sleep|benchmark|load_file|get_lock|release_lock|release_all_locks|sys_exec|sys_eval)$/i;

/** The statement's own text, with strings, quoted names and comments taken out, in the database's own quoting rules. */
export function bareSql(sql: string, type?: string): Checked<{ bare: string }> {
  const mysql = type === 'mysql';
  let out = '';
  let at = 0;
  const here = (text: string) => sql.startsWith(text, at);
  while (at < sql.length) {
    const char = sql[at] ?? '';
    if (here('--') || (mysql && char === '#')) {
      const newline = sql.indexOf('\n', at);
      at = newline < 0 ? sql.length : newline;
      out += ' ';
      continue;
    }
    if (here('/*')) {
      // Postgres nests block comments; MySQL runs /*! ... */ as code, so it is refused.
      if (mysql && here('/*!')) return { error: 'MySQL executable comments (/*! */) are not allowed' };
      let depth = 1;
      at += 2;
      while (at < sql.length && depth) {
        if (!mysql && here('/*')) {
          depth++;
          at += 2;
        } else if (here('*/')) {
          depth--;
          at += 2;
        } else at++;
      }
      if (depth) return { error: 'a comment is not closed' };
      out += ' ';
      continue;
    }
    const dollar = !mysql && char === '$' ? /^\$([A-Za-z_]\w*)?\$/.exec(sql.slice(at))?.[0] : undefined;
    if (dollar) {
      const end = sql.indexOf(dollar, at + dollar.length);
      if (end < 0) return { error: 'a $$ string is not closed' };
      at = end + dollar.length;
      out += " '' ";
      continue;
    }
    if (char === "'" || char === '"' || (mysql && char === '`')) {
      // MySQL strings take backslash escapes; Postgres only in E'...' strings.
      const before = sql.slice(0, at);
      const escapes = mysql ? char !== '`' : char === "'" && /[eE]$/.test(before) && !/\w[eE]$/.test(before);
      let end = at + 1;
      for (; end < sql.length; end++) {
        if (escapes && sql[end] === '\\') end++;
        else if (sql[end] === char) {
          if (sql[end + 1] !== char) break;
          end++;
        }
      }
      if (end >= sql.length) return { error: 'a quoted string or name is not closed' };
      at = end + 1;
      out += char === "'" ? " '' " : ' "q" ';
      continue;
    }
    out += char;
    at++;
  }
  return { bare: out };
}

/** One statement that only reads, without the trailing semicolon; or why not. */
export function readOnlySql(sql: string | null | undefined, type?: string): Checked<{ sql: string }> {
  const statement = (sql ?? '').trim().replace(/;\s*$/, '');
  if (!statement) return { error: 'give the SQL to run, in quotes' };
  const stripped = bareSql(statement, type);
  if (stripped.error !== undefined) return { error: stripped.error };
  const { bare } = stripped;
  if (bare.includes(';')) return { error: 'one statement at a time' };
  if (bare.includes('\\')) return { error: 'database client commands (a backslash) are not allowed' };
  const words = bare.toLowerCase().match(/[a-z_][a-z0-9_$]*/g) ?? [];
  if (!READS.has(words[0] ?? ''))
    return { error: 'only reading statements: SELECT, WITH, EXPLAIN, SHOW, VALUES, TABLE or DESCRIBE' };
  const writes = words.find(word => WRITES.has(word));
  if (writes)
    return {
      error: `"${writes.toUpperCase()}" can change data or the session, so it is not allowed here (quote a column with that name)`,
    };
  const calls = [...bare.matchAll(/([a-z_][\w$]*)\s*\(/gi)]
    .map(match => match[1] ?? '')
    .find(called => SIDE_EFFECTS.test(called));
  if (calls) return { error: `${calls}() changes the server or reaches outside it, so it is not allowed here` };
  return { sql: statement };
}

interface ClientCall {
  /** The client program, and the Homebrew formula that has it. */
  bin: [string, string];
  env: Record<string, string>;
  args: string[];
}
/** The client call for a connection; the password goes in the environment, never on the command line. */
export function clientCall(to: Connection, sql: string): ClientCall | null {
  const port = String(to.port);
  if (to.type === 'postgres')
    return {
      bin: ['psql', 'libpq'],
      env: {
        PGPASSWORD: to.password,
        PGCONNECT_TIMEOUT: '10',
        PGOPTIONS: '-c default_transaction_read_only=on -c statement_timeout=30000',
      },
      args: [
        ...['-h', to.host, '-p', port, '-U', to.user, '-d', to.database || 'postgres', '-X', '-v', 'ON_ERROR_STOP=1'],
        ...['-c', `BEGIN TRANSACTION READ ONLY; ${sql}\n; ROLLBACK;`],
      ],
    };
  if (to.type === 'mysql')
    return {
      bin: ['mysql', 'mysql-client'],
      env: { MYSQL_PWD: to.password },
      args: [
        ...['--connect-timeout=10', '-h', to.host, '-P', port, '-u', to.user],
        ...(to.database ? ['-D', to.database] : []),
        ...['--table', '-e', `SET SESSION TRANSACTION READ ONLY; START TRANSACTION READ ONLY; ${sql}\n; ROLLBACK;`],
      ],
    };
  return null;
}

/** The rows, or why not; never the value, and of the server's messages only a plain reason or the SQL error. */
export async function runQuery(to: Connection, sql: string): Promise<Checked<{ rows: string; more: number }>> {
  const call = clientCall(to, sql);
  if (!call) return { error: `Koppler cannot query a ${to.type} connection` };
  const client = findClient(...call.bin);
  if (!client) return { error: `the ${call.bin[0]} client is not installed (brew install ${call.bin[1]})` };
  const ran = await new Promise<{ failed: boolean; stdout: string; stderr: string }>(resolve => {
    const options = { env: clientEnv(call.env), timeout: 60000, maxBuffer: 16 * 1024 * 1024 };
    execFile(client, call.args, options, (error, stdout, stderr) => {
      resolve({ failed: !!error, stdout, stderr });
    });
  });
  if (ran.failed) {
    const sqlError = ran.stderr.split('\n').find(line => /ERROR/i.test(line));
    const why = reason(ran.stderr) ?? sqlError?.replace(/^.*?ERROR[: ]*/i, '') ?? 'see the database client';
    return { error: `the query failed: ${why}` };
  }
  const lines = ran.stdout
    .trimEnd()
    .split('\n')
    .filter(line => !/^(BEGIN|ROLLBACK|SET)$/.test(line.trim()));
  return { rows: lines.slice(0, MAX_LINES).join('\n'), more: Math.max(0, lines.length - MAX_LINES) };
}

export async function queryCommand(args: string[]): Promise<void> {
  const [app = '', sqlArg] = args.filter(
    (arg, at) => !arg.startsWith('--') && !['--env', '--secret'].includes(args[at - 1] ?? ''),
  );
  const stack = readStack() ?? fail('no stack loaded (koppler init)');
  const base = stack.apps[app] ?? fail('usage: koppler query <app> [--env <env>] [--secret <NAME>] "<sql>"');
  const [first] = stack.envs;
  const env = flagValue(args, '--env') ?? first ?? '';
  if (!stack.envs.includes(env)) fail(`unknown env ${env}; the stack has ${stack.envs.join(', ')}`);
  // Refused before any stored value is read (on PROD each read asks for the Keychain), whichever database it is for.
  const early = DATABASES.map(type => readOnlySql(sqlArg, type));
  const [refused] = early;
  if (refused?.error !== undefined && early.every(checked => checked.error !== undefined)) fail(refused.error);
  const store = storeOf(stack, app, env);
  const named = flagValue(args, '--secret');
  const name = base.name;
  // The app's database secret: the one named, else the one the stack types as a database, else the only one that reads as one.
  const candidates = (appOn(stack, app, env)?.secrets ?? []).filter(
    secret => secret.env && (!named || secret.env === named),
  );
  const read = (secret: string) => {
    try {
      return execFileSync(path.join(BIN, 'secret-store'), ['value', store, secret], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch {
      return '';
    }
  };
  const typed = (type: string | undefined): type is string => DATABASES.includes(type ?? '');
  let chosen: { name: string; to: Connection } | undefined;
  for (const secret of [...candidates.filter(one => typed(one.type)), ...candidates.filter(one => !one.type)]) {
    const value = read(secret.env ?? '');
    if (!value) continue;
    const to = parse(value, typed(secret.type) ? secret.type : undefined);
    if (to && typed(to.type ?? undefined)) {
      chosen = { name: secret.env ?? '', to: to as Connection };
      break;
    }
  }
  if (!chosen)
    fail(
      `no stored database connection for ${name} on ${env.toUpperCase()}${named ? ` named ${named}` : ''} (store it first; koppler doctor ${app} --env ${env})`,
    );
  const statement = readOnlySql(sqlArg, chosen.to.type);
  if (statement.error !== undefined) fail(statement.error);
  console.error(`${name} on ${env.toUpperCase()}, read-only, with ${chosen.name}:`);
  const result = await runQuery(chosen.to, statement.sql);
  if (result.error !== undefined) fail(result.error);
  console.log(result.rows);
  if (result.more) console.error(`(${String(result.more)} more lines not shown; add a LIMIT)`);
}
