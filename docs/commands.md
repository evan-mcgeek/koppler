# Commands

Apps and tunnels that `koppler` starts run detached, so they keep running after the terminal or agent session that started them ends.
`koppler --help` lists every command, and `koppler help <command>` or `koppler <command> --help` shows its options and an example.

## For you

| Command | What it does |
|---|---|
| `koppler init [--new "<name>" --envs qa,prod] [--root <dir>]... [--stack <dir>] [--pick] [--no-fetch]` | Find your repos and the stack, or start a new stack and pick its apps |
| `koppler canvas [start] [--board "<name>"] [--no-open] \| stop` | Start the canvas if needed and open it in your browser, on a board when one is named; `stop` stops it |
| `koppler use [stack] [--boards]` | List the stacks on this machine (`*` marks the one in use), switch to one, or list its boards |
| `koppler link [<url> \| update \| discard \| pr]` | Use a stack shared on GitHub; then bring in its changes, drop yours, or open a pull request with yours |
| `koppler doctor [app...] [--env <env>] [--no-tunnels <app,...>]` | Can it run here: the tools your stack needs, then what you still have to do for these apps |
| `koppler doctor --secrets [app...]` | Also test that each stored secret works, for example that the database connects |
| `koppler doctor --flow` | Test every connection of what runs now, like the canvas's Flow check |
| `koppler doctor --approve` | Review everything the stack would run or write (checks, start commands, code changes) and allow it; asks you, never a script |
| `koppler secret set\|list\|remove\|psql <app>[@<env>] [<NAME>] [--stdin] [--pgpass]` | Store and manage secrets; a value never shows. `psql` opens the database with the stored connection |
| `koppler status [--apps] [--debug [name...]]` | What Koppler runs; `--apps` adds the stack's apps and clones; `--debug` gives versions and scrubbed logs for a bug report |
| `koppler logs <name> [-f] [-n <lines>]` | Show or follow a log, secrets masked |
| `koppler stop <name...> \| --all` | Stop by name, or every app and tunnel (asks first); changes stay until `koppler down` |
| `koppler history [session \| done [<id>] [--failed "<why>"]]` | Recent runs and Stops and how they ended; `session` gathers what happened since the last Stop, for a bug report; `done` marks a run finished |
| `koppler query <app> [--env <env>] [--secret <NAME>] "<sql>"` | A read-only query with the app's stored connection; on production, in your own terminal only |

## Used by the agent add-on

You can run these yourself too; the agent uses them to do its part.

| Command | What it does |
|---|---|
| `koppler sync [--stack <dir>] [--rescan]` | Reload the stack and your clones |
| `koppler discover [app...] [--no-fetch] [--no-github]` | What the repos say: local ports, tunnels, calls, conflicts and gaps, then what could be added to `stack.json` |
| `koppler discover --deployed` | Also draft deployed addresses, settings, secret names, queues and calls from the infrastructure code |
| `koppler discover --apply` | Keep the agreed findings in the stack |
| `koppler discover --find "<name,...>"` | The repos behind names in a description: the stack, your clones, your GitHub orgs |
| `koppler add <repo or folder>...` / `koppler remove <app>` | Add apps to the stack from your clones, or take one out |
| `koppler add --outside "<name>" [--called-by <app,...>] [--sends-to <app,...>] [--url <address>] [--why "<why>"]` | Add a system that never runs here (a SaaS API, a payment provider): the apps that call it, and the apps it calls (a webhook). The canvas has the same under "Add outside system…" |
| `koppler plan [app...] [--env <env>]` | What the newest run starts, restarts and stops; with apps, the tunnels they need |
| `koppler plan --wire <caller> <callee> [--device ios\|android\|phone\|<id>]` | What to change so a caller uses a local app |
| `koppler up <app...> [--cable <caller>:<callee>]... [--env <env>]` | Start apps as a run, added to what already runs: recorded like Run on the canvas, so the canvas, history and Stop see it |
| `koppler up --board "<name>" [--env <env>] \| --run <id>` | Start a saved board, or a recorded run: tunnels, local queues, then apps, callees first, each waited for |
| `koppler down [--run <stop id>]` | Stop and revert: stop what Koppler runs, undo every change, put branches back |
| `koppler run <app> [--env <env>] [--device ios\|android\|phone\|<id>] [--lan] [--no-test] [--dry-run]` | Start one stack app, any kind. `--no-test` skips the check that its stored secrets work |
| `koppler run <name> [--cwd <dir>] [--port <n>] [--bind <address>] [--ready <url>] [--restart] -- <command...>` | Start any command, detached and logged; it never gets secrets. `--bind` says which local address it listens on, when two share a port |
| `koppler switch <app> <branch> [--set-aside \| --take-along]` | Switch a clone to the board's branch; `--back` undoes it |
| `koppler recipes [app] \| --remember <app> --why "..." [--when ...] [--any-os] [--private] \| --apply <app...> [--env <env>]` | Remembered code changes: list them, keep the last edit, apply the matching ones. A stack's own are applied only after `koppler doctor --approve` |
| `koppler listen take \| as <id> \| stop` | Wait for requests from the canvas; one agent session at a time |
| `koppler board new "<name>" [--add <app,...>] [--cable <caller>:<callee>]...` | Make a board of your own, with its apps and cables; an open canvas adds it to your boards |
| `koppler board edit "<name>" [--add <app,...>] [--remove <app,...>] [--cable <caller>:<callee>]... [--uncable <caller>:<callee>]... [--branch <app>=<branch>]... [--note <app>="<note>"]...` | Change a board, even one open on the canvas: the canvas shows the change and keeps it; cards it does not touch stay put |
| `koppler stack get [<path>]` \| `set <path> <value>` \| `unset <path>` | Read or change any field of the stack, such as `apps.orders.url` or `apps.orders.envs.prod.prereqs`; each change is checked before it is kept. With the canvas's settings, the only way to change `stack.json` |
| `koppler stack lock <path>` \| `unlock <path>` \| `locks` | `lock` keeps a field as it is for commands, the canvas and the agent; `unlock` asks you in the terminal, so an agent cannot; `locks` lists them |
| `koppler actions [--json]` \| `add '<json>'` \| `add --file <json file>` \| `clear [--app <app>]` | The action log: every temporary change, which Stop undoes. `add` logs a change before it is made (checked, never a secret value); `clear` empties it after a revert. The only way to write it |
| `koppler status step <app> "<label>" done\|todo\|user\|failed [--detail "..."] [--copy "..."] [--port <n>] [--log <file>]` \| `step <app> --clear` | Set one step of an app's checklist on its card, or take the agent's steps off |
| `koppler say [--file <json>]` \| `--answered <id> [--text "..."]` | Show a question or result on the canvas, with choices to press; `--answered` closes one that was answered in the chat |

## Conventions

- `koppler --version` prints the version, or the commit when Koppler runs from a clone.
- Commands that report something take `--json` for scripts and agents.
- Commands that stop everything ask first; in a script, add `--yes`.
- Exit codes: 0 done, 1 failed, 2 wrong usage.

## Environment

| Variable | Default | What |
|---|---|---|
| `KOPPLER_STATE` | `~/.local/state/koppler` | Run state, boards, history, the action log, logs |
| `KOPPLER_CONFIG_DIR` | `~/.config/koppler` | Which stack is in use, private stacks, approvals |
| `KOPPLER_PORT` | `4747` | The canvas's port |
| `KOPPLER_SECRETS` | the Keychain | A folder for secrets instead of the macOS Keychain |
| `KOPPLER_KEYCHAIN` | your default keychain | A keychain file of its own for secrets, e.g. a throwaway one in tests |
| `KOPPLER_TEMP` | `<state>/run` | The run state: boards, history, the action log |
| `KOPPLER_LOGS` | `<state>/logs` | The apps' logs |
