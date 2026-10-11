import assert from 'node:assert/strict';
import { addressOf, assignments, blocks, draftApp, queueUses, readModule, resolve, stackEnv } from '../dist/engine/deployed.js';

assert.deepEqual(assignments('a = "x"\n  b = var.y # note\n  m = {\n    dev = "d"\n    prod = "p"\n  }\n  nested {\n    skip = 1\n  }\n"q.r" = 2'),
  [['a', '"x"'], ['b', 'var.y'], ['m', '{\n    dev = "d"\n    prod = "p"\n  }'], ['q.r', '2']]);
assert.equal(blocks('resource "a" "b" {\n  x = { y = 1 }\n}\nresource "a" "c" {\n z = 2\n}', /resource\s+"a"\s+"\w+"\s*\{/g).length, 2);

const ctx = { workspace: 'dev', vars: { zone: '"acme-dev.test"', name: '"orders"' }, locals: { hosts: '{\n dev = "a.test"\n prod = "b.test"\n}', ws: 'terraform.workspace' } };
assert.equal(resolve('"${var.name}.${var.zone}"', ctx), 'orders.acme-dev.test');
assert.equal(resolve('local.hosts[local.ws]', ctx), 'a.test');
assert.equal(resolve('terraform.workspace == "prod" ? "https://p.test" : "https://q.test"', ctx), 'https://q.test');
assert.equal(resolve('"${random_string.id.id}-x"', ctx), null);
assert.equal(resolve('lower(var.name)', ctx), null);

assert.equal(addressOf('https://api.acme.test/v1/'), 'https://api.acme.test/v1');
assert.equal(addressOf('api.acme.test'), 'api.acme.test');
// Anything that could carry a credential is never an address.
for (const secret of ['https://user:pw@api.acme.test', 'https://api.acme.test/?key=abc', 'Host=db;Password=x', 'sk_live_123', 'postgres://u:p@db.acme.test/x']) assert.equal(addressOf(secret), null);

const stack = { envs: ['qa', 'prod'], envAliases: { qa: ['dev'] }, apps: { orders: { deployedUrl: 'https://orders.acme-dev.test' }, billing: { deployedUrl: 'https://billing.acme-dev.test' } } };
assert.equal(stackEnv('dev', stack), 'qa');
assert.equal(stackEnv('production', stack), 'prod');
assert.equal(stackEnv('uat', stack), null);

// Per-environment variable files.
const tf = `
variable "zone" {}
variable "db" { sensitive = true }
resource "aws_apigatewayv2_domain_name" "d" {
  domain_name = "orders.\${var.zone}"
}
resource "aws_lambda_function" "f" {
  environment {
    variables = {
      BILLING_URL          = "https://billing.\${var.zone}/v1"
      ConnectionStrings__DB = var.db
      PLAIN                 = "eu-west-1"
      AWS_XRAY_CONTEXT_MISSING = "LOG_ERROR"
    }
  }
}
resource "aws_secretsmanager_secret" "s" {
  name = "orders-\${terraform.workspace}"
}
resource "aws_secretsmanager_secret" "r" {
  name = "orders-\${random_string.id.id}"
}
data "aws_ssm_parameter" "p" {
  name = "/aws/service/thing"
}`;
const modules = readModule([{ name: 'main.tf', text: tf }, { name: 'deployment-dev.tfvars', text: 'zone = "acme-dev.test"\naccount_name = "acme-dev"' }, { name: 'deployment-prod.tfvars', text: 'zone = "acme.test"' }]);
assert.deepEqual(modules.map(m => m.token), ['dev', 'prod']);
assert.deepEqual(modules[0].domains, [{ host: 'orders.acme-dev.test', from: 'api' }]);
assert.equal(modules[0].account, 'acme-dev');
assert.deepEqual(modules[0].settings, [
  { name: 'BILLING_URL', address: 'https://billing.acme-dev.test/v1', secret: false },
  { name: 'ConnectionStrings__DB', address: null, secret: true },
  { name: 'PLAIN', address: null, secret: false },
]);
assert.deepEqual(modules[0].secrets.map(s => s.name), ['orders-dev', 'orders-${random_string.id.id}']);

const owners = new Map([['orders.acme-dev.test', 'orders'], ['billing.acme-dev.test', 'billing']]);
const draft = draftApp('orders', modules, stack, owners);
assert.equal(draft.qa.deployedUrl, 'https://orders.acme-dev.test/');
assert.equal(draft.prod.deployedUrl, 'https://orders.acme.test/');
assert.deepEqual(draft.qa.calls, [{ to: 'billing', setting: 'BILLING_URL', deployed: 'https://billing.acme-dev.test/v1' }]);
assert.deepEqual(draft.qa.settings, ['BILLING_URL', 'PLAIN']);
assert.deepEqual(draft.qa.secretSettings, ['ConnectionStrings__DB']);
// No value other than an address leaves the reader.
assert.equal(JSON.stringify(draft).includes('eu-west-1'), false);

// One folder, environment chosen by workspace; the stack's own name wins over its alias.
const byWorkspace = readModule([{ name: 'main.tf', text: `
locals {
  host = {
    dev = "old.acme-dev.test"
    qa  = "orders.acme-dev.test"
    prod = "orders.acme.test"
  }
}
variable "environment" {}
resource "aws_api_gateway_domain_name" "d" {
  domain_name = local.host[var.environment]
}` }], ['qa', 'dev', 'prod']);
assert.deepEqual(byWorkspace.map(m => [m.token, m.domains[0]?.host]), [['qa', 'orders.acme-dev.test'], ['dev', 'old.acme-dev.test'], ['prod', 'orders.acme.test']]);
assert.equal(draftApp('orders', byWorkspace, stack, owners).qa.deployedUrl, 'https://orders.acme-dev.test/');
assert.deepEqual(draftApp('orders', byWorkspace, stack, owners).qa.otherAddresses, []);
console.log('deployed tests ok');

// Queues: who reads and who sends, the settings that carry the address, and what feeds a queue from outside.
{
  const tf = `
resource "aws_sqs_queue" "thumbs" {
  name = "user-media-thumbnail-queue"
}
resource "aws_sqs_queue" "thumbs_dlq" {
  name = "user-media-thumbnail-dlq"
}
resource "aws_s3_bucket_notification" "n" {
  queue {
    queue_arn = aws_sqs_queue.thumbs.arn
  }
}
resource "aws_lambda_event_source_mapping" "m" {
  event_source_arn = aws_sqs_queue.thumbs.arn
}
resource "aws_sqs_queue" "emergency" {
  name = "user-emergency-responses-queue.fifo"
}
resource "aws_iam_policy" "p" {
  policy = jsonencode({
    Statement = [{
      Action   = ["sqs:SendMessage", "sqs:GetQueueUrl"]
      Resource = aws_sqs_queue.emergency.arn
    }]
  })
}
module "sqs" {
  source = "git@github.com:acme/tf.git//modules/sqs?ref=v1"
  name   = "\${var.service_name}-sqs-queue-\${var.environment}"
}
resource "aws_lambda_function" "f" {
  environment {
    variables = {
      QUEUE_URL = module.sqs.id,
      OTHER     = "x"
    }
  }
}`;
  const q = Object.fromEntries(queueUses(tf).map(x => [x.address, x]));
  assert.deepEqual(Object.keys(q), ['aws_sqs_queue.thumbs', 'aws_sqs_queue.emergency', 'module.sqs']);
  assert.deepEqual([q['aws_sqs_queue.thumbs'].reads, q['aws_sqs_queue.thumbs'].sends, q['aws_sqs_queue.thumbs'].fedBy], [true, false, ['S3 bucket notifications']]);
  assert.deepEqual([q['aws_sqs_queue.emergency'].reads, q['aws_sqs_queue.emergency'].sends], [false, true]);
  assert.deepEqual(q['module.sqs'].env, ['QUEUE_URL']);
  // Per environment, the name is worked out from the variables.
  const [dev] = readModule([{ name: 'main.tf', text: tf }, { name: 'dev.tfvars', text: 'service_name = "bookings"\nenvironment = "dev"' }]);
  assert.equal(dev.queues.find(x => x.address === 'module.sqs').name, 'bookings-sqs-queue-dev');
}
console.log('deployed queue tests ok');

// Outside systems from an app's addresses per environment, and stack queues known by their real name.
{
  const { outsideCalls, inStack } = await import('../dist/engine/deployed.js');
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-outside-'));
  fs.writeFileSync(path.join(dir, 'appsettings.prod.json'), JSON.stringify({ Salesforce: { Url: 'https://acme.my.salesforce.com' }, Other: 'https://api.example.com' }));
  const stack = { envs: ['qa', 'prod'], envAliases: { qa: ['dev'] }, apps: {} };
  const found = outsideCalls(dir, { qa: { settingsWithAddress: [{ name: 'SF_URL', address: 'https://acme--qa.sandbox.my.site.com' }] } }, stack);
  assert.deepEqual([...found.salesforce.qa.hosts], ['acme--qa.sandbox.my.site.com']);
  assert.deepEqual([...found.salesforce.prod.hosts], ['acme.my.salesforce.com']);
  assert.deepEqual([...found.salesforce.prod.settings], ['Url']);
  assert.equal(inStack({ id: 'thumbs', queue: 'user-media-thumbnail-queue' }, { queues: { 'user-media-thumbnails': { queue: 'user-media-thumbnail-queue' } } }), true);
  fs.rmSync(dir, { recursive: true });
}
console.log('deployed outside tests ok');

// A SAM app's deploy domains per samconfig.toml environment.
{
  const { samDomains } = await import('../dist/engine/deployed.js');
  const toml = 'version = 0.1\n[qa]\n[qa.deploy.parameters]\nparameter_overrides = "Environment=\\"QA\\" HostedZoneName=\\"cdr-qa.example.com\\" CatalogEndpoint=\\"https://other.example.com\\""\n[prod.deploy.parameters]\nparameter_overrides = "DomainName=\\"cdr.example.com\\""\n';
  assert.deepEqual(samDomains(toml), [{ token: 'qa', domains: [{ host: 'cdr-qa.example.com', from: 'api' }] }, { token: 'prod', domains: [{ host: 'cdr.example.com', from: 'api' }] }]);
}
// Nothing that could be a secret comes out of a draft: a webhook URL keeps only its origin, and an account is only
// what a variable named for the account holds.
assert.equal(addressOf('https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX'), 'https://hooks.slack.com');
assert.equal(addressOf('https://api.acme.dev/api/v1/'), 'https://api.acme.dev/api/v1');
assert.equal(addressOf('https://api.acme.dev/Hook/9f8a7b6c'), 'https://api.acme.dev');
{
  const account = text => readModule([{ name: 'main.tf', text }])[0]?.account ?? null;
  assert.equal(account('variable "service_account_key" { default = "SUPERSECRETVALUE" }'), null);
  assert.equal(account('variable "account_id" { default = "123456789012" }'), '123456789012');
  assert.equal(account('variable "account_name" { default = "acme-dev" }'), 'acme-dev');
  assert.equal(account('variable "account_name" { default = "not a name: a sentence" }'), null);
}
console.log('deployed sam tests ok');

// samconfig.toml as people write it: a commented-out line, a list, values without quotes, and hosts that are not the app's own.
{
  const { samDomains } = await import('../dist/engine/deployed.js');
  const hosts = toml => samDomains(toml).map(x => `${x.token}: ${x.domains.map(d => d.host).join(' ')}`);
  assert.deepEqual(hosts('[prod.deploy.parameters]\n# parameter_overrides = "DomainName=\\"old.acme.dev\\""\nparameter_overrides = "DomainName=\\"api.acme.dev\\""\n'), ['prod: api.acme.dev']);
  assert.deepEqual(hosts('[qa.deploy.parameters]\nparameter_overrides = [\n  "DomainName=api.qa.acme.dev",\n  "Stage=qa",\n]\n[prod.deploy.parameters]\nparameter_overrides = ["DomainName=api.acme.dev"]\n'), ['qa: api.qa.acme.dev', 'prod: api.acme.dev']);
  assert.deepEqual(hosts('[prod.deploy.parameters]\nparameter_overrides = "Stage=prod DomainName=api.acme.dev"\n'), ['prod: api.acme.dev']);
  assert.deepEqual(hosts("[prod.deploy.parameters]\nparameter_overrides = 'HostedZoneName=\"acme.dev\"'\n"), ['prod: acme.dev']);
  assert.deepEqual(hosts('[prod.deploy.parameters]\nparameter_overrides = "DbHost=\\"db.acme.dev\\" RedisHost=cache.acme.dev DomainName=\\"api.acme.dev\\""\n'), ['prod: api.acme.dev']);
}

// Terraform text inside quotes is text: braces, brackets and comment marks in it do not end a block or cut a value.
{
  const tf = 'resource "aws_sqs_queue" "jobs" {\n  name = "jobs #1 // main"\n  tags = { note = "closes } early (maybe" }\n  delay = 5 # seconds\n}\nresource "aws_sqs_queue" "other" {\n  name = "other"\n}\n';
  const found = blocks(tf, /resource\s+"aws_sqs_queue"\s+"([\w-]+)"\s*\{/g);
  assert.deepEqual(found.map(b => b.match[1]), ['jobs', 'other']);
  assert.deepEqual(assignments(found[0].body), [['name', '"jobs #1 // main"'], ['tags', '{ note = "closes } early (maybe" }'], ['delay', '5']]);
  assert.deepEqual(assignments(found[1].body), [['name', '"other"']]);
  assert.deepEqual(assignments('a = "x${var.b["k"]}y" # note\nb = [\n  "(", # one\n]\nc = 1\n'), [['a', '"x${var.b["k"]}y"'], ['b', '[\n  "(",\n]'], ['c', '1']]);
  // A block named inside a comment is not a block.
  assert.deepEqual(blocks('# resource "aws_sqs_queue" "gone" {\nresource "aws_sqs_queue" "real" {\n}\n', /resource\s+"aws_sqs_queue"\s+"([\w-]+)"\s*\{/g).map(b => b.match[1]), ['real']);
}

// A policy that lets the app both send to a queue and read from it records both.
{
  const tf = 'resource "aws_sqs_queue" "jobs" {\n  name = "jobs"\n}\nresource "aws_iam_role_policy" "app" {\n  policy = jsonencode({ Statement = [{ Action = ["sqs:SendMessage", "sqs:ReceiveMessage"], Resource = aws_sqs_queue.jobs.arn }] })\n}\n';
  const q = queueUses(tf).find(x => x.address === 'aws_sqs_queue.jobs');
  assert.deepEqual([q.sends, q.reads], [true, true]);
}
console.log('deployed misreads tests ok');
