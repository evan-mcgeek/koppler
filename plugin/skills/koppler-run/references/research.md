# A stack from a description

The user describes a flow in words ("push notifications from the wallet to the app") or attaches a diagram (a drawing, a screenshot, an Excalidraw export).
You turn it into a proposed stack and a wired board. The description is a lead, not a fact: every fact comes from the repos.

## 1. Read the description

List every named thing and every arrow between them:
- apps, APIs, lambdas, workers, front ends;
- databases, caches, queues, topics and event buses;
- outside systems (Salesforce, Firebase, Kafka, a SaaS).

Show the list back to the user in one short message and fix what they correct before searching.

## 2. Find each one

`koppler discover --find "<name>" "<name>" ...` searches the stack, then the clones on this Mac, then GitHub in the user's own organisations (through their `gh` login).
- One match: use it.
- Several or none: ask which, showing the candidates; never pick one yourself. An archived repo is rarely the one meant; say so.
- Not cloned: give the clone command and ask before cloning anything.

Things that never run locally (a SaaS, an S3 bucket) become apps with an `outside` reason, so the stack still names them.

## 3. Confirm the facts from the repos

For every app that is cloned: `koppler discover` (local ports, tunnels, calls, conflicts) and `koppler discover --deployed` (deployed addresses, settings, secret names, calls from the Terraform).
Its kind, how it runs, its addresses and who it calls come from there, not from the description.
Where a repo disagrees with the drawing (a call that does not exist, a direction the other way round), say so and ask.

## 4. Propose, then write

Show the proposal before writing anything:
- the `stack.json` additions (apps, their facts, `consumes` for each confirmed call, `outside` systems);
- a board: the apps and the cables of the flow, as a shared or local board;
- open questions, one line each.

Write only after the user's yes: the stack's `stack.json` (then `koppler sync`), and the board as a preset.
A shared stack's change is for the user to commit (or `koppler link pr` for a linked one).

Queues, topics and event buses go under `queues`, with `publishes` / `reads` on each app (`references/stack.md`); confirm both ends from the repos and the Terraform, as for a call.
