---
name: koppler-run
description: Use when the user wants to connect this Claude Code session to the Koppler canvas ("/koppler-run connect", "disconnect"), wants to report what went wrong with Koppler ("/koppler-run feedback"), or wants to run several apps or services of their stack locally, wired to each other, while the rest keeps calling a deployed environment, or says "koppler", "local stack", "run koppler with the X board", "run X locally against local Y", "point X at my local Y", or submits a graph from the Koppler canvas. In auto mode it applies the config changes and starts logins, tunnels and apps itself; in manual mode it hands over a per-app checklist. Not for deploying, debugging deployed services, or fetching secrets.
---

# Koppler

## Talking to the user on the canvas

When a run started from the canvas needs the user (a decision, something only they can do) or has finished or failed, also put it on the canvas, so it is seen there and not only in the chat:
`koppler say` with JSON on stdin: `{ "kind": "question" | "result" | "failure", "run": "<data.id of the run>", "title", "summary", "sections": [{ "title", "items": [...], "commands": [...] }], "choices": [{ "id", "label", "detail" }] }`.
Put anything the user has to run in a section's `commands`, never in `items`: the canvas shows each command in a box with a Copy button.
Short plain sentences; no Markdown, it is shown as text. The same question also goes in your chat reply.
An answer from the canvas arrives as a `koppler-reply` prompt (`data.message`, `data.choice` and its `label`, or `data.text`): act on it like the user's own reply. If the user answers in the chat instead, run `koppler say --answered <message id>` so the canvas stops asking.

## Connect and disconnect

When invoked with `connect` (or the user asks to connect this session to Koppler):
1. Make sure the canvas runs: `koppler status`; if `canvas` is not running, `koppler canvas`.
2. Start listening for the canvas's requests in this session (runs with a note, checklists, fixes, and what a run left over): `koppler listen take` with run_in_background and `timeout: 7200000`. `take` moves the connection here from any other session, which stops getting them. Its first line names this session (`connected as session <id>`); remember the id.
3. Run `koppler plan` and `koppler history`, then tell the user in a few lines: the canvas address (`<state>/canvas-url`), that this session now gets their runs, and any run already waiting (handle it as usual, starting with `koppler plan`).
4. **Always listen again.** `koppler listen` exits as soon as it hands over a prompt, and nothing reaches this session until it runs again. Start `koppler listen as <id>` (this session's id, never `take`) again before you end every turn that handled a prompt (a run, a Stop, an answer from the canvas, a "find the facts" request), and also when you stop early (blocked, failed, waiting for the user's answer in chat). Never end a turn without a listener running, unless the user asked to disconnect. If it exits 3, the user connected another session or disconnected this one: tell them this one no longer gets runs, and stop listening (only `connect` brings it back).
5. **Every request ends with `koppler history done` and the next listener**, runs or not. A request that is no run (filling in settings, an answer, a fix or facts request) is finished with `koppler history done` (no id) once you have acted on it: otherwise the canvas keeps showing the agent as working, and after ten minutes as quiet.
6. What the canvas shows: "Agent connected" while a listener runs; "Agent working, N min" from taking a prompt until `koppler history done` marks it done or failed; "Agent needs you" while a question of yours waits in the inbox; "Agent quiet, N min" once that has lasted over ten minutes; after that, with no listener, "No agent listening, N waiting", and the user's runs and Stops pile up unseen. So finish a run with `koppler history done` and the next listener together.

When invoked with `disconnect`: `koppler listen stop`, and say runs keep working without an agent, while notes, checklists and fixes wait until a session connects.

Compose a local run from a graph: nodes run locally, an edge points a caller at a local callee, every unwired dependency calls the deployed app of the chosen environment (the stack's `envs`).
Koppler is a separate app that works without an agent; this skill drives it. It needs the `koppler` command on the PATH (`npm i -g koppler`, or `npm link` in `app/` of a Koppler clone): when `koppler --version` fails, tell the user how to install it and stop.
A released skill has a `VERSION` file beside this one: when `koppler --version` names another version, tell the user both, and that the older one needs updating (`npm i -g koppler`, or `koppler@next` for the QA channel, and the plugin from the same channel).
`<app>` below means the Koppler app's folder, `"$(dirname "$(realpath "$(command -v koppler)")")/.."` (with `dist/` and `bin/`), and `<state>` Koppler's state folder, `~/.local/state/koppler/run` (the canvas, the agent and `koppler` share it).

## Operating principles

- **Facts come from the shared stack config**: `stack.json` in the stack folder set in `~/.config/koppler/config.json`, copied by `koppler sync` into `<state>/registry.json` (with its `source` path) for the canvas and scripts. Read the stack's `notes` first.
  Top-level app fields are the first env; for another env, each field in `apps[id].envs.<env>` replaces the top-level one (a list such as `prereqs` or `secrets` is replaced whole, never merged). Every sign-in, tunnel and hosts entry the first env has must be in that env's own list; `koppler doctor` reports a missing one as a gap, and Koppler never borrows another env's.
  **Never write `stack.json`, `registry.json` or any other Koppler JSON file yourself, not even one field.** Every change to the stack goes through `koppler stack set <path> <value>` / `koppler stack unset <path>` (`koppler stack get <path>` reads one), or `koppler add`/`remove` for whole apps; each change is checked before it is kept, and the stack reloads. A change no command can make is a Koppler gap: report it, never work around it.
  Never guess a missing fact: read the app's repo and set it with `koppler stack set`; that change is for the user to commit to the team repo, or, when they ask, to propose with `koppler stack propose` (a pull request with only those changes).
  No app is the center of a stack: an empty or missing `consumes` means its calls are not mapped yet, never that it calls nothing. A cable the user draws between apps the stack has no call for is marked `NEW` in the prompt: find in the caller's repo how it picks the callee's address (a setting, an env file, a constant), record it with `koppler stack set apps.<caller>.consumes.<callee> '{"how":...}'`, and ask when it cannot be told. Never state which apps call which from `stack.json` alone; `koppler sync` searches every clone for other apps' deployed hosts and prints `FOUND a -> b` for calls the stack misses (stored as `REGISTRY.found`, cable-able on the canvas), `UNKNOWN` for apps with no deployed address and `SHARED` for hosts it cannot attribute. Treat a found call like `how: unknown`; once confirmed, record it with `koppler stack set`. Apps with a `pending` field have name, kind and slug only; fill in `run`, `url`, `deployedUrl`, `baseProfile`, `project`, `launchSettings`, `prereqs` before use with `koppler stack set`, then `koppler stack unset apps.<id>.pending`.
- **Mode decides who acts** (a Send's `mode`: `auto`, or `manual` when the user picked "Get a checklist instead" in the Run menu; in chat, ask; default `auto`):
  - `auto`: apply the changes, start AWS logins, tunnels and apps yourself (tunnels and apps through `koppler run`), and verify each app answers with `koppler wait <apps> --healthy` (never a polling loop of your own). Log each change with `koppler actions add` before you make it (`references/action-log.md`). Report what ran.
  - `manual`: change nothing; hand over the per-app checklist and wait.
- **Always stop and ask, in both modes:** checking out a branch over uncommitted changes when the user has not chosen on the card how to treat them, anything that needs the user in a browser or terminal (SSO approval, sudo for `/etc/hosts`, secrets), and on `prod` before opening a DB tunnel or swapping secrets.
- **Never approve a stack's commands.** A stack can carry checks, start commands and code changes of its own; Koppler runs none until the user has reviewed them with `koppler doctor --approve` in their own terminal, and again after any of them changes. When a command says so, tell the user exactly that and stop: do not pass `--yes`, do not edit the approvals file, and do not start the app another way.
- **Never touch secrets.** The agent does not read, fetch, print or source secret values. See `references/secrets.md`.
- **Real clones, not worktrees**, so the IDE sees the changes. Never commit or discard on the user's behalf; stash only through `koppler switch --set-aside`, when the user chose it on the card.
- A `koppler-facts` prompt with `data.app` comes from "Ask the agent to fill in" in an app's settings: read that app's repo for each field under `EMPTY`, leave the ones that do not apply, never touch a field under `LOCKED` (a locked field, listed by `koppler stack locks`, refuses every change; only the user unlocks one, in their own terminal, so never run `koppler stack unlock`), propose what you would set and why, and after the user's yes set each with `koppler stack set apps.<app>.<field> <value>`.
- A `koppler-facts` prompt (or "find the PROD facts for <app>") lists what the stack is missing for an environment (`koppler doctor` reports them as `GAP`): a tunnel another environment has, or how to get a secret there. Read the app's repo (Terraform tfvars per environment, workflow files) and the user's local tunnel aliases (shell rc files); never read a secret value, and never copy another environment's host. Propose the additions (`apps.<id>.envs.<env>.prereqs`, `.secrets` with `fetch` steps for that environment's account) and make them with `koppler stack set` only after the user confirms. Until then `koppler plan` refuses that environment for the app.
- When the user raises a concern about the canvas ("this looked wrong", "it did X"), read `<state>/debug.jsonl` first: with Settings > Debug log on, it holds every click, change, shortcut, message and page error, each with a summary of the board. If it is empty, ask them to turn it on and repeat what happened.
- **Report every Koppler bug as a GitHub issue.** When something is wrong with Koppler itself (the command, the canvas, the engine, this skill or its docs), file it on `evan-mcgeek/koppler` with a reproduction, scrubbed logs (`koppler status --debug`) and a possible fix, after the user agrees to the draft. Never work around one silently. Something Koppler cannot do yet that the user wants is a feature request, filed the same way. Each goes on the project board (Bugs or Feature Requests) and moves to In Progress, Testing and Done as it is worked on. See `references/reporting-bugs.md`.
- Private findings and open questions go in `<state>/NOTES.md` (dated, one per line); facts about the apps go in the stack, through `koppler stack set`.

## Feedback

When invoked with `feedback` (or the user asks to report what went wrong with Koppler):
1. Gather the session: `koppler history session` prints what happened since the last finished Stop (failed and left-over runs, page errors, messages the user saw, buttons clicked over and over, error lines in app logs) and says where the files are. Add `koppler status --debug` and what you yourself hit in this session: a command that failed, a step you worked around, an instruction here that was wrong or missing.
2. Keep only problems with Koppler itself. What belongs to the user's own apps or to the stack's facts is left out: say so in one line and offer to fix the stack with `koppler stack set` as usual.
3. Show a table, one row per problem: what went wrong, the evidence (the file and line, or the message), and whether it is reported already (`gh issue list -R evan-mcgeek/koppler --state all --search "<a few words>"`). Ask which rows to report.
4. For each row the user picks, write one issue as `references/reporting-bugs.md` says, from scrubbed text only, and show it in full before it is filed. An existing issue gets a comment instead. Without `gh` or a GitHub login, give a prefilled link: `https://github.com/evan-mcgeek/koppler/issues/new?title=<title>&body=<body>`, both URL-encoded.
5. Reply with the links, and what the user can do until each is fixed.

The gathered files stay on the user's Mac: they have secrets masked but still name the user's apps. Nothing from them goes into an issue as is; an issue never holds a secret value or anything that names the user, their company or their stack.

## Session review (while Koppler itself is worked on)

When Koppler runs from its source folder (not an installed plugin), every session is recorded: the canvas debug log is always on, and each app's previous log is kept next to it (`<app>.log.history`) when it restarts.
A finished Stop and revert ends the session: `koppler history done` gathers it into `<state>/sessions/<stop id>/` (summary, runs, the user's clicks and the messages they saw, the agent's messages, Koppler's start logs, app logs, the canvas log) and queues a `koppler-review` prompt.
On that prompt:
1. Read `summary.md`, then the files it points at. Every problem the user ran into counts: failed or left-over runs, page errors, warnings they saw, buttons clicked over and over, questions you had to ask, error lines in app logs.
2. For each one, find the cause in Koppler (engine, canvas, skill) and reproduce it the way the user hit it. File it as an issue (`references/reporting-bugs.md`), then fix it on a branch whose commits name the issue, and verify (tests, and a throwaway canvas for UI). Problems in the user's own app repos or the stack's facts are not fixed silently: list them with what you would change, and ask.
3. Report one line per problem: what happened, the issue, the cause, the fix, how it was verified; and what you left for the user.
4. Start `koppler listen as <id>` again, as after every prompt.

## Routing

| Step | What | Where |
|---|---|---|
| 0 | What the stack needs on this Mac: `koppler doctor` (also run by every `koppler sync`, and shown on the canvas). Stop on `MISSING` and give the user the fix it prints. `PENDING` is a check written into the stack that waits for approval: tell the user to run `koppler doctor --approve` in their own terminal; never approve it for them. | inline |
| 0a | Several stacks: `koppler use` lists every one on this Mac (shared in cloned repos, private in `~/.config/koppler/stacks`); `koppler use <name or folder>` switches, and the canvas has the same switcher next to the name. Each stack keeps its own board, presets, history, live state and action log. Only one is in use at a time | inline |
| 0a2 | A stack linked from GitHub (`koppler link <url>`, or a link on the canvas) is a local copy in `~/.config/koppler/stacks/`: set the facts you learn with `koppler stack set` as usual. They show as changes not in the shared stack yet (`koppler link`). Opening a pull request with them (`koppler link pr`) pushes to the team's repo, so do it only when the user asks for it; never `discard` without being asked | inline |
| 0b | Stack and clones: `koppler sync` before every canvas open (reloads the stack, reads each clone's branch and changes; `--rescan` after the user clones something). With no config yet, `koppler init` once: it scans the user's repo folders (any git host) and finds `stack.json` files; if it finds several or none, ask which stack to use and rerun with `--stack <dir>`. Which clones belong to the stack is the user's choice, made on the canvas: `koppler init --pick` (automatic on a stack with no apps) opens the repo picker, and "Add repos" above the Apps list opens it later. Never add an app to `stack.json` that the user did not pick. | inline |
| 0c | Stack format, adding or fixing an app's facts. `koppler discover` (also the last step of `koppler init` once the stack has apps) first fetches every clone and fast-forwards a clean branch that is only behind (uncommitted or diverged work is reported, never touched; `--no-fetch` skips this), then reports every app's local ports, tunnels, calls, port conflicts and gaps against `stack.json`, with suggestions in `<state>/stack.suggestions.json`; check them in the repo before adding them to `stack.json`. `koppler discover --deployed` drafts each app's deployed address, settings, secret names and calls from the Terraform in its clone (and a SAM app's domains from its `samconfig.toml`) (names and plain addresses only), and the queues and topics between apps (who sends, who reads, what feeds them, which other clones name them) into `<state>/stack.deployed.json` (`queueSuggestions`) | `references/stack.md` |
| 0c2 | An app the stack does not have yet: `koppler add <repo or folder>` (from the user's clones), then fill in its facts with `koppler discover`; `koppler remove <app>` takes one out. An outside system (SaaS, payment provider, a webhook sender): `koppler add --outside "<name>" --called-by <app,...> --sends-to <app,...> [--url <address>] [--why "<why>"]` | inline |
| 0d | A stack from a description (words or a diagram): find each named app (`koppler discover --find`), confirm facts from the repos, propose the stack additions and a board, make them with `koppler stack set` after a yes | `references/research.md` |
| 1 | Get the graph: from chat, or the canvas (below). A saved board or team preset runs in one go: `koppler up --board "<name>"` (`koppler use --boards` lists them) | inline |
| 2 | Per app: branch, wiring overrides, temporary edits (`koppler recipes --apply` first: remembered changes) | `references/preparing-nodes.md` |
| 3 | Per app: prerequisites (AWS SSO, tunnels, hosts, dev certs, files) | `references/preparing-nodes.md` |
| 3b | What the user has to do (AWS sign-in, hosts entries, the HTTPS certificate, secrets, `sudo` steps): `koppler doctor <every local app> --env <env>` checks each one live and words it for someone who never ran the backend. Hand the user exactly its numbered steps (secrets in their own terminal, never with `!`); with `--json`, put them on the cards as `user` steps with `copy` | `references/secrets.md` |
| 4 | Run (auto) or checklist (manual) | inline |
| 4a | Something does not answer: `koppler logs <name>` (secrets masked, `-f` follows), and `koppler doctor --flow` tests every connection of what runs, like the canvas's Flow check. To see where one request failed across the apps, `koppler traces start`, restart the apps involved, repeat the request, then `koppler traces open <app>` | inline |
| 4b | Canvas open (`koppler canvas`): keep each card's checklist current with `koppler status step <app> "<label>" <state>`, so it shows what is done, what waits for the user and what failed | `references/status.md` |
| 5 | Stop and revert: Koppler does it (`koppler down`); you only finish what it left (canvas button, tag `koppler-stop`, or asked in chat) | `references/action-log.md` |
| 6 | What a run will do, and marking it done: `koppler plan`, `koppler history done`, `koppler history` | inline, section 1 |

## 1. Canvas

Open it with `koppler canvas` (starts it when needed and opens it; the address stays the same across restarts), then `koppler listen as <id>` (run_in_background; it exits with the prompts as JSON lines; start it again after each).
The user answers on the canvas (its inbox) or in the chat.

**Nothing happens that the user has not seen and confirmed.** Before a run or a Stop leaves the canvas, a review lists what it will start, restart, stop and revert, and keep running, compared with what is running now; the confirmed plan comes with the prompt (`data.plan`, `PLAN` lines in the text).
- A prompt's `waited` is how many minutes it sat in the queue before you got it; only the newest run or Stop is handed over, older ones are already marked replaced. Over 5 minutes, tell the user what it is and how old it is, and ask before applying it.
- First run `koppler plan`: it works the plan out again against what is really running. If it says `DIFFERS`, things changed since the user confirmed: tell them what differs and ask before doing anything.
- Do exactly the plan: `STOP AND REVERT` apps are stopped and only their own changes reverted (their action-log entries, and the tunnels nothing else needs); `RESTART` apps are rewired and restarted for the listed reason; `START` apps are started; `KEEP RUNNING` apps are not touched, not even restarted.
- Anything the plan does not list (another app, another branch, another environment, a restart to fix something) needs the user's yes first.
- `koppler history done` only after every `START` and `RESTART` line really happened and each app answers; if you skipped or could not do one, it is `koppler history done --failed "<which and why>"`, never plain `koppler history done`.
- Check before you explain: when a result looks wrong (an empty query, an unexpected value), verify the cause (the data, the currency, the filters) before blaming the tunnel, the environment or the user's setup.
- When done: `koppler history done` (or `koppler history done --failed "<what went wrong, in plain words>"`). After a Stop and revert: `koppler history done <id>` with the prompt's `data.id`. That board becomes the live state the next plan is compared with, and the run shows as Done or Failed in the canvas History.
- A Stop whose `data.switchTo` is set comes from switching stacks on the canvas: stop and revert as usual, `koppler history done <id>`, then `koppler use "<switchTo>"`. The canvas then loads that stack by itself. `koppler use` refuses while anything is still running.
- A newer run replaces one you have not started; if one arrives while you work, finish the step in progress, then run `koppler plan` again.

Either returns a `koppler` prompt whose `data` is `{ env, mode, note?, nodes: [{id, branch, run, platform?, tunnels?, changes?, note?}], edges: [{from, to}], deployed: [{from, to}], queues?: {<queue>: 'local'}, layout }`; the canvas server keeps the layout itself. A `koppler-stop` prompt means stop and revert.
A `koppler-fix` prompt comes from the canvas's Flow check: `data.failures` lists each failed connection (`connection`, `result`, `detail`, and the ids it was tested with). Find the cause of each in the logs, the launch profiles and `koppler doctor`, tell the user what you would change with `koppler say`, and ask before starting, stopping or restarting anything; it confirms no plan by itself.
`tunnels: false` means the user wants only that app's API: open none of its tunnels, add no hosts entries for them, leave it out of `koppler plan`, pass it to `koppler doctor` with `--no-tunnels <id>`, and start the app anyway.
`note` is the user's own instruction, for the whole run or for one app (e.g. a feature flag, a test account, an extra env var): apply it like the stack's facts, record any change it causes in the action log so it is reverted too, and ask when it is unclear or conflicts with the stack.
`run` is `cli`, `ide` or `mock` (Koppler answers the app's `mock` responses from the stack in its place: nothing to prepare for it, and its callers are wired to it like to a local app); a mobile app node with `run: cli` also carries `platform`: `ios` (simulator), `android` (emulator) or `phone` (a connected phone on the same Wi-Fi; its callees run with `--lan`). With `ide` the device is picked in the IDE, so ask which one before wiring the mobile app.
Apps not cloned are greyed out; `koppler sync` prints the clone command. Ask before cloning.
Boards: the canvas always shows one board, saved as the user changes it; the selector switches between the user's boards and the team boards (the stack's `presets`). A team board the user changes becomes their own copy. When the user asks for a usual setup, suggest the matching board.
To change a board ("trim it to the apps in flow X", "add the apps that call Y"), use `koppler board edit "<name>" --add <app,...> --remove <app,...> --cable <caller>:<callee> --uncable <caller>:<callee> --branch <app>=<branch> --note <app>="<note>"`, never `state.json` or a board file: an open canvas makes the change and shows it, and the cards it does not touch keep their places. A team board changed this way becomes the user's own copy. A board that does not exist yet is made with `koppler board new "<name>"`, which takes the same `--add`, `--cable`, `--branch` and `--note`. When the change is your own idea rather than something the user asked for, add `--propose`: nothing changes until the user says yes in the canvas inbox, and their answer comes back as a `koppler-reply` prompt. Add `--arrange` whenever the change adds apps or cables, so the board is laid out as Arrange does instead of the new cards being put beside the others; leave it off only when the user has placed the cards by hand.
Whenever you make, change, share or run a board from the chat (`koppler board new`, `edit`, `share`, `koppler up --board`) and the user did not open it on the canvas themselves, end with `koppler canvas --board "<name>"`, every time, so they see the result.
After changing the stack, clones or anything else the canvas shows from outside it, run `koppler refresh`: it syncs, and an open canvas reads the stack and its board again without reloading the page.

## 4. Run or checklist

**Koppler starts a confirmed run itself.** On an auto run from the canvas, the canvas server runs `koppler up --run <id>`: stops and restarts from the plan, branches as chosen on the cards (`koppler switch`), remembered changes (`koppler recipes --apply`), each cable's local address passed to its caller at start, tunnels, queues switched to local (an AWS emulator, `references/stack.md`), then apps callees first, each waited for; then it marks the run done.
You get the run only when Koppler could not do all of it (the prompt says what it did and what is left, `data.koppler`), when it has a note, or when it is a checklist. Then do only what is left: never restart what Koppler already started, and finish with `koppler history done`.
A cable left for you ("point it at ...") means its caller is not started yet: make the change, log it (`references/action-log.md`), then run the same `koppler up --run <id>` again, which starts the caller and marks the run done.
To check data (after a fix, for a report), propose `koppler query <app> --env <env> "<one SQL statement>"`: read-only, the stored connection, rows only. On PROD the user runs it in their own terminal and tells you what matters; never run it yourself there, the rows are production data.
Allowing the safe `koppler` commands without prompts: `references/permissions.md`.
When the user asks in chat, start with `koppler up <apps> --cable <caller>:<callee>... --env <env>` too: one `--cable` per call that should reach a local app. It is recorded like Run on the canvas and added to what already runs on that environment, so the canvas, the history and Stop all see it. A single `koppler run <app>` is not part of any run; the canvas shows it as running outside a run, so use it only for one-off commands, never to start a board. If you are blocked from starting something (auto mode, PROD), never hand over a list of commands: point the user to press Run on the canvas, or give the single `koppler up <apps> --env <env>` line.

### A board asked for in chat

A sentence such as "run koppler on qa with the checkout board" names a board, and often an environment or another task next to it.
1. Find the board: `koppler use --boards`, matched loosely on the name (a typo or a part of it is fine). With several matches or none, list them and ask.
2. Start it: `koppler up --board "<name>" --env <env>` (without `--env`, the stack's first environment).
3. Open it: `koppler canvas --board "<name>"`, every time, also when the canvas already runs. It opens that board in the browser.
4. Paste the canvas address (`<state>/canvas-url`) in the chat reply as a link, next to what is running.

Do steps 3 and 4 even when step 2 is blocked or fails, so the user can press Run on the board themselves.

Order callees before callers (topological over edges); cycles are fine, start either.
Shared prerequisites first: AWS logins, then tunnels, then apps in order.
Plan tunnels with `koppler plan <every local app> --env <env>` and follow it: one tunnel per host and port (apps share it); a moved tunnel runs on its new port, and `koppler up` starts its apps with the new address (for an app started from the IDE, its `env` setting goes into the app's `-LOCAL` profile; log it as a profile change); a tunnel on a loopback alias needs the user to run the printed `sudo` commands first.

- `auto`: start tunnels and apps with `koppler`. Its processes are detached: they outlive agent background-job limits and Claude Code restarts, log where the canvas reads, and stop by name.
  - Stack apps of any kind: `koppler run <app> [--env <env>] [--device ios|android|phone|<id>]` (each kind has its own rules): .NET runs its `-LOCAL` profile; Flutter builds and launches on the device, keeps its log on the card and closes the app on stop; Node and web front ends run `npm run` of their `script` (else `dev` or `start`), with the framework's default port and, with `--lan`, its own host flag. It loads the app's stored secrets (the only way the agent may start an app with them; never `with-secrets`, which stays denied), first tests each one against its own address (so open tunnels before apps; on a production env add `--test` only when the user agreed to the extra Keychain prompt), and refuses a port that is already held. `--dry-run` prints the command without starting it, e.g. for a manual-mode checklist.
  - Anything else: `koppler run <app or tunnel name> [--cwd <repo>] [--port <p>] [--bind <address>] [--restart] -- <command>`; an arbitrary command never gets secrets. Use `--restart` for tunnels, and `--bind` for one that keeps its port on its own address (`koppler plan` prints it).
  Wait for each app's `url` to answer (or a startup error in its log) before the next. An `ide` node still runs from the CLI unless the user said they start it in the IDE.
  A Flutter app the user starts from the IDE still gets its log on the card: `koppler run <app> --cwd <repo> --restart -- fvm flutter logs -d <device id>` (`references/status.md`).
  When `koppler run` reports a held port: if it is the same app (same repo binary, expected `LAUNCH_PROFILE`/env, e.g. started from Rider), reuse it; if it is anything else, ask before stopping it.
- `manual`: the checklist below, one block per app.

Logins open the browser: run `aws sso login --profile <p>` in the background and poll `aws sts get-caller-identity --profile <p>` until it passes.
Only short waits stay agent background jobs (`aws sso login`, `koppler listen`, with `timeout: 7200000`); never start a tunnel or app that way.

## Output format

Start with one stack line (env, mode, local apps, what stays deployed), then one block per app in start order:

```
### <App name>  (<repo path>, <branch>)
- [ ] Changes: <diff or "none"> (<profile>)
- [ ] Prerequisites: <each login / tunnel / hosts / cert / secret, with status>
- [ ] Start: <command or IDE profile> → <url>
- [ ] Check: <url> answers
```

In `auto`, tick what you did and leave unticked only what needs the user. End with `koppler status` (what is running, ports) and how to stop it (`koppler stop <name>`, or Stop and revert).
