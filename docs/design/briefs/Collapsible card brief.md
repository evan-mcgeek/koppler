# Collapsible card: an open card that fits the screen

For Claude Design, working on this canvas, Koppler.
Koppler runs a few apps of a stack locally, wired to each other, while the rest call a deployed environment.

## The job

An open app card stacks every section at full height and runs past the screen on a real stack.
Design sections that collapse to one summary line, in one canvas file, `Koppler Collapsible Card.dc.html`, in Patch bay: Mono, plus Paper to check light.
One numbered section per item under "To design".
Issue: https://github.com/evan-mcgeek/koppler/issues/709

## Read first

- `Koppler Design System.dc.html`: the open app card and its fields, the zoomed-out card, type, components.
- `Koppler Databases.dc.html`: the Databases section with Show tunnel.
- `Koppler Patch Bay Fixes.dc.html`: the card's Failed block and its fix button.

## Settled (do not redesign)

- The name, the state light, the failure and Ask the agent to fix stay open; they are what a person looks for first.
- Each other section can collapse to one line; the choice is remembered per card.
- Nothing is removed from the card: every field and chip is one click away.
- The failure is said once, in the Failed block (#708).
- The Calls row (the deployed apps it calls, as chips) shows in Plan only; Live leaves it off (#710).

## To design

1. **A collapsed section's line**, for each section:
   - Fields (Branch, Started by, Tunnels, Queues): their values in one line, e.g. `main · Koppler · tunnels on · queues off`.
   - Databases: `2 databases · 1 tunnel shown`.
   - Note for the agent: its first line.
   - Calls PROD: `Calls 12 deployed apps`, with the chips on open.
2. **The control** that collapses and opens a section, and how a person collapses or opens all at once.
3. **The card fully collapsed and fully open**, with the content below, at the board's normal zoom.
4. **A failed card collapsed**: the Failed block and its button above the folded sections.
5. **Light (Paper)** for 3 and 4.

## Content to use

Acme Shop. Mobile API (.NET), branch `main`, started by Koppler, tunnels on, queues off.
Databases: Cache (Valkey, tunnel off) and Orders DB (Aurora, tunnel shown).
Note for the agent, six lines: "Repro: /user throws for accounts whose only order is cancelled (e.g. order 1001). Accounts API stays deployed; a date of birth mismatch reproduces via sign-up with customer 2002 and a wrong date of birth."
Failed to start: `mobile-api exited before answering on port 57057`.
Calls PROD: Web Shop, Payments API, Booking API, Wallet API, Product Catalog, Basket, Properties API, CRM API, Academics API, Customer Service API, Notifications API, Departures.

## Rules that stay

- Patch bay: Barlow, Barlow Semi Condensed, Sometype Mono; square corners; hairlines; sentence-case sans for words, mono for values; white as the only filled button; colour only for state (local, deployed, live, warn, prod).
- Names are the Acme Shop examples, never a real stack.

## Open points (with your default)

- Which sections start collapsed - default: Databases, Note and Calls collapsed; fields open.
- One control per section, or one for the whole card - default: one per section, plus collapse all in the card's actions.

## How to work

- Re-read the published canvas before editing; it may have changed since you last wrote it.
- Edit in place. Never delete or rename a file without asking; stop and report the question instead.

## Done means

- One line per section: what it shows.
- Each open point you decided, and why.
- Anything you could not check, with the reason.
