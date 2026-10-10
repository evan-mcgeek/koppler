import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { switchBack, switchTo } from '../src/branch.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-branch-')), repo = path.join(dir, 'repo'), logFile = path.join(dir, 'actions.json');
const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
fs.mkdirSync(repo);
git('init', '-q', '-b', 'develop'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
fs.writeFileSync(path.join(repo, 'a.txt'), 'one\n'); git('add', '.'); git('commit', '-qm', 'one');
git('branch', 'feature/x');
const branch = () => git('rev-parse', '--abbrev-ref', 'HEAD');

// Uncommitted changes need a choice; set aside, they come back on the way back.
fs.writeFileSync(path.join(repo, 'a.txt'), 'mine\n'); fs.writeFileSync(path.join(repo, 'new.txt'), 'untracked\n');
assert.match(switchTo({ app: 'api', repo, to: 'feature/x', how: null, logFile }).error, /2 uncommitted changes on develop: choose --set-aside or --take-along/);
assert.match(switchTo({ app: 'api', repo, to: 'feature/x', how: 'set-aside', logFile }).message, /develop -> feature\/x, your 2 uncommitted changes are set aside until Stop/);
assert.equal(branch(), 'feature/x');
assert.equal(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8'), 'one\n');
assert.match(switchBack({ app: 'api', logFile }).message, /back on develop, your set-aside changes are back/);
assert.equal(branch(), 'develop');
assert.equal(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8'), 'mine\n');
assert.ok(fs.existsSync(path.join(repo, 'new.txt')));
assert.deepEqual(JSON.parse(fs.readFileSync(logFile, 'utf8')), []);

// Taken along, the changes travel both ways.
assert.match(switchTo({ app: 'api', repo, to: 'feature/x', how: 'take-along', logFile }).message, /changes came along/);
assert.equal(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8'), 'mine\n');
assert.match(switchBack({ app: 'api', logFile }).message, /back on develop$/);
assert.equal(branch(), 'develop');
console.log('branch tests ok');

// A clone that was on a commit, not a branch, goes back to that commit.
{
  git('stash', 'push', '-q', '--include-untracked'); git('stash', 'drop', '-q');
  git('switch', '-q', '--detach');
  const commit = git('rev-parse', 'HEAD'), log = () => JSON.parse(fs.readFileSync(logFile, 'utf8'));
  assert.match(switchTo({ app: 'api', repo, to: 'feature/x', how: null, logFile }).message, new RegExp(`commit ${commit.slice(0, 7)} -> feature/x`));
  assert.match(switchBack({ app: 'api', logFile }).message, new RegExp(`back on commit ${commit.slice(0, 7)}$`));
  assert.equal(branch(), 'HEAD');
  assert.equal(git('rev-parse', 'HEAD'), commit);
  assert.deepEqual(log(), []);

  // Set-aside changes that clash with what the branch became meanwhile stay in the stash; the clone is left clean and the entry stays.
  git('switch', '-q', 'develop');
  git('switch', '-q', '-c', 'ahead'); fs.writeFileSync(path.join(repo, 'a.txt'), 'theirs\n'); git('commit', '-qam', 'ahead'); git('switch', '-q', 'develop');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'mine\n'); fs.writeFileSync(path.join(repo, 'new.txt'), 'untracked\n');
  assert.match(switchTo({ app: 'api', repo, to: 'feature/x', how: 'set-aside', logFile }).message, /set aside until Stop/);
  git('branch', '-q', '-f', 'develop', 'ahead');
  for (let i = 0; i < 2; i++) {
    assert.match(switchBack({ app: 'api', logFile }).error, /back on develop, but your set-aside changes clash[\s\S]*git stash pop/);
    assert.equal(branch(), 'develop');
    assert.equal(git('status', '--porcelain'), '');
    assert.equal(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8'), 'theirs\n');
    assert.equal(git('stash', 'list').split('\n').filter(Boolean).length, 1);
    assert.equal(log().length, 1);
  }
  // Once the user has taken them back, the switch is done.
  try { git('stash', 'pop'); } catch { /* the clash is theirs to settle */ }
  fs.writeFileSync(path.join(repo, 'a.txt'), 'settled\n'); git('add', 'a.txt'); git('stash', 'drop', '-q');
  assert.match(switchBack({ app: 'api', logFile }).message, /back on develop, your set-aside changes were taken back already/);
  assert.equal(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8'), 'settled\n');
  assert.deepEqual(log(), []);

  // A clone that is gone is an answer, not a crash.
  fs.writeFileSync(logFile, JSON.stringify([{ kind: 'checkout', app: 'api', repo: path.join(dir, 'gone'), from: 'develop', to: 'feature/x' }]));
  assert.match(switchBack({ app: 'api', logFile }).error, /clone is no longer at/);
  assert.match(switchTo({ app: 'api', repo: path.join(dir, 'gone'), to: 'feature/x', how: null, logFile }).error, /^api: /);
  console.log('switching back tests ok');
}
