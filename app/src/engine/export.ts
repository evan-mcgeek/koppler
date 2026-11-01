// `koppler export`: the team's feature boards as one page to read, for people who never run Koppler. The page and
// everything it needs are in the one file, so it opens from disk or from any web host, and loads nothing else.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Bundled from 'elkjs/lib/elk.bundled.js';
import type { ELK } from 'elkjs/lib/elk-api.js';
import { flagValue, positional } from '../cli/output.ts';
import { readStack } from '../data.ts';
import { flowsOf, type Exported, type Flow } from '../core/export.ts';
import { layOut } from '../core/layout.ts';
import { migrateStack } from '../core/migrations/stack/index.ts';
import type { Stack } from '../core/stack.ts';
import { fail } from '../failure.ts';
import { readJson } from '../json-files.ts';
import { CODE } from '../paths.ts';

// The engine with its worker built in, run here rather than in the page: node loads it as the constructor itself.
const Engine = Bundled as unknown as new () => ELK;

/** The stack in the folder given, as it is in its repo, or the stack in use. */
function stackFrom(dir: string | undefined): Stack {
  if (!dir) return readStack() ?? fail('no stack loaded (koppler init), or name its folder with --stack <dir>');
  const file = path.join(path.resolve(dir), 'stack.json');
  const raw = readJson(file);
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) fail(`${file}: no stack there`);
  const migrated = migrateStack(raw as Record<string, unknown>);
  if (migrated.error !== undefined) fail(`${file}: ${migrated.error}`);
  return migrated.value as Stack;
}

/** A flow its author never arranged is laid out as Discover lays out a map. */
async function placed(flow: Flow): Promise<Flow> {
  if (flow.at) return flow;
  const links = flow.phases.flatMap(phase =>
    phase.steps.map(step => ({ id: step.number, from: step.from, to: step.to })),
  );
  const cards = flow.cards.map(card => ({ id: card.id, w: 200, h: 60 }));
  const laid = await layOut(cards, links, 'RIGHT', new Engine());
  return { ...flow, at: laid.at };
}

/** The viewer page as built, with its script, styles and the data written into it. */
export function pageWith(data: Exported, viewer = path.join(CODE, 'viewer')): string {
  const html = fs.readFileSync(path.join(viewer, 'index.html'), 'utf8');
  const asset = (pattern: RegExp) => {
    const name = pattern.exec(html)?.[1];
    if (!name) fail('the export page is not built (npm run build)');
    return fs.readFileSync(path.join(viewer, name), 'utf8').replaceAll('</script', '<\\/script');
  };
  const script = asset(/<script type="module" crossorigin src="\.\/(assets\/[^"]+\.js)"><\/script>/);
  const style = asset(/<link rel="stylesheet" crossorigin href="\.\/(assets\/[^"]+\.css)">/);
  const hash = crypto.createHash('sha256').update(script).digest('base64');
  // Nothing may be loaded or sent: the page runs its own script and nothing else.
  const policy = `default-src 'none'; script-src 'sha256-${hash}'; style-src 'unsafe-inline'; font-src data:; img-src data:`;
  const json = JSON.stringify(data).replaceAll('<', '\\u003c');
  return html
    .replace('<title>Flows</title>', `<title>${escape(data.stack)} flows</title>`)
    .replace(
      /<script type="module" crossorigin src="[^"]+"><\/script>/,
      () =>
        `<meta http-equiv="Content-Security-Policy" content="${policy}" />\n    <script type="module">${script}</script>`,
    )
    .replace(/<link rel="stylesheet" crossorigin href="[^"]+">/, () => `<style>${style}</style>`)
    .replace(
      '<div id="app"></div>',
      () => `<div id="app"></div>\n    <script type="application/json" id="flows">${json}</script>`,
    );
}
const escape = (text: string) =>
  text.replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char] ?? char);

export async function exportCommand(args: string[]): Promise<void> {
  const stack = stackFrom(flagValue(args, '--stack'));
  const name = stack.name ?? 'Stack';
  const flows = await Promise.all(flowsOf(stack).map(placed));
  const file = path.resolve(
    positional(args, ['--stack'])[0] ??
      `${
        name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '') || 'stack'
      }-flows.html`,
  );
  fs.writeFileSync(file, pageWith({ stack: name, exported: new Date().toISOString(), flows }));
  console.log(`WROTE ${file}: ${String(flows.length)} ${flows.length === 1 ? 'flow' : 'flows'}`);
  console.log(
    flows.length
      ? "Open it in any browser. It holds the flows' names, steps and app names, and nothing else of the stack."
      : 'The stack has no team feature boards yet: share one (koppler board share) and export again.',
  );
}
