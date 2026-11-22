import { expect, test } from 'vitest';
import { serverlessDomains } from './serverless.ts';

const hosts = (yml: string, stages: string[] = []) =>
  serverlessDomains(yml, stages).found.map(
    ({ token, domains }) => `${String(token)}: ${domains.map(d => `${d.host}${d.path ? `/${d.path}` : ''}`).join(' ')}`,
  );

test('a fixed custom domain is the app address, with its base path', () => {
  const yml = `service: orders-api
custom:
  customDomain:
    domainName: api.acme.dev # the public one
    basePath: 'orders'
`;
  expect(hosts(yml)).toEqual(['null: api.acme.dev/orders']);
});

test('a domain per stage is read from a map under custom, for each stack environment and each key of the map', () => {
  const yml = `provider:
  name: aws
  stage: \${opt:stage, 'qa'}
custom:
  domains:
    qa: "api.qa.acme.dev"
    prod: api.acme.dev
  customDomain:
    domainName: \${self:custom.domains.\${sls:stage}}
`;
  expect(hosts(yml, ['qa', 'staging'])).toEqual(['qa: api.qa.acme.dev', 'prod: api.acme.dev']);
});

test('a stage written into the name works with each stage variable', () => {
  for (const stage of ['${sls:stage}', '${opt:stage}', '${self:provider.stage}', "${opt:stage, 'qa'}"])
    expect(hosts(`custom:\n  customDomain:\n    domainName: orders-${stage}.acme.dev\n`, ['qa', 'prod'])).toEqual([
      'qa: orders-qa.acme.dev',
      'prod: orders-prod.acme.dev',
    ]);
});

test('a value read when deployed is not guessed, and is said', () => {
  const read = serverlessDomains('custom:\n  customDomain:\n    domainName: ${ssm:/acme/domain}\n', ['qa']);
  expect(read.found).toEqual([]);
  expect(read.unread).toBe('${ssm:/acme/domain}');
  expect(serverlessDomains('service: jobs\n', ['qa'])).toEqual({ found: [], unread: null });
  // A value that names itself ends, unread.
  expect(
    serverlessDomains('custom:\n  customDomain:\n    domainName: ${self:custom.customDomain.domainName}\n', []).unread,
  ).toBe('${self:custom.customDomain.domainName}');
});

test('a real file reads: anchors, lists and CloudFormation tags elsewhere do not get in the way', () => {
  const yml = `service: orders-api
defaults: &domain
  domainName: api.\${sls:stage}.acme.dev
  basePath: orders
functions:
  list:
    handler: handler.list
    events:
      - http: { path: orders, method: get }
custom:
  customDomain:
    <<: *domain
resources:
  Resources:
    Queue:
      Type: AWS::SQS::Queue
      Properties:
        QueueName: !Ref QueueName
        Tags:
          - Key: app
            Value: !Sub "\${AWS::StackName}"
`;
  expect(hosts(yml, ['qa'])).toEqual(['qa: api.qa.acme.dev/orders']);
  expect(serverlessDomains('custom: [unclosed\n', ['qa'])).toEqual({ found: [], unread: null });
});
