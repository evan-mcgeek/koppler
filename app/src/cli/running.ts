// The commands about what Koppler runs: stop, the canvas, logs and status.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readClones, readData, readStack } from '../data.ts';
import { alive, listener, NAME, readRecord, records, sh, sleep, stopOne, uptime } from '../engine/processes.ts';
import { run } from '../engine/run.ts';
import { CODE, LOGS, TEMP } from '../paths.ts';
import { redact, scrub } from '../scrub.ts';
import { confirm, flagValue, positional, table } from './output.ts';
import { fail } from '../failure.ts';

const notAName = (name: string) => `${name} is not a name Koppler gives its processes`;

export async function stop(args: string[]): Promise<void> {
  // --apps: every app, API and tunnel Koppler runs, but not the canvas; code changes and branches stay as they are.
  const all = args.includes('--all');
  const apps = args.includes('--apps');
  const names = args.filter(arg => !arg.startsWith('-'));
  if (!all && !apps && !names.length) fail('usage: koppler stop <name...> | --apps | --all [--yes]');
  for (const name of names) if (!NAME.test(name)) fail(notAName(name));
  const targets = all
    ? records()
    : apps
      ? records().filter(record => record.name !== 'canvas')
      : names.map(name => readRecord(name) ?? fail(`${name} is not started by koppler`));
  if (!targets.length) {
    console.log('nothing to stop');
    return;
  }
  const asked = `Stop ${targets.map(record => record.name).join(', ')}?`;
  if ((all || apps) && !(await confirm(asked, args))) fail('nothing stopped (in a script, add --yes)');
  for (const line of await Promise.all(targets.map(stopOne))) console.log(line);
}

/** The canvas: started when it is not running, then opened in the browser. */
export async function canvas(args: string[]): Promise<void> {
  if (args.includes('--stop')) {
    await stop(['canvas']);
    return;
  }
  const record = readRecord('canvas');
  if (!record || !alive(record)) {
    const port = String(Number(process.env['KOPPLER_PORT']) || 4747);
    await run(['canvas', '--port', port, '--', process.execPath, path.join(CODE, 'status-watch.mjs')]);
  }
  const urlFile = path.join(TEMP, 'canvas-url');
  for (let tries = 0; tries < 40 && !fs.existsSync(urlFile); tries++) await sleep(250);
  if (!fs.existsSync(urlFile)) fail('the canvas did not start; see koppler logs canvas');
  // The address carries the page's access token, so it goes to the browser and is not printed.
  const url = fs.readFileSync(urlFile, 'utf8').trim() + (args.includes('--pick') ? '#pick' : '');
  if (args.includes('--no-open') || process.platform !== 'darwin') {
    console.log(`The canvas runs on port ${new URL(url).port}; its address is in ${urlFile}`);
    return;
  }
  sh('open', [url]);
  console.log('The canvas is open in your browser.');
}

/** A log, with secrets masked as on the card; `-f` follows it. */
export function logs(args: string[]): void {
  const [want] = positional(args, ['-n']);
  const lines = Number(flagValue(args, '-n')) || 50;
  if (!want) fail('usage: koppler logs <name> [-f] [-n <lines>]');
  if (!NAME.test(want)) fail(notAName(want));
  const file = path.join(LOGS, `${want}.log`);
  if (!fs.existsSync(file)) fail(`no log for ${want}; koppler status lists what runs`);
  const last = fs.readFileSync(file, 'utf8').trimEnd().split('\n').slice(-lines);
  process.stdout.write(redact(last.join('\n')) + '\n');
  if (!args.includes('-f') && !args.includes('--follow')) return;
  let at = fs.statSync(file).size;
  fs.watchFile(file, { interval: 500 }, now => {
    if (now.size < at) at = 0;
    if (now.size === at) return;
    const fd = fs.openSync(file, 'r');
    const added = Buffer.alloc(now.size - at);
    fs.readSync(fd, added, 0, added.length, at);
    fs.closeSync(fd);
    at = now.size;
    process.stdout.write(redact(added.toString('utf8')));
  });
}

const tail = (file: string, lines: number) => {
  try {
    return fs.readFileSync(file, 'utf8').trimEnd().split('\n').slice(-lines).join('\n');
  } catch {
    return null;
  }
};
const read = (file: string): unknown => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};
const newestRunLog = () => {
  try {
    const logs = fs.readdirSync(TEMP).filter(file => /^up-.*\.log$/.test(file));
    const age = (file: string) => fs.statSync(path.join(TEMP, file)).mtimeMs;
    const [newest] = logs.sort((a, b) => age(b) - age(a));
    return newest ? path.join(TEMP, newest) : null;
  } catch {
    return null;
  }
};
/** A board's name says nothing about a bug and may name a project, even one no stack lists any more. */
const unnamed = (line: string) => {
  try {
    const entry = JSON.parse(line) as { board?: { name?: string } };
    if (entry.board?.name) entry.board.name = 'board';
    return JSON.stringify(entry);
  } catch {
    return line;
  }
};

/**
 * What a bug report needs, ready to paste into a public issue: versions, then the tails of the canvas debug log, the
 * latest run log and each named log, all scrubbed of secrets and of everything that names the user or their stack.
 */
async function debugReport(names: string[]): Promise<void> {
  const { stacksHere } = await import('../engine/sync.ts');
  const stacks = stacksHere().map(stack => read(path.join(stack.dir, 'stack.json')));
  let commit: string | null = null;
  try {
    const git = ['-C', CODE, 'rev-parse', '--short', 'HEAD'];
    commit = execFileSync('git', git, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    // An installed copy is not a clone.
  }
  const parts = [`Koppler ${commit ?? 'installed copy'}, Node ${process.version}, ${os.type()} ${os.release()}`];
  const add = (title: string, text: string | null | undefined) => {
    if (text) parts.push(`## ${title}\n\n\`\`\`text\n${text}\n\`\`\``);
  };
  add('Canvas debug log', tail(path.join(TEMP, 'debug.jsonl'), 40)?.split('\n').map(unnamed).join('\n'));
  const runLog = newestRunLog();
  add(`Latest run (${runLog ? path.basename(runLog) : ''})`, runLog && tail(runLog, 60));
  for (const name of names)
    add(`${name} log`, NAME.test(name) ? (tail(path.join(LOGS, `${name}.log`), 80) ?? 'no log') : 'not a log name');
  console.log(scrub(parts.join('\n\n'), [readData('registry'), readData('state'), ...stacks]));
}

/** What runs; --apps adds every app in the stack with its clone; --debug is for a bug report. */
export async function status(args: string[] = []): Promise<void> {
  if (args.includes('--debug')) {
    await debugReport(positional(args));
    return;
  }
  const processes = records().map(record => {
    const up = alive(record);
    return {
      name: record.name,
      state: up ? 'running' : 'exited',
      pid: record.pid,
      up: up ? uptime(record.startedAt) : null,
      port: record.port ?? null,
      open: !!(record.port && up && listener(record.port, record.bind)),
      command: record.command,
    };
  });
  const stack = args.includes('--apps') ? (readStack() ?? fail('no stack loaded (koppler init)')) : null;
  const clones = readClones();
  const apps =
    stack &&
    Object.entries(stack.apps).map(([id, app]) => {
      const clone = clones[id];
      return {
        id,
        name: app.name,
        kind: app.kind,
        clone: clone ? { branch: clone.branch ?? null, changed: clone.dirty ?? 0 } : null,
        state: processes.find(one => one.name === id)?.state ?? null,
      };
    });
  if (args.includes('--json')) {
    console.log(JSON.stringify({ processes, ...(apps && { stack: stack.name ?? null, apps }) }, null, 2));
    return;
  }
  if (stack && apps) {
    console.log(`${stack.name ?? 'stack'}: ${stack.source ?? ''}`);
    const cloneOf = ({ clone }: (typeof apps)[number]) =>
      clone ? `${clone.branch ?? 'detached'}${clone.changed ? ` (${String(clone.changed)} changed)` : ''}` : 'missing';
    table([
      ['APP', 'NAME', 'KIND', 'CLONE', 'KOPPLER'],
      ...apps.map(app => [app.id, app.name, app.kind, cloneOf(app), app.state ?? '-']),
    ]);
    console.log('');
  }
  if (!processes.length) {
    console.log('nothing started by koppler');
    return;
  }
  const short = (command: string) => (command.length > 70 ? command.slice(0, 67) + '...' : command);
  table([
    ['NAME', 'STATE', 'PID', 'UP', 'PORT', 'COMMAND'],
    ...processes.map(one => [
      one.name,
      one.state,
      one.pid,
      one.up ?? '-',
      one.port ? `${String(one.port)} ${one.open ? 'open' : 'closed'}` : '-',
      short(one.command),
    ]),
  ]);
}
