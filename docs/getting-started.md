# Getting started

## 1. Install

```bash
npm install -g koppler
```

Koppler needs macOS or Linux, git and Node 22 or newer.
Until it is on npm, install it from a clone: `npm install -g ./koppler/app`.
The [agent add-on](../README.md#the-agent-add-on) is optional.

## 2. Find your repos and a stack

```bash
koppler init
```

`init` scans your usual code folders (`~/development`, `~/src`, `~/code`, ...) for git repos on any host and looks for `stack.json` files in them.

- **One stack found:** it is used.
- **Several found:** pick one with `koppler init --stack <folder>`.
- **Your team shares one on GitHub:** `koppler link <GitHub link to the stack.json>` uses it straight from there.
- **None yet:** start one with `koppler init --new "Shop" --envs qa,prod`, then pick its apps from your repos on the canvas.

Once the stack has apps, `init` ends with `koppler discover`, which reads every app's repo and reports local ports, tunnels, calls and gaps in the stack.
`koppler discover --deployed` drafts deployed addresses, settings, secret names, queues and calls from each repo's infrastructure code.
The agent checks those drafts in the repos before adding them to `stack.json`.
The stack lives in your team's repo, so changes to it are yours to review and commit.

## 3. Check your machine

```bash
koppler doctor
```

It lists the tools your stack needs (the .NET SDK, Flutter, Docker, the AWS CLI, ...) and what is missing.
It also runs whenever a stack loads, and the canvas shows anything missing.

## 4. Open the canvas

```bash
koppler canvas
```

It starts the canvas server when needed and opens it in your browser.
The agent chip in the toolbar shows whether an agent session is connected; you only need one for notes, checklists and fixes.

<img alt="One feature, Checkout, worked on across four apps: the mobile app and web shop cabled to a local Orders API, which calls a local Payments API; each runs its feature/checkout branch, Orders API has a database tunnel and a local SQS queue, two apps carry a note for the agent, and everything runs" src="images/board.png">

## 5. Your first run

1. Drag the apps you need from the Apps list onto the board, or load a preset.
2. Plug a cable from a caller to each app it should call locally. Unplugged calls keep going to the deployed environment.
3. Pick the environment (QA, PROD, ...).
4. Press **Run**.

Koppler shows the plan: what it starts, restarts and stops, and what you have to do first (a sign-in, a secret, a `sudo` step).
Things only you can do, such as storing a secret, are steps you copy into your own terminal.
Once you confirm, each card shows its progress, whether its port answers, and its log.

Press **Stop** to stop everything Koppler started and undo every temporary change.

## Next

- [The canvas](canvas.md) in detail.
- [Secrets and safety](security.md) before you store your first secret.
- [Stack format](../plugin/skills/koppler-run/references/stack.md) to describe your apps.
