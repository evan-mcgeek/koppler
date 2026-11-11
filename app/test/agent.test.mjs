import './sandbox.mjs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const entry = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'koppler.mjs');

/** A home folder with the agents' own folders, and a stand-in for the claude command that keeps what it was asked. */
function sandbox() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-agent-'));
  const bin = path.join(home, 'bin');
  fs.mkdirSync(bin);
  fs.mkdirSync(path.join(home, '.claude'));
  fs.mkdirSync(path.join(home, '.copilot'));
  fs.mkdirSync(path.join(home, '.config', 'opencode'), { recursive: true });
  // OpenCode already has a server of its own, which stays.
  fs.writeFileSync(path.join(home, '.config', 'opencode', 'opencode.json'), JSON.stringify({ theme: 'dark', mcp: { other: { type: 'local', command: ['other'] } } }));
  const added = path.join(home, 'claude-mcp');
  fs.writeFileSync(
    path.join(bin, 'claude'),
    `#!/bin/sh\nif [ "$2" = get ]; then test -f ${added}; exit $?; fi\necho "$@" >> ${added}\n`,
    { mode: 0o755 },
  );
  const env = { ...process.env, HOME: home, PATH: `${bin}:/usr/bin:/bin` };
  const koppler = (...args) => spawnSync(process.execPath, [entry, ...args], { encoding: 'utf8', env });
  return { home, added, koppler };
}

test('agent init links the skill into each agent found and registers koppler mcp, keeping what the configs had', () => {
  const { home, added, koppler } = sandbox();
  const done = koppler('agent', 'init');
  assert.equal(done.status, 0, done.stderr);
  // Both skills, each under a name of its own: without the plugin there is no koppler: in front.
  assert.match(
    done.stdout,
    /Claude Code: skill linked at .*\.claude\/skills\/koppler-plan, skill linked at .*\.claude\/skills\/koppler-discover, skill linked at .*\.claude\/skills\/koppler-help; MCP added/,
  );
  assert.match(done.stdout, /GitHub Copilot CLI: skill linked/);
  assert.match(done.stdout, /OpenCode: skill linked/);
  assert.doesNotMatch(done.stdout, /VS Code/);
  for (const dir of ['.claude/skills', '.copilot/skills', '.config/opencode/skills'])
    for (const skill of ['koppler-plan', 'koppler-discover', 'koppler-help'])
      assert.ok(fs.existsSync(path.join(home, dir, skill, 'SKILL.md')), `${dir}/${skill}`);
  assert.match(fs.readFileSync(added, 'utf8'), /^mcp add --scope user koppler -- .+ mcp$/m);
  const copilot = JSON.parse(fs.readFileSync(path.join(home, '.copilot', 'mcp-config.json'), 'utf8'));
  assert.equal(copilot.mcpServers.koppler.type, 'local');
  assert.equal(copilot.mcpServers.koppler.args.at(-1), 'mcp');
  const opencode = JSON.parse(fs.readFileSync(path.join(home, '.config', 'opencode', 'opencode.json'), 'utf8'));
  assert.equal(opencode.theme, 'dark');
  assert.deepEqual(Object.keys(opencode.mcp), ['other', 'koppler']);
  assert.equal(opencode.mcp.koppler.command.at(-1), 'mcp');

  // Run again, nothing changes.
  const again = koppler('agent', 'init');
  assert.match(again.stdout, /Claude Code: skill already linked at .*; MCP already added/);
  assert.match(again.stdout, /OpenCode: skill already linked .*; MCP already in/);
  assert.equal(fs.readFileSync(added, 'utf8').trim().split('\n').length, 1);
});

test("agent init leaves the user's own skill folder and a config that is not plain JSON alone, and says what to add", () => {
  const { home, koppler } = sandbox();
  fs.mkdirSync(path.join(home, '.copilot', 'skills', 'koppler-plan'), { recursive: true });
  fs.writeFileSync(path.join(home, '.config', 'opencode', 'opencode.json'), '{\n  // mine\n  "theme": "dark"\n}\n');
  const done = koppler('agent', 'init', '--agent', 'copilot,opencode');
  assert.equal(done.status, 0, done.stderr);
  assert.match(done.stdout, /GitHub Copilot CLI: left .*koppler-plan alone \(a folder of its own\)/);
  assert.match(done.stdout, /OpenCode: skill linked .*; left .*opencode\.json alone \(not plain JSON\); add under "mcp": "koppler": \{"type":"local"/);
  assert.match(fs.readFileSync(path.join(home, '.config', 'opencode', 'opencode.json'), 'utf8'), /\/\/ mine/);
  assert.doesNotMatch(done.stdout, /Claude Code/);
  assert.match(koppler('agent', 'init', '--agent', 'cursor').stderr, /no agent called cursor/);
});

test('agent init removes the koppler-run link an older Koppler left once it points nowhere, and keeps one that still works', () => {
  const { home, koppler } = sandbox();
  const claude = path.join(home, '.claude', 'skills');
  fs.mkdirSync(claude, { recursive: true });
  fs.symlinkSync(path.join(home, 'gone'), path.join(claude, 'koppler-run'));
  const done = koppler('agent', 'init', '--agent', 'claude');
  assert.equal(done.status, 0, done.stderr);
  assert.match(done.stdout, /removed the old skill link at .*koppler-run/);
  assert.equal(fs.lstatSync(path.join(claude, 'koppler-run'), { throwIfNoEntry: false }), undefined);

  const copilot = path.join(home, '.copilot', 'skills');
  fs.mkdirSync(path.join(home, 'mine'));
  fs.mkdirSync(copilot, { recursive: true });
  fs.symlinkSync(path.join(home, 'mine'), path.join(copilot, 'koppler-run'));
  assert.doesNotMatch(koppler('agent', 'init', '--agent', 'copilot').stdout, /old skill link/);
  assert.ok(fs.lstatSync(path.join(copilot, 'koppler-run')).isSymbolicLink());
});
