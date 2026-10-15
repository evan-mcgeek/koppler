// The stack file shared in the team's repo: its schema, the check CI runs on it, and a pull request with what this
// Mac's copy learned since its last commit.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import * as z from 'zod';
import { StackSchema, validateStack } from '../core/stack.ts';
import { fail } from '../failure.ts';
import { proposeFile, readFile } from '../github.ts';
import { changes, proposeChanges, sourceOf, type StackJson } from './linked.ts';
import { shareTarget } from './share.ts';
import { currentStack } from './stacks.ts';

type Loose = Record<string, unknown>;
const isObject = (value: unknown): value is Loose =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The JSON Schema of stack.json, for editors (`$schema`) and the settings panels. */
export const stackSchema = () => z.toJSONSchema(StackSchema, { unrepresentable: 'any', io: 'input' });

/** The stack file's problems, every check `koppler stack set` makes; none when it is fine. */
export function checkStackFile(file: string): string[] {
  let data: unknown;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    return [`${file} cannot be read as JSON: ${(error as Error).message}`];
  }
  return validateStack(data);
}

/**
 * What changed from `base` to `mine`, made on `theirs`: the changes this copy made, on the file as others left it. A
 * list is taken whole.
 */
export function patch(base: unknown, mine: unknown, theirs: unknown): unknown {
  if (JSON.stringify(base) === JSON.stringify(mine)) return theirs;
  if (!isObject(base) || !isObject(mine) || !isObject(theirs)) return mine;
  const changed = [...new Set([...Object.keys(base), ...Object.keys(mine)])].filter(
    key => JSON.stringify(base[key]) !== JSON.stringify(mine[key]),
  );
  const kept = Object.entries(theirs).filter(([key]) => !changed.includes(key) || key in mine);
  return Object.fromEntries([
    ...kept.map(([key, value]) => [key, changed.includes(key) ? patch(base[key], mine[key], value) : value]),
    ...changed.filter(key => key in mine && !(key in theirs)).map(key => [key, mine[key]]),
  ]);
}

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

/** `koppler stack propose`: a pull request on the stack's repo with what the copy here changed since its last commit. */
export async function proposeStack(): Promise<void> {
  const dir = currentStack() ?? fail('no stack in use (koppler use)');
  if (sourceOf(dir)) {
    const done = await proposeChanges(dir);
    if (done.error !== undefined) fail(done.error);
    console.log(`PROPOSED: ${done.url}`);
    return;
  }
  const target = await shareTarget(dir);
  if (target.error !== undefined) fail(target.error);
  const file = path.join(dir, 'stack.json');
  const mine = JSON.parse(fs.readFileSync(file, 'utf8')) as StackJson;
  let base: StackJson;
  try {
    base = JSON.parse(git(dir, 'show', `HEAD:./stack.json`)) as StackJson;
  } catch {
    fail(`stack.json is not committed in ${dir} yet: commit it first`);
  }
  const list = changes(base, mine);
  if (!list.length) fail('Nothing to propose: stack.json matches its last commit.');
  const text = await readFile(target.file);
  if (text === null) fail(`Could not read the stack on ${target.repo}. Check that gh is signed in.`);
  const next = patch(base, mine, JSON.parse(text));
  const problems = validateStack(next);
  if (problems.length) fail(`The stack would not pass its check: ${problems.slice(0, 3).join('; ')}`);
  const name = typeof mine.name === 'string' ? mine.name : 'stack';
  const opened = await proposeFile(target.file, `${JSON.stringify(next, null, 2)}\n`, {
    branch: `koppler/stack-${Date.now().toString(36)}`,
    title: `${name}: ${String(list.length)} ${list.length === 1 ? 'change' : 'changes'} from Koppler`,
    body: `What Koppler learned while running these apps locally:\n\n${list.map(line => `- ${line}`).join('\n')}\n\nNames and addresses only; no secret values.`,
  });
  if (opened.error !== undefined) fail(opened.error);
  console.log(
    `PROPOSED ${String(list.length)} ${list.length === 1 ? 'change' : 'changes'} on ${target.repo}: ${opened.url}`,
  );
}
