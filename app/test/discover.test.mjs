import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyFindings, discover } from '../src/discover.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-discover-'));
const mk = (name, files) => { const d = path.join(dir, name); for (const [f, t] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), t); } return d; };
const api = mk('orders-api', {
  'src/Api/Api.csproj': '', 'src/Api/Properties/launchSettings.json': JSON.stringify({ profiles: { QA: { applicationUrl: 'https://localhost:7001;http://localhost:5001' } } }),
  'infra/main.tf': 'resource "aws_apigatewayv2_domain_name" "d" {\n  domain_name = "orders.${var.zone}"\n}\nvariable "zone" {}',
  'infra/deployment-qa.tfvars': 'zone = "acme-qa.test"', 'infra/deployment-prod.tfvars': 'zone = "acme.test"',
});
const web = mk('shop-web', { 'package.json': '{"devDependencies":{"vite":"5"}}', 'src/api.ts': 'export const ORDERS = "https://orders.acme-qa.test/v1";' });
const stack = { name: 'Shop', envs: ['qa', 'prod'], apps: { 'orders-api': { name: 'Orders', kind: 'dotnet', slug: 'acme/orders-api' }, 'shop-web': { name: 'Shop', kind: 'web', slug: 'acme/shop-web' } } };
// The caller's code mentions the callee's QA address, which only Terraform knew.
const grep = (repo, hosts) => repo === web && hosts.includes('orders.acme-qa.test') ? ['src/api.ts:1:export const ORDERS = "https://orders.acme-qa.test/v1";'] : [];
const found = discover(stack, { 'orders-api': api, 'shop-web': web }, { grep });
assert.deepEqual(found.map(f => [f.id, f.value]), [
  ['url:orders-api', 'https://localhost:7001'],
  ['address:orders-api:qa', 'https://orders.acme-qa.test/'],
  ['address:orders-api:prod', 'https://orders.acme.test/'],
  ['url:shop-web', 'http://localhost:5173'],
  ['call:shop-web:orders-api', 'orders-api'],
]);
// Only what the user picks is written; a call records where it was found and the callee's address.
const some = applyFindings(stack, found, ['address:orders-api:qa', 'address:orders-api:prod', 'call:shop-web:orders-api']);
assert.equal(some.applied, 3);
assert.equal(some.stack.apps['orders-api'].deployedUrl, 'https://orders.acme-qa.test/');
assert.equal(some.stack.apps['orders-api'].envs.prod.deployedUrl, 'https://orders.acme.test/');
assert.equal(some.stack.apps['orders-api'].url, undefined);
assert.deepEqual(some.stack.apps['shop-web'].consumes, { 'orders-api': { how: 'unknown', found: 'src/api.ts:1:export const ORDERS = "https://orders.acme-qa.test/v1";', deployed: 'https://orders.acme-qa.test/' } });
assert.deepEqual(applyFindings(stack, found, ['made-up']).applied, 0);
// Once recorded, nothing is offered again.
assert.deepEqual(discover(applyFindings(stack, found, found.map(f => f.id)).stack, { 'orders-api': api, 'shop-web': web }, { grep }), []);
// Repos that deploy QA as "dev": the pairing is offered, and QA's addresses come with it.
const legacy = mk('legacy-api', { 'App.csproj': '', 'infra/main.tf': 'resource "aws_apigatewayv2_domain_name" "d" {\n  domain_name = "legacy.${var.zone}"\n}\nvariable "zone" {}', 'infra/deployment-dev.tfvars': 'zone = "acme-dev.test"', 'infra/deployment-prod.tfvars': 'zone = "acme.test"' });
const st2 = { name: 'L', envs: ['qa', 'prod'], apps: { legacy: { name: 'Legacy', kind: 'dotnet', slug: 'acme/legacy', url: 'http://localhost:1' } } };
const f2 = discover(st2, { legacy }, { grep: () => [] });
assert.deepEqual(f2.map(f => [f.id, f.value, f.needs ?? null]), [['alias:qa:dev', 'dev', null], ['address:legacy:qa', 'https://legacy.acme-dev.test/', 'alias:qa:dev'], ['address:legacy:prod', 'https://legacy.acme.test/', null]]);
assert.equal(applyFindings(st2, f2, ['address:legacy:qa']).applied, 0);
const withAlias = applyFindings(st2, f2, f2.map(f => f.id)).stack;
assert.deepEqual(withAlias.envAliases, { qa: ['dev'] });
assert.equal(withAlias.apps.legacy.deployedUrl, 'https://legacy.acme-dev.test/');
assert.deepEqual(discover(withAlias, { legacy }, { grep: () => [] }), []);
// No address in Terraform: the app's own code names it, and that is enough to see who calls whom.
const st3 = { name: 'C', envs: ['qa', 'prod'], envAliases: { qa: ['dev'] }, apps: { catalog: { name: 'Catalog', kind: 'dotnet', slug: 'acme/product-catalog', url: 'http://localhost:1' }, rules: { name: 'Rules', kind: 'dotnet', slug: 'acme/core-rulesengine', url: 'http://localhost:2' } } };
const lines = { catalog: ['src/Swagger.cs:3:https://product-catalog-dev.svc-dev.acme.test', 'src/Swagger.cs:4:https://product-catalog-qa.svc-dev.acme.test', 'src/Swagger.cs:5:https://product-catalog-prod.svc.acme.test', 'ci.yaml:9:https://github.com'],
  rules: ['src/appsettings.json:4:https://product-catalog-qa.svc-dev.acme.test', 'src/Swagger.cs:8:https://rulesengine.qa.acme.test', 'a.json:1:https://rulesengine.prod.acme.test', 'b.json:1:https://rulesengine.prod.other.test'] };
const f3 = discover(st3, { catalog: 'catalog', rules: 'rules' }, { urls: repo => lines[repo], grep: (repo, hosts) => repo === 'rules' && hosts.includes('product-catalog-qa.svc-dev.acme.test') ? ['src/appsettings.json:4:  "Catalog": "https://product-catalog-qa.svc-dev.acme.test"'] : [] });
// QA's own name beats "dev"; two PROD hosts for Rules cannot be told apart; the call runs from Rules to Catalog only.
assert.deepEqual(f3.map(f => [f.id, f.value]), [['address:catalog:qa', 'https://product-catalog-qa.svc-dev.acme.test/'], ['address:catalog:prod', 'https://product-catalog-prod.svc.acme.test/'], ['address:rules:qa', 'https://rulesengine.qa.acme.test/'], ['call:rules:catalog', 'catalog']]);
assert.equal(f3[0].why, 'its own code, src/Swagger.cs:4');
fs.rmSync(dir, { recursive: true });
console.log('discover tests ok');
