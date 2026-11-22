import './sandbox.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

// koppler discover --deployed drafts a Serverless Framework app's address from its custom domain, per stage.
test('discover --deployed drafts each environment address from serverless.yml, and never changes the stack', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-serverless-'));
  const clone = path.join(dir, 'orders-api');
  fs.mkdirSync(clone);
  fs.writeFileSync(
    path.join(clone, 'serverless.yml'),
    `service: orders-api
provider:
  name: aws
  stage: \${opt:stage, 'qa'}
custom:
  domains:
    qa: api.qa.acme.dev
    prod: api.acme.dev
  customDomain:
    domainName: \${self:custom.domains.\${sls:stage}}
    basePath: orders
`,
  );
  const jobs = path.join(dir, 'jobs');
  fs.mkdirSync(jobs);
  fs.writeFileSync(path.join(jobs, 'serverless.yml'), 'custom:\n  customDomain:\n    domainName: ${ssm:/acme/jobs-domain}\n');
  const config = path.join(dir, 'config'), temp = path.join(dir, 'temp'), code = path.join(dir, 'code');
  const shop = path.join(config, 'stacks', 'acme-shop');
  for (const folder of [shop, temp, code]) fs.mkdirSync(folder, { recursive: true });
  const stackFile = path.join(shop, 'stack.json');
  const apps = { orders: { name: 'Orders API', kind: 'other', slug: 'acme/orders-api' }, jobs: { name: 'Jobs', kind: 'other', slug: 'acme/jobs' } };
  fs.writeFileSync(stackFile, JSON.stringify({ name: 'Acme Shop', envs: ['qa', 'prod'], apps }));
  const env = { ...process.env, HOME: dir, KOPPLER_STATE: dir, KOPPLER_TEMP: temp, KOPPLER_CONFIG_DIR: config };
  delete env.CLAUDE_CODE_SESSION_ID;
  const entry = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'koppler.mjs');
  const koppler = (...args) => spawnSync('node', [entry, ...args], { encoding: 'utf8', env, cwd: dir });
  try {
    const init = koppler('init', '--root', code, '--stack', shop, '--no-fetch');
    assert.equal(init.status, 0, init.stdout + init.stderr);
    fs.writeFileSync(path.join(temp, 'local.json'), JSON.stringify({ apps: { orders: { path: clone }, jobs: { path: jobs } } }));
    const before = fs.readFileSync(stackFile, 'utf8');
    const r = koppler('discover', '--deployed', '--no-fetch');
    const out = r.stdout + r.stderr;
    assert.equal(r.status, 0, out);
    assert.match(out, /address\s+https:\/\/api\.qa\.acme\.dev\/orders\/\s+NEW/);
    assert.match(out, /serverless\.yml: its domain \$\{ssm:\/acme\/jobs-domain\} is only known when deployed/);
    assert.doesNotMatch(out, /Terraform found/);
    const { suggestions } = JSON.parse(fs.readFileSync(path.join(temp, 'stack.deployed.json'), 'utf8'));
    assert.equal(suggestions.orders.deployedUrl, 'https://api.qa.acme.dev/orders/');
    assert.equal(suggestions.orders.envs.prod.deployedUrl, 'https://api.acme.dev/orders/');
    assert.equal(suggestions.jobs, undefined);
    assert.equal(fs.readFileSync(stackFile, 'utf8'), before);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
