# Preparing local nodes

Facts come from `<state>/registry.json` (a copy of the shared `stack.json`; read its `notes`) and `<state>/local.json` (its `apps`, written by `koppler sync`: clone path, branch, dirty count).
For an env other than the first, each field in `apps[id].envs.<env>` replaces the top-level one first (lists such as `prereqs` and `secrets` are replaced whole, never merged).
Work in `LOCAL.apps[id].path`, the user's real clone, never a worktree.
Every change below is proposed with the exact diff or command and applied only after the user confirms.

## Remembered changes

Before working out any temporary edit, run `koppler recipes --apply <every local app>`: it applies the remembered changes (`koppler recipes`) that match the latest Send's environment and cables, logs them for Stop, and says which no longer fit because the code moved.
For an edit you still have to make, log it first with `koppler actions add`; once the app runs with it, ask the user "Remember this for next time?" and on yes run `koppler recipes --remember <app> --why "<plain reason>" --when <always|calls:<app>|env:<env>>`. Add `--any-os` only when nothing in the edit depends on the operating system. It is shared through stack.json unless it names a path, alias or user only this machine has; then it stays private.
A recipe that moved: make the edit again by hand, then offer to remember the new one.

## Branches

If a node's `branch` is set and differs from `LOCAL.apps[id].branch`, run `koppler switch <id> <branch>`; it logs the switch itself.
With uncommitted changes the node carries the user's choice from the card, `changes: set-aside` or `take-along`: pass it as `--set-aside` or `--take-along`. Never pick one yourself; without it (a chat request), ask which.
If it says the changes clash with the branch, tell the user and leave the app on its branch.

> This command modifies state.

## Wiring

For each edge `from -> to`, run `koppler plan --wire <from> <to> [--device ios|android|phone|<id>]`: it prints the setting or the file and key, and the value to use, worked out for the device a mobile app runs on (simulator `localhost`, Android emulator `10.0.2.2`, a phone the Mac's network address and the callee's http port). Then:

- `how: env`: add a launch profile `<baseProfile>-LOCAL` (e.g. `QA-LOCAL`, `PROD-OPS-LOCAL`) to `from`'s `launchSettings`, copied from `baseProfile`, with each listed env var set to the printed value.
  Reuse the profile if it exists and only update its env vars. Keep a `note`'s path requirements (e.g. a callee URL that must keep a path suffix).
- `how: edit`: make the minimal temporary edit at `file` / `key` with the printed value, marked with a `koppler: do not commit` comment.
  A mobile node's `platform` is the device (`ios`, `android` or `phone`); with `run: ide` there is no `platform`, so ask which device the user will pick.
- `how: env-file`: add the printed lines to the printed file (`.env.local` by default: git-ignored and read on top of `.env` by Vite, Next.js and Create React App), creating it if needed; log it as `env-file`.
  For a browser front end, also set the printed CORS setting in the callee's `-LOCAL` profile, and pass on any warning (no recorded CORS setting, an https page calling an http API).
- `how: unknown`: find how the caller picks this address in its repo, apply it, and record the real `how` with `koppler stack set apps.<caller>.consumes.<callee>.how <how>`.
- When it says the callee must listen on the network (a phone), start the callee with `koppler run <to> --lan`.

Overrides named in a prerequisite `note` (e.g. an `AWS_PROFILE`) go into the same `-LOCAL` profile.
Leave out of the `-LOCAL` profile any variable the app has as a stored secret (its `secrets[].env`): a launch profile's own value wins over the environment, so it would hide the secret, and `koppler run` refuses to start until it is removed.
A node with no edges and no overrides runs its `baseProfile` unchanged.

> This command modifies state.

## Prerequisites

Collect every local node's `prereqs`, remove duplicates, check before asking:

| Kind       | Check                                                | If missing                                                                                     |
| ---------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `sso`      | `aws sts get-caller-identity --profile <p>`          | user runs `aws sso login --profile <sso>` (a `source_profile` role needs its source logged in) |
| `tunnel`   | `lsof -iTCP:<port> -sTCP:LISTEN`                     | user starts `alias` in their own terminal                                                      |
| `hosts`    | `grep <host> /etc/hosts`                             | user adds the line (needs sudo)                                                                |
| `devCerts` | `dotnet dev-certs https --check --trust`             | `dotnet dev-certs https --clean && dotnet dev-certs https --trust`                             |
| `file`     | the path exists                                      | follow the entry's `note` or its `secrets` fetch steps                                         |
| `nuget`    | the repo restored before (`obj/project.assets.json`) | README GitHub packages setup with a `read:packages` token                                      |

Two tunnels on the same `port` conflict; the stack's `notes` say which one can move and how.

For a production env (`prod`): say so up front, and confirm before opening a production DB tunnel or anything that swaps secrets.

## Cleanup, when asked

Revert every `koppler: do not commit` edit and remove the `-LOCAL` profiles, unless the user wants to keep them.

> This command modifies state.
