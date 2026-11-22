import { expect, test } from 'vitest';
import { sampleEvent } from './sam-events.ts';

test('each trigger gets the sample event SAM makes for it; one SAM has none for gets null', () => {
  expect(sampleEvent(['SQS'])).toEqual(['sqs', 'receive-message']);
  expect(sampleEvent(['ScheduleV2'])).toEqual(['cloudwatch', 'scheduled-event']);
  expect(sampleEvent(['EventBridgeRule'])).toEqual(['cloudwatch', 'scheduled-event']);
  expect(sampleEvent(['DynamoDB'])).toEqual(['dynamodb', 'update']);
  expect(sampleEvent(['Kinesis'])).toEqual(['kinesis', 'get-records']);
  expect(sampleEvent(['S3'])).toEqual(['s3', 'put']);
  expect(sampleEvent(['SNS'])).toEqual(['sns', 'notification']);
  expect(sampleEvent(['HttpApi'])).toEqual(['apigateway', 'http-api-proxy']);
  // The first trigger SAM has an event for wins.
  expect(sampleEvent(['MSK', 'SQS'])).toEqual(['sqs', 'receive-message']);
  expect(sampleEvent(['MSK'])).toBeNull();
  expect(sampleEvent([])).toBeNull();
});
