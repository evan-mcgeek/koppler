// What the canvas page loads: its own files, its data as JSON, the stack schema, the choices for the settings panels and
// an app's log.
import { runLog } from '../engine/run-logs.ts';
import { stackSchema } from '../engine/stack-share.ts';
import fs from 'node:fs';
import type http from 'node:http';
import path from 'node:path';
import { readClones, readData, type DataName } from '../data.ts';
import { APP_ID } from '../ids.ts';
import { CODE, tempDir } from '../paths.ts';
import { awsProfiles, cloneChoices } from './choices.ts';
import { tail } from './logs.ts';
import { sharedLog } from './shared-log.ts';
import { logFile, SOURCE, statusJson } from './status.ts';
import { joinPage } from './pages.ts';

export const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

/** The files the page may load, by the path it asks for; `temp/` ones come from the run folder. */
const PAGE_FILES: Record<string, string> = {
  '': 'page/index.html',
  'appearance.js': 'page/appearance.js',
  'favicon.svg': 'page/favicon.svg',
  'temp/debug.jsonl': 'temp/debug.jsonl',
};
const CONTENT_TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  woff2: 'font/woff2',
  svg: 'image/svg+xml',
  jsonl: 'text/plain; charset=utf-8',
};
const DATA_FILE = /^data\/(registry|local|repos|state|local-databases)\.json$/;
/** The files the page names: what its build put beside it. */
const assetFile = (what: string) => (/^assets\/[\w-][\w.-]*$/.test(what) ? `page/${what}` : undefined);

/** What the page loads: its own files, its data as scripts or as JSON, and an app's log. */
export function serveFile(what: string, url: URL, res: http.ServerResponse): void {
  // The open log tab reads its app's log here, much longer than the short tail every status carries.
  if (what === 'log') {
    const id = url.searchParams.get('app') ?? '';
    const run = url.searchParams.get('run');
    if (!APP_ID.test(id)) {
      res.writeHead(400).end();
      return;
    }
    // A past run's log, as the run kept it.
    if (run !== null) {
      const kept = runLog(run, id);
      const text = kept ? tail(kept, 2 * 1024 * 1024, 2000) : null;
      res.writeHead(text === null ? 404 : 200, { 'content-type': 'text/plain; charset=utf-8' }).end(text ?? '');
      return;
    }
    let named: unknown;
    try {
      const status = JSON.parse(fs.readFileSync(SOURCE, 'utf8')) as { apps?: Record<string, { log?: unknown } | null> };
      named = status.apps?.[id]?.log;
    } catch {
      // No agent wrote a status: the log is where Koppler keeps it.
    }
    const file = logFile(id, named);
    const text = tail(file, 2 * 1024 * 1024, 2000);
    const headers = { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' };
    res.writeHead(text === null ? 404 : 200, headers).end(text ?? '');
    return;
  }
  // The log of every app the page names, in one stream: its All apps tab.
  if (what === 'log-all') {
    const apps = (url.searchParams.get('apps') ?? '')
      .split(',')
      .filter(id => APP_ID.test(id))
      .slice(0, 100);
    const since = url.searchParams.get('since');
    const lines = Number(url.searchParams.get('lines')) || undefined;
    const entries = sharedLog(apps, {
      since: since === 'hour' || since === 'all' ? since : 'run',
      ...(lines && { lines: Math.min(lines, 100_000) }),
    });
    res.writeHead(200, { ...JSON_HEADERS, 'cache-control': 'no-store' }).end(JSON.stringify(entries));
    return;
  }
  // The shape of a stack, for the settings panels: every field they show comes from it.
  if (what === 'data/stack-schema.json') {
    res.writeHead(200, JSON_HEADERS).end(JSON.stringify(stackSchema()));
    return;
  }
  // What the settings panels offer to pick from on this machine: names only.
  if (what === 'data/choices.json') {
    const id = url.searchParams.get('app') ?? '';
    const clone = APP_ID.test(id) ? readClones()[id]?.path : undefined;
    res.writeHead(200, JSON_HEADERS).end(JSON.stringify({ awsProfiles: awsProfiles(), ...cloneChoices(clone) }));
    return;
  }
  if (what === 'data/events') {
    joinPage(res);
    return;
  }
  if (what === 'data/status.json') {
    const status = statusJson();
    res.writeHead(status ? 200 : 404, JSON_HEADERS).end(status ?? 'null');
    return;
  }
  const asked = DATA_FILE.exec(what)?.[1] as DataName | undefined;
  if (asked) {
    // One not written yet (no board saved, no stack) is null, not an error the page's console reports.
    res.writeHead(200, JSON_HEADERS).end(JSON.stringify(readData(asked)));
    return;
  }
  // Where the canvas was while it was built beside the page it replaced.
  if (what === 'next' || what === 'next/') {
    res.writeHead(308, { location: what === 'next' ? './' : '../' }).end();
    return;
  }
  const file = Object.hasOwn(PAGE_FILES, what) ? PAGE_FILES[what] : assetFile(what);
  if (!file) {
    res.writeHead(404).end();
    return;
  }
  const full = file.startsWith('temp/') ? path.join(tempDir(), file.slice(5)) : path.join(CODE, file);
  fs.readFile(full, (error, body) => {
    if (error) {
      res.writeHead(404).end();
      return;
    }
    res
      .writeHead(200, {
        'content-type': CONTENT_TYPES[path.extname(file).slice(1)] ?? 'text/javascript; charset=utf-8',
        'cache-control': file.endsWith('.woff2') ? 'private, max-age=604800' : 'no-store',
      })
      .end(body);
  });
}
