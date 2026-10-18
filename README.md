# Koppler

Run the part of your stack you need on your own machine, without learning how each backend is run.

Pick apps on a canvas and plug cables between them, then press **Run**.
Koppler does the wiring, the tunnels, the local queues and the start order, and reverts all of it when you press Stop.
Everything you leave unplugged keeps calling the deployed environment you chose.

Koppler is for local development.
It helps most when you work on one app (a mobile app, a front end, one API) and need a few of its neighbours running next to it.

<img alt="One feature, Checkout, worked on across four apps: the mobile app and web shop cabled to a local Orders API, which calls a local Payments API; each runs its feature/checkout branch, Orders API has a database tunnel and a local SQS queue, two apps carry a note for the agent, and everything runs" src="docs/images/board.png">

## How it works

- **A shared stack.** The team describes its apps once in a `stack.json` in a repo they share: what each app is, how it runs, what it calls, which queues it uses, which secrets it needs.
- **A board per person.** On the canvas each app is a card. A cable from one card to another means "this caller uses my local copy of that app". Team boards load a usual setup in one click.
- **Run.** Koppler switches branches, points callers at the local apps, opens tunnels, starts local queues and starts the apps callees first, checking that each one answers. Before anything starts, a review lists what will start, what keeps calling the deployed environment and which tunnels open.
- **Live cards.** Each card shows its steps, whether its port answers, and its log.
- **Settings, not JSON.** Every fact of the stack is edited in the canvas's settings or with `koppler stack set`, checked before it is kept; a lock keeps a field as it is. Nobody edits `stack.json` by hand.
- **Stop and revert.** One click stops what Koppler started and undoes every temporary change. Apps you started yourself are left alone.
- **Secrets stay yours.** You store them in the macOS Keychain (on Linux, in files only you can read); Koppler starts an app with them and never shows them.

<img alt="The review before a Run on QA: the four apps that start on feature/checkout with their notes for the agent, what keeps calling deployed QA, and the tunnel that opens" src="docs/images/review.png" width="520">

## Install

```bash
npm install -g koppler
koppler init
koppler canvas
```

`koppler init` finds your repos and your team's stack (or starts a new one), and `koppler canvas` opens the canvas in your browser.
[Getting started](docs/getting-started.md) walks through the first run.

## The agent add-on

Koppler works on its own.
With an AI agent it does more: you describe a setup in chat ("run the Orders API against my local Payments API"), the agent fills in what the stack is missing from the repos, takes notes like "use the test account" into a run, and explains and fixes what fails.

In Claude Code, add the plugin:

```
/plugin marketplace add evan-mcgeek/koppler
/plugin install koppler@koppler
```

For any other agent (GitHub Copilot CLI, VS Code, OpenCode), or Claude Code without the plugin, run `koppler agent init`.
It links the [skill](plugin/skills/koppler-run) into each agent it finds and registers `koppler mcp`, its MCP server.
Either way, the agent drives the `koppler` command, so install the app first.

## Requirements

- macOS (secrets live in the Keychain) or Linux (secrets live in private files, without the per-read prompt; see [security](docs/security.md)).
- git and Node 22 or newer.

Everything else depends on your stack (the .NET SDK, Flutter, Docker, the AWS CLI, ...).
`koppler doctor` lists what your stack needs on your machine and what is missing.

## Documentation

- [Getting started](docs/getting-started.md): install, the first stack, the first run.
- [The canvas](docs/canvas.md): boards, cables, queues, environments, Run and Stop.
- [App kinds](docs/app-kinds.md): what Koppler can run and how.
- [Secrets and safety](docs/security.md): how secrets are kept, and what an agent may and may not do.
- [Commands](docs/commands.md): every `koppler` command.
- [Stack format](plugin/skills/koppler-run/references/stack.md): the `stack.json` reference.
- [Releasing](docs/releasing.md): how a version tag publishes Koppler to npm.

## Repository

| Folder | What |
|---|---|
| [`app/`](app) | The `koppler` package: the command, the engine, the canvas and its local server |
| [`plugin/`](plugin) | The agent add-on: a Claude Code plugin with the `koppler-run` skill |
| [`docs/`](docs) | User documentation |

Koppler runs from `app/dist/`, which `npm run build` makes from `app/src/` (`npm install` first).
While working on Koppler itself, link `app/scripts/koppler-dev.mjs` as `koppler`: it rebuilds when the source is newer, then runs the build.
Run the tests with `npm test` in `app/`; unit tests sit next to their module as `<name>.test.ts`.
The documentation's screenshots come from `npm run screenshots` in `app/`: it drives the canvas on a demo stack and writes `docs/images/`.
The canvas has tests of its own that drive it in a browser: `npm install`, `npx playwright install chromium` once, then `npm run test:canvas`.
`npm run lint`, `npm run types` and `npm run format:check` are what CI checks besides the tests; `npm run format` formats.

## Reporting bugs

Open an [issue](https://github.com/evan-mcgeek/koppler/issues/new?template=bug_report.md) with the steps to reproduce, the logs and, if you have one, an idea for the fix.
`koppler status --debug [app...]` gives versions and recent logs with secrets and company names taken out, ready to paste.
With the add-on, the agent does the same on its own: when it finds a bug in Koppler, it drafts the issue and files it once you agree.

## Status

Early.
Used daily on .NET, Flutter, Node and AWS (Lambda, SAM, SQS, Kafka) apps behind Cloudflare tunnels, on macOS.
See the [project board](https://github.com/users/evan-mcgeek/projects/2) for what is next.

## License

[MIT](LICENSE)
