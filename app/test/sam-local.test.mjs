import assert from 'node:assert/strict';
import { declared, functions, overrides } from '../dist/sam-local.mjs';

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

console.log('sam tests ok');

// Stopped while it builds, it ends there: no second build another way, and no API started.
{
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path'), { spawnSync } = await import('node:child_process'), { fileURLToPath } = await import('node:url');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-sam-stop-')), calls = path.join(dir, 'calls');
  fs.mkdirSync(path.join(dir, 'bin')); fs.mkdirSync(path.join(dir, 'app'));
  fs.writeFileSync(path.join(dir, 'app', 'template.yaml'), 'Resources: {}\n');
  // A stand-in for sam that is stopped in the middle of its first build.
  fs.writeFileSync(path.join(dir, 'bin', 'sam'), `#!/bin/sh\necho "$1 $2 $*" >> "${calls}"\ncase " $* " in *" --cached "*) kill -TERM $$ ;; esac\n`, { mode: 0o755 });
  const r = spawnSync('node', [path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'sam-local.mjs'), '3999', '{}'], { cwd: path.join(dir, 'app'), encoding: 'utf8', env: { ...process.env, PATH: `${path.join(dir, 'bin')}:${process.env.PATH}`, HOME: dir, KOPPLER_STATE: path.join(dir, 'state'), DOCKER_HOST: 'unix:///nowhere' } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const ran = fs.readFileSync(calls, 'utf8').trim().split('\n');
  assert.equal(ran.length, 1, ran.join('\n'));
  assert.match(ran[0], /^build .* --cached/);
  fs.rmSync(dir, { recursive: true });
  console.log('sam stop tests ok');
}
