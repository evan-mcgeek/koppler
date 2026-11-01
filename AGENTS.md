# Working on Koppler

## How we work

Before building a feature, follow `docs/workflow/feature.md`.
Before fixing a bug or a flaky test, follow `docs/workflow/bugs.md`.

- Decisions are the user's; facts are yours to find. Ask only what you cannot look up, one round at a time, each question with your recommended answer.
- Show proposals and questions as a page the user can annotate, with the `lavish` skill: feature proposals, ideas borrowed from other tools, a grill round whose answers have options to compare, and plans. Their notes come back to you through it.
- The user merges. One branch and one PR per issue, off `origin/main`; give the user the merge command.
- CI must pass before a merge: check the PR's runs (`gh pr checks <n>`) and give the merge command only when every one is green. A red or flaky run is fixed first.
- Issues and tickets are drafted and shown first, then filed on the user's yes, onto the project board in their column.
- Examples use the Acme Shop stack. Real stack names, hosts and apps stay out of the repo.
- Any lint error, test failure or flake you see is yours to fix, in the same PR.
- Write plain dashes, never em dashes. Commits and PR bodies carry no agent attribution.

## Agent skills

### Issue tracker

Issues live in GitHub Issues on `evan-mcgeek/koppler`, each one a card on the project board. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default triage roles, each label named after its role. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Golden rule: nobody edits JSON by hand

Nobody writes a Koppler JSON file directly: not `stack.json`, not the state files, not a board.
That holds for users and for agents alike, with no exceptions.
Every change goes through a `koppler` command, and every change that is the user's to make also has a control on the canvas.
A change with no command yet is a missing feature: build the command (and the control) first, then make the change with it.

| What changes            | The command                                                                                | On the canvas             |
| ----------------------- | ------------------------------------------------------------------------------------------ | ------------------------- |
| A fact of the stack     | `koppler stack set` / `unset`, `koppler add`, `koppler remove`, `koppler discover --apply` | Settings (the gear)       |
| A lock on a field       | `koppler stack lock` / `unlock`                                                            | The lock beside the field |
| A board                 | `koppler board new` / `edit`                                                               | The board itself          |
| A change Stop must undo | `koppler actions add` / `clear`                                                            | History shows it          |
| A step on a card        | `koppler status step`                                                                      | The card                  |
| A message to the user   | `koppler say`                                                                              | The inbox                 |

## A change to a file's format comes with its migration

Every JSON file Koppler keeps says the Koppler version whose format it is written in (`koppler`): the stack, a board, the board file.
A change to what one of them holds, beyond adding a field older files can do without, comes with a migration, so a file written before keeps working:

- One migration per Koppler version per file, in `app/src/core/migrations/<file>/<version>.ts`, added last to that file's list, with the format's `version` moved to it.
- It takes the raw JSON in the format before and gives it in the new one; it never loses a fact, and when it cannot be sure, it leaves the file as it was.
- Migrating is internal: reading a file runs every migration newer than its version (none means older than any), then sets the version and writes the file back. There is no command or button for it.
- A file from a newer Koppler is refused with "update Koppler".
- Its tests give a file in the old format and check the new one, and that a file already in the new format is left alone.

## Before every release: pull the designs

Koppler's look is designed in Claude Design (project `8557df85-2270-420b-923d-268ea539f6af`), and `docs/design` keeps a copy of it.
Before every release, pull the current files from that project into `docs/design`, so the release ships with the design it was built from:

- `sources/`: each `.dc.html` as it is now, never `support.js` (Claude Design's runtime, not ours to publish).
- `images/`: each design rendered again, full page.

Real stacks' names, hosts and apps never go in: replace them with the Acme Shop examples first, and check the folder for them before committing.
When a design changed something the app shows (the landing hero, the social card, the mark), update it in the app and the README in the same change.
