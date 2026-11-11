# Reporting a bug or a feature request in Koppler

Every problem with Koppler itself goes to a GitHub issue on `evan-mcgeek/koppler`: the `koppler` command, the canvas, the engine, this skill and its references, and the docs.
That includes a wrong or missing instruction in this skill, a confusing message, and a step you had to work around.
Something Koppler cannot do yet, that the user asks for or that would have saved them a step, is a feature request: an issue too, labelled `enhancement`, with what they wanted to do and why instead of the logs.
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
   `gh issue create -R evan-mcgeek/koppler --label bug --title "<title>" --body-file <file>` (`--label enhancement` for a feature request).
   Without `gh` or a GitHub login, give the user the draft to paste at https://github.com/evan-mcgeek/koppler/issues/new.
7. **Put it on the project board** when you can write to it (`gh auth status` lists the `project` scope): a bug in **Bugs**, a feature request in **Feature Requests**. See [the board](#the-board).
8. **Tell the user** the issue link and what they can do until it is fixed.

## The issue

Title: what goes wrong, in plain words ("Stop leaves the Kafka broker running after a failed Send").

````markdown
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
````

Never put in an issue: secret values, the user's stack.json as is, internal hostnames, company or app names, file paths under the user's home, screenshots of their apps.

## The board

Every issue is a card on https://github.com/users/evan-mcgeek/projects/2, in one of five columns:

| Column           | Holds                                     | Option id  |
| ---------------- | ----------------------------------------- | ---------- |
| Bugs             | Something broken, not started             | `f75ad846` |
| Feature Requests | Something new or better, not started      | `edf21591` |
| In Progress      | Being fixed or built, on a branch         | `47fc9ee4` |
| Testing          | Merged, for the user to try               | `394ec429` |
| Done             | The user tried it, or it needed no trying | `98236657` |

To add an issue and set its column:

```bash
item=$(gh project item-add 2 --owner evan-mcgeek --url <issue url> --format json --jq .id)
gh project item-edit --project-id PVT_kwHOBGpGts4BmUgx --id "$item" \
  --field-id PVTSSF_lAHOBGpGts4BmUgxzhk-BfA --single-select-option-id <option id>
```

`gh project item-list 2 --owner evan-mcgeek --format json` finds the item id of an issue already on the board.

## While Koppler itself is worked on

When Koppler runs from its source folder, the same rule holds: file the issue first, then fix it on a branch whose commits name the issue (`Fixes #12`).
Move its card as the work goes: **In Progress** when the branch starts, **Testing** once it is merged and the user can try it, **Done** when they have.
