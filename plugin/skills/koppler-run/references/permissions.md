# Letting the agent run Koppler without prompts

Koppler starts a confirmed run and a Stop and revert itself (`koppler up`, `koppler down`), so the agent mostly checks and finishes leftovers.
These commands read state or act only on what Koppler already runs, so they are safe to allow without a prompt on QA:

```
koppler status
koppler logs
koppler plan
koppler history
koppler doctor
koppler recipes
koppler switch
koppler listen
koppler say
```

In Claude Code that is a `permissions.allow` list in `.claude/settings.json`, one `Bash(koppler <command>:*)` entry per line above.
Other agents have their own allow lists; use the same commands.

Leave these asking every time, because they start or stop things, may touch production, show its data, or touch secrets: `koppler run`, `koppler up`, `koppler down`, `koppler stop`, `koppler query`, `koppler secret`.
`koppler doctor --approve` cannot be allowed at all: it asks the person at the terminal, and refuses anywhere else.
On PROD the user's Run on PROD on the canvas is the confirmation; `koppler query` stays in the user's own terminal.
