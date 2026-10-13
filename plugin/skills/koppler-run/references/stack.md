# Shared stack config: `stack.json`

One file per stack, in the team's repo, reviewed through PRs.
It holds facts about the apps, never secret values.
`koppler sync` validates it (`envs`, and `name` / `kind` / `slug` per app, `consumes` pointing at known apps) and copies it to `<state>/registry.json`.

```json
{
  "name": "Orders",
  "envs": ["qa", "prod"],
  "notes": ["Stack-wide facts the agent reads first, e.g. which tunnel can move to another port."],
  "checks": [
    { "name": "nuget-feed", "kinds": ["dotnet"], "run": "dotnet nuget list source | grep -q acme", "ok": "feed configured", "fix": "see the README setup" }
  ],
  "apps": {
    "orders-api": {
      "name": "Orders API",
      "kind": "dotnet",
      "slug": "acme/orders-api",
      "project": "src/Orders.Api",
      "launchSettings": "src/Orders.Api/Properties/launchSettings.json",
      "baseProfile": "QA",
      "url": "http://localhost:5001",
      "deployedUrl": "https://orders.qa.acme.dev",
      "run": { "cli": "dotnet run --project src/Orders.Api --launch-profile <profile>", "ide": "Rider: launch profile <profile>" },
      "consumes": {
        "payments-api": { "how": "env", "env": ["Payments__BaseUrl"], "deployed": "https://payments.qa.acme.dev" }
      },
      "prereqs": [
        { "sso": "acme-qa", "note": "AWS login for config and secrets" },
        { "tunnel": "db-qa.internal.acme.dev", "port": 5432, "cmd": "cloudflared access tcp --hostname db-qa.internal.acme.dev --url localhost:5432" }
      ],
      "secrets": [
        { "env": "ConnectionStrings__DB", "when": "always", "fetch": { "cli": "<command> | koppler secret set orders-api ConnectionStrings__DB --stdin", "ui": "<where to copy it from>" } }
      ],
      "envs": { "prod": { "baseProfile": "PROD", "deployedUrl": "https://orders.acme.dev" } }
    }
  }
}
```

| Field | Meaning |
|---|---|
| `envs` | Deployed environments, first one is the default; app fields apply to it, `apps[id].envs.<env>` overrides them for the others. |
| `protected` | The environments where a mistake costs something (production, usually): a list of names from `envs`. Without it, every environment except the first. They get the red frame and the blocking review on the canvas, and their secrets ask on every read. |
| `envAliases` | Other names the repos use for an environment, e.g. `{ "qa": ["dev"] }`; `koppler discover --deployed` reads Terraform written for `dev` as QA. |
| `notes` | Stack-wide facts. |
| `checks` | The stack's own health checks, run when it loads (`koppler doctor`): `name`, `run` (a shell command), `ok` and `fix` texts, `kinds` to limit it to stacks with those app kinds. At most 50, each `run` up to 2000 characters. They are someone's commands, so they run only after the user approved them with `koppler doctor --approve`, and again after one changes. The same approval covers everything else the stack would run or write: an app's `start` (also per environment), a custom kind's `start` and `stop`, and `localChanges`. |
| `apps.<id>.outside` | The app does not run on this Mac, or has nothing to run (Salesforce, a SaaS package, a managed service, an S3 bucket, a library or config repo), with a short why. It is never planned, sent or started (`koppler up` refuses it by name), needs no `slug`, and its card shows the address its `deployedUrl` gives for the board's environment (the Salesforce sandbox on QA, production on PROD). `koppler discover --deployed` drafts known ones (Salesforce) from each app's addresses per environment, with the calls to them (`outsideSuggestions`). It stays in the stack so the flow is complete: it never runs or takes a cable, and shows as a dashed read-only card next to the board apps that call it (`consumes`) or share a queue with it. |
| `queues` | Top-level: `{ "<id>": { "name", "type", "queue"? } }`, the queues, topics and event buses between apps. `type` is `sqs`, `sns`, `eventbridge`, `kafka` or `other`; `queue` is its real name (default the id), per environment under `envs.<env>.queue`. |
| `apps.<id>.publishes`, `apps.<id>.reads` | `koppler discover --deployed` drafts them, with `queues`, from the Terraform (who sends and reads, the settings carrying each address, what feeds a queue from outside); confirm before adding.  The queues the app sends to or takes from: `{ "<queue>": { "env"?: [settings holding the queue's URL] } }`. On the canvas they draw a queue card between its apps, with a Local switch. Switched on, `koppler up` runs it locally. SQS: one AWS emulator in Docker on port 4566 holds the queue, and every app on it starts with `AWS_ENDPOINT_URL_SQS` (which current AWS SDKs read) and its `env` settings pointed at the local queue. Kafka: one broker in Docker (`apache/kafka`) on `localhost:9092` gets the topic (`queue`), and every app on it starts with its `env` settings (its broker list, e.g. `Kafka__BootstrapServers`) set to `localhost:9092`; a broker setup that needs sign-in (SASL, MSK IAM) has to be turned off for the local run, e.g. by a remembered change. SNS and EventBridge stay deployed. Off, a local reader takes messages off the deployed queue, so the deployed reader misses those; the card says so. |
| `install` | How to install a program the stack needs, by name: `{ "cloudflared": "brew install cloudflared" }`. Which programs are needed is worked out from the stack itself: each app kind's own, and the first word of every prerequisite's `cmd`. |
| `kind` | What the app is built with; decides how it is recognized, started and shown. See "Kinds" below. |
| `start` | The shell command that starts the app in its repo. Needed for `other`, optional for the recipe kinds, where it replaces the usual command. |
| `kinds` | Top-level: the stack's own kinds, `{ "<id>": { "label", "detect": [files that must all exist], "start": "<command>", "port" } }`, for a technology Koppler has no recipe for. |
| `slug` | `owner/repo` for GitHub, or `host/path` for any other git host (`gitlab.com/group/sub/repo`, `dev.azure.com/org/project/repo`); `koppler init` matches it against the remotes of the user's clones. |
| `ready` | Optional. When the app is ready, for an app whose port answers before it can serve: `{ "path": "/health", "status"?: 200, "timeout"?: seconds }`. A start then also waits until a GET of that path on the app's `url` answers (with that status, or any below 400), and apps that call it start after that. Without it, ready means the port answers. |
| `consumes.<app>` | How this app calls another: `how: env` (env vars in a `-LOCAL` launch profile), `how: env-file` (lines in a git-ignored local env file, `file` default `.env.local`, for front ends whose variables need the framework's prefix such as `VITE_` or `NEXT_PUBLIC_`), `how: edit` (a marked temporary code edit at `file` / `key`; `value` is optional, `koppler plan --wire` works out the address for each device, and a `value` per `ios` / `android` pins it), or `how: unknown` (the call is known from the repo, `found` says where, but how a local run repoints it is not: work it out from the repo on first use and write the real `how` back). When the caller's setting holds more than the callee's address (it posts to `<address>/some/route` as it is), give that route as `path`: a local cable then sets `<local address><path>`, where it would otherwise drop the route. |
| `prereqs` | `sso` (an AWS profile) or `signIn` (the name of a sign-in under the stack's `signIns`, for anything else), `tunnel` (+ `port`, `cmd`; optional `what` such as `"Database (Aurora)"`, else guessed from the host name; optional `env`, the app setting that holds the tunnel's `host:port`, which lets Koppler move the tunnel to a free port when another one needs the same port; optional `connectsAs`, the host name the app actually dials when it is not the tunnel host, e.g. a database endpoint from a secret mapped to the tunnel by a `hosts` entry), `hosts`, `devCerts`, `file`, `nuget`, each with an optional `note`. |
| `secrets` | What the user must store (`env` or `file`), `when` it is needed, `fetch.cli` / `fetch.ui` steps, and for a database or cache connection an optional `type` (`postgres`, `mysql`, `redis`) so it can be tested. See `secrets.md`. |
| `mobile` | `iosBundleId` / `androidPackage`, so the watcher can tell whether the app is running, and `koppler stop` can close it on the device. |
| `flutter` | For `kind: flutter`: `fvm` (run through fvm), `flavor` (pass the env as `--flavor`), `defineFile` (e.g. `.env_{env}.json` for `--dart-define-from-file`). |
| `script` | For `kind: node` or `web`: the npm script that starts the app locally (default `dev`, else `start`). |
| `cors` | For an API called from browser front ends: `env`, the setting(s) holding allowed origins, e.g. `"Cors__AllowedOrigins__{n}"`; `{n}` gives each front end its own slot. Without it, `koppler plan --wire` warns that the browser may block calls. |
| `pending` | The app is listed but its run facts are not collected yet. |

Local libraries need nothing in `stack.json`: `koppler sync` matches each app's dependencies (`pubspec.yaml`, `package.json`) with the packages your clones publish, and the card offers a Libraries switch for each. Switched on, `koppler up` points the app at your clone (a `pubspec_overrides.yaml` for Dart, `npm install --no-save` for npm) and Stop reverts it; .NET libraries are not covered yet.

Top-level `presets` are the team boards: `[{ "name": "Mobile App + Mobile API", "version": 1, "nodes": { "<app>": { "run": "cli", "platform"?, "branch"?, "note"? } }, "edges": [{ "from", "to" }] }]`. The canvas lays them out by who calls whom; `koppler sync` checks every app and cable exists. Every board a user builds is kept as their own, saved as they change it; Share copies it as JSON to add here.
A single preset in its own `.json` file (the JSON that Share copies), a list of them, or a whole `stack.json` can be opened from the canvas's board selector, as a file or as a GitHub link.

Every preset carries the `version` of the preset format it was saved in (`VERSION` in `core/presets`, currently 1); `koppler sync` requires it on shared presets.
Before any preset opens, its version is compared with the one this Koppler reads:
- older: it is brought up to date one step at a time (`MIGRATIONS[n]` turns version n into n + 1; a file without a version is read as version 0);
- newer: it is refused, with a message to update Koppler.

It is then checked against the stack and your clones: apps the stack does not have or you have not cloned are left out, a run mode or platform the app does not offer falls back to one it does, a cable between apps that do not call each other is dropped, and a branch missing from your clone is pointed out.
Each change is listed when the preset loads; a preset with nothing left to open is refused and the board stays as it was.
To change the format: raise `VERSION`, add the `MIGRATIONS` step from the previous version, and cover it in `presets.test.mjs`.

Other fields (`config`, `overrides`, `note`) are free-form facts for the agent to read.

## What the repos say

Right after repos are added on the canvas, and later from "Look through the repos again" in the stack menu (`koppler discover [--apply]`), Koppler reads the clones and offers, for the user to tick:
- where each app runs locally (launch settings, `.env`, the framework's default port), as its `url`;
- each app's deployed address per environment, from its Terraform, as `deployedUrl` (and `envs.<env>.deployedUrl`);
- an environment the repos name differently (QA deployed as `dev`), as `envAliases`, with the addresses that follow from it;
- who calls whom: another app's address in a caller's code, as `consumes.<callee>` with `how: unknown` and where it was found.
Only ticked findings are written; the agent works out `how` the first time that cable is used.

## Shared stacks from GitHub

A stack can be used straight from a link to its `stack.json` on GitHub (`koppler link <url>`, or "Use" next to the link field on the canvas), with no clone.
Koppler reads it through the user's `gh` login and keeps a copy in `~/.config/koppler/stacks/<owner>-<repo>-<name>/`, with `.source.json` holding the link and the file as last fetched.
- What Koppler learns goes into the copy and shows as "Changes not shared yet" in the stack menu (`koppler link`).
- "Check for updates" (`koppler link --update`) brings in GitHub's changes; when both sides changed it refuses rather than lose either.
- "Open pull request" (`koppler link --pr`) pushes a branch `koppler/<stack>-<id>` with the copy and opens a pull request listing the changes, after the user confirms. Once it is merged, the next update finds the two in line.
- "Discard my changes" (`koppler link --discard`) puts the copy back to the shared file as last fetched.

## Kinds

| Kind | Recognized by | Started with | Usual port |
|---|---|---|---|
| `dotnet` | a `.csproj` | `dotnet run` with the app's `-LOCAL` launch profile | from the profile |
| `flutter` | `pubspec.yaml` | `flutter run` on the chosen device, then `flutter logs` | none |
| `reactnative` | `expo` or `react-native` in `package.json` | `npx expo start --ios` / `npx react-native run-ios` (or android) | none |
| `web` | Vite, Next.js, Create React App or Angular in `package.json` | `npm run` its `script` (else `dev`, `start`) | the framework's |
| `node` | any other `package.json` | `npm run` its `script` (else `dev`, `start`) | from `.env` or scripts |
| `go` | `go.mod` | `go run .`, or `go run ./cmd/<name>` when there is one | none |
| `rust` | `Cargo.toml` | `cargo run` | none |
| `java` | `pom.xml`, `build.gradle(.kts)` | Spring Boot: `./mvnw spring-boot:run` or `./gradlew bootRun`; other Gradle: `run` | 8080 for Spring Boot |
| `python` | `manage.py`, `pyproject.toml`, `requirements.txt`, `Pipfile` | Django `manage.py runserver`, FastAPI `uvicorn <module>:app --reload`, Flask `flask run`, through uv, Poetry, Pipenv or `.venv` when present | 8000, Flask 5000 |
| `ruby` | `Gemfile` | Rails: `bin/rails server` | 3000 |
| `php` | `artisan`, `composer.json` | Laravel: `php artisan serve` | 8000 |
| `compose` | a Compose file, when nothing above matches | `docker compose up`, and `docker compose down` on stop | the first published port |
| `lambda` | chosen by hand: a queue-triggered AWS Lambda | `lambda-local.mjs`: an AWS emulator in Docker (Floci) with the queue, the function and its secret; needs Docker and the AWS CLI | from `url` (the next port up is the emulator's) |
| `sam` | `template.yaml` with `AWS::Serverless` and no `dev` / `start` script | `sam-local.mjs`: `sam build`, then `sam local start-api` for the API-triggered functions, any runtime; deploy parameters from `samconfig.toml` for the env (or `sam.envs.<env>`), the template's declared settings from stored secrets and cable addresses (`localhost` becomes `host.docker.internal`); functions with other triggers are listed, not run. Built under `~/.local/state/koppler/sam`, never in the repo. Needs Docker and the SAM CLI | from `url`, default 3000 |
| `other` | chosen by hand | the app's `start` | from `url` |

A `lambda` app says how to build and trigger it: `"lambda": { "project", "handler", "runtime", "timeout", "routes": ["retry_request"], "secret": { "id": "<the Secrets Manager name the function asks for>", "from": "<the stored secret holding its JSON>" } }`.
Callers post to `url` plus a route, as they post to API Gateway when deployed.
A callee whose address lives inside that secret is repointed by writing `{ "set": { "<key>": "http://host.docker.internal:<port>/" } }` to `<state>/lambda-<app id>.json` before the start (the function runs in Docker, where `localhost` is not the Mac); log it as an `env-file` action.

When a recipe cannot tell how the app starts (several Go commands, a Python repo with no known framework, plain Maven), `koppler run` says so and asks for `start`.
The port in the app's `url` wins over the usual one. The recipes live in the app's `core/kinds`; only .NET, Flutter, Node and the web frameworks have been run for real so far.

## Adding apps

Apps join the stack through the repo picker on the canvas: `koppler init --pick` (it opens by itself on a stack with no apps) or "Add repos" above the Apps list.
It lists the clones found on this machine by folder, with the kind each looks like (.NET, Flutter, Node, web; ask when it cannot tell) and a name taken from the repo, which can be edited.
Only the ticked ones are written to `stack.json`, as `{ name, kind, slug, pending }`: listed, but not set up yet. Their run facts are collected the first time they are used.

## Who calls whom

Map every app's outgoing calls, not just the app you started from: a missing or empty `consumes` means "not mapped yet", never "calls nothing".
`koppler sync` helps: it searches each cloned app's repo for the other apps' deployed hosts (`deployedUrl`, and each `consumes.<app>.deployed`) and prints:

- `FOUND a -> b`: a call in `a`'s repo that `stack.json` does not list. The canvas lets you cable it; confirm how a local run repoints it, then add it to `consumes`.
- `UNKNOWN app`: no deployed address is known for it, so calls to it cannot be found. Add its `deployedUrl`.
- `SHARED host`: two apps use the same address (e.g. one app's QA URL pointing at another app), so calls to it are not attributed. Check those by hand.

Tests, docs, lock files and migration tools are not searched.

## Drafting from Terraform

`koppler discover --deployed [app...]` reads the Terraform in each clone (no cloud access) and drafts, per environment:

- the app's deployed address (API Gateway domain, CDN alias or DNS record), marked `NEW`, `matches stack.json` or `OTHER than stack.json`;
- the names of its settings, and which of them hold or point to a secret;
- Secrets Manager secret names and Parameter Store paths;
- calls: a setting whose address belongs to another app.

It reads out names and plain addresses only (a host, or an http(s) URL with no credentials or query); every other value stays in the repo.
Environments come from variable files named after them (`deployment-dev.tfvars`) or, without those, from trying each stack environment and alias as the Terraform workspace.
What it cannot work out (a domain passed in by the deploy pipeline, a name built from a random suffix) is reported as not found or counted.
The draft, with a `suggestions` block shaped like `stack.json`, goes to `<state>/stack.deployed.json`. Review it before copying anything across.

## Sign-ins that are not AWS

`sso` is shorthand for an AWS profile.
Add `account` (the 12-digit id) next to it when the profile must be one account: signed in to another one then counts as not signed in, and nothing starts.
A declared sign-in does the same inside its own `check` command.
Any other sign-in (Azure, Google Cloud, Firebase, a company tool) is declared once at the top of the stack and named by the apps that need it:

```json
"signIns": {
  "acme-dev": {
    "what": "Azure",
    "check": "az account get-access-token --tenant acme",
    "login": "az login --tenant acme",
    "env": { "AZURE_TENANT_ID": "acme" }
  }
},
"apps": { "orders": { "prereqs": [{ "signIn": "acme-dev" }] } }
```

- `check` succeeds while the sign-in holds. Koppler runs it before a run starts anything, and it is a command of the stack, so it runs only after `koppler doctor --approve`.
- `login` is what the user runs to sign in. Koppler shows it and never runs it.
- `env` is given to the app when Koppler starts it.
- Like `sso`, a sign-in belongs to one environment: each environment that needs one lists its own.
