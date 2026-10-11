import { afterEach, expect, test } from 'vitest';
import { defaultPort, detect, KINDS, of, register } from './kinds.ts';
import { CLONES, repoOf } from './testing/repo.ts';

afterEach(() => {
  register({});
});

test('every kind has a label; one nobody defined is called by its own name', () => {
  expect(of({ kind: 'flutter' }).label).toBe('Flutter');
  expect(of({ kind: 'go' }).label).toBe('Go');
  expect(of({ kind: 'other' }).label).toBe('Other');
  expect(of({ kind: 'cobol' })).toMatchObject({ label: 'cobol', serves: true });
  expect(of({ kind: 'constructor' }).label).toBe('constructor');
  expect(of(null).label).toBe('App');
  expect(of({ kind: 'reactnative' })).toMatchObject({
    serves: false,
    platforms: [expect.anything(), expect.anything()],
  });
  expect(KINDS['sam']?.needs?.map(need => need.tool)).toEqual(['docker', 'sam']);
});

test('a clone is recognised by its files', () => {
  for (const [kind, files] of Object.entries(CLONES)) expect(detect(repoOf(files)), kind).toBe(kind);
  expect(detect(repoOf({ 'README.md': '' }))).toBeNull();
  // A .NET repo that only keeps a database in a compose file is still .NET.
  expect(detect(repoOf({ 'Api.csproj': '', 'docker-compose.yml': '' }))).toBe('dotnet');
});

test('a SAM app is one unless it has a dev server of its own', () => {
  const template = 'Transform: AWS::Serverless-2016-10-31\n';
  expect(detect(repoOf({ 'template.yaml': template }))).toBe('sam');
  expect(detect(repoOf({ 'template.yaml': template, 'package.json': '{"scripts":{"test":"jest"}}' }))).toBe('sam');
  expect(detect(repoOf({ 'template.yaml': template, 'package.json': '{"scripts":{"dev":"vite"}}' }))).toBe('node');
  expect(detect(repoOf({ 'template.yaml': 'Resources: {}', 'package.json': '{}' }))).toBe('node');
});

test('the usual port comes from what the repo holds', () => {
  expect(defaultPort('java', repoOf(CLONES['java'] ?? {}))).toBe(8080);
  expect(defaultPort('python', repoOf({ 'requirements.txt': 'Flask==3.0' }))).toBe(5000);
  expect(defaultPort('compose', repoOf(CLONES['compose'] ?? {}))).toBe(8085);
  expect(defaultPort('rust', repoOf(CLONES['rust'] ?? {}))).toBeNull();
  expect(defaultPort('dotnet', repoOf({}))).toBeNull();
});

test("a stack's own kind is recognised first, cannot replace a built-in one, and goes away with the stack", () => {
  register({
    elixir: { label: 'Elixir', detect: ['mix.exs'], start: 'mix phx.server', port: 4000 },
    go: { label: 'Not Go' },
    'Bad Id': { label: 'x' },
    broken: null,
  });
  expect(of({ kind: 'elixir' })).toMatchObject({ label: 'Elixir', custom: true });
  expect(of({ kind: 'go' }).label).toBe('Go');
  expect(Object.hasOwn(KINDS, 'Bad Id') || Object.hasOwn(KINDS, 'broken')).toBe(false);
  expect(detect(repoOf({ 'mix.exs': '', 'package.json': '{}' }))).toBe('elixir');
  expect(defaultPort('elixir', repoOf({}))).toBe(4000);
  register({});
  expect(of({ kind: 'elixir' }).label).toBe('elixir');
  expect(detect(repoOf({ 'mix.exs': '' }))).toBeNull();
});
