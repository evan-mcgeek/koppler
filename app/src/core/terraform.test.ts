import { expect, test } from 'vitest';
import { readModule } from './terraform.ts';

const files = (all: Record<string, string>) => Object.entries(all).map(([name, text]) => ({ name, text }));

// Queues made by for_each and count: one per instance, each with its own name in each environment.
const QUEUES = {
  'queues.tf': `
resource "aws_sqs_queue" "orders" {
  for_each = toset(["created", "paid"])
  name     = "acme-orders-\${each.key}-\${var.env}"
}
resource "aws_sqs_queue" "sync" {
  for_each = var.regions
  name     = "acme-sync-\${each.value}"
}
resource "aws_sns_topic" "kinds" {
  for_each = toset(local.kinds)
  name     = "acme-\${each.value}-news"
}
resource "aws_sqs_queue" "shard" {
  count = var.shards
  name  = "acme-shard-\${count.index}"
}
resource "aws_sqs_queue" "jobs" {
  name = "acme-jobs-\${random_id.suffix.hex}"
}
resource "aws_sqs_queue" "plain" {
  name = "acme-plain-\${var.env}"
}
locals {
  kinds = ["stock", "price"]
}`,
  'qa.tfvars': 'env = "qa"\nshards = 2\nregions = {\n  eu = "eu-west-1"\n  us = "us-east-1"\n}',
};

test('for_each and count make one queue per instance, named for the environment', () => {
  const [qa] = readModule(files(QUEUES));
  const named = Object.fromEntries((qa?.queues ?? []).map(queue => [queue.address, queue.name]));
  expect(named).toEqual({
    'aws_sqs_queue.orders["created"]': 'acme-orders-created-qa',
    'aws_sqs_queue.orders["paid"]': 'acme-orders-paid-qa',
    'aws_sqs_queue.sync["eu"]': 'acme-sync-eu-west-1',
    'aws_sqs_queue.sync["us"]': 'acme-sync-us-east-1',
    'aws_sns_topic.kinds["stock"]': 'acme-stock-news',
    'aws_sns_topic.kinds["price"]': 'acme-price-news',
    'aws_sqs_queue.shard[0]': 'acme-shard-0',
    'aws_sqs_queue.shard[1]': 'acme-shard-1',
    'aws_sqs_queue.jobs': null,
    'aws_sqs_queue.plain': 'acme-plain-qa',
  });
});

test('a name only known once deployed keeps its pattern; a named queue has none', () => {
  const [qa] = readModule(files(QUEUES));
  const jobs = qa?.queues.find(queue => queue.address === 'aws_sqs_queue.jobs');
  expect(jobs?.pattern).toBe('acme-jobs-${random_id.suffix.hex}');
  expect(qa?.queues.find(queue => queue.address === 'aws_sqs_queue.plain')?.pattern).toBeUndefined();
});

test('a for_each it cannot read stays one queue with its pattern, as before', () => {
  const [one] = readModule(
    files({ 'q.tf': 'resource "aws_sqs_queue" "x" {\n  for_each = var.unknown\n  name = "acme-${each.key}"\n}' }),
  );
  expect(one?.queues.map(queue => [queue.address, queue.name, queue.pattern])).toEqual([
    ['aws_sqs_queue.x', null, 'acme-${each.key}'],
  ]);
});
