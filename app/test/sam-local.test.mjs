import assert from 'node:assert/strict';
import { declared, functions, overrides } from '../src/sam-local.mjs';
import kinds from '../src/kinds.js';

// What a SAM template declares: the settings its functions read, and which functions run here (API ones).
const template = `Transform: AWS::Serverless-2016-10-31
Globals:
  Function:
    Runtime: nodejs18.x
    Environment:
      Variables:
        TABLE: !Ref Table
        CATALOG_ENDPOINT: !Ref CatalogEndpoint
Resources:
  ApiFunction:
    Type: AWS::Serverless::Function
    Properties:
      Handler: app.api
      Environment:
        Variables:
          EXTRA: x
      Events:
        Post:
          Type: Api
          Properties:
            Path: /v1/cdr
            Method: post
  SyncFunction:
    Type: AWS::Serverless::Function
    Properties:
      Handler: app.sync
      Events:
        Every:
          Type: Schedule
`;
assert.deepEqual(declared(template), ['TABLE', 'CATALOG_ENDPOINT', 'EXTRA']);
assert.deepEqual(functions(template), [{ name: 'ApiFunction', triggers: ['Api'] }, { name: 'SyncFunction', triggers: ['Schedule'] }]);
// Deploy parameters of the first environment name samconfig.toml has (the stack's env, then its aliases).
const toml = `version = 0.1
[dev]
[dev.deploy]
[dev.deploy.parameters]
parameter_overrides = "Environment=\\"DEV\\" CatalogEndpoint=\\"https://catalogapi-qa.example\\""
[prod]
[prod.deploy.parameters]
parameter_overrides = "Environment=\\"PROD\\""
`;
assert.deepEqual(overrides(toml, ['qa', 'dev']), { env: 'dev', value: 'Environment="DEV" CatalogEndpoint="https://catalogapi-qa.example"' });
assert.equal(overrides(toml, ['staging']), null);

// A repo with a SAM template is a SAM app, unless it has its own dev server.
const repo = files => ({ has: f => f in files, read: f => files[f] ?? null, list: () => [], find: () => null });
assert.equal(kinds.detect(repo({ 'template.yaml': template, 'package.json': '{"scripts":{"test":"jest"}}' })), 'sam');
assert.equal(kinds.detect(repo({ 'template.yaml': template, 'package.json': '{"scripts":{"dev":"tsx watch src/dev.ts"}}' })), 'node');
assert.equal(kinds.detect(repo({ 'template.yaml': 'Resources: {}' , 'package.json': '{}' })), 'node');
const cmd = kinds.startCommand({ kind: 'sam', url: 'http://localhost:3011' }, { repo: '/r', env: 'qa', engine: '/e', envNames: ['qa', 'dev'] });
assert.deepEqual(cmd.command, ['node', '/e/sam-local.mjs', '3011', '{"envs":["qa","dev"]}']);
assert.equal(kinds.KINDS.sam.needs.map(n => n.tool).join(), 'docker,sam');
console.log('sam tests ok');
