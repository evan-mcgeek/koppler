import assert from 'node:assert/strict';
import { test } from 'vitest';
import { type Stack, validateStack } from '../core/stack.ts';
import { readModule } from '../core/terraform.ts';
import { draftApp, linkQueues, resourceDraft } from './deployed.ts';

const tf = `
resource "aws_s3_bucket" "receipts" {
  bucket = "acme-receipts-\${var.environment}"
}
resource "aws_s3_bucket" "site" {
  bucket = "acme-site-\${var.environment}"
}
resource "aws_s3_bucket_policy" "receipts" {
  bucket = aws_s3_bucket.receipts.id
  policy = jsonencode({ Statement = [{ Action = ["s3:GetObject"], Resource = "\${aws_s3_bucket.receipts.arn}/*" }] })
}
data "aws_iam_policy_document" "lambda" {
  statement {
    actions   = ["s3:PutObject"]
    resources = ["\${aws_s3_bucket.receipts.arn}/*"]
  }
  statement {
    actions   = ["s3:GetObject", "s3:ListBucket"]
    resources = ["arn:aws:s3:::acme-catalog-images-\${var.environment}/*"]
  }
  statement {
    actions   = ["states:StartExecution"]
    resources = [aws_sfn_state_machine.refunds.arn]
  }
}
resource "aws_sqs_queue" "changes" {
  name = "order-changes-\${var.environment}"
}
resource "aws_apigatewayv2_api" "public" {
  name = "acme-public-\${var.environment}"
}
resource "aws_apigatewayv2_integration" "lambda" {
  api_id           = aws_apigatewayv2_api.public.id
  integration_type = "AWS_PROXY"
  integration_uri  = aws_lambda_function.main.invoke_arn
}
resource "aws_apigatewayv2_integration" "changes" {
  api_id              = aws_apigatewayv2_api.public.id
  integration_type    = "AWS_PROXY"
  integration_subtype = "SQS-SendMessage"
  request_parameters  = { QueueUrl = aws_sqs_queue.changes.url, MessageBody = "$request.body" }
}
resource "aws_apigatewayv2_route" "top_up" {
  api_id    = aws_apigatewayv2_api.public.id
  route_key = "POST /gift-cards/top-up"
  target    = "integrations/\${aws_apigatewayv2_integration.lambda.id}"
}
resource "aws_apigatewayv2_route" "changes" {
  api_id    = aws_apigatewayv2_api.public.id
  route_key = "POST /orders/modifications"
  target    = "integrations/\${aws_apigatewayv2_integration.changes.id}"
}
resource "aws_sfn_state_machine" "refunds" {
  name = "acme-refunds-\${var.environment}"
  definition = jsonencode({
    "StartAt" : "Check the refund",
    "States" : {
      "Tell support" : { "Type" : "Task", "Resource" : "arn:aws:states:::sns:publish", "End" : true },
      "Check the refund" : { "Type" : "Pass", "Next" : "Pay it back" },
      "Pay it back" : {
        "Type" : "Task",
        "Parameters" : { "FunctionName" : aws_lambda_function.main.arn },
        "Next" : "Tell support"
      },
      "Failed" : { "Type" : "Fail" }
    }
  })
}
resource "aws_scheduler_schedule" "nightly" {
  target { arn = aws_sfn_state_machine.refunds.arn }
}
`;

test('Terraform is read into buckets by access, API Gateway routes and state machines with their steps', () => {
  const [qa] = readModule([
    { name: 'main.tf', text: tf },
    { name: 'qa.tfvars', text: 'environment = "qa"' },
  ]);
  assert.ok(qa);
  // The bucket's own policy says nothing of the app; a bucket nobody here reads or writes is left out.
  assert.deepEqual(qa.buckets, [
    { address: 'aws_s3_bucket.receipts', name: 'acme-receipts-qa', reads: false, writes: true },
    { address: 'name:acme-catalog-images-qa', name: 'acme-catalog-images-qa', reads: true, writes: false },
  ]);
  assert.deepEqual(qa.routes, [
    {
      api: 'aws_apigatewayv2_api.public',
      apiName: 'acme-public-qa',
      route: 'POST /gift-cards/top-up',
      to: { own: true },
    },
    {
      api: 'aws_apigatewayv2_api.public',
      apiName: 'acme-public-qa',
      route: 'POST /orders/modifications',
      to: { queue: 'aws_sqs_queue.changes' },
    },
  ]);
  assert.deepEqual(qa.machines, [
    {
      address: 'aws_sfn_state_machine.refunds',
      name: 'acme-refunds-qa',
      steps: [
        { name: 'Check the refund', own: false },
        { name: 'Pay it back', own: true },
        { name: 'Tell support', own: false },
      ],
      startedHere: true,
      scheduled: true,
    },
  ]);
});

test('the resources are drafted across the apps for stack.json, and the stack takes them', () => {
  const stack: Stack = {
    envs: ['qa', 'prod'],
    apps: {
      shop: { name: 'Shop', kind: 'node', slug: 'acme/shop' },
      catalog: { name: 'Catalog', kind: 'node', slug: 'acme/catalog' },
    },
  };
  const vars = (env: string) => ({ name: `${env}.tfvars`, text: `environment = "${env}"` });
  const catalogTf = `
resource "aws_s3_bucket" "images" { bucket = "acme-catalog-images-\${var.environment}" }
data "aws_iam_policy_document" "task" {
  statement {
    actions   = ["s3:PutObject"]
    resources = ["\${aws_s3_bucket.images.arn}/*"]
  }
}`;
  const modules = {
    shop: readModule([{ name: 'main.tf', text: tf }, vars('qa'), vars('prod')]),
    catalog: readModule([{ name: 'main.tf', text: catalogTf }, vars('qa'), vars('prod')]),
  };
  const drafts = Object.fromEntries(
    Object.entries(modules).map(([id, found]) => [id, draftApp(id, found, stack, new Map())]),
  );
  const draft = resourceDraft(drafts, linkQueues(drafts, stack), stack);
  assert.deepEqual(draft, {
    resources: {
      'acme-receipts': {
        type: 's3',
        name: 'Acme Receipts',
        bucket: 'acme-receipts-qa',
        envs: { prod: { bucket: 'acme-receipts-prod' } },
      },
      'acme-catalog-images': {
        type: 's3',
        name: 'Acme Catalog Images',
        bucket: 'acme-catalog-images-qa',
        envs: { prod: { bucket: 'acme-catalog-images-prod' } },
      },
      'acme-public': {
        type: 'apigw',
        name: 'Acme Public',
        routes: { 'POST /gift-cards/top-up': 'shop', 'POST /orders/modifications': 'queue:order-changes' },
      },
      'acme-refunds': {
        type: 'sfn',
        name: 'Acme Refunds',
        startedBy: ['shop'],
        steps: [{ name: 'Check the refund' }, { name: 'Pay it back', calls: 'shop' }, { name: 'Tell support' }],
        note: 'Started on a schedule',
      },
    },
    apps: {
      shop: { buckets: { 'acme-receipts': { access: 'write' }, 'acme-catalog-images': { access: 'read' } } },
      catalog: { buckets: { 'acme-catalog-images': { access: 'write' } } },
    },
  });
  // Taken as drafted, with the queue the route hands to.
  const taken = {
    ...stack,
    queues: { 'order-changes': { name: 'Order changes', type: 'sqs' } },
    resources: draft.resources,
    apps: Object.fromEntries(Object.entries(stack.apps).map(([id, app]) => [id, { ...app, ...draft.apps[id] }])),
  };
  assert.deepEqual(validateStack(taken), []);
});
