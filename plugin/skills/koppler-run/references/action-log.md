# Action log and stop / revert

Stop and revert (canvas button, prompt tag `koppler-stop`, or asked in chat) means: **stop every process the agent started, and revert every temporary code change** (including ones the log does not know about).
The agent keeps `<state>/actions.json` so it knows exactly what it started and changed.

## Action log

In `auto` mode, append one object per action to `<state>/actions.json` (JSON array, in order) just before you make the change, so a change interrupted part-way still has its entry. Never store secret values.
If the file cannot be read as a JSON list, stop and tell the user: never start it afresh, since every entry in it is a change Stop must undo. Koppler's own commands refuse the same way and keep a copy (`actions.json.damaged-<time>`).
Give every entry its `app`, so that when a later run drops one app from the board, only that app's entries are stopped and reverted and removed from the log; a full Stop and revert still empties it.
The log says how to undo things; which runs and Stops happened, and how they ended, is the run history (`koppler history`, `<state>/history.jsonl`, written by the canvas and `koppler history --done`).

| `kind` | Fields |
|---|---|
| `edit` | `app`, `file`, `before`, `after` (exact strings), `recipe?` (set by `koppler recipes --apply` for a remembered change) |
| `profile` | `app`, `file`, `name`, `created` (bool), `previous` (env object, when an existing profile was updated) |
| `process` | `name` (the `koppler run` name), `command`, `port?`. For the rare process not started through `koppler` (e.g. `flutter run` in the background): `label`, `pid` (the program's own pid, not a shell wrapper: find it by the listening port or the first word of `ps -o command=`, never with a bare `pgrep -f`), `command`, `port?` |
| `env-file` | `app`, `file` (e.g. `.env.local`), `lines` added, `created` (bool: Koppler created the file) |
| `file` | `app`, `file`, `before` (the file's text before the run, `null` when Koppler created it), `after` (the text Koppler wrote last): a local library's `pubspec_overrides.yaml`; Stop puts `before` back or removes the file, and leaves a file that no longer reads as `after` for you to sort out |
| `npm-local` | `app`, `repo`, `packages`: local libraries installed with `npm install --no-save`; Stop runs `npm install` to go back to the published ones, after the branch is back |
| `checkout` | `app`, `repo`, `from` (a branch, or a commit with `detached`), `to`, `stash?` (its label), `carried?`; written by `koppler switch`, do not add it yourself. It stays until the clone is back and its set-aside changes are too: when those clash, the clone is left clean, they stay in the stash, and the user takes them back with `git stash pop` |
| `secret` | `app`, `env` (name only) |

`koppler history --done` copies the code changes in this log (`edit`, `profile`, `env-file`, `checkout`) into the run's history entry, with secrets masked, so the canvas History shows them as diffs even after a revert. Log each change before calling it.

Also write `<state>/state.js` after every run from the canvas, so a fresh open restores the layout: `window.SAVED_STATE = <data.layout as JSON>;`

## Koppler does it

Stop and revert from the canvas runs `koppler down --run <id>` (by hand: `koppler down`): it stops everything Koppler runs except the canvas, undoes this log in reverse (edits, env files, launch profiles, then `koppler switch --back`), looks for unlogged `koppler:` markers, and marks the Stop done.
You get the Stop only for what it left (listed in the prompt; those entries stay in the log): handle exactly those by the rules below, then `koppler history --done <id>`.

## Stop

Stop only processes the agent started, as recorded in the log:
- `name` entries: `koppler stop <name...>` (it stops the whole process tree, `TERM` then `KILL` after 8 s). `koppler status` lists what Koppler runs, after a Claude Code restart too; something there the log does not know about was started by the user, so leave it.
- `pid` entries: only if the `pid` still runs the logged `command`; send `TERM`, wait up to 10 s, then `KILL`.
Check each logged `port` is free afterwards.
Leave running: anything the user started (IDE sessions, their own terminals, tunnels they opened), AWS SSO logins, and anything not in the log. Name what was left running in the report.

## Revert

1. **Logged edits**, in reverse order: replace `after` with `before`. If `after` is no longer in the file, report it and leave the file alone.
2. **Unlogged edits:** search each stack repo for `koppler:` markers (`git -C <repo> grep -nE "koppler:.*do not commit"`). Revert each with the matching `edit` entry's `before`; if there is none, restore that line from `git show HEAD:<file>` when the rest of the file has no other changes, otherwise show the line and ask.
3. **Env files:** remove the logged `lines` from `file`, one occurrence each, the last one, so a line of the user's own that reads the same stays; delete the file if Koppler `created` it and nothing else is left in it.
4. **Launch profiles:** remove profiles the skill added (logged `created` profiles, plus any profile whose name ends in `-LOCAL`); restore `previous` env for updated ones. Keep the rest of `launchSettings.json` byte-for-byte; if the file then equals `HEAD`, it is clean again.
5. **Checkouts:** `koppler switch <app> --back` for each: it switches back and brings set-aside changes back. If it reports new uncommitted changes, tell the user and leave that app on its branch.
6. **Secrets:** leave stored values; mention `bin/secret-list` so the user can decide.

Finish by checking `git -C <repo> status --porcelain` for each stack repo shows no change the skill made, empty the log (`[]`), and report one line per stopped process and reverted change, plus anything left as is and why.

> This command modifies state.
