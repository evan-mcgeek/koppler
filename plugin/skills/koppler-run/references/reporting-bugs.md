# Reporting a bug in Koppler

Every problem with Koppler itself goes to a GitHub issue on `evan-mcgeek/koppler`: the `koppler` command, the canvas, the engine, this skill and its references, and the docs.
That includes a wrong or missing instruction in this skill, a confusing message, and a step you had to work around.
Problems in the user's own apps or in the stack's facts are not Koppler bugs: tell the user, and fix the stack with `koppler stack set` as usual.

Never work around a Koppler bug silently, and never keep it only in `<state>/NOTES.md`.

## Steps

1. **Reproduce it** the way the user hit it, in the smallest setup that still shows it. If it does not reproduce, say so in the issue and describe exactly what happened instead.
2. **Find the cause** in Koppler's code or instructions, as far as you can, and a possible fix.
3. **Look for an existing issue:** `gh issue list -R evan-mcgeek/koppler --state all --search "<a few words>"`. If one matches, add your evidence to it as a comment instead of opening another.
4. **Gather the logs:** `koppler history session` sums up what happened since the last finished Stop and keeps the files on this Mac, for you to read.
   For the issue itself, `koppler status --debug [name...]` prints the versions and the recent canvas debug log, latest run log and each named app or tunnel log, scrubbed. Keep only the lines around the problem.
5. **Read the scrubbed text yourself** before it goes anywhere. The scrubbing replaces secrets, the stack's app, repo, host and queue names, paths, user names, emails, ticket ids, account ids and IPs, but it cannot know every name in the user's own code (class names, project names). Replace anything that still names the user, their company, their apps or their data with a neutral word (Orders API, `acme`).
6. **Show the user the draft** (title and body) and file it once they agree:
   `gh issue create -R evan-mcgeek/koppler --label bug --title "<title>" --body-file <file>`.
   Without `gh` or a GitHub login, give the user the draft to paste at https://github.com/evan-mcgeek/koppler/issues/new.
7. **Tell the user** the issue link and what they can do until it is fixed.

## The issue

Title: what goes wrong, in plain words ("Stop leaves the Kafka broker running after a failed Send").

```markdown
## What happened
One or two sentences: what the user did, what they expected, what happened instead.

## How to reproduce
1. Numbered steps from a clean start, with the commands and the clicks.
2. A minimal stack.json excerpt with neutral names, if the stack matters.

## Logs
<scrubbed lines, only around the problem, in a ```text block>

## Where it goes wrong
The file and line, or the instruction in the skill, and why it fails.

## Possible fix
What you would change, and how it could be tested.

## Environment
The first line of `koppler status --debug`, and the agent used.
```

Never put in an issue: secret values, the user's stack.json as is, internal hostnames, company or app names, file paths under the user's home, screenshots of their apps.

## While Koppler itself is worked on

When Koppler runs from its source folder, the same rule holds: file the issue first, then fix it on a branch whose commits name the issue (`Fixes #12`).
