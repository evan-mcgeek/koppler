// App kinds: how each kind of app shows on the canvas and how `koppler run <app>` starts and stops it.
// Pure: koppler.mjs gathers the facts (launch profiles, package.json scripts, the chosen device) and passes them in.
// Shared by the canvas (as a browser global) and the koppler command.
(function (root) {
  // Who starts the app: Koppler from the terminal, or you from your IDE.
  const RUN_IN = [['cli', 'Koppler'], ['ide', 'Your IDE']];
  const KINDS = {
    // `needs`: the programs this kind is started with, checked when a stack that has such an app loads.
    dotnet: { label: '.NET', runIn: RUN_IN, serves: true, needs: [{ tool: 'dotnet', fix: 'Install the .NET SDK the repo targets' }] },
    flutter: { label: 'Flutter', runIn: RUN_IN, platforms: [['ios', 'iOS simulator'], ['android', 'Android emulator'], ['phone', 'Phone']], serves: false, needs: [{ tool: 'fvm', fix: 'brew tap leoafarias/fvm && brew install fvm' }] },
    node: { label: 'Node', runIn: RUN_IN, serves: true, needs: [{ tool: 'npm', fix: 'Comes with Node' }] },
    web: { label: 'Web', runIn: RUN_IN, serves: false, browser: true, needs: [{ tool: 'npm', fix: 'Comes with Node' }] },
    // Anything else: started by the command in its `start` field.
    // A queue-triggered AWS Lambda, run in an AWS emulator in Docker (lambda-local.mjs); callers post to its local address.
    lambda: { label: 'Lambda', runIn: RUN_IN, serves: true, needs: [{ tool: 'docker', fix: 'Install a Docker runtime (Docker Desktop or Colima)' }, { tool: 'aws', fix: 'brew install awscli' }] },
    // An AWS SAM app (template.yaml): its API runs with `sam local start-api`, any runtime (sam-local.mjs).
    sam: { label: 'AWS SAM', runIn: RUN_IN, serves: true, needs: [{ tool: 'docker', fix: 'Install a Docker runtime (Docker Desktop or Colima)' }, { tool: 'sam', fix: 'brew install aws-sam-cli (or: uv tool install aws-sam-cli)' }] },
    other: { label: 'Other', runIn: RUN_IN, serves: true },
  };

  // Recipes: kinds that need no code of their own. Each says how to recognize a repo, how it is usually started and on which port.
  // `repo` is a small view of the clone: has(path), read(path), list(dir). `o` carries the port to use and, for mobile, the platform.
  const text = (repo, files) => files.map(f => repo.read(f) || '').join('\n').toLowerCase();
  const pyRun = repo => repo.has('uv.lock') ? 'uv run ' : repo.has('poetry.lock') ? 'poetry run ' : repo.has('Pipfile') ? 'pipenv run ' : repo.has('.venv/bin/python') ? '.venv/bin/' : '';
  const pyDeps = repo => text(repo, ['pyproject.toml', 'requirements.txt', 'Pipfile']);
  const jvmText = repo => text(repo, ['pom.xml', 'build.gradle', 'build.gradle.kts']);
  const composeFile = repo => ['compose.yaml', 'compose.yml', 'docker-compose.yml', 'docker-compose.yaml'].find(f => repo.has(f));
  const flag = (name, port) => port ? ` ${name}${port}` : '';
  const RECIPES = {
    reactnative: { label: 'React Native', color: ['#087EA4', '#58C4DC'], serves: false, platforms: [['ios', 'iOS simulator'], ['android', 'Android emulator']],
      detect: repo => /"(expo|react-native)"\s*:/.test(repo.read('package.json') || ''),
      start: (repo, o) => /"expo"\s*:/.test(repo.read('package.json') || '') ? `npx expo start --${o.platform || 'ios'}` : `npx react-native run-${o.platform || 'ios'}` },
    go: { label: 'Go', color: ['#00758D', '#5AD1E6'],
      detect: repo => repo.has('go.mod'),
      start: repo => { if (repo.has('main.go')) return 'go run .'; const cmds = repo.list('cmd'); return cmds.length === 1 ? `go run ./cmd/${cmds[0]}` : null; } },
    rust: { label: 'Rust', color: ['#A0522D', '#E8A27C'], detect: repo => repo.has('Cargo.toml'), start: () => 'cargo run' },
    java: { label: 'Java / Kotlin', color: ['#B0562B', '#F0975F'],
      detect: repo => repo.has('pom.xml') || repo.has('build.gradle') || repo.has('build.gradle.kts'),
      port: repo => /spring-boot|springframework\.boot/.test(jvmText(repo)) ? 8080 : null,
      start: repo => {
        const spring = /spring-boot|springframework\.boot/.test(jvmText(repo));
        if (repo.has('pom.xml')) return spring ? `${repo.has('mvnw') ? './mvnw' : 'mvn'} spring-boot:run` : null;
        return `${repo.has('gradlew') ? './gradlew' : 'gradle'} ${spring ? 'bootRun' : 'run'}`;
      } },
    python: { label: 'Python', color: ['#2F6F9F', '#7FB8E6'],
      detect: repo => ['manage.py', 'pyproject.toml', 'requirements.txt', 'Pipfile'].some(f => repo.has(f)),
      port: repo => repo.has('manage.py') || /fastapi|uvicorn/.test(pyDeps(repo)) ? 8000 : /flask/.test(pyDeps(repo)) ? 5000 : null,
      start: (repo, o) => {
        const run = pyRun(repo), deps = pyDeps(repo);
        if (repo.has('manage.py')) return `${run}python manage.py runserver${o.port ? ` ${o.port}` : ''}`;
        if (/fastapi|uvicorn/.test(deps)) { const mod = ['main.py', 'app/main.py', 'src/main.py'].find(f => repo.has(f)); return mod ? `${run}uvicorn ${mod.replace(/\.py$/, '').replace(/\//g, '.')}:app --reload${flag('--port ', o.port)}` : null; }
        if (/flask/.test(deps)) return `${run}flask run${flag('--port ', o.port)}`;
        return null;
      } },
    ruby: { label: 'Ruby', color: ['#B3261E', '#F28B82'],
      detect: repo => repo.has('Gemfile'),
      port: repo => repo.has('config/application.rb') ? 3000 : null,
      start: (repo, o) => repo.has('config/application.rb') ? `bin/rails server${flag('-p ', o.port)}` : null },
    php: { label: 'PHP', color: ['#6C5FC7', '#A99FF5'],
      detect: repo => repo.has('artisan') || repo.has('composer.json'),
      port: repo => repo.has('artisan') ? 8000 : null,
      start: (repo, o) => repo.has('artisan') ? `php artisan serve${flag('--port=', o.port)}` : null },
    // Last: many repos carry a compose file only for their database.
    compose: { label: 'Docker Compose', color: ['#1D63ED', '#7AA7FF'],
      detect: repo => !!composeFile(repo),
      port: repo => Number(((repo.read(composeFile(repo)) || '').match(/["'\s-](\d{2,5}):\d{2,5}["'\s]/) || [])[1]) || null,
      start: () => 'docker compose up', stop: 'docker compose down' },
  };
  for (const [id, x] of Object.entries(RECIPES)) KINDS[id] = { label: x.label, runIn: RUN_IN, serves: x.serves !== false, ...(x.platforms && { platforms: x.platforms }), color: x.color };

  // A stack's own kinds: "kinds": { "<id>": { "label", "detect": [files], "start": "<command>", "port" } } in stack.json.
  const custom = new Set();
  function register(kinds) {
    for (const id of custom) { delete KINDS[id]; delete RECIPES[id]; }
    custom.clear();
    for (const [id, k] of Object.entries(kinds || {})) {
      if (!/^[a-z0-9-]{1,32}$/.test(id) || (KINDS[id] && !custom.has(id)) || !k || typeof k !== 'object') continue;
      const files = [].concat(k.detect || []).filter(f => typeof f === 'string');
      RECIPES[id] = { label: String(k.label || id), detect: repo => files.length > 0 && files.every(f => repo.has(f)), port: () => Number(k.port) || null, start: () => (typeof k.start === 'string' && k.start) || null };
      KINDS[id] = { label: RECIPES[id].label, runIn: RUN_IN, serves: k.serves !== false, custom: true };
      custom.add(id);
    }
  }
  // Which kind a clone looks like, or null. A stack's own kinds are asked first, then the specific ones, then the general ones.
  const isSam = repo => ['template.yaml', 'template.yml'].some(f => repo.has(f) && /AWS::Serverless/.test(repo.read(f) || ''));
  function detect(repo) {
    for (const id of custom) if (RECIPES[id].detect(repo)) return id;
    if (repo.has('pubspec.yaml')) return 'flutter';
    if (RECIPES.reactnative.detect(repo)) return 'reactnative';
    if (repo.find && repo.find('.csproj')) return 'dotnet';
    // A SAM app, unless it has its own dev server (then it runs as the Node app it also is).
    if (isSam(repo)) { let pkg = null; try { pkg = JSON.parse(repo.read('package.json') || 'null'); } catch (e) {} if (!pkg?.scripts?.dev && !pkg?.scripts?.start) return 'sam'; }
    if (repo.has('package.json')) { let pkg = null; try { pkg = JSON.parse(repo.read('package.json')); } catch (e) {} return frameworkOf(pkg) ? 'web' : 'node'; }
    for (const id of Object.keys(RECIPES)) if (!custom.has(id) && RECIPES[id].detect(repo)) return id;
    return null;
  }
  const defaultPort = (kind, repo) => (RECIPES[kind] && RECIPES[kind].port ? RECIPES[kind].port(repo) : null);

  // Browser front-end frameworks, recognized from package.json: default dev port, how to open the dev server to the
  // network, and the prefix the framework requires for env variables the browser code can read.
  const FRAMEWORKS = [
    { dep: 'next', name: 'Next.js', port: 3000, lanArgs: ['-H', '0.0.0.0'], envPrefix: 'NEXT_PUBLIC_' },
    { dep: 'vite', name: 'Vite', port: 5173, lanArgs: ['--host', '0.0.0.0'], envPrefix: 'VITE_' },
    { dep: '@angular/cli', name: 'Angular', port: 4200, lanArgs: ['--host', '0.0.0.0'], envPrefix: '' },
    { dep: 'react-scripts', name: 'Create React App', port: 3000, lanEnv: 'HOST=0.0.0.0', envPrefix: 'REACT_APP_' },
  ];
  function frameworkOf(pkg) {
    const deps = Object.assign({}, pkg && pkg.dependencies, pkg && pkg.devDependencies);
    return FRAMEWORKS.find(f => deps[f.dep]) || null;
  }
  const of = app => KINDS[app && app.kind] || { label: (app && app.kind) || 'App', runIn: RUN_IN, serves: true };

  const portOf = url => { try { return Number(new URL(url).port) || undefined; } catch (e) { return undefined; } };

  // The host a device uses to reach this Mac: the iOS simulator shares its network, the Android emulator sees it as
  // 10.0.2.2, and a real phone reaches it over Wi-Fi at the Mac's network address.
  function deviceHost(device, lanIp) {
    if (!device || (device.platform === 'ios' && !device.physical)) return 'localhost';
    if (device.platform === 'android' && !device.physical) return '10.0.2.2';
    return lanIp || null;
  }

  // The address a caller on `device` uses for a local callee. A phone cannot trust the Mac's development certificate,
  // so it gets the callee's plain http address, and the callee has to listen on the network (`koppler run <app> --lan`).
  function localAddress(callee, device, opts) {
    const o = opts || {}, phone = !!(device && device.physical);
    const base = phone && o.httpUrl ? o.httpUrl : callee.url;
    if (!base) return { error: 'the callee has no url in stack.json' };
    const host = deviceHost(device, o.lanIp);
    if (!host) return { error: "no network address for this Mac; connect to Wi-Fi, or pass the phone's reachable host" };
    const u = new URL(base);
    u.hostname = host;
    // Keep the caller's own style for a trailing slash (its deployed value), else the callee's.
    const slash = /\/$/.test(o.like || callee.url || '');
    const url = slash ? u.toString() : u.toString().replace(/\/$/, '');
    return { url, needsLan: phone, note: phone && !o.httpUrl && u.protocol === 'https:' ? 'the callee has no http address; a phone will reject its development certificate' : undefined };
  }
  const quote = s => /^[\w@%+=:,./-]+$/.test(s) ? s : `'${String(s).replace(/'/g, `'\\''`)}'`;

  // A .NET app's launch profile for an environment: one named after it (PROD for prod) before baseProfile; its -LOCAL copy when there is one.
  function launchProfile(app, profiles, env) {
    const all = profiles || {};
    const base = Object.keys(all).find(n => env && n.toLowerCase() === String(env).toLowerCase()) || app.baseProfile;
    const local = `${base}-LOCAL`;
    return { base, local, name: all[local] ? local : base };
  }

  // Returns { cwd, port, command, secrets, onStop } or { error }.
  function startCommand(app, ctx) {
    const kind = app.kind;
    if (kind === 'dotnet') {
      if (!app.project || !app.launchSettings || !app.baseProfile) return { error: 'needs project, launchSettings and baseProfile in stack.json' };
      const profiles = ctx.profiles || {};
      const { local, name: profile } = launchProfile(app, profiles, ctx.env);
      if (!profiles[profile]) return { error: `launch profile ${profile} not found in ${app.launchSettings}` };
      const vars = profiles[profile].environmentVariables || {};
      // A launch profile's own value wins over the environment, so it would silently hide a stored secret of the same name.
      const hiddenSecrets = (app.secrets || []).map(x => x && x.env).filter(name => name && vars[name] !== undefined);
      if (hiddenSecrets.length && profile === local) return { error: `launch profile ${local} sets ${hiddenSecrets.join(', ')}, which hides the stored secret of that name; remove it from ${local}` };
      // A setting given for this start (a cable's local address) is hidden the same way, so the value passed in wins.
      const hidden = [...hiddenSecrets, ...(ctx.override || []).filter(name => vars[name] !== undefined)];
      const lan = ctx.lan ? (ctx.httpPort ? ['--urls', `http://0.0.0.0:${ctx.httpPort}`] : null) : [];
      if (!lan) return { error: 'no http address in its launch profile to open to the network' };
      const port = ctx.lan ? ctx.httpPort : portOf(app.url);
      const run = ['dotnet', 'run', '--project', app.project];
      if (!hidden.length) return { cwd: ctx.repo, port, secrets: true, command: [...run, '--launch-profile', profile, ...lan] };
      // Without a -LOCAL profile, the base profile's settings are passed minus the hidden ones, so the repo stays untouched;
      // the environment's AWS sign-in replaces the repo's own AWS_PROFILE, which names a profile on someone else's Mac.
      const sso = ((app.prereqs || []).find(p => p && p.sso) || {}).sso;
      const env = Object.entries({ ...vars, ...(sso && { AWS_PROFILE: sso }), ...(profiles[profile].applicationUrl && { ASPNETCORE_URLS: profiles[profile].applicationUrl }) })
        .filter(([name]) => !hidden.includes(name)).map(([name, value]) => `${name}=${value}`);
      return { cwd: ctx.repo, port, secrets: true, command: ['env', ...env, ...run, '--no-launch-profile', ...lan] };
    }
    if (kind === 'flutter') {
      const f = app.flutter || {};
      if (!ctx.device) return { error: 'needs a device: --device ios, --device android or a device id (fvm flutter devices)' };
      const flutter = f.fvm ? ['fvm', 'flutter'] : ['flutter'];
      const runArgs = [...flutter, 'run', '--no-resident', ...(f.flavor ? ['--flavor', ctx.env] : []),
        ...(f.defineFile ? [`--dart-define-from-file=${f.defineFile.replace('{env}', ctx.env)}`] : []), '-d', ctx.device.id];
      // `flutter run --no-resident` builds, installs and launches, then exits; `flutter logs` keeps the app's output on the card.
      const script = `${runArgs.map(quote).join(' ')} && exec ${[...flutter, 'logs', '-d', ctx.device.id].map(quote).join(' ')}`;
      const m = app.mobile || {};
      const onStop = ctx.device.platform === 'ios' && m.iosBundleId ? [['xcrun', 'simctl', 'terminate', ctx.device.id, m.iosBundleId]]
        : ctx.device.platform === 'android' && m.androidPackage ? [['adb', '-s', ctx.device.id, 'shell', 'am', 'force-stop', m.androidPackage]] : [];
      return { cwd: ctx.repo, command: ['sh', '-c', script], onStop };
    }
    if (kind === 'node' || kind === 'web') {
      const scripts = ctx.scripts || {};
      const script = app.script || ['dev', 'start'].find(s => scripts[s]);
      if (!script || !scripts[script]) return { error: `no ${app.script || 'dev or start'} script in package.json; set "script" in stack.json` };
      const fw = kind === 'web' ? frameworkOf(ctx.pkg) : null;
      const port = portOf(app.url) || (fw && fw.port);
      if (!ctx.lan) return { cwd: ctx.repo, port, command: ['npm', 'run', script] };
      // Opened to the network: the framework's own host flag, else HOST=0.0.0.0, which most Node servers read.
      if (fw && fw.lanArgs) return { cwd: ctx.repo, port, command: ['npm', 'run', script, '--', ...fw.lanArgs] };
      return { cwd: ctx.repo, port, command: ['env', (fw && fw.lanEnv) || 'HOST=0.0.0.0', 'npm', 'run', script],
        note: fw ? undefined : 'HOST=0.0.0.0 is set; check the app reads it' };
    }
    if (kind === 'lambda') {
      const l = app.lambda || {}, port = portOf(app.url);
      if (!l.handler || !l.runtime || !port) return { error: 'needs url and lambda { handler, runtime } in stack.json' };
      return { cwd: ctx.repo, port, command: ['node', `${ctx.engine}/lambda-local.mjs`, JSON.stringify(l), String(port), `${ctx.engine}/temp/lambda-${ctx.id}.json`], onStop: [['docker', 'rm', '-f', `koppler-lambda-${port}`]] };
    }
    if (kind === 'sam') {
      const port = portOf(app.url) || 3000;
      return { cwd: ctx.repo, port, command: ['node', `${ctx.engine}/sam-local.mjs`, String(port), JSON.stringify({ ...(app.sam?.template && { template: app.sam.template }), envs: app.sam?.envs?.[ctx.env] ? [].concat(app.sam.envs[ctx.env]) : ctx.envNames || [ctx.env] })] };
    }
    if (kind === 'other') {
      if (!app.start) return { error: 'needs "start" in stack.json: the shell command that starts it, run in its repo' };
      return { cwd: ctx.repo, port: portOf(app.url), command: ['sh', '-c', String(app.start)] };
    }
    const recipe = RECIPES[kind];
    if (recipe) {
      // The stack's own `start` wins; else the recipe works one out from what is in the repo.
      const files = ctx.files || { has: () => false, read: () => null, list: () => [] };
      const port = portOf(app.url) || (recipe.port ? recipe.port(files) : null) || undefined;
      const command = app.start || recipe.start(files, { port, platform: ctx.platform });
      if (!command) return { error: `cannot tell how this ${recipe.label} app starts; set "start" in stack.json: the shell command, run in its repo` };
      return { cwd: ctx.repo, port, command: ['sh', '-c', String(command)], ...(recipe.stop && { onStop: [['sh', '-c', `cd ${quote(ctx.repo)} && ${recipe.stop}`]] }) };
    }
    return { error: `kind ${kind} cannot start by id yet` };
  }

  // What a browser front end needs from an API it calls locally: its own origin allowed (CORS), and no https page calling http.
  // `slot` numbers each browser caller of the same API, for settings written as `Cors__AllowedOrigins__{n}`.
  function browserChecks(caller, callee, callerUrl, slot) {
    const origin = (() => { try { return new URL(callerUrl).origin; } catch (e) { return null; } })();
    const out = { settings: [], warnings: [] };
    if (callee.cors && callee.cors.env && origin) for (const env of [].concat(callee.cors.env)) out.settings.push({ app: 'callee', env: env.replace('{n}', String(slot || 0)), value: origin });
    else if (origin) out.warnings.push(`${callee.name || 'the API'} has no recorded CORS setting; the browser may block calls from ${origin}. Record it as "cors": { "env": "<setting>" } in stack.json.`);
    if (callerUrl && callee.url && /^https:/.test(callerUrl) && /^http:/.test(callee.url)) out.warnings.push('an https page cannot call an http API; use the API\'s https address or serve the page over http');
    return out;
  }

  // An env-file change: lines to put in a git-ignored local env file the framework reads on top of its .env.
  function envFileChange(call, value) {
    return { file: call.file || '.env.local', lines: [].concat(call.env || []).map(e => `${e}=${value}`) };
  }

  const api = { KINDS, FRAMEWORKS, of, frameworkOf, register, detect, defaultPort, startCommand, launchProfile, deviceHost, localAddress, browserChecks, envFileChange };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KopplerKinds = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
