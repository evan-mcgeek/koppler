// App kinds: what each kind of app is called, where it can be started, and how a clone is recognised as one.
// Kinds with a program of their own to start them are listed first; the rest are recipes, which say how a repo is
// recognised and how it is usually started. A stack can add kinds of its own.
import { frameworkOf, type PackageJson } from './frameworks.ts';

/** A choice shown to the user: its id and its words. */
type Choice = readonly [id: string, label: string];
// Who starts the app: Koppler from the terminal, or the user from their IDE.
const RUN_IN: readonly Choice[] = [
  ['cli', 'Koppler'],
  ['ide', 'Your IDE'],
];
const DOCKER = { tool: 'docker', fix: 'Install a Docker runtime (Docker Desktop or Colima)' };
const NPM = { tool: 'npm', fix: 'Comes with Node' };

export interface Kind {
  label: string;
  runIn: readonly Choice[];
  /** Whether it answers requests, so other apps can call it. */
  serves: boolean;
  /** The devices a mobile app can run on. */
  platforms?: readonly Choice[];
  /** A front end that runs in a browser. */
  browser?: true;
  /** The programs this kind is started with, checked when a stack that has such an app loads. */
  needs?: { tool: string; fix: string }[];
  /** Its colour on the canvas, for light and dark. */
  color?: readonly [string, string];
  /** Added by the stack in use. */
  custom?: true;
}
/** Koppler's own kinds. */
export const KINDS: Record<string, Kind> = {
  dotnet: {
    label: '.NET',
    runIn: RUN_IN,
    serves: true,
    needs: [{ tool: 'dotnet', fix: 'Install the .NET SDK the repo targets' }],
  },
  flutter: {
    label: 'Flutter',
    runIn: RUN_IN,
    serves: false,
    platforms: [
      ['ios', 'iOS simulator'],
      ['android', 'Android emulator'],
      ['phone', 'Phone'],
    ],
    needs: [{ tool: 'fvm', fix: 'brew tap leoafarias/fvm && brew install fvm' }],
  },
  node: { label: 'Node', runIn: RUN_IN, serves: true, needs: [NPM] },
  web: { label: 'Web', runIn: RUN_IN, serves: false, browser: true, needs: [NPM] },
  // A queue-triggered AWS Lambda, run in an emulator in Docker; callers post to its local address.
  lambda: {
    label: 'Lambda',
    runIn: RUN_IN,
    serves: true,
    needs: [DOCKER, { tool: 'aws', fix: 'brew install awscli' }],
  },
  // An AWS SAM app (template.yaml): its API runs with `sam local start-api`, whatever its runtime.
  sam: {
    label: 'AWS SAM',
    runIn: RUN_IN,
    serves: true,
    needs: [DOCKER, { tool: 'sam', fix: 'brew install aws-sam-cli (or: uv tool install aws-sam-cli)' }],
  },
  // Anything else: started by the command in its `start` field.
  other: { label: 'Other', runIn: RUN_IN, serves: true },
};

/** A small view of a clone: which files it has, their text, and what a folder holds. */
export interface RepoView {
  has: (path: string) => boolean;
  read: (path: string) => string | null;
  list: (dir: string) => string[];
  /** Whether any file ends with this. */
  find?: (suffix: string) => boolean;
}
export interface Recipe {
  label: string;
  color?: readonly [string, string];
  serves?: false;
  platforms?: readonly Choice[];
  detect: (repo: RepoView) => boolean;
  /** The port it usually answers on, when that can be told from the repo. */
  port?: (repo: RepoView) => number | null;
  /** The shell command that starts it, or null when the repo does not say. */
  start: (repo: RepoView, options: { port?: number | undefined; platform?: string | undefined }) => string | null;
  /** The shell command that stops what `start` leaves behind. */
  stop?: string;
}

const read = (repo: RepoView, file: string) => repo.read(file) ?? '';
const textOf = (repo: RepoView, files: string[]) =>
  files
    .map(file => read(repo, file))
    .join('\n')
    .toLowerCase();
const flag = (name: string, port: number | undefined) => (port ? ` ${name}${String(port)}` : '');
const pythonDeps = (repo: RepoView) => textOf(repo, ['pyproject.toml', 'requirements.txt', 'Pipfile']);
// How the repo runs its Python: through its package manager, or its own virtual environment.
function pythonRunner(repo: RepoView): string {
  if (repo.has('uv.lock')) return 'uv run ';
  if (repo.has('poetry.lock')) return 'poetry run ';
  if (repo.has('Pipfile')) return 'pipenv run ';
  return repo.has('.venv/bin/python') ? '.venv/bin/' : '';
}
const isSpring = (repo: RepoView) =>
  /spring-boot|springframework\.boot/.test(textOf(repo, ['pom.xml', 'build.gradle', 'build.gradle.kts']));
const composeFile = (repo: RepoView) =>
  ['compose.yaml', 'compose.yml', 'docker-compose.yml', 'docker-compose.yaml'].find(file => repo.has(file));

const BUILT_IN_RECIPES: Record<string, Recipe> = {
  reactnative: {
    label: 'React Native',
    color: ['#087EA4', '#58C4DC'],
    serves: false,
    platforms: [
      ['ios', 'iOS simulator'],
      ['android', 'Android emulator'],
    ],
    detect: repo => /"(expo|react-native)"\s*:/.test(read(repo, 'package.json')),
    start: (repo, { platform = 'ios' }) =>
      /"expo"\s*:/.test(read(repo, 'package.json'))
        ? `npx expo start --${platform}`
        : `npx react-native run-${platform}`,
  },
  go: {
    label: 'Go',
    color: ['#00758D', '#5AD1E6'],
    detect: repo => repo.has('go.mod'),
    start: repo => {
      if (repo.has('main.go')) return 'go run .';
      const commands = repo.list('cmd');
      return commands.length === 1 ? `go run ./cmd/${commands[0] ?? ''}` : null;
    },
  },
  rust: {
    label: 'Rust',
    color: ['#A0522D', '#E8A27C'],
    detect: repo => repo.has('Cargo.toml'),
    start: () => 'cargo run',
  },
  java: {
    label: 'Java / Kotlin',
    color: ['#B0562B', '#F0975F'],
    detect: repo => repo.has('pom.xml') || repo.has('build.gradle') || repo.has('build.gradle.kts'),
    port: repo => (isSpring(repo) ? 8080 : null),
    start: repo => {
      if (repo.has('pom.xml')) return isSpring(repo) ? `${repo.has('mvnw') ? './mvnw' : 'mvn'} spring-boot:run` : null;
      return `${repo.has('gradlew') ? './gradlew' : 'gradle'} ${isSpring(repo) ? 'bootRun' : 'run'}`;
    },
  },
  python: {
    label: 'Python',
    color: ['#2F6F9F', '#7FB8E6'],
    detect: repo => ['manage.py', 'pyproject.toml', 'requirements.txt', 'Pipfile'].some(file => repo.has(file)),
    port: repo => {
      const deps = pythonDeps(repo);
      if (repo.has('manage.py') || /fastapi|uvicorn/.test(deps)) return 8000;
      return deps.includes('flask') ? 5000 : null;
    },
    start: (repo, { port }) => {
      const run = pythonRunner(repo);
      const deps = pythonDeps(repo);
      if (repo.has('manage.py')) return `${run}python manage.py runserver${flag('', port)}`;
      if (/fastapi|uvicorn/.test(deps)) {
        const main = ['main.py', 'app/main.py', 'src/main.py'].find(file => repo.has(file));
        const module = main?.replace(/\.py$/, '').replace(/\//g, '.');
        return module ? `${run}uvicorn ${module}:app --reload${flag('--port ', port)}` : null;
      }
      return deps.includes('flask') ? `${run}flask run${flag('--port ', port)}` : null;
    },
  },
  ruby: {
    label: 'Ruby',
    color: ['#B3261E', '#F28B82'],
    detect: repo => repo.has('Gemfile'),
    port: repo => (repo.has('config/application.rb') ? 3000 : null),
    start: (repo, { port }) => (repo.has('config/application.rb') ? `bin/rails server${flag('-p ', port)}` : null),
  },
  php: {
    label: 'PHP',
    color: ['#6C5FC7', '#A99FF5'],
    detect: repo => repo.has('artisan') || repo.has('composer.json'),
    port: repo => (repo.has('artisan') ? 8000 : null),
    start: (repo, { port }) => (repo.has('artisan') ? `php artisan serve${flag('--port=', port)}` : null),
  },
  // Last: many repos carry a compose file only for their database.
  compose: {
    label: 'Docker Compose',
    color: ['#1D63ED', '#7AA7FF'],
    detect: repo => !!composeFile(repo),
    port: repo => Number(/["'\s-](\d{2,5}):\d{2,5}["'\s]/.exec(read(repo, composeFile(repo) ?? ''))?.[1]) || null,
    start: () => 'docker compose up',
    stop: 'docker compose down',
  },
};
for (const [id, recipe] of Object.entries(BUILT_IN_RECIPES))
  KINDS[id] = {
    label: recipe.label,
    runIn: RUN_IN,
    serves: recipe.serves !== false,
    ...(recipe.platforms && { platforms: recipe.platforms }),
    ...(recipe.color && { color: recipe.color }),
  };

/** The kinds Koppler has itself: a stack cannot define one under the same id. */
export const BUILT_IN_KINDS: readonly string[] = Object.keys(KINDS);

/** The kinds a stack can use: Koppler's own, then the stack's (`"kinds": { "<id>": { "label", "detect", "start", "port", "serves" } }`). */
interface Table {
  kinds: Record<string, Kind>;
  recipes: Record<string, Recipe>;
  custom: string[];
}
type WithKinds = { kinds?: unknown } | null | undefined;
const BUILT_IN: Table = { kinds: KINDS, recipes: BUILT_IN_RECIPES, custom: [] };
const tables = new WeakMap<object, Table>();

/** A malformed kind, or one named like a kind Koppler has, is left out. */
function tableOf(stack: WithKinds): Table {
  const given = stack?.kinds;
  if (typeof given !== 'object' || given === null) return BUILT_IN;
  const cached = tables.get(given);
  if (cached) return cached;
  const table: Table = { kinds: { ...KINDS }, recipes: { ...BUILT_IN_RECIPES }, custom: [] };
  for (const [id, one] of Object.entries(given as Record<string, unknown>)) {
    if (!/^[a-z0-9-]{1,32}$/.test(id) || Object.hasOwn(KINDS, id) || typeof one !== 'object' || one === null) continue;
    const kind = one as { label?: unknown; detect?: unknown; start?: unknown; port?: unknown; serves?: unknown };
    const files = [kind.detect ?? []].flat().filter((file): file is string => typeof file === 'string');
    const label = typeof kind.label === 'string' && kind.label ? kind.label : id;
    table.recipes[id] = {
      label,
      detect: repo => files.length > 0 && files.every(file => repo.has(file)),
      port: () => Number(kind.port) || null,
      start: () => (typeof kind.start === 'string' && kind.start ? kind.start : null),
    };
    table.kinds[id] = { label, runIn: RUN_IN, serves: kind.serves !== false, custom: true };
    table.custom.push(id);
  }
  tables.set(given, table);
  return table;
}

/** Every kind a stack can use, by id. */
export const kindsFor = (stack: WithKinds): Readonly<Record<string, Kind>> => tableOf(stack).kinds;

export const recipeOf = (kind: string | undefined, stack?: WithKinds): Recipe | undefined => {
  const { recipes } = tableOf(stack);
  return kind !== undefined && Object.hasOwn(recipes, kind) ? recipes[kind] : undefined;
};

const packageJson = (repo: RepoView): PackageJson | null => {
  try {
    return JSON.parse(read(repo, 'package.json') || 'null') as PackageJson | null;
  } catch {
    return null;
  }
};
const isSam = (repo: RepoView) =>
  ['template.yaml', 'template.yml'].some(file => repo.has(file) && read(repo, file).includes('AWS::Serverless'));

/** Which kind a clone looks like, or null. A stack's own kinds are asked first, then the specific, then the general. */
export function detect(repo: RepoView, stack?: WithKinds): string | null {
  const { custom, recipes } = tableOf(stack);
  for (const id of custom) if (recipes[id]?.detect(repo)) return id;
  if (repo.has('pubspec.yaml')) return 'flutter';
  if (BUILT_IN_RECIPES['reactnative']?.detect(repo)) return 'reactnative';
  if (repo.find?.('.csproj')) return 'dotnet';
  const pkg = packageJson(repo);
  // A SAM app, unless it has its own dev server (then it runs as the Node app it also is).
  if (isSam(repo) && !pkg?.scripts?.['dev'] && !pkg?.scripts?.['start']) return 'sam';
  if (repo.has('package.json')) return frameworkOf(pkg) ? 'web' : 'node';
  return Object.keys(BUILT_IN_RECIPES).find(id => BUILT_IN_RECIPES[id]?.detect(repo)) ?? null;
}

/** The port a clone of this kind usually answers on, when its files say. */
export const defaultPort = (kind: string, repo: RepoView, stack?: WithKinds): number | null =>
  recipeOf(kind, stack)?.port?.(repo) ?? null;

/** What is known about an app's kind; a kind nobody defined still gets a label and the usual choices. */
export function of(app: { kind?: string | undefined } | null | undefined, stack?: WithKinds): Kind {
  const kind = app?.kind;
  const kinds = kindsFor(stack);
  return (
    (kind !== undefined && Object.hasOwn(kinds, kind) && kinds[kind]) || {
      label: kind ?? 'App',
      runIn: RUN_IN,
      serves: true,
    }
  );
}
