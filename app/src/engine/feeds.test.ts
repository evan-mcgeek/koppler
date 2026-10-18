import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'vitest';
import { readModule } from '../core/terraform.ts';
import { draftApp, linkQueues, queueDraft, readRepo } from './deployed.ts';

// One app's Terraform: Kafka topics piped onto its bus, and a rule forwarding to a bus in another account.
const SENDER = {
  'pipe.tf': `
resource "aws_cloudwatch_event_bus" "main" {
  name = "orders-events"
}
resource "aws_pipes_pipe" "main" {
  for_each = toset(var.topics)
  source   = "smk://broker:9096"
  target   = aws_cloudwatch_event_bus.main.arn
  source_parameters {
    self_managed_kafka_parameters {
      topic_name = each.key
    }
  }
}
resource "aws_cloudwatch_event_rule" "forward" {
  event_bus_name = aws_cloudwatch_event_bus.main.name
}
resource "aws_cloudwatch_event_target" "forward" {
  rule = aws_cloudwatch_event_rule.forward.name
  arn  = local.shop_bus[var.environment_type]
}
locals {
  shop_bus = {
    dev  = "arn:aws:events:eu-west-1:111:event-bus/shop_bus_dev"
    prod = "arn:aws:events:eu-west-1:222:event-bus/shop_bus_prod"
  }
}
variable "topics" {
  type = list(string)
}`,
  'deployment.tfvars': 'topics = [\n  "Orders_Created",\n  "Orders_Paid"\n  //"Orders_Old"\n]',
};
// The other app: the bus the rule forwards to, read by a rule to its Lambda, and an SNS topic sent on to a queue.
const READER = {
  'bus.tf': `
resource "aws_cloudwatch_event_bus" "shop" {
  name = "shop_bus_\${terraform.workspace}"
}
resource "aws_cloudwatch_event_rule" "all" {
  event_bus_name = aws_cloudwatch_event_bus.shop.name
}
resource "aws_cloudwatch_event_target" "lambda" {
  rule = aws_cloudwatch_event_rule.all.name
  arn  = aws_lambda_function.main.arn
}
resource "aws_sns_topic" "news" {
  name = "news-\${terraform.workspace}"
}
resource "aws_sqs_queue" "inbox" {
  name = "inbox-\${terraform.workspace}"
}
resource "aws_sns_topic_subscription" "inbox" {
  topic_arn = aws_sns_topic.news.arn
  protocol  = "sqs"
  endpoint  = aws_sqs_queue.inbox.arn
}`,
};
const stack = { envs: ['qa'], envAliases: { qa: ['dev'] }, apps: {} };
const files = (all: Record<string, string>) => Object.entries(all).map(([name, text]) => ({ name, text }));

test('Kafka topics, pipes, rules and subscriptions are read into what feeds what, across apps', () => {
  const drafts = {
    orders: draftApp('orders', readModule(files(SENDER)), stack, new Map()),
    shop: draftApp('shop', readModule(files(READER), ['dev']), stack, new Map()),
  };
  const linked = linkQueues(drafts, stack);
  const at = (id: string) => linked.find(queue => queue.id === id);
  // A list of topics is one queue per topic; the commented-out one is left out.
  assert.deepEqual(at('orders-created')?.feeds, { 'orders-events': 'pipe' });
  assert.deepEqual(at('orders-paid')?.feeds, { 'orders-events': 'pipe' });
  assert.equal(at('orders-old'), undefined);
  assert.equal(at('orders-created')?.type, 'kafka');
  // The rule's target is another account's bus, named per environment: it is the reader's bus.
  assert.deepEqual(at('orders-events')?.feeds, { 'shop-bus': 'rule' });
  assert.deepEqual(at('shop-bus')?.reads, ['shop']);
  assert.deepEqual(at('shop-bus')?.via, { shop: 'rule to Lambda' });
  assert.deepEqual(at('news')?.feeds, { inbox: 'subscription' });

  const draft = queueDraft(linked, {});
  assert.deepEqual((draft.queues['orders-created'] as { feeds?: unknown }).feeds, { 'orders-events': { via: 'pipe' } });
  assert.deepEqual(draft.apps['shop']?.reads?.['shop-bus'], { via: 'rule to Lambda' });
});

test("a pipe in a module folder reads the topics of a map in its parent's .tfvars.json, and its send right is not the app's", () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-feeds-'));
  const listener = path.join(repo, 'infra', 'listener');
  fs.mkdirSync(listener, { recursive: true });
  fs.writeFileSync(
    path.join(repo, 'infra', 'deployment.tfvars.json'),
    JSON.stringify({ kafka: { topics: { product: 'Juno_Product', destination: 'Juno_Destination' } } }),
  );
  fs.writeFileSync(path.join(repo, 'infra', 'main.tf'), 'module "listener" {\n  source = "./listener"\n}\n');
  fs.writeFileSync(
    path.join(listener, 'pipes.tf'),
    `
module "sqs" {
  source = "git@github.com:acme/modules.git//modules/sqs"
  name   = "catalog-kafka-sqs"
}
resource "awscc_pipes_pipe" "listener" {
  for_each = var.kafka.topics
  source   = "smk://broker:9096"
  target   = module.sqs.arn
  source_parameters = {
    self_managed_kafka_parameters = {
      topic_name = each.value
    }
  }
}
data "aws_iam_policy_document" "pipe" {
  statement {
    actions   = ["sqs:SendMessage"]
    resources = [module.sqs.arn]
  }
}
resource "aws_lambda_event_source_mapping" "reader" {
  event_source_arn = module.sqs.arn
}`,
  );
  const drafts = { catalog: draftApp('catalog', readRepo(repo), stack, new Map()) };
  const linked = linkQueues(drafts, stack);
  const at = (id: string) => linked.find(queue => queue.id === id);
  assert.deepEqual(at('juno-product')?.feeds, { 'catalog-kafka': 'pipe' });
  assert.deepEqual(at('juno-destination')?.feeds, { 'catalog-kafka': 'pipe' });
  assert.deepEqual(at('catalog-kafka')?.reads, ['catalog']);
  assert.deepEqual(at('catalog-kafka')?.sends, []);
  fs.rmSync(repo, { recursive: true, force: true });
});
