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

// An ECS service behind a load balancer: its address comes from the listener rule that forwards to it.
const ECS = {
  'ecs.tf': `
resource "aws_ecs_service" "orders" {
  name = "orders"
  load_balancer {
    target_group_arn = aws_lb_target_group.orders.arn
    container_port   = 8080
  }
}
resource "aws_lb_target_group" "orders" {
  port = 8080
}
resource "aws_lb_target_group" "billing" {
  port = 9090
}
resource "aws_lb" "public" {
  name = "acme-public"
}
resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.public.arn
  port              = 443
  protocol          = "HTTPS"
  default_action {
    type = "fixed-response"
  }
}
resource "aws_lb_listener_rule" "orders" {
  listener_arn = aws_lb_listener.https.arn
  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.orders.arn
  }
  condition {
    host_header {
      values = ["orders.\${var.zone}"]
    }
  }
  condition {
    path_pattern {
      values = ["/api/*"]
    }
  }
}
resource "aws_lb_listener_rule" "billing" {
  listener_arn = aws_lb_listener.https.arn
  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.billing.arn
  }
  condition {
    host_header {
      values = ["billing.\${var.zone}"]
    }
  }
}`,
  'qa.tfvars': 'zone = "acme-qa.example"',
};

test('an ECS service behind a load balancer: the host and path of the rule that forwards to it', () => {
  const [qa] = readModule(files(ECS));
  const lb = (qa?.domains ?? []).filter(domain => domain.from === 'lb');
  expect(lb).toEqual([{ host: 'orders.acme-qa.example', from: 'lb', path: 'api' }]);
});

test('with no host on the rule, the Route 53 alias of its load balancer; plain HTTP is said', () => {
  const [module] = readModule(
    files({
      'ecs.tf': `
resource "aws_ecs_service" "orders" {
  load_balancer {
    target_group_arn = aws_lb_target_group.orders.arn
  }
}
resource "aws_lb_target_group" "orders" {
  port = 8080
}
resource "aws_lb" "public" {
  name = "acme-public"
}
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.public.arn
  port              = 80
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.orders.arn
  }
}
resource "aws_route53_record" "orders" {
  name = "orders.acme.example"
  type = "A"
  alias {
    name    = aws_lb.public.dns_name
    zone_id = aws_lb.public.zone_id
  }
}`,
    }),
  );
  const lb = (module?.domains ?? []).filter(domain => domain.from === 'lb');
  expect(lb).toEqual([{ host: 'orders.acme.example', from: 'lb', http: true }]);
});

test('a load balancer with no ECS service behind it gives no address of its own', () => {
  const tf = ECS['ecs.tf'].replace(/resource "aws_ecs_service"[\s\S]*?\n\}\n/, '');
  const [qa] = readModule(files({ ...ECS, 'ecs.tf': tf }));
  expect((qa?.domains ?? []).filter(domain => domain.from === 'lb')).toEqual([]);
});
