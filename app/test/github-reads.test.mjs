import './sandbox.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const entry = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'koppler.mjs');

test('A repo not cloned here is read from a copy taken from GitHub, only when asked, and its calls say where they were found.', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-github-'));
  try {
    const repo = (name, files) => {
      const at = path.join(dir, name);
      fs.mkdirSync(path.join(at, 'src'), { recursive: true });
      for (const [file, text] of Object.entries(files)) fs.writeFileSync(path.join(at, file), text);
      const git = (...args) => execFileSync('git', ['-C', at, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args]);
      git('init', '-q');
      git('remote', 'add', 'origin', `git@github.com:acme/${name}.git`);
      git('add', '.');
      git('commit', '-qm', 'one');
      return at;
    };
    // Orders is cloned here; Payments is only on "GitHub", where its code calls Orders.
    repo(path.join('code', 'orders'), { 'src/app.ts': 'export const port = 3000;\n' });
    const github = repo('payments-on-github', { 'src/orders.ts': 'const orders = "https://orders.acme.dev/api";\n' });
    const bin = path.join(dir, 'bin');
    fs.mkdirSync(bin);
    // Plays `gh repo clone <slug> <dir> -- ...`, and says what it was asked.
    fs.writeFileSync(
      path.join(bin, 'gh'),
      `#!/bin/sh\necho "$@" >> "${path.join(dir, 'gh.log')}"\n[ "$3" = acme/payments ] || exit 1\ngit clone -q "${github}" "$4"\n`,
      { mode: 0o755 },
    );
    const stack = path.join(dir, 'stack');
    fs.mkdirSync(stack);
    fs.writeFileSync(path.join(stack, 'stack.json'), JSON.stringify({ name: 'Acme Shop', envs: ['qa'], apps: {
      orders: { name: 'Orders API', kind: 'node', slug: 'acme/orders', deployedUrl: 'https://orders.acme.dev/' },
      payments: { name: 'Payments API', kind: 'node', slug: 'acme/payments', deployedUrl: 'https://payments.acme.dev/' },
      gone: { name: 'Gone API', kind: 'node', slug: 'acme/gone', deployedUrl: 'https://gone.acme.dev/' },
      odd: { name: 'Odd API', kind: 'node', slug: '../escape', deployedUrl: 'https://odd.acme.dev/' },
    } }));
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, HOME: dir, KOPPLER_STATE: path.join(dir, 'state'), KOPPLER_TEMP: path.join(dir, 'temp'), KOPPLER_CONFIG_DIR: path.join(dir, 'config') };
    delete env.CLAUDE_CODE_SESSION_ID;
    const koppler = (...args) => spawnSync('node', [entry, ...args], { encoding: 'utf8', env });
    assert.equal(koppler('init', '--root', path.join(dir, 'code'), '--stack', stack, '--no-fetch').status, 0);
    const found = () => JSON.parse(fs.readFileSync(path.join(dir, 'temp', 'registry.json'), 'utf8')).found;

    // Not asked: GitHub is not touched, and nothing is found in a repo not cloned here.
    assert.equal(koppler('sync').status, 0);
    assert.equal(fs.existsSync(path.join(dir, 'gh.log')), false);
    assert.deepEqual(found(), {});

    const read = koppler('sync', '--github');
    assert.equal(read.status, 0, read.stderr);
    assert.match(read.stdout, /^FOUND payments -> orders, not in stack\.json: GitHub acme\/payments: src\/orders\.ts:1:/m);
    assert.match(read.stdout, /^GITHUB gone: could not read acme\/gone/m);
    // A slug that is not owner/repo is never asked for, nor made a folder from.
    assert.doesNotMatch(fs.readFileSync(path.join(dir, 'gh.log'), 'utf8'), /escape/);
    assert.equal(fs.existsSync(path.join(dir, 'escape')), false);
    // The copy is Koppler's own, and the next sync reads it without asking GitHub again.
    assert.equal(fs.existsSync(path.join(dir, 'state', 'github', 'acme', 'payments', 'src', 'orders.ts')), true);
    const asked = fs.readFileSync(path.join(dir, 'gh.log'), 'utf8');
    assert.equal(koppler('sync').status, 0);
    assert.equal(fs.readFileSync(path.join(dir, 'gh.log'), 'utf8'), asked);
    assert.match(found().payments.orders, /^GitHub acme\/payments: src\/orders\.ts:1:/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
