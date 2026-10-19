# Working on Koppler

## Golden rule: nobody edits JSON by hand

Nobody writes a Koppler JSON file directly: not `stack.json`, not the state files, not a board.
That holds for users and for agents alike, with no exceptions.
Every change goes through a `koppler` command, and every change that is the user's to make also has a control on the canvas.
A change with no command yet is a missing feature: build the command (and the control) first, then make the change with it.

| What changes | The command | On the canvas |
|---|---|---|
| A fact of the stack | `koppler stack set` / `unset`, `koppler add`, `koppler remove`, `koppler discover --apply` | Settings (the gear) |
| A lock on a field | `koppler stack lock` / `unlock` | The lock beside the field |
| A board | `koppler board new` / `edit` | The board itself |
| A change Stop must undo | `koppler actions add` / `clear` | History shows it |
| A step on a card | `koppler status step` | The card |
| A message to the user | `koppler say` | The inbox |

## Before every release: pull the designs

Koppler's look is designed in Claude Design (project `8557df85-2270-420b-923d-268ea539f6af`), and `docs/design` keeps a copy of it.
Before every release, pull the current files from that project into `docs/design`, so the release ships with the design it was built from:

- `sources/`: each `.dc.html` as it is now, never `support.js` (Claude Design's runtime, not ours to publish).
- `briefs/`: each brief (`.md`) sent to Claude Design.
- `images/`: each design rendered again, full page.

Real stacks' names, hosts and apps never go in: replace them with the Acme Shop examples first, and check the folder for them before committing.
When a design changed something the app shows (the landing hero, the social card, the mark), update it in the app and the README in the same change.
