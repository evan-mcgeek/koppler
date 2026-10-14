# Live status on the canvas

The canvas shows each app's checklist, whether its port answers, and the tail of its log.
The page asks the canvas server for the status every 1.5 seconds.

## What the agent maintains: each card's steps

Set one step at a time; never write the status file yourself:

```bash
koppler status step orders-api "Start" user --detail "Run in your own terminal." --copy "<exact command>" --port 5001
koppler status step orders-api "Start" done      # the same label replaces the step
koppler status step orders-api --clear           # take your steps off the card
```

What the card then holds:

```json
{
  "stack": { "env": "qa", "mode": "auto" },
  "apps": {
    "<app id>": {
      "port": 5001,
      "log": "/absolute/path/to/app.log",
      "steps": [
        { "label": "Changes", "state": "done", "detail": "QA-LOCAL points Orders API at http://localhost:5001." },
        { "label": "Prerequisites", "state": "done", "detail": "AWS login, Redis tunnel on :6379." },
        { "label": "Start", "state": "user", "detail": "Run in your own terminal.", "copy": "<exact command>" },
        { "label": "Check", "state": "todo", "detail": "http://localhost:5001 answers." }
      ]
    }
  }
}
```

- `state`: `done`, `todo`, `user` (waiting on the user) or `failed`. Keep the four steps in this order, matching the output format in `SKILL.md`.
- `copy`: only on a step the user must run; the card shows a "Copy command" button. Take the title, why and command from `koppler doctor --json`, so the wording matches the terminal.
- `--port`: leave out for apps with no port (the mobile app). `--log <file>`: only when the app logs somewhere else than the default file below; it must be a `.log`, `.out` or `.txt` file.
- Set a step again whenever it changes. Secret values are masked.
- A run Koppler applies itself (`koppler up --run`) writes its own steps per app to `<state>/progress.json` (branch, remembered change, tunnels, local queue, start), and the step it stopped on is marked failed. Cards show them when you wrote no steps for that app; a Stop clears them.

## What publishes it: `status-watch.mjs`

```bash
koppler canvas   # while the canvas is open
node <app>/dist/status-watch.mjs --once                                # publish a single snapshot
```

Every 1.5 seconds it puts the status together from those steps, adding `listening` (a TCP connect to the port) and `logTail` (the end of the log).
Log lines are masked for passwords, tokens, JWTs, AWS keys and credentials inside addresses before they reach the page, `koppler logs`, a failed start's output or a run handed to the agent.
The files in the logs folder are not masked: read a log with `koppler logs <name>`, never the file itself.
Started through `koppler`, it keeps running across agent sessions.

## Where logs come from

| App started by | Log |
|---|---|
| The agent or the user, through `koppler run <app> ...` | written by `koppler` |
| The user, in the foreground of their own terminal | `bin/run-logged <app> -- <command>` |
| The user, from an IDE: a Flutter app | `koppler run <app> --cwd <repo> --restart -- fvm flutter logs -d <device id>` copies the app's output from the simulator, emulator or phone (`fvm flutter devices` lists ids). It follows the app across restarts and shows lines only when the app prints |
| The user, from an IDE: anything else | none; the output stays in the IDE. The card still shows the port state and checklist |
| A web front end's browser console | not captured yet; its dev server's output is, when started through `koppler run` |

Both write `~/.local/state/koppler/logs/<app>.log` (private to the user) and restart the file on each run, so the `koppler run` name must be the app id for the card to find it.

## Layout autosave

The board is kept by the canvas server as the user changes it, so a reload brings it back.
While `status-watch.mjs` runs, it listens on `127.0.0.1` (port 4747 or `KOPPLER_PORT`; the token is kept in `~/.local/state/koppler/canvas-token`, so the page address survives restarts) and handles:

| Request | What it does |
|---|---|
| `GET /s/<token>/` and `/s/<token>/data/<name>.json` | serves the canvas and its data; the URL is in `<state>/canvas-url` |
| `POST /state?token=…` | keeps only known layout fields and writes `<state>/state.json`, which the page loads on open |
| `POST /preset?token=…` | body `{ "url" }`: reads a preset file from an https GitHub link (through the user's `gh` login, else as a public file, 300 KB at most) and returns its presets with only known fields; any other address is refused |
| `POST /secret?token=…`, `/secret-remove`, `/secret-test` | body `{ app, env, name }` (+ `value` to set): store, remove or test one secret the stack declares for that app and environment; nothing returns a value, and the test answers only `{ ok, message }` |
| `POST /apps?token=…` | body `{ apps: [{ slug, name?, kind? }] }`: adds clones the user picked to `stack.json` as apps not set up yet (only clones the scan found, never one already there), then reloads the stack |
| `POST /prompt?token=…` | a run/Stop from the standalone page (`koppler` or `koppler-stop` only); appended to `<state>/prompts.jsonl`, which `koppler listen` prints and consumes, and kept as a run in `<state>/history.jsonl` |

The full list of routes is in `app/src/server/routes.ts`.
Everything else gets 404, 400 or 413.
The page saves 400 ms after each change, and tries again when the server did not take it. The sidebar says whether the layout is being saved.

## Mobile app detection

The mobile app has no port, so for registry apps with a `mobile` field (`iosBundleId`, `androidPackage`) the watcher checks every 5 seconds:
- iOS: each booted simulator's `launchctl list` for `UIKitApplication:<bundle id>[`
- Android: `adb shell pidof <package>` on each connected device, with the model from `getprop ro.product.model`
- the matching `flutter run` process for `--flavor` and `--machine` (started from an IDE) or not (CLI)

It publishes `running: [{ platform, device, deviceId, pid, flavor, source }]` (empty when not running); the card shows it next to the status dot.
QA and PROD builds share the same id, so the flavor is only known while `flutter run` is attached; a build launched from the home screen shows no flavor.
