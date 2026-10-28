import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { expect, test } from 'vitest';
import { launchProfile, startCommand, type App, type Start, type StartContext } from './launch.ts';
import { CLONES, repoOf } from './testing/repo.ts';

const api: App = {
  kind: 'dotnet',
  project: 'src/Api',
  launchSettings: 'p.json',
  baseProfile: 'QA',
  url: 'https://localhost:7089/',
};
const command = (start: Start) => start.command ?? [];
const script = (start: Start) => command(start)[2];

test('.NET: the -LOCAL profile wins when there is one, and stored secrets apply', () => {
  expect(startCommand(api, { repo: '/r', profiles: { QA: {}, 'QA-LOCAL': {} } })).toEqual({
    cwd: '/r',
    port: 7089,
    secrets: true,
    command: ['dotnet', 'run', '--project', 'src/Api', '--launch-profile', 'QA-LOCAL'],
  });
  expect(command(startCommand(api, { repo: '/r', profiles: { QA: {} } })).at(-1)).toBe('QA');
  expect(startCommand(api, { repo: '/r', profiles: {} }).error).toMatch(/QA not found/);
  expect(startCommand({ kind: 'dotnet' }).error).toMatch(/needs project/);
});

test('.NET: one rule for which profile, used for starting, wiring and checking', () => {
  const profiles = { DEV: {}, PROD: {}, 'PROD-LOCAL': {} };
  expect(launchProfile({ baseProfile: 'DEV' }, profiles, 'prod')).toEqual({
    base: 'PROD',
    local: 'PROD-LOCAL',
    name: 'PROD-LOCAL',
  });
  expect(launchProfile({ baseProfile: 'DEV' }, { DEV: {} }, 'qa')).toEqual({
    base: 'DEV',
    local: 'DEV-LOCAL',
    name: 'DEV',
  });
});

test('.NET: a profile that would hide a stored secret is refused, with what to do', () => {
  const app: App = { ...api, url: 'http://localhost:1', secrets: [{ env: 'ConnectionStrings__DB' }] };
  const hiding = { QA: {}, 'QA-LOCAL': { environmentVariables: { ConnectionStrings__DB: 'x' } } };
  expect(startCommand(app, { repo: '/r', profiles: hiding }).error).toMatch(
    /QA-LOCAL sets ConnectionStrings__DB, which hides the stored secret.*remove it from QA-LOCAL/,
  );
  const fine = {
    QA: { environmentVariables: { ConnectionStrings__DB: 'x' } },
    'QA-LOCAL': { environmentVariables: { OTHER: '1' } },
  };
  expect(command(startCommand(app, { repo: '/r', profiles: fine })).at(-1)).toBe('QA-LOCAL');
});

test(".NET: without a -LOCAL profile, the base profile's settings go in minus what is hidden", () => {
  const app: App = {
    ...api,
    baseProfile: 'DEV',
    url: 'http://localhost:58000',
    secrets: [{ env: 'ConnectionStrings__DB' }],
    prereqs: [{ sso: 'acct-prod-ops' }, { tunnel: 'db' }],
  };
  const profiles = {
    DEV: { environmentVariables: { AWS_PROFILE: 'dev' } },
    PROD: {
      applicationUrl: 'http://localhost:58000',
      environmentVariables: {
        ASPNETCORE_ENVIRONMENT: 'Development',
        AWS_PROFILE: 'prod',
        ConnectionStrings__DB: 'placeholder',
      },
    },
  };
  // The environment's own sign-in replaces the repo's AWS_PROFILE.
  expect(startCommand(app, { repo: '/r', env: 'prod', profiles }).command).toEqual([
    'env',
    'ASPNETCORE_ENVIRONMENT=Development',
    'AWS_PROFILE=acct-prod-ops',
    'ASPNETCORE_URLS=http://localhost:58000',
    ...['dotnet', 'run', '--project', 'src/Api', '--no-launch-profile'],
  ]);
  // No profile named after the environment: the stack's baseProfile is used, its AWS_PROFILE replaced too.
  expect(command(startCommand(app, { repo: '/r', env: 'qa', profiles }))).toEqual([
    'env',
    'AWS_PROFILE=acct-prod-ops',
    ...['dotnet', 'run', '--project', 'src/Api', '--no-launch-profile'],
  ]);
});

test(".NET: a profile whose AWS_PROFILE is not the app's sign-in is passed with the sign-in, even with nothing hidden", () => {
  const app: App = { ...api, url: 'http://localhost:5001', prereqs: [{ sso: 'acme-dev-ops' }] };
  const profiles = {
    QA: { environmentVariables: { AWS_PROFILE: 'dev', ASPNETCORE_ENVIRONMENT: 'QA' } },
    'QA-LOCAL': { environmentVariables: { AWS_PROFILE: 'mine' } },
  };
  expect(command(startCommand(app, { repo: '/r', env: 'qa', profiles: { QA: profiles.QA } }))).toEqual([
    'env',
    'AWS_PROFILE=acme-dev-ops',
    'ASPNETCORE_ENVIRONMENT=QA',
    ...['dotnet', 'run', '--project', 'src/Api', '--no-launch-profile'],
  ]);
  // Already the sign-in, or the user's own -LOCAL profile: the profile is used as it is.
  const same = { QA: { environmentVariables: { AWS_PROFILE: 'acme-dev-ops' } } };
  expect(command(startCommand(app, { repo: '/r', env: 'qa', profiles: same })).at(-1)).toBe('QA');
  expect(command(startCommand(app, { repo: '/r', env: 'qa', profiles })).at(-1)).toBe('QA-LOCAL');
});

test('.NET: a setting passed for this start wins over the profile', () => {
  const app: App = { ...api, url: 'http://localhost:1' };
  const profiles = { QA: { environmentVariables: { WalletUrl: 'https://wallet.qa', OTHER: '1' } } };
  const wired = command(startCommand(app, { repo: '/r', env: 'qa', profiles, override: ['WalletUrl'] }));
  expect(wired).toContain('--no-launch-profile');
  expect(wired.some(word => word.startsWith('WalletUrl='))).toBe(false);
  expect(wired).toContain('OTHER=1');
  expect(command(startCommand(app, { repo: '/r', env: 'qa', profiles })).at(-1)).toBe('QA');
});

test('.NET: opened to the network, it listens on its http port', () => {
  const opened = startCommand(api, { repo: '/r', profiles: { QA: {} }, lan: true, httpPort: 5089 });
  expect(command(opened).slice(-2)).toEqual(['--urls', 'http://0.0.0.0:5089']);
  expect(opened.port).toBe(5089);
  expect(startCommand(api, { repo: '/r', profiles: { QA: {} }, lan: true }).error).toMatch(/no http address/);
});

test('Flutter: run on the device and stay, its output the log, for hot reload; stopping closes the app', () => {
  const app: App = {
    kind: 'flutter',
    flutter: { fvm: true, flavor: true, defineFile: '.env_{env}.json' },
    mobile: { iosBundleId: 'com.acme.app', androidPackage: 'com.acme.app' },
  };
  const ios = startCommand(app, { repo: '/m', env: 'qa', device: { id: 'SIM-1', platform: 'ios' } });
  expect(command(ios).slice(0, 2)).toEqual(['sh', '-c']);
  const ends = '; s=$?; pkill -P $$ -x tail; exit $s; }';
  expect(script(ios)).toBe(
    `tail -f /dev/null | { fvm flutter run --flavor qa --dart-define-from-file=.env_qa.json -d SIM-1${ends}`,
  );
  // It stays, with its process id kept for hot reload.
  const kept = startCommand(app, {
    repo: '/m',
    env: 'qa',
    flutterPid: '/t/flutter-app.pid',
    device: { id: 'SIM-1', platform: 'ios' },
  });
  expect(script(kept)).toBe(
    `tail -f /dev/null | { fvm flutter run --pid-file /t/flutter-app.pid --flavor qa --dart-define-from-file=.env_qa.json -d SIM-1${ends}`,
  );
  expect(ios.onStop).toEqual([['xcrun', 'simctl', 'terminate', 'SIM-1', 'com.acme.app']]);
  const android = startCommand(app, { repo: '/m', env: 'prod', device: { id: 'emulator-5554', platform: 'android' } });
  expect(android.onStop).toEqual([['adb', '-s', 'emulator-5554', 'shell', 'am', 'force-stop', 'com.acme.app']]);
  expect(startCommand(app, { repo: '/m', env: 'qa' }).error).toMatch(/needs a device/);
  // A device id is one shell word whatever it holds.
  const odd = startCommand({ kind: 'flutter' }, { repo: '/m', env: 'qa', device: { id: "it's", platform: 'ios' } });
  expect(script(odd)).toBe(`tail -f /dev/null | { flutter run -d 'it'\\''s'${ends}`);
});

test('Flutter: what Koppler started ends when flutter run ends, with its exit status', () => {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-flutter-'));
  fs.writeFileSync(path.join(bin, 'flutter'), '#!/bin/sh\nexit 3\n', { mode: 0o755 });
  const start = startCommand({ kind: 'flutter' }, { repo: bin, device: { id: 'SIM-1', platform: 'ios' } });
  const [shell = '', ...args] = command(start);
  const env = { ...process.env, PATH: `${bin}:${process.env['PATH'] ?? ''}` };
  const ran = spawnSync(shell, args, { env, timeout: 5000 });
  fs.rmSync(bin, { recursive: true, force: true });
  expect(ran.signal).toBeNull();
  expect(ran.status).toBe(3);
});

test("Node: the stack's script, else dev, else start", () => {
  const app: App = { kind: 'node', url: 'http://localhost:5173' };
  expect(startCommand(app, { repo: '/w', scripts: { dev: 'vite', start: 'node .' } })).toEqual({
    cwd: '/w',
    port: 5173,
    command: ['npm', 'run', 'dev'],
  });
  expect(command(startCommand(app, { repo: '/w', scripts: { start: 'node .' } })).at(-1)).toBe('start');
  expect(command(startCommand({ ...app, script: 'serve' }, { repo: '/w', scripts: { serve: 'x' } })).at(-1)).toBe(
    'serve',
  );
  expect(startCommand(app, { repo: '/w', scripts: {} }).error).toMatch(/no dev or start script/);
});

test("a web front end: its framework's port, and its own way of opening to the network", () => {
  const site: App = { kind: 'web' };
  const vite: StartContext = { repo: '/s', scripts: { dev: 'vite' }, pkg: { devDependencies: { vite: '5' } } };
  expect(startCommand(site, vite)).toEqual({ cwd: '/s', port: 5173, command: ['npm', 'run', 'dev'] });
  expect(startCommand(site, { ...vite, lan: true }).command).toEqual(['npm', 'run', 'dev', '--', '--host', '0.0.0.0']);
  const next: StartContext = {
    repo: '/s',
    scripts: { dev: 'next dev' },
    pkg: { dependencies: { next: '14' } },
    lan: true,
  };
  expect(startCommand(site, next).command).toEqual(['npm', 'run', 'dev', '--', '-H', '0.0.0.0']);
  const cra: StartContext = {
    repo: '/s',
    scripts: { start: 'x' },
    pkg: { dependencies: { 'react-scripts': '5' } },
    lan: true,
  };
  expect(startCommand(site, cra).command).toEqual(['env', 'HOST=0.0.0.0', 'npm', 'run', 'start']);
  expect(startCommand({ kind: 'web', url: 'http://localhost:4000' }, vite).port).toBe(4000);
  const plain = startCommand({ kind: 'node' }, { repo: '/n', scripts: { start: 'node .' }, lan: true });
  expect(plain.command).toEqual(['env', 'HOST=0.0.0.0', 'npm', 'run', 'start']);
  expect(plain).toMatchObject({ note: 'HOST=0.0.0.0 is set; check the app reads it' });
});

test('a Lambda and a SAM app start through their local runners', () => {
  const lambda: App = { kind: 'lambda', url: 'http://localhost:5080', lambda: { handler: 'A::B', runtime: 'dotnet8' } };
  const fn = startCommand(lambda, { repo: '/r', engine: '/e', id: 'fn' });
  expect(fn.port).toBe(5080);
  expect(command(fn).slice(0, 2)).toEqual(['node', '/e/lambda-local.mjs']);
  expect(command(fn).slice(3)).toEqual(['5080', '/e/temp/lambda-fn.json', 'fn']);
  expect(fn.onStop?.[0]?.at(-1)).toContain("--filter 'name=^koppler-fn-fn-[0-9a-f]+$'");
  expect(startCommand({ kind: 'lambda', lambda: { handler: 'A::B' } }).error).toMatch(/needs url and lambda/);

  const sam = startCommand(
    { kind: 'sam', url: 'http://localhost:3011' },
    { repo: '/r', env: 'qa', engine: '/e', envNames: ['qa', 'dev'] },
  );
  expect(sam.command).toEqual(['node', '/e/sam-local.mjs', '3011', '{"envs":["qa","dev"]}']);
  const named = startCommand(
    { kind: 'sam', sam: { template: 'api.yaml', envs: { qa: 'test' } } },
    { env: 'qa', engine: '/e' },
  );
  expect(command(named).slice(2)).toEqual(['3000', '{"template":"api.yaml","envs":["test"]}']);
});

test('any other kind starts with the command the stack gives it', () => {
  expect(
    startCommand({ kind: 'other', start: 'go run ./cmd/api', url: 'http://localhost:8080' }, { repo: '/repo' }),
  ).toEqual({
    cwd: '/repo',
    port: 8080,
    command: ['sh', '-c', 'go run ./cmd/api'],
  });
  expect(startCommand({ kind: 'other' }, { repo: '/repo' }).error).toMatch(
    /needs "start".*koppler stack set apps.<app>.start/,
  );
  expect(startCommand({ kind: 'cobol' }).error).toBe('kind cobol cannot start by id yet');
});

test('recipes: each technology is started the usual way, from what its repo holds', () => {
  const start = (kind: string, files: Record<string, string>, app: App = {}, ctx: StartContext = {}) =>
    startCommand({ kind, ...app }, { repo: '/r', files: repoOf(files), ...ctx });
  const run = (...args: Parameters<typeof start>) => script(start(...args));
  const clone = (kind: string) => CLONES[kind] ?? {};

  expect(run('go', { 'go.mod': '', 'main.go': '' })).toBe('go run .');
  expect(run('go', { 'go.mod': '', 'cmd/api/main.go': '' })).toBe('go run ./cmd/api');
  const twoCommands = { 'go.mod': '', 'cmd/api/main.go': '', 'cmd/worker/main.go': '' };
  expect(start('go', twoCommands).error).toMatch(
    /cannot tell how this Go app starts; set it with koppler stack set apps.<app>.start/,
  );
  expect(run('go', twoCommands, { start: 'go run ./cmd/api' })).toBe('go run ./cmd/api');
  expect(run('rust', clone('rust'))).toBe('cargo run');

  expect([run('java', clone('java')), start('java', clone('java')).port]).toEqual(['./gradlew bootRun', 8080]);
  expect(run('java', { 'pom.xml': '<artifactId>spring-boot-starter-web</artifactId>' })).toBe('mvn spring-boot:run');
  expect(run('java', { 'build.gradle': 'application {}' })).toBe('gradle run');
  expect(start('java', { 'pom.xml': '<project/>' }).error).toMatch(/cannot tell how this Java \/ Kotlin app starts/);

  expect(run('python', { 'manage.py': '', 'poetry.lock': '' })).toBe('poetry run python manage.py runserver 8000');
  expect(start('python', { 'manage.py': '' }).port).toBe(8000);
  expect(run('python', clone('python'), { url: 'http://localhost:9000' })).toBe(
    'uvicorn app.main:app --reload --port 9000',
  );
  expect(run('python', { 'requirements.txt': 'Flask==3.0', '.venv/bin/python': '' })).toBe(
    '.venv/bin/flask run --port 5000',
  );
  expect(start('python', { 'requirements.txt': 'numpy' }).error).toMatch(/cannot tell how this Python app starts/);

  expect(run('ruby', clone('ruby'))).toBe('bin/rails server -p 3000');
  expect(run('php', clone('php'))).toBe('php artisan serve --port=8000');
  expect(run('reactnative', clone('reactnative'), {}, { platform: 'android' })).toBe('npx expo start --android');
  expect(run('reactnative', { 'package.json': '{"dependencies":{"react-native":"0.74"}}' })).toBe(
    'npx react-native run-ios',
  );

  const compose = start('compose', clone('compose'));
  expect([script(compose), compose.port]).toEqual(['docker compose up', 8085]);
  expect(compose.onStop).toEqual([['sh', '-c', 'cd /r && docker compose down']]);
});

test("a stack's own kind starts as the stack says", () => {
  const stack = { kinds: { elixir: { label: 'Elixir', detect: ['mix.exs'], start: 'mix phx.server', port: 4000 } } };
  const elixir = startCommand({ kind: 'elixir' }, { repo: '/r', stack });
  expect([script(elixir), elixir.port]).toEqual(['mix phx.server', 4000]);
  expect(startCommand({ kind: 'elixir' }, { repo: '/r' }).error).toMatch(/cannot start by id yet/);
});
