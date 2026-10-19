# Working on Koppler

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
- Files are migrated on every read, in memory. One is written in the new format only when the user asks (`koppler stack migrate --apply`, or Update the file on the canvas), since teammates on an older Koppler cannot read it after.
- Its tests give a file in the old format and check the new one, and that a file already in the new format is left alone.

## Before every release: pull the designs

Koppler's look is designed in Claude Design (project `8557df85-2270-420b-923d-268ea539f6af`), and `docs/design` keeps a copy of it.
Before every release, pull the current files from that project into `docs/design`, so the release ships with the design it was built from:

- `sources/`: each `.dc.html` as it is now, never `support.js` (Claude Design's runtime, not ours to publish).
- `briefs/`: each brief (`.md`) sent to Claude Design.
- `images/`: each design rendered again, full page.

Real stacks' names, hosts and apps never go in: replace them with the Acme Shop examples first, and check the folder for them before committing.
When a design changed something the app shows (the landing hero, the social card, the mark), update it in the app and the README in the same change.
