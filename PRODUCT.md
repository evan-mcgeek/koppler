# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Any developer who needs other apps of their stack running locally without knowing how to run them.
Mobile and frontend developers benefit most.
They can work next to an AI agent (any harness), which fills in missing facts and fixes what fails; Koppler does the starting, wiring and reverting itself.

## Product Purpose

Koppler composes a local run from a graph: chosen apps run locally and call each other, every unwired dependency keeps calling a deployed environment (QA or PROD).
The canvas is where the user builds that graph, runs it, and watches what runs.
Success is trust at a glance: it is always clear what runs where, what is broken, and that nothing starts, stops or restarts without an explicit yes.

## Positioning

Local development only, for developers who should not need to learn how each backend runs.
Not a backend tool for working inside a shared cluster (mirrord, Telepresence, Signadot), and not deployed-to-local traffic routing.

## Operating Context

- The canvas runs in a browser tab next to the IDE and the agent's terminal, often for hours.
- Stack facts come from a shared `stack.json` in the team's repo; private state (layout, presets, run state, secret values) never leaves the machine.
- Flows: pick a stack, load a preset or drag apps onto the board, wire cables, choose the environment, press Run, review, then watch cards, logs, Flow check and History.
- Secrets are entered by the user in their own terminal; the agent and the canvas never see values.

## Capabilities and Constraints

- The canvas is a Svelte 5 page with Svelte Flow, built by Vite from `app/canvas/` and served locally by `status-watch.mjs`.
- Patch bay: eight schemes in Appearance, five dark (Mono by default) and three light, with the local and deployed colours pickable by hand; warning and PROD colours follow the scheme and are never offered as picks.
- Agent and harness agnostic wording.
- PROD is a dangerous mode and must always look different from QA.
- Undecided: whether "local integration testing" becomes part of the positioning.

## Brand Commitments

- Name: Koppler (a coupler connects separate components), written `koppler` in Barlow Semi Condensed beside its mark: a stem with two cables plugged into sockets.
- Look: graphite hardware with its labels printed on the panel, square corners and hairlines.
- Type: Barlow for words (labels, buttons, names), Sometype Mono for values you could copy (branches, hosts, ports), and mono capitals only for codes (a kind such as .NET, the environment, the PROD banner).
- Colour is a signal: `local` for a local cable and the one filled button, `deployed` for what still calls the deployed environment, green for what runs, amber for what needs you, red for PROD and failures.
- Icons for canvas tools people know from other tools; words for Koppler's own actions, and always for anything touching PROD or that cannot be undone.
- Voice: plain, short, sentence case; says exactly what will happen; never uses the em dash.

## Product Principles

1. Explicit over automatic: nothing runs, stops or changes outside what the user confirmed.
2. The board is the truth: what the canvas shows matches what is actually running.
3. Failures come with a next step, never just a red state.
4. Secrets are never exposed to the agent or the page.
5. Quiet by default, loud only for PROD and failures.

## Accessibility & Inclusion

WCAG 2.2 AA: 4.5:1 text contrast in every scheme, visible focus, 24px minimum targets, keyboard alternatives for board drag actions, reduced motion respected.
