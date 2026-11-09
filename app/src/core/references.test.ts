// The skill's references name stack fields: each must be one the format knows, or the agent writes what it refuses.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { unknownFields } from './stack.ts';

const references = new URL('../../../plugin/skills/koppler-run/references/', import.meta.url);
const read = (name: string) => fs.readFileSync(new URL(name, references), 'utf8');
/** The backticked names in each row's first cell of the table under a header row that starts with `head`. */
const firstColumn = (text: string, head: string) => {
  const lines = text.split('\n');
  const start = lines.findIndex(line => line.startsWith(`| ${head} `));
  const rows = lines.slice(start + 2).filter((line, at, all) => all.slice(0, at + 1).every(one => one.startsWith('|')));
  return rows.flatMap(row => [...(row.split('|')[1] ?? '').matchAll(/`([^`]+)`/g)].map(match => match[1] ?? ''));
};
/** A stack that holds the field at this path, `<x>` and `[n]` standing for any key and any item. */
const holding = (path: string): unknown => {
  const [first = '', ...rest] = path.split('.');
  const list = /^(\w+)\[n\]$/.exec(first);
  const key = first.startsWith('<') ? 'any' : (list?.[1] ?? first);
  const inner = rest.length ? holding(rest.join('.')) : null;
  return { [key]: list ? [inner] : inner };
};
const known = (path: string) =>
  !unknownFields(holding(path)).length || !unknownFields(holding(`apps.<id>.${path}`)).length;

describe('the skill references', () => {
  it('name only fields the stack format knows', () => {
    const fields = firstColumn(read('stack.md'), 'Field');
    expect(fields.length).toBeGreaterThan(30);
    expect(fields.filter(field => !known(field))).toEqual([]);
  });

  it('list only prerequisites the stack format knows', () => {
    const kinds = firstColumn(read('preparing-nodes.md'), 'Kind');
    expect(kinds).toContain('tunnel');
    expect(kinds.filter(kind => unknownFields({ apps: { any: { prereqs: [{ [kind]: null }] } } }).length)).toEqual([]);
  });
});
