---
name: help
description: Use before running any koppler command you are not sure of, when a flag or a subcommand is needed, when the user asks what Koppler can do or which command does something, or when a command failed with a usage line. It lists every koppler command, its forms, flags and an example, from the CLI itself. For running a slice of the stack use koppler:plan; for understanding a flow, koppler:discover.
---

# Koppler help

The `koppler` command's own help is the one true list of what it can do: it is built from the same table the command runs, so it is never out of date.
Read it instead of guessing a command or a flag, even when the user did not ask and does not know the command exists.

1. `koppler --help`: every command, in two groups, **For you** (what the user runs) and **For the agent** (what you run).
2. `koppler <command> --help`: that command's forms, one per line, each with what it does, and an example. Read it before the first use of a command in a session, and whenever a command prints a `usage:` line.
3. `koppler --version`: the Koppler installed. When it differs from this skill's `VERSION` file, say so: the older one needs updating (`npm i -g koppler`, and the plugin).

`koppler` on its own starts the canvas and its server and opens it; `koppler completion zsh|bash|fish` gives the user Tab completion of every command and flag.

## Which skill next

- Running apps on this Mac, wired to each other, and stopping them; connecting this session to the canvas: **koppler:plan**.
- How a flow works, feature boards, comments, sharing a flow: **koppler:discover**.

## Rules

- A command not in `koppler --help` does not exist: never invent one or a flag, and never edit a Koppler JSON file instead. A change with no command is a missing feature: say so to the user.
- Never touch secret values: `koppler secret` is for the user, in their own terminal, and its values never show; the koppler:plan skill says how secrets are handled.
