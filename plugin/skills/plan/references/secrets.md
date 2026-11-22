# Secrets

The agent never reads, fetches, prints or sources a secret value: no `aws secretsmanager get-secret-value`, no reading the secrets store, no reading an app's secrets file.
Back this up with deny rules in the user's `~/.claude/settings.json` (`permissions.deny`):

```json
"Read(~/.config/koppler/secrets/**)",
"Read(**/appsettings.secrets.json)",
"Read(~/.pgpass)",
"Bash(*pgpass*)",
"Bash(*koppler/secrets*)",
"Bash(*with-secrets*)",
"Bash(*secret-store*)",
"Bash(*find-generic-password*)",
"Bash(*koppler secret set*)",
"Bash(*appsettings.secrets.json*)",
"Bash(*secretsmanager get-secret-value*)"
```

An app that loads its own secrets at runtime with the user's AWS login (e.g. from Secrets Manager or SSM) needs nothing here.

## Store

Values live in the macOS Keychain, one item per secret (service `koppler:<app>` or `koppler:<app>@<env>`, account = the name).
`bin/secret-store` is the only code that touches them, and the other scripts go through it.
A protected environment's store is created so that every read shows a Keychain prompt.
The others are readable without one, by anything running as the user.
So only the deny rules above keep an agent from them.
Which environments are protected is the stack's call (`protected` in `stack.json`).
Without `protected`, every environment except the first is protected.
It is never decided by an environment's name.
Where there is no Keychain (or when `KOPPLER_SECRETS` names a folder) values live in private files instead: `<folder>/<app>.env`, default `~/.config/koppler/secrets` (dir 700, files 600). `bin/secret-store migrate` moves such files into the Keychain.
On the canvas, the Credentials panel lists what the apps on the board need for the chosen environment.
It can Set, Test and Remove a value.
It never shows one, and fetching stays a command the user copies into their own terminal.
Each environment after the stack's first has its own store, named `<app>@<env>` (`koppler secret set orders-api@prod <NAME>`).
`koppler run <app> --env <env>` loads only that one and refuses to start while a declared secret is missing from it.
So a PROD value never replaces or leaks into QA.
`koppler doctor --secrets <app> [--env <env>]` tries each stored secret the app declares and prints only the outcome (`connected`, or a plain reason).
It tests Postgres (needs `psql`), MySQL (needs the `mysql` client) and Redis or Valkey (no client needed).
The value can be in .NET `Key=Value;` form, a URL, or `host:port,password=...` for Redis.
A secret's optional `type` in `stack.json` (`postgres`, `mysql`, `redis`, `key`) says which one it is.
Without it, the value's shape decides, and an ambiguous `Server=...;User Id=...` string asks for the type.
`koppler run <app>` runs the same test before it starts the app and refuses to start on a failure (`--no-test` starts anyway). A protected environment's store is only tested when asked (`--test`), because each read of it shows a Keychain prompt.
A connection is only ever sent to the host named inside it.
An API key or token (`type: key`) names no host, so the stack says where to try it: `probe.url`, an https address.
It goes as a bearer token, or in the header `probe.header` names.
The test sends one request and reads only the status: `accepted`, rejected (401 or 403), or the status it got.
It never follows a redirect, and never shows the value or the answer.
A key goes only to a host the user approved for that secret on this Mac: `koppler secret approve <app>[@<env>] <NAME> <host>`.
Anyone editing `stack.json` could point `probe.url` elsewhere, so the approval lives in `~/.config/koppler/approvals.json`, never in the stack.
A new host asks again, and `koppler secret revoke <app>[@<env>] <NAME>` takes every approval back.
Without one, the test says so and prints the approve command; the agent hands that command to the user and never runs it.
`koppler secret psql <app or app@env> <NAME>` opens `psql` with a stored connection string.
`... --pgpass` adds its line to `~/.pgpass` (for `localhost` and `127.0.0.1`), so other database tools find the password.
Both are for the user's own terminal.
`--pgpass` refuses a protected environment's store: that password stays behind its Keychain prompt and is never copied into a plain file.
Scripts are in `<app>/bin/`:

| Script                                                   | Who runs it                     | What it does                                                                                                                                                                  |
| -------------------------------------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `koppler secret set <app> <ENV_NAME>`                    | the user, in their own terminal | hidden prompt; prints only the key name and length                                                                                                                            |
| `<fetch> \| koppler secret set <app> <ENV_NAME> --stdin` | the user                        | stores a fetched value without showing it                                                                                                                                     |
| `koppler secret list <app>[@<env>]`                      | anyone                          | key names only                                                                                                                                                                |
| `with-secrets <app> -- <command>`                        | the user                        | runs the command with the app's secrets in its environment only                                                                                                               |
| `koppler run <app>`                                      | the agent or the user           | starts a stack app of any kind with its secrets, detached and logged. With only an app id it cannot run another command. `koppler run <name> -- <command>` never gets secrets |

## Asking the user

For each local node's `secrets` entry whose `when` applies:

- `env` entry: say what the value is and why it is needed.
  Then give both `fetch.cli` and `fetch.ui`, ending in `koppler secret set <app> <NAME>` (piped with `--stdin`, or typed at its prompt).
  Tell the user to run them in their own terminal, not with `!` (its output lands in the conversation).
  The app then runs through `koppler run <app>` (or `with-secrets <app> -- <run command>` in the user's terminal); for a Rider run, the user points the EnvFile plugin at `~/.config/koppler/secrets/<app>.env`.
- `file` entry: give `fetch.cli` / `fetch.ui` and the `note`; the user places the file. Warn when the path is tracked in git.

Confirm with `koppler secret list <app>` (names only) before handing over the run plan.
