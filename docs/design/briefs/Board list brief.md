# Board list: one list by area, not Team boards and Your boards

For Claude Design, working on this canvas, Koppler.
Koppler runs a few apps of a stack locally, wired to each other, while the rest call a deployed environment.

## The job

The board menu (opened from the board's name in the bar) lists boards twice over.
Team boards come grouped by area (`Team boards · Commerce`, `Payments`, `No area`), then a flat `Your boards` list below them.
Once the stack has areas, a person looks for a board by its area, so the second heading splits the same question in two and the user's own boards lose their area.
Design one list grouped by area, where a board that is the team's and a board that is the person's own still tell apart, in one canvas file, `Koppler Board List.dc.html`, in Patch bay: Mono, plus Paper to check light.
One numbered section per item under "To design".

## Read first

- `Koppler Board Picker.dc.html`: the board picker in the bar and the menu it opens.
- `Koppler Areas.dc.html`: the area filter, the `N team boards in …  Show all` line, Set area.
- `Board picker brief.md` and `Areas brief.md`.

## What the menu holds today

- Find a board (search), then the area filter and Show all when the chosen areas hide some.
- `Current board`, pinned on top when the chosen areas hide it.
- `Team boards · <area>`, then each other area, then `No area`.
- `N team boards in Shipping and Accounts  Show all`, when the chosen areas hide some; a search lists those under `Hidden by your areas`.
- `Your boards`: the person's own, flat, on this Mac.
- New board, New feature board, Duplicate; Rename (own board on screen); Open from a link or a file; Recently deleted.
- Each row: name, `(local)` or `(mine)` set apart after it, the area name in some rows, and `…` for Open, Set area…, and on own boards Reload, Share with team, Delete.

## Settled (do not redesign)

- Team boards and own boards stay different things: a team board comes from the stack and changing it makes a copy of your own; an own board is kept on this Mac and can be shared as a pull request.
- Each board has one area, worked out from its apps or set by hand; own boards get one the same way.
- The area filter, search, Current board, Recently deleted and the strip of actions stay as they are.
- A row's actions stay in its `…` menu.

## To design

1. **The list by area**, with own and team boards mixed under each area heading, and how a row says which kind it is.
2. **Order inside an area**: own boards first, team first, or by name.
3. **The hidden line and `Hidden by your areas`**, now counting both kinds.
4. **A stack with no areas**: one flat list, the same mark on rows.
5. **Light (Paper)** for 1.

## Content to use

Acme Shop, areas Commerce, Payments, Accounts.
Commerce: Checkout (team), Checkout (local) (own), Basket rework (own, feature board).
Payments: Refunds (team), Wallet top-up (team), Payments API alone (own).
Accounts: Sign-up (team).
No area: Scratch (own).
Board on screen: Checkout (local).

## Rules that stay

- Patch bay: Barlow, Barlow Semi Condensed, Sometype Mono; square corners; hairlines; sentence-case sans for words, mono for values; white as the only filled button; colour only for state (local, deployed, live, warn, prod).
- Names are the Acme Shop examples, never a real stack.

## Open points (with our default)

- Which kind carries the mark - default: a small `Team` tag on team boards, own boards plain, since they are the ones a person changes.
- Order inside an area - default: by name, so a board stays put when it is shared.

## How to work

- Re-read the published canvas before editing; it may have changed since you last wrote it.
- Edit in place. Never delete or rename a file without asking; stop and report the question instead.

## Done means

- One line per section: what it shows.
- Each open point you decided, and why.
- Anything you could not check, with the reason.
