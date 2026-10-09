// A read-only database query with an app's stored connection string, for checking data (e.g. after a PROD fix) without
// writing a script. The value never shows; the session and the transaction are read-only; one statement at a time.
// The rows are real data: on PROD the user runs it in their own terminal, never the agent.
// Usage: koppler query <app> [--env <env>] [--secret <NAME>] "<sql>"
import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { parse } from './secret-check.mjs';
import { BIN } from './paths.mjs';

const MAX_LINES = 500;
const client = (name, formula) => [...(process.env.PATH ?? '').split(':').map(d => `${d}/${name}`), `/opt/homebrew/opt/${formula}/bin/${name}`, `/usr/local/opt/${formula}/bin/${name}`]
  .find(p => { try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; } });
const reason = text => /password authentication failed|access denied|WRONGPASS/i.test(text) ? 'it refused the user name or password'
  : /connection refused|could not connect|can't connect|timeout|timed out|could not translate|unknown (mysql )?server host|ENOTFOUND/i.test(text) ? 'nothing answers at its address (is the tunnel up?)'
  : /read-only|read only/i.test(text) ? 'that statement writes, and this connection is read-only'
  : null;

// One statement, without the trailing semicolon; a second statement could end the read-only transaction.
export function oneStatement(sql) {
  const s = String(sql ?? '').trim().replace(/;\s*$/, '');
  if (!s) return { error: 'give the SQL to run, in quotes' };
  const bare = s.replace(/'(?:[^']|'')*'|"(?:[^"]|"")*"/g, '');
  return bare.includes(';') ? { error: 'one statement at a time' } : { sql: s };
}

// The client call for a connection; the password goes in the environment, never on the command line.
export function clientCall(c, sql) {
  if (c.type === 'postgres') return { bin: ['psql', 'libpq'], env: { PGPASSWORD: c.password, PGCONNECT_TIMEOUT: '10', PGOPTIONS: '-c default_transaction_read_only=on -c statement_timeout=30000' },
    args: ['-h', c.host, '-p', String(c.port), '-U', c.user, '-d', c.database || 'postgres', '-X', '-v', 'ON_ERROR_STOP=1', '-c', `BEGIN TRANSACTION READ ONLY; ${sql}; ROLLBACK;`] };
  if (c.type === 'mysql') return { bin: ['mysql', 'mysql-client'], env: { MYSQL_PWD: c.password },
    args: ['--connect-timeout=10', '-h', c.host, '-P', String(c.port), '-u', c.user, ...(c.database ? ['-D', c.database] : []), '--table', '-e', `SET SESSION TRANSACTION READ ONLY; START TRANSACTION READ ONLY; ${sql}; ROLLBACK;`] };
  return null;
}

export async function queryCommand(args, { load, fail, here }) {
  const flag = n => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
  const [app, sqlArg] = args.filter((a, i) => !a.startsWith('--') && !['--env', '--secret'].includes(args[i - 1]));
  const registry = load('registry.js', 'REGISTRY') ?? fail('no stack loaded (koppler init)');
  const base = registry.apps[app] ?? fail('usage: koppler query <app> [--env <env>] [--secret <NAME>] "<sql>"');
  const env = flag('env') ?? registry.envs[0];
  if (!registry.envs.includes(env)) fail(`unknown env ${env}; the stack has ${registry.envs.join(', ')}`);
  const st = oneStatement(sqlArg); if (st.error) fail(st.error);
  const conf = env === registry.envs[0] ? base : { ...base, ...(base.envs?.[env] ?? {}) };
  const store = env === registry.envs[0] ? app : `${app}@${env}`;
  // The app's database secret: the one named, else the one the stack types as a database, else the only one that reads as one.
  const candidates = (conf.secrets ?? []).filter(s => s?.env && (!flag('secret') || s.env === flag('secret')));
  const read = name => { try { return execFileSync(path.join(BIN, 'secret-store'), ['value', store, name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return ''; } };
  let chosen = null;
  for (const s of [...candidates.filter(s => ['postgres', 'mysql'].includes(s.type)), ...candidates.filter(s => !s.type)]) {
    const value = read(s.env); if (!value) continue;
    const c = parse(value, ['postgres', 'mysql'].includes(s.type) ? s.type : undefined);
    if (c?.type === 'postgres' || c?.type === 'mysql') { chosen = { name: s.env, c }; break; }
  }
  if (!chosen) fail(`no stored database connection for ${base.name ?? app} on ${env.toUpperCase()}${flag('secret') ? ` named ${flag('secret')}` : ''} (store it first; koppler doctor ${app} --env ${env})`);
  console.error(`${base.name ?? app} on ${env.toUpperCase()}, read-only, with ${chosen.name}:`);
  const r = await runQuery(chosen.c, st.sql);
  if (r.error) fail(r.error);
  console.log(r.rows);
  if (r.more) console.error(`(${r.more} more lines not shown; add a LIMIT)`);
}

// { rows, more } or { error }; never the value, and of the server's messages only a plain reason or the SQL error.
export async function runQuery(c, sql) {
  const call = clientCall(c, sql), bin = call && client(...call.bin);
  if (!call) return { error: `Koppler cannot query a ${c.type} connection` };
  if (!bin) return { error: `the ${call.bin[0]} client is not installed (brew install ${call.bin[1]})` };
  const out = await new Promise(resolve => execFile(bin, call.args, { env: { ...process.env, ...call.env }, timeout: 60000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => resolve({ err, stdout: String(stdout), stderr: String(stderr) })));
  if (out.err) return { error: `the query failed: ${reason(out.stderr) ?? out.stderr.split('\n').find(l => /ERROR/i.test(l))?.replace(/^.*?ERROR[: ]*/i, '') ?? 'see the database client'}` };
  const lines = out.stdout.trimEnd().split('\n').filter(l => !/^(BEGIN|ROLLBACK|SET)$/.test(l.trim()));
  return { rows: lines.slice(0, MAX_LINES).join('\n'), more: Math.max(0, lines.length - MAX_LINES) };
}
