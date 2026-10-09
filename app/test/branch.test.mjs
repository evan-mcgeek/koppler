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
