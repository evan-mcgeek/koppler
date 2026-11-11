# Discover and Run: two front doors on one base

For Claude Design, working on this canvas, Koppler.
Koppler runs a few apps of a stack locally, wired to each other, while the rest call a deployed environment.
It also maps how the stack fits together (Discover) and keeps feature boards: a feature's flow as numbered steps in phases.

## The job

Today Discover, Plan and Live are one tab bar on one board.
They serve two different jobs and audiences, and switching tabs silently changes what the screen is about: Discover is often the whole stack, Plan and Live are one board.
Design Koppler as two front doors on one base, as one canvas file, `Koppler Discover and Run.dc.html`, in Patch bay: Mono, plus Paper to check light.
One numbered section per item under "To design".
Issue: https://github.com/evan-mcgeek/koppler/issues/715

## The two jobs

- **Discover: understand and share a flow.** A developer asks the agent "how does checkout work" or "what listens to Orders API"; the agent builds a feature board; the developer reads it, comments where a service is missing, and the agent fills it in. Then they share it with a colleague, often a PO, who will never run anything. Today that share is a screenshot.
- **Run: run a slice locally.** Pick apps, wire them, run them against a deployed environment, watch them in Live.

## Read first

- `Koppler Header.dc.html`: the bar today (stack, board, Discover / Plan / Live, environment, status, Activity, Settings, Stop).
- `Koppler Board Picker.dc.html` and `Koppler Areas.dc.html`: the board menu, team and own boards, areas.
- `Koppler Discover.dc.html`: the Discover map, feature boards, the steps panel and the walk-through.
- `Koppler Side Panel.dc.html`: the Apps list.
- `Scheduled jobs brief.md`: scheduled jobs, which belong on the Discover side only.

## Settled (do not redesign)

- One base: the same stack, facts, boards and engine. Two front doors, not two apps to install.
- Discover has nothing to run: no Run, Stop, Live, branches, tunnels or secrets on its screens.
- Run keeps boards, Plan and Live, as designed.
- Feature boards live on the Discover side; "Plan a run with these" crosses from Discover to Run with the picked cards.
- A viewer (a PO) sees a feature board view-only: the map, the steps, the walk-through, each app's description; no hosts or technical settings, nothing saved.
- Areas apply on both sides.

## To design

1. **The two front doors:** how a person gets to Discover and to Run, and always knows which one they are in. What the bar holds in each.
2. **Discover's home:** the whole stack map, the feature boards (team and own), and asking the agent a question that becomes a feature board.
3. **A feature board in Discover:** its map, steps panel, walk-through and comments, with no run controls.
4. **Crossing over:** "Plan a run with these" from Discover to Run, and from a run board back to its flow in Discover.
5. **Sharing a feature board:** the control that gives a link, and what the viewer sees when they open it (view-only, no install).
6. **Comments on a feature board:** leaving one on a card or a step, and how the agent's reply shows.

## Content to use

Acme Shop. Apps: Web Shop, Mobile App, Orders API, Payments API, Basket, Catalog API, Notifications API, Accounts API; Order events (queue), Orders DB, Payment provider (outside).
Feature boards: Checkout (Place the order; Pay), Refunds, Push to phone.
Run boards: Checkout (local), Payments debugging.
A comment: "Payment provider's webhook back to Payments API is missing."

## Rules that stay

- Patch bay: Barlow, Barlow Semi Condensed, Sometype Mono; square corners; hairlines; sentence-case sans for words, mono for values; white as the only filled button; colour only for state (local, deployed, live, warn, prod).
- Names are the Acme Shop examples, never a real stack.

## Open points (with your default)

- Where the switch between the doors sits - default: the first control in the bar, where Discover / Plan / Live are now, as Discover | Run.
- Whether Discover keeps the environment switch (QA / PROD) - default: yes, since links differ per environment.
- How the shared link is hosted (an exported file, a page Koppler serves, the company's own host) is not settled; design the viewer's page so it works as any of them.

## How to work

- Re-read the published canvas before editing; it may have changed since you last wrote it.
- Edit in place. Never delete or rename a file without asking; stop and report the question instead.

## Done means

- One line per section: what it shows.
- Each open point you decided, and why.
- Anything you could not draw or check, with the reason.
