# Side panel: app names that fit, and a width you can change

For Claude Design, working on this canvas, Koppler.
Koppler runs a few apps of a stack locally, wired to each other, while the rest call a deployed environment.

## The job

In a stack of 38 apps at 1440 px, 27 names in the side panel's Apps list are cut off, some to "Orders Fulfilm...".
The build has drifted from the Design System's Apps list: the design draws the panel at 300 px with rows of kind 62 px | name | light 10 px, and no buttons. The build added three row actions (remove from the board, run alone, remove from the stack) that keep their room even while hidden, and widened the panel to 324 px. A name gets about 150 px.
Design the fix as one canvas file, `Koppler Side Panel.dc.html`, in Patch bay: Mono, plus Paper to check light. One numbered section per item under "To design".

## Read first

- `Koppler Design System.dc.html`: the Apps list ("Apps · 5 of 6 on the board"), the row grid this starts from, type, schemes.
- `Koppler Board Picker.dc.html` and its brief, section 4: the board picker leaves the side panel for the bar, so the panel starts with Apps. Design the panel in that shape.
- `Koppler Built While Away Review.dc.html`: the card name rule (two lines, then an ellipsis; unbroken names break anywhere; the kind tag under the name). The list should agree with the cards.

## Settled (do not redesign)

- The row actions exist and stay, but take no room at rest. They show on hover and on keyboard focus, laid over the end of the name. They have no design yet: this round gives them one.
- A name still too long takes two lines, then ends in an ellipsis; the full name shows on hover. Same rule as the cards.
- The panel is resizable by dragging its right edge, from 280 to 560 px. Double-click the edge to reset to the default. The edge is focusable and arrow keys resize it.
- The edge is the panel's hairline, brightening on hover, while dragging and on focus. No grip, no shadow.
- The width is kept on this Mac for every stack, and survives closing and opening the panel. The board reflows; nothing on it moves.
- As the window narrows, the widest the panel can go shrinks, so the board keeps a usable width.

## To design

1. **A row at rest:** kind, the full name, the state word (outside, not cloned) and the running light where they apply. Rows on the board and off it.
2. **A row hovered, and focused from the keyboard:** the three actions over the name's end, and how the name gives way under them.
3. **A name longer than the widest panel:** two lines, the ellipsis, and the full name on hover.
4. **The kind label:** keep its 62 px column, narrow it, or move it under the name as the cards do - your call, given rows that may now be two lines.
5. **The edge:** at rest, hovered, while dragging, at 280 and at 560, focused from the keyboard, and the cursor.
6. **The canvas** at 1440 with the panel at its default and at 560; at 1010, with the widest capped.

## Content to use

Acme Shop examples, long names on purpose: Orders Fulfilment Service, Payments Notification Handler, Carrier Gateway Webhook Receiver, Customer Accounts API, Web Shop, Basket, Push Sender Lambda (outside), Inventory Sync Job (not cloned).

## Rules that stay

- Patch bay: Barlow, Barlow Semi Condensed, Sometype Mono; square corners; hairlines; sentence-case sans for words, mono for values, mono caps only for codes; colour only for state.
- Names are the Acme Shop examples, never a real stack.

## Open points (with your default)

- The kind label (item 4) - default: under the name, as on the cards, if two-line rows read well; else keep the column narrowed to what the longest kind needs.
- The default width - default: 300 px as the Design System draws it, now that the actions take no room; 324 px if 300 cuts common names.

## How to work

- Re-read the published canvas before editing; it may have changed since you last wrote it.
- Edit in place. Never delete or rename a file without asking; stop and report the question instead.

## Done means

- One line per section: what it shows.
- Each open point you decided, and why.
- Anything you could not draw or check, with the reason.
