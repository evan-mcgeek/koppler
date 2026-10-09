# App kinds

Every app in the stack has a `kind`.
It says how Koppler recognises the repo, how `koppler run <app>` starts it, and how a cable passes it a local address.
`koppler add` and `koppler discover` pick the kind from the repo's files; you can always set it by hand in `stack.json`.

Each kind is marked:

- **Run for real:** used daily on real stacks.
- **Recognised:** Koppler detects the repo and knows the usual start command and port, but it has seen little real use yet. Please [report](https://github.com/evan-mcgeek/koppler/issues/new?template=bug_report.md) what does not work.

Any app can also be started by you, from your IDE: set **Started by: Me** on its card.
Koppler then wires it the same way and watches its port, but leaves starting and stopping to you.

## Back ends and APIs

| Stack | Kind | Recognised by | Started with | |
|---|---|---|---|---|
| .NET (ASP.NET Core, workers) | `dotnet` | a `.csproj` | its `-LOCAL` launch profile, derived from the base profile with local addresses swapped in | Run for real |
| Node (Express, NestJS, Fastify, any npm script) | `node` | `package.json` without a front-end framework | `npm run` of its `script`, else `dev` or `start` | Run for real |
| Go | `go` | `go.mod` | `go run .`, or `go run ./cmd/<name>` when there is one command | Recognised |
| Rust | `rust` | `Cargo.toml` | `cargo run` | Recognised |
| Java and Kotlin (Spring Boot, Gradle, Maven) | `java` | `pom.xml` or `build.gradle(.kts)` | `mvn spring-boot:run` or `gradle bootRun` (wrappers first), port 8080 | Recognised |
| Python (Django, FastAPI, Flask) | `python` | `manage.py`, `pyproject.toml`, `requirements.txt` or `Pipfile` | `manage.py runserver`, `uvicorn <module>:app` or `flask run`, through uv, Poetry, Pipenv or the repo's `.venv` | Recognised |
| Ruby on Rails | `ruby` | `Gemfile` with `config/application.rb` | `bin/rails server`, port 3000 | Recognised |
| PHP (Laravel) | `php` | `artisan` or `composer.json` | `php artisan serve`, port 8000 | Recognised |

Local addresses reach a back end as environment variables, named per cable in `stack.json`; for .NET they go into the `-LOCAL` launch profile.

## Web front ends

| Framework | Kind | Dev server port | |
|---|---|---|---|
| Vite (React, Vue, Svelte, Solid, ...) | `web` | 5173 | Run for real |
| Next.js | `web` | 3000 | Recognised |
| Angular | `web` | 4200 | Recognised |
| Create React App | `web` | 3000 | Recognised |

A `web` app is started with `npm run` like a Node app and opened in the browser.
A local address is passed with the prefix the framework needs for browser code (`VITE_`, `NEXT_PUBLIC_`, `REACT_APP_`), or written to the git-ignored `.env.local`.
Koppler also checks what a browser needs on the other side: the API must allow the front end's origin (CORS), and an https page cannot call an http API.
Other front-end dev servers (Nuxt, Remix, Astro, ...) run as `node` apps through their npm script.

## Mobile

| Stack | Kind | Runs on | |
|---|---|---|---|
| Flutter | `flutter` | iOS simulator, Android emulator, or a phone on the same Wi-Fi (through `fvm`) | Run for real |
| React Native and Expo | `reactnative` | iOS simulator or Android emulator (`npx expo start`, `npx react-native run-ios`) | Recognised |
| Native iOS (Swift) and Android (Kotlin) | none yet | started by you from Xcode or Android Studio | Not covered |

A simulator reaches your Mac's local apps at `localhost`, the Android emulator at `10.0.2.2`, and a phone at your Mac's address on the network, with the apps it calls opened to the network (`koppler run <app> --lan`).
Koppler works out that address per device for Flutter and React Native; for a native app, set it in your project the same way.

## Serverless and cloud

| Stack | Kind | Started with | Needs | |
|---|---|---|---|---|
| AWS Lambda, queue-triggered | `lambda` | the function in its real runtime image, its queue in a local AWS emulator, and a local address callers post to | Docker, the AWS CLI | Run for real (.NET) |
| AWS SAM | `sam` | `sam build`, then `sam local start-api`, with the environment's deploy parameters from `samconfig.toml` | Docker, the SAM CLI | Run for real |

A SAM app serves its API functions; functions triggered by queues, schedules or streams are listed in its log, not run.

## Containers

| Stack | Kind | Started with | |
|---|---|---|---|
| Docker Compose | `compose` | `docker compose up`, stopped with `docker compose down` | Recognised |

Compose is checked last: many repos have a compose file only for their database.

## Anything else

- **`other`:** any app, started by the command in its `start` field.
- **Your own kinds:** a stack can define kinds for a technology Koppler has no recipe for: the files that recognise it, its start command and its port. See `kinds` in the [stack format](../plugin/skills/koppler-run/references/stack.md).
- **Outside systems** (`outside`): things the apps call that never run locally, such as Salesforce or a SaaS API. They show as dashed cards and always use the deployed environment.

## What every run gets

- **Local addresses** for every cable, in the way the kind takes settings.
- **Secrets** from the Keychain, loaded into that process only.
- **Tunnels** to deployed databases and services, opened first.
- **Local queues**, when switched on: an SQS emulator or a Kafka broker in Docker. SNS and EventBridge stay deployed.
- **Local libraries**, linked for the run: `pubspec_overrides.yaml` for Dart and Flutter, `npm install --no-save` for npm. Nothing tracked changes, and Stop puts the published packages back.

See the [project board](https://github.com/users/evan-mcgeek/projects/2) for what is planned.
