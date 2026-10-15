// A web app set to show its browser console on its card: when it starts, its page loads the canvas server's console
// script, through one line added to its HTML entry file. The line is a temporary change: Stop takes it out.
import fs from 'node:fs';
import path from 'node:path';
import { consoleKey } from '../server/browser-console.ts';
import { tempDir } from '../paths.ts';
import { readActions, updateActions, type EditAction } from './actions.ts';
import { insideClone } from './recipes.ts';

/** Adds the script line to the app's HTML file, logged so Stop undoes it; says what it did, or why not. */
export function showBrowserConsole(app: string, repo: string, file: string): string {
  const target = insideClone(repo, file);
  if (!target) return `${file} is not a file inside ${app}'s clone`;
  let canvas: URL;
  try {
    canvas = new URL(fs.readFileSync(path.join(tempDir(), 'canvas-url'), 'utf8').trim());
  } catch {
    return 'the canvas is not running, so the browser console has nowhere to go';
  }
  let body: string;
  try {
    body = fs.readFileSync(target, 'utf8');
  } catch {
    return `${file} is not in the clone`;
  }
  const line = `<script src="http://${canvas.host}/console.js?app=${app}&key=${consoleKey(app)}"></script>`;
  if (body.includes(line)) return 'already shows its browser console';
  const log = path.join(tempDir(), 'actions.json');
  if (
    readActions(log).some(
      action => action.kind === 'edit' && action.file === target && action.after.includes('/console.js?'),
    )
  )
    return 'already shows its browser console';
  const at = body.match(/<\/head>/i)?.[0];
  if (!at) return `${file} has no </head> to put the console script before`;
  // Logged before the file changes, so a crash part-way still leaves Stop an entry to undo.
  const entry: EditAction = { kind: 'edit', app, file: target, before: at, after: `${line}${at}` };
  updateActions(log, list => {
    list.push(entry);
  });
  fs.writeFileSync(
    target,
    body.replace(at, () => entry.after),
  );
  return 'shows its browser console on its card';
}
