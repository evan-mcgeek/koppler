# Secrets and safety

Koppler starts and changes things on your machine, by itself or through the agent add-on.
These are the rules it follows, including the ones that hold whatever an agent does.

## Secrets stay yours

- Values live in the macOS Keychain, one item per secret, per app and environment.
- You store them yourself, in your own terminal, with a hidden prompt: `koppler secret set <app> <NAME>`, or piped from a fetch command with `--stdin`.
- The agent can list secret names and start an app with its secrets (`koppler run <app>`), and nothing else. A command it runs never gets them.
- Each environment has its own store, so a production value never replaces or leaks into a test environment.
- Production secrets show a Keychain prompt on every read.
- The canvas Credentials panel can set, test and remove a value, and never shows one.
- `koppler doctor --secrets <app>` checks that a stored database or Redis secret connects and prints only the outcome. A value is only ever sent to the host named inside it.

Back this up with deny rules in your agent's settings; [secrets.md](../plugin/skills/koppler-run/references/secrets.md) lists them.

## Nothing runs without your yes

- Run shows the plan first: what starts, restarts and stops.
- A shared stack can carry commands and code changes of its own: checks, start commands, remembered code changes. Koppler runs none of them until you have reviewed the exact list with `koppler doctor --approve`, in your own terminal, and asks again whenever any of it changes. An agent or a script cannot approve.
- The agent always stops and asks before it switches a branch over uncommitted changes, before anything that needs you in a browser or terminal (sign-ins, `sudo`, secrets), and before it opens a production database tunnel.
- On production, pressing Run in the review is the confirmation, and `koppler query` results stay in your own terminal.

## Changes are temporary

- Every change is recorded in an action log and undone on Stop.
- Koppler works in your real clones, so your IDE sees the changes, but it never commits, stashes or discards your work.
- Apps you started yourself are left alone.

## What stays on your machine

The shared `stack.json` holds facts about the apps: names, addresses, how to run them, the names of the secrets they need and how to fetch each one.
Your clone paths, board, presets, run state, notes and secret values stay on your machine.

## Letting the agent run without prompts

Read-only commands are safe to allow without a prompt; [permissions.md](../plugin/skills/koppler-run/references/permissions.md) lists them and the ones that should keep asking.
