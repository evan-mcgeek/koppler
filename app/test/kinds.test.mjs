import assert from 'node:assert/strict';
import kinds from '../src/kinds.cjs';
const { startCommand, of } = kinds;

// .NET: the -LOCAL profile wins when it exists; stored secrets apply.
const api = { kind: 'dotnet', project: 'src/Api', launchSettings: 'p.json', baseProfile: 'QA', url: 'https://localhost:7089/' };
assert.deepEqual(startCommand(api, { repo: '/r', profiles: { QA: {}, 'QA-LOCAL': {} } }),
  { cwd: '/r', port: 7089, secrets: true, command: ['dotnet', 'run', '--project', 'src/Api', '--launch-profile', 'QA-LOCAL'] });
assert.equal(startCommand(api, { repo: '/r', profiles: { QA: {} } }).command.at(-1), 'QA');
assert.match(startCommand(api, { repo: '/r', profiles: {} }).error, /QA not found/);
assert.match(startCommand({ kind: 'dotnet' }, {}).error, /needs project/);

// Flutter: build, install and launch on the device, then stay attached to its logs; stopping closes the app.
const app = { kind: 'flutter', flutter: { fvm: true, flavor: true, defineFile: '.env_{env}.json' }, mobile: { iosBundleId: 'com.acme.app', androidPackage: 'com.acme.app' } };
const ios = startCommand(app, { repo: '/m', env: 'qa', device: { id: 'SIM-1', platform: 'ios' } });
assert.deepEqual(ios.command.slice(0, 2), ['sh', '-c']);
assert.equal(ios.command[2], 'fvm flutter run --no-resident --flavor qa --dart-define-from-file=.env_qa.json -d SIM-1 && exec fvm flutter logs -d SIM-1');
assert.deepEqual(ios.onStop, [['xcrun', 'simctl', 'terminate', 'SIM-1', 'com.acme.app']]);
assert.deepEqual(startCommand(app, { repo: '/m', env: 'prod', device: { id: 'emulator-5554', platform: 'android' } }).onStop, [['adb', '-s', 'emulator-5554', 'shell', 'am', 'force-stop', 'com.acme.app']]);
assert.match(startCommand(app, { repo: '/m', env: 'qa' }).error, /needs a device/);
assert.equal(startCommand({ kind: 'flutter' }, { repo: '/m', env: 'qa', device: { id: "it's", platform: 'ios' } }).command[2], "flutter run --no-resident -d 'it'\\''s' && exec flutter logs -d 'it'\\''s'");

// Node: the stack's script, else dev, else start.
const web = { kind: 'node', url: 'http://localhost:5173' };
assert.deepEqual(startCommand(web, { repo: '/w', scripts: { dev: 'vite', start: 'node .' } }), { cwd: '/w', port: 5173, command: ['npm', 'run', 'dev'] });
assert.equal(startCommand(web, { repo: '/w', scripts: { start: 'node .' } }).command.at(-1), 'start');
assert.equal(startCommand({ ...web, script: 'serve' }, { repo: '/w', scripts: { serve: 'x' } }).command.at(-1), 'serve');
assert.match(startCommand(web, { repo: '/w', scripts: {} }).error, /no dev or start script/);

assert.equal(of({ kind: 'flutter' }).label, 'Flutter');
assert.equal(of({ kind: 'go' }).label, 'Go');
assert.equal(of({ kind: 'cobol' }).label, 'cobol');
console.log('ok');

// Device addresses.
const { localAddress, deviceHost } = kinds;
const mapi = { url: 'http://localhost:57057/' }, academics = { url: 'https://localhost:7089/' };
assert.equal(deviceHost({ platform: 'ios' }), 'localhost');
assert.equal(deviceHost({ platform: 'android' }), '10.0.2.2');
assert.equal(deviceHost({ platform: 'android', physical: true }, '192.168.0.5'), '192.168.0.5');
assert.equal(localAddress(mapi, { platform: 'ios' }).url, 'http://localhost:57057/');
assert.equal(localAddress(mapi, { platform: 'android' }).url, 'http://10.0.2.2:57057/');
assert.deepEqual(localAddress(mapi, { platform: 'ios', physical: true }, { lanIp: '192.168.0.5' }), { url: 'http://192.168.0.5:57057/', needsLan: true, note: undefined });
assert.equal(localAddress(academics, { platform: 'android', physical: true }, { lanIp: '10.1.1.1', httpUrl: 'http://localhost:5089' }).url, 'http://10.1.1.1:5089/');
assert.match(localAddress(academics, { platform: 'ios', physical: true }, { lanIp: '10.1.1.1' }).note, /certificate/);
assert.match(localAddress(mapi, { platform: 'ios', physical: true }, {}).error, /network address/);
assert.equal(localAddress({ url: 'http://localhost:3000' }, undefined).url, 'http://localhost:3000');
// .NET opened to the network listens on 0.0.0.0 at its http port.
assert.deepEqual(startCommand(api, { repo: '/r', profiles: { QA: {} }, lan: true, httpPort: 5089 }).command.slice(-2), ['--urls', 'http://0.0.0.0:5089']);
assert.match(startCommand(api, { repo: '/r', profiles: { QA: {} }, lan: true }).error, /no http address/);
assert.equal(localAddress({ url: 'https://localhost:56037/' }, undefined, { like: 'https://cs-qa.acme.dev' }).url, 'https://localhost:56037');
assert.equal(localAddress({ url: 'http://localhost:3000' }, undefined, { like: 'https://x.acme.dev/' }).url, 'http://localhost:3000/');
console.log('device addresses ok');

// Web front ends.
const { frameworkOf, browserChecks, envFileChange } = kinds;
assert.equal(frameworkOf({ devDependencies: { vite: '^5' } }).name, 'Vite');
assert.equal(frameworkOf({ dependencies: { next: '14', react: '18' } }).name, 'Next.js');
assert.equal(frameworkOf({ dependencies: { express: '4' } }), null);
const site = { kind: 'web' };
assert.deepEqual(startCommand(site, { repo: '/s', scripts: { dev: 'vite' }, pkg: { devDependencies: { vite: '5' } } }), { cwd: '/s', port: 5173, command: ['npm', 'run', 'dev'] });
assert.deepEqual(startCommand(site, { repo: '/s', scripts: { dev: 'vite' }, pkg: { devDependencies: { vite: '5' } }, lan: true }).command, ['npm', 'run', 'dev', '--', '--host', '0.0.0.0']);
assert.deepEqual(startCommand(site, { repo: '/s', scripts: { dev: 'next dev' }, pkg: { dependencies: { next: '14' } }, lan: true }).command, ['npm', 'run', 'dev', '--', '-H', '0.0.0.0']);
assert.deepEqual(startCommand(site, { repo: '/s', scripts: { start: 'react-scripts start' }, pkg: { dependencies: { 'react-scripts': '5' } }, lan: true }).command, ['env', 'HOST=0.0.0.0', 'npm', 'run', 'start']);
assert.equal(startCommand({ kind: 'web', url: 'http://localhost:4000' }, { repo: '/s', scripts: { dev: 'x' }, pkg: { devDependencies: { vite: '5' } } }).port, 4000);
assert.deepEqual(startCommand({ kind: 'node' }, { repo: '/n', scripts: { start: 'node .' }, lan: true }).command, ['env', 'HOST=0.0.0.0', 'npm', 'run', 'start']);
// CORS and mixed content.
const apiWithCors = { name: 'Orders API', url: 'https://localhost:7001', cors: { env: ['Cors__Origins__0'] } };
assert.deepEqual(browserChecks(site, apiWithCors, 'http://localhost:5173'), { settings: [{ app: 'callee', env: 'Cors__Origins__0', value: 'http://localhost:5173' }], warnings: [] });
assert.match(browserChecks(site, { name: 'Pay', url: 'http://localhost:5000' }, 'http://localhost:5173').warnings[0], /no recorded CORS setting/);
assert.match(browserChecks(site, { name: 'Pay', url: 'http://localhost:5000', cors: { env: 'X' } }, 'https://localhost:3000').warnings[0], /https page cannot call an http API/);
assert.deepEqual(envFileChange({ env: ['VITE_API_URL'] }, 'https://localhost:7001'), { file: '.env.local', lines: ['VITE_API_URL=https://localhost:7001'] });
assert.equal(browserChecks(site, { url: 'https://localhost:7001', cors: { env: 'Cors__AllowedOrigins__{n}' } }, 'http://localhost:3000', 1).settings[0].env, 'Cors__AllowedOrigins__1');
console.log('web ok');
// Any other kind of app starts with the command the stack gives it.
assert.equal(kinds.of({ kind: 'other' }).label, 'Other');
assert.deepEqual(kinds.startCommand({ kind: 'other', start: 'go run ./cmd/api', url: 'http://localhost:8080' }, { repo: '/repo' }), { cwd: '/repo', port: 8080, command: ['sh', '-c', 'go run ./cmd/api'] });
assert.match(kinds.startCommand({ kind: 'other' }, { repo: '/repo' }).error, /needs "start" in stack.json/);

// Recipes: each technology is recognized from its files and started the usual way. A repo is given as { path: text }.
{
  const repo = files => ({ has: f => f in files || Object.keys(files).some(k => k.startsWith(f + '/')), read: f => files[f] ?? null, find: suffix => Object.keys(files).some(k => k.endsWith(suffix)),
    list: d => [...new Set(Object.keys(files).filter(k => k.startsWith(d + '/') && k.split('/').length > d.split('/').length + 1).map(k => k.split('/')[d.split('/').length]))] });
  const start = (kind, files, app = {}, ctx = {}) => kinds.startCommand({ kind, ...app }, { repo: '/r', files: repo(files), ...ctx });
  const cmd = (...a) => start(...a).command?.[2];
  const cases = [
    ['flutter', { 'pubspec.yaml': '' }],
    ['reactnative', { 'package.json': '{"dependencies":{"expo":"~51.0.0","react":"18"}}' }],
    ['dotnet', { 'src/Api/Api.csproj': '' }],
    ['web', { 'package.json': '{"devDependencies":{"vite":"5"}}' }],
    ['node', { 'package.json': '{"dependencies":{"express":"4"}}' }],
    ['go', { 'go.mod': 'module x', 'main.go': '' }],
    ['rust', { 'Cargo.toml': '' }],
    ['java', { 'build.gradle.kts': 'id("org.springframework.boot")', gradlew: '' }],
    ['python', { 'pyproject.toml': 'dependencies = ["fastapi"]', 'app/main.py': '' }],
    ['ruby', { Gemfile: '', 'config/application.rb': '' }],
    ['php', { artisan: '', 'composer.json': '{}' }],
    ['compose', { 'compose.yaml': 'services:\n  api:\n    ports:\n      - "8085:80"\n' }],
  ];
  for (const [kind, files] of cases) assert.equal(kinds.detect(repo(files)), kind, kind);
  assert.equal(kinds.detect(repo({ 'README.md': '' })), null);
  // A .NET repo that only keeps a database in a compose file is still .NET.
  assert.equal(kinds.detect(repo({ 'Api.csproj': '', 'docker-compose.yml': '' })), 'dotnet');

  assert.equal(cmd('go', { 'go.mod': '', 'main.go': '' }), 'go run .');
  assert.equal(cmd('go', { 'go.mod': '', 'cmd/api/main.go': '' }), 'go run ./cmd/api');
  assert.match(start('go', { 'go.mod': '', 'cmd/api/main.go': '', 'cmd/worker/main.go': '' }).error, /cannot tell how this Go app starts; set "start"/);
  assert.equal(cmd('go', { 'go.mod': '', 'cmd/api/main.go': '', 'cmd/worker/main.go': '' }, { start: 'go run ./cmd/api' }), 'go run ./cmd/api');
  assert.equal(cmd('rust', { 'Cargo.toml': '' }), 'cargo run');
  assert.deepEqual([cmd('java', cases[7][1]), start('java', cases[7][1]).port], ['./gradlew bootRun', 8080]);
  assert.equal(cmd('java', { 'pom.xml': '<artifactId>spring-boot-starter-web</artifactId>' }), 'mvn spring-boot:run');
  assert.equal(cmd('java', { 'build.gradle': 'application {}' }), 'gradle run');
  assert.match(start('java', { 'pom.xml': '<project/>' }).error, /cannot tell how this Java \/ Kotlin app starts/);
  assert.deepEqual([cmd('python', { 'manage.py': '', 'poetry.lock': '' }), start('python', { 'manage.py': '' }).port], ['poetry run python manage.py runserver 8000', 8000]);
  assert.equal(cmd('python', cases[8][1], { url: 'http://localhost:9000' }), 'uvicorn app.main:app --reload --port 9000');
  assert.deepEqual([cmd('python', { 'requirements.txt': 'Flask==3.0', '.venv/bin/python': '' }), start('python', { 'requirements.txt': 'Flask==3.0' }).port], ['.venv/bin/flask run --port 5000', 5000]);
  assert.match(start('python', { 'requirements.txt': 'numpy' }).error, /cannot tell how this Python app starts/);
  assert.equal(cmd('ruby', cases[9][1]), 'bin/rails server -p 3000');
  assert.equal(cmd('php', cases[10][1]), 'php artisan serve --port=8000');
  assert.equal(cmd('reactnative', cases[1][1], {}, { platform: 'android' }), 'npx expo start --android');
  assert.equal(cmd('reactnative', { 'package.json': '{"dependencies":{"react-native":"0.74"}}' }), 'npx react-native run-ios');
  const compose = start('compose', cases[11][1]);
  assert.deepEqual([compose.command[2], compose.port, compose.onStop], ['docker compose up', 8085, [['sh', '-c', 'cd /r && docker compose down']]]);
  assert.equal(kinds.of({ kind: 'reactnative' }).platforms.length, 2);
  assert.equal(kinds.of({ kind: 'reactnative' }).serves, false);

  // A stack's own kind: recognized first, started as it says; it cannot replace a built-in one, and goes away with the stack.
  kinds.register({ elixir: { label: 'Elixir', detect: ['mix.exs'], start: 'mix phx.server', port: 4000 }, go: { label: 'Not Go' }, 'Bad Id': { label: 'x' } });
  assert.equal(kinds.of({ kind: 'elixir' }).label, 'Elixir');
  assert.equal(kinds.of({ kind: 'go' }).label, 'Go');
  assert.equal(kinds.detect(repo({ 'mix.exs': '', 'package.json': '{}' })), 'elixir');
  assert.deepEqual([cmd('elixir', {}), start('elixir', {}).port], ['mix phx.server', 4000]);
  kinds.register({});
  assert.equal(kinds.of({ kind: 'elixir' }).label, 'elixir');
  assert.equal(kinds.detect(repo({ 'mix.exs': '' })), null);
  // A Lambda starts through the local runner, on the port in its url, with its overrides file next to the engine.
  const fn = kinds.startCommand({ kind: 'lambda', url: 'http://localhost:5080', lambda: { handler: 'A::B', runtime: 'dotnet8' } }, { repo: '/r', engine: '/e', id: 'fn' });
  assert.deepEqual([fn.port, fn.command.slice(0, 2), fn.command.slice(3), fn.onStop], [5080, ['node', '/e/lambda-local.mjs'], ['5080', '/e/temp/lambda-fn.json'], [['docker', 'rm', '-f', 'koppler-lambda-5080']]]);
  assert.match(kinds.startCommand({ kind: 'lambda', lambda: { handler: 'A::B' } }, {}).error, /needs url and lambda/);
  // A .NET launch profile that sets a variable the app also has as a stored secret would hide the secret: refused, with what to do.
  const net = env => kinds.startCommand({ kind: 'dotnet', project: 'src/Api', launchSettings: 'p.json', baseProfile: 'QA', url: 'http://localhost:1', secrets: [{ env: 'ConnectionStrings__DB' }] }, { repo: '/r', profiles: env });
  assert.match(net({ QA: {}, 'QA-LOCAL': { environmentVariables: { ConnectionStrings__DB: 'x' } } }).error, /QA-LOCAL sets ConnectionStrings__DB, which hides the stored secret.*remove it from QA-LOCAL/);
  assert.equal(net({ QA: { environmentVariables: { ConnectionStrings__DB: 'x' } }, 'QA-LOCAL': { environmentVariables: { OTHER: '1' } } }).command.at(-1), 'QA-LOCAL');
  // Without a -LOCAL profile, the base profile's settings go in minus the hidden secret, with the environment's sign-in as AWS_PROFILE.
  const prod = { kind: 'dotnet', project: 'src/Api', launchSettings: 'p.json', baseProfile: 'DEV', url: 'http://localhost:58000', secrets: [{ env: 'ConnectionStrings__DB' }], prereqs: [{ sso: 'acct-prod-ops' }, { tunnel: 'db' }] };
  const profiles = { DEV: { environmentVariables: { AWS_PROFILE: 'dev' } }, PROD: { applicationUrl: 'http://localhost:58000', environmentVariables: { ASPNETCORE_ENVIRONMENT: 'Development', AWS_PROFILE: 'prod', ConnectionStrings__DB: 'placeholder' } } };
  assert.deepEqual(kinds.startCommand(prod, { repo: '/r', env: 'prod', profiles }).command,
    ['env', 'ASPNETCORE_ENVIRONMENT=Development', 'AWS_PROFILE=acct-prod-ops', 'ASPNETCORE_URLS=http://localhost:58000', 'dotnet', 'run', '--project', 'src/Api', '--no-launch-profile']);
  // No profile named after the environment: the stack's baseProfile is used.
  assert.equal(kinds.startCommand(prod, { repo: '/r', env: 'qa', profiles }).command.at(-1), 'DEV');
  console.log('recipes ok');
}
// One profile rule for starting, wiring and checking: the environment's own profile, then baseProfile; -LOCAL when there is one.
assert.deepEqual(kinds.launchProfile({ baseProfile: 'DEV' }, { DEV: {}, PROD: {}, 'PROD-LOCAL': {} }, 'prod'), { base: 'PROD', local: 'PROD-LOCAL', name: 'PROD-LOCAL' });
assert.deepEqual(kinds.launchProfile({ baseProfile: 'DEV' }, { DEV: {} }, 'qa'), { base: 'DEV', local: 'DEV-LOCAL', name: 'DEV' });
// A setting passed for this start (a cable's address) wins: the profile's own value of it is left out.
{
  const app = { kind: 'dotnet', project: 'src/Api', launchSettings: 'p.json', baseProfile: 'QA', url: 'http://localhost:1' };
  const profiles = { QA: { environmentVariables: { WalletUrl: 'https://wallet.qa', OTHER: '1' } } };
  const cmd = kinds.startCommand(app, { repo: '/r', env: 'qa', profiles, override: ['WalletUrl'] }).command;
  assert.equal(cmd.includes('--no-launch-profile'), true);
  assert.equal(cmd.some(a => a.startsWith('WalletUrl=')), false);
  assert.equal(cmd.includes('OTHER=1'), true);
  assert.equal(kinds.startCommand(app, { repo: '/r', env: 'qa', profiles }).command.at(-1), 'QA');
}
