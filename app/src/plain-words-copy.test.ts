// Plain words in Koppler's own text: no sentence over 25 words in what a person reads (the canvas, the command line,
// the requests the canvas sends to the agent) or in the docs and the agent's skills.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { SENTENCE_WORDS, tooLong } from './core/plain-words.ts';

const app = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.join(app, '..');
const under = (dir: string, ext: RegExp) =>
  fs
    .readdirSync(path.join(root, dir), { recursive: true, encoding: 'utf8' })
    .map(file => path.join(dir, file))
    .filter(file => ext.test(file) && !/node_modules|dist|\.test\.|\.spec\.|design[/\\]/.test(file));
const lineAt = (text: string, at: number) => text.slice(0, at).split('\n').length;

/** Prose lines of a Markdown file, table cells each on their own; code blocks and HTML left out. */
function markdown(text: string): [number, string][] {
  let code = false;
  return text.split('\n').flatMap((line, at): [number, string][] => {
    if (line.trimStart().startsWith('```')) code = !code;
    if (code || line.trimStart().startsWith('```') || line.trimStart().startsWith('<')) return [];
    if (/^\s*\|?[\s:|-]+\|?\s*$/.test(line)) return [];
    const plain = line.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
    const cells = plain.trim().startsWith('|') ? plain.split(/(?<!\\)\|/) : [plain];
    return cells.map(cell => [at + 1, cell.replace(/^\s*(?:[-*>#]+|\d+\.)\s+/, '')]);
  });
}

/** What a Svelte component shows: its markup text and the words of its titles, labels and placeholders. */
function markup(text: string): [number, string][] {
  const shown = text.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, block =>
    block.replace(/[^\n]/g, ' '),
  );
  return [...shown.matchAll(/>([^<>{}]+)<|(?:title|aria-label|placeholder|alt)="([^"{}]+)"/g)].map(found => [
    lineAt(shown, found.index),
    (found[1] ?? found[2] ?? '').replace(/\s+/g, ' '),
  ]);
}

/** Strings in code that read as prose: messages, notices and requests; usage lines and drawings left out. */
function strings(text: string): [number, string][] {
  return [...text.matchAll(/(['`])((?:(?!\1)[^\\\n]|\\.)*)\1/g)].flatMap((found): [number, string][] => {
    const said = found[2] ?? '';
    if (!/^[\p{L}"“]/u.test(said) || !/\p{L}{3,} \p{L}{2,} \p{L}{2,}/u.test(said) || /\[--|^usage:/.test(said))
      return [];
    return said
      .replace(/\$\{[^}]*\}/g, 'x')
      .split(/\\n/)
      .map(line => [lineAt(text, found.index), line]);
  });
}

test(`no sentence of Koppler's own text has more than ${String(SENTENCE_WORDS)} words`, () => {
  const sources: [string, (text: string) => [number, string][]][] = [
    ...['README.md', 'PRODUCT.md', 'AGENTS.md', 'GLOSSARY.md'].map((file): [string, typeof markdown] => [
      file,
      markdown,
    ]),
    ...under('docs', /\.md$/).map((file): [string, typeof markdown] => [file, markdown]),
    ...under('plugin', /\.md$/).map((file): [string, typeof markdown] => [file, markdown]),
    ...under('app/canvas', /\.svelte$/).map((file): [string, typeof markup] => [file, markup]),
    ...[...under('app/canvas', /\.(ts|svelte)$/), ...under('app/src', /\.m?ts$/)].map(
      (file): [string, typeof strings] => [file, strings],
    ),
  ];
  const long = sources.flatMap(([file, read]) =>
    read(fs.readFileSync(path.join(root, file), 'utf8')).flatMap(([line, text]) =>
      tooLong(text).map(({ sentence, words }) => `${file}:${String(line)} ${String(words)} words: ${sentence}`),
    ),
  );
  expect(long, `Split each into sentences of ${String(SENTENCE_WORDS)} words at most:\n${long.join('\n')}`).toEqual([]);
});
