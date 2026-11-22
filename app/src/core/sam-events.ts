// The sample event `sam local generate-event` makes for each trigger a SAM template names.
const EVENTS: Record<string, [string, string]> = {
  SQS: ['sqs', 'receive-message'],
  SNS: ['sns', 'notification'],
  S3: ['s3', 'put'],
  DynamoDB: ['dynamodb', 'update'],
  Kinesis: ['kinesis', 'get-records'],
  Schedule: ['cloudwatch', 'scheduled-event'],
  ScheduleV2: ['cloudwatch', 'scheduled-event'],
  CloudWatchEvent: ['cloudwatch', 'scheduled-event'],
  EventBridgeRule: ['cloudwatch', 'scheduled-event'],
  Api: ['apigateway', 'aws-proxy'],
  HttpApi: ['apigateway', 'http-api-proxy'],
};

/** The `generate-event` service and event for the first trigger SAM has one for, or null. */
export const sampleEvent = (triggers: string[]): [string, string] | null =>
  triggers.map(trigger => (Object.hasOwn(EVENTS, trigger) ? EVENTS[trigger] : undefined)).find(Boolean) ?? null;
