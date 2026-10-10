# Commands

Apps and tunnels that `koppler` starts run detached, so they keep running after the terminal or agent session that started them ends.
`koppler --help` lists every command, and `koppler <command> --help` shows its options and an example.

## For you

| Command | What it does |
|---|---|
| `koppler init [--new "<name>" --envs qa,prod]` | Find your repos and the stack, or start a new stack and pick its apps |
| `koppler canvas [--stop]` | Start the canvas if needed and open it in your browser |
| `koppler use [stack] [--boards]` | List the stacks on this machine (`*` marks the one in use), switch to one, or list its boards |
| `koppler link <url> \| --update \| --discard \| --pr` | Use a stack shared on GitHub; then bring in its changes, drop yours, or open a pull request with yours |
| `koppler doctor [app...] [--env <env>]` | Can it run here: the tools your stack needs, then what you still have to do for these apps |
| `koppler doctor --secrets [app...]` | Also test that each stored secret works, for example that the database connects |
| `koppler doctor --flow` | Test every connection of what runs now, like the canvas's Flow check |
| `koppler doctor --approve` | Review everything the stack would run or write (checks, start commands, code changes) and allow it; asks you, never a script |
| `koppler secret set\|list\|remove\|psql <app>[@<env>] [<NAME>]` | Store and manage secrets; a value never shows |
| `koppler status [--apps] [--debug [name...]]` | What Koppler runs; `--apps` adds the stack's apps and clones; `--debug` gives versions and scrubbed logs for a bug report |
| `koppler logs <name> [-f] [-n <lines>]` | Show or follow a log, secrets masked |
| `koppler stop <name...> \| --apps \| --all` | Stop by name, every app and tunnel, or everything including the canvas; the last two ask first |
| `koppler history [--done [<id>] [--failed "<why>"]]` | Recent runs and Stops and how they ended; `--done` marks a run finished |
| `koppler query <app> [--env <env>] "<sql>"` | A read-only query with the app's stored connection; on production, in your own terminal only |

## Used by the agent add-on

You can run these yourself too; the agent uses them to do its part.

| Command | What it does |
|---|---|
| `koppler sync [--rescan]` | Reload the stack and your clones |
| `koppler discover [app...]` | What the repos say: local ports, tunnels, calls, conflicts and gaps, then what could be added to `stack.json` |
| `koppler discover --deployed` | Also draft deployed addresses, settings, secret names, queues and calls from the infrastructure code |
| `koppler discover --apply` | Write the agreed findings to `stack.json` |
| `koppler discover --find "<names>"` | The repos behind names in a description: the stack, your clones, your GitHub orgs |
| `koppler add <repo or folder>...` / `koppler remove <app>` | Add apps to the stack from your clones, or take one out |
| `koppler plan [app...] [--env <env>]` | What the newest run starts, restarts and stops; with apps, the tunnels they need |
| `koppler plan --wire <caller> <callee>` | What to change so a caller uses a local app |
| `koppler up <app...> [--cable <caller>:<callee>]...` | Start apps as a run, added to what already runs: recorded like Run on the canvas, so the canvas, history and Stop see it |
| `koppler up --board "<name>" \| --run <id>` | Start a saved board, or a recorded run: tunnels, local queues, then apps, callees first, each waited for |
| `koppler down` | Stop and revert: stop what Koppler runs, undo every change, put branches back |
| `koppler run <app> [--env <env>] [--device ...] [--lan] [--dry-run]` | Start one stack app, any kind |
| `koppler run <name> [--cwd <dir>] [--port <n>] [--restart] -- <command...>` | Start any command, detached and logged; it never gets secrets |
| `koppler switch <app> <branch> [--set-aside \| --take-along]` | Switch a clone to the board's branch; `--back` undoes it |
| `koppler recipes [app] \| --remember <app> --why "..." \| --apply <app...>` | Remembered code changes: list them, keep the last edit, apply the matching ones |
| `koppler listen --take \| --as <id> \| --stop` | Wait for requests from the canvas; one agent session at a time |
| `koppler say` | Show a question or result on the canvas, with choices to press |

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
