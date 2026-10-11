# Koppler

Run the part of your stack you need on your own machine, without learning how each backend is run.

Pick apps on a canvas and plug cables between them, then press **Run**.
Koppler does the wiring, the tunnels, the local queues and the start order, and reverts all of it when you press Stop.
Everything you leave unplugged keeps calling the deployed environment you chose.

Koppler is for local development.
It helps most when you work on one app (a mobile app, a front end, one API) and need a few of its neighbours running next to it.

## How it works

- **A shared stack.** The team describes its apps once in a `stack.json` in a repo they share: what each app is, how it runs, what it calls, which queues it uses, which secrets it needs.
- **A board per person.** On the canvas each app is a card. A cable from one card to another means "this caller uses my local copy of that app". Presets load a usual setup in one click.
- **Run.** Koppler switches branches, points callers at the local apps, opens tunnels, starts local queues and starts the apps callees first, checking that each one answers.
- **Live cards.** Each card shows its steps, whether its port answers, and its log.
- **Stop and revert.** One click stops what Koppler started and undoes every temporary change. Apps you started yourself are left alone.
- **Secrets stay yours.** You store them in the macOS Keychain (on Linux, in files only you can read); Koppler starts an app with them and never shows them.

## Install

```bash
npm install -g koppler
koppler init
koppler canvas
```

`koppler init` finds your repos and your team's stack (or starts a new one), and `koppler canvas` opens the canvas in your browser.
[Getting started](docs/getting-started.md) walks through the first run.

Koppler is not on npm yet. Until it is, install it from a clone:

```bash
git clone https://github.com/evan-mcgeek/koppler.git
npm install -g ./koppler/app
```

## The agent add-on

Koppler works on its own.
With an AI agent it does more: you describe a setup in chat ("run the Orders API against my local Payments API"), the agent fills in what the stack is missing from the repos, takes notes like "use the test account" into a run, and explains and fixes what fails.

In Claude Code, add the plugin:

```
/plugin marketplace add evan-mcgeek/koppler
/plugin install koppler@koppler
```

Another agent that reads [Agent Skills](https://agentskills.io) can use [`plugin/skills/koppler-run`](plugin/skills/koppler-run) directly.
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

## Repository

| Folder | What |
|---|---|
| [`app/`](app) | The `koppler` package: the command, the engine, the canvas and its local server |
| [`plugin/`](plugin) | The agent add-on: a Claude Code plugin with the `koppler-run` skill |
| [`docs/`](docs) | User documentation |

Run the tests with `npm test` in `app/`.
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
