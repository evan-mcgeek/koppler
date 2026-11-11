# Scheduled jobs: draw the jobs a flow runs on a schedule

For Claude Design, working on this canvas, Koppler.
Koppler runs a few apps of a stack locally, wired to each other, while the rest call a deployed environment.

## The job

Many backends have scheduled jobs next to their API (ECS scheduled tasks, EventBridge rules, a Lambda on a cron).
They read and write the same systems, so a flow is not complete without them.
Design how a job shows on the canvas as one canvas file, `Koppler Scheduled Jobs.dc.html`, in Patch bay: Mono, plus Paper to check light.
One numbered section per item under "To design".
Issue: https://github.com/evan-mcgeek/koppler/issues/706

## Read first

- `Koppler Design System.dc.html`: the app card, the zoomed-out card, the Apps list row, type, schemes, components.
- `Koppler Discover.dc.html`: the Discover map and feature boards with phases and numbered steps.
- `Koppler Side Panel.dc.html`: the Apps list.
- `Koppler Settings Panel.dc.html`: an app's settings.
- `Koppler Databases.dc.html`: how an always-deployed card sits beside local ones.

## Settled (do not redesign)

- A job is an app with a schedule, not a new kind: it keeps its kind (.net, lambda) and has its own card, beside the API it shares a repo with.
- Its schedule is per environment, e.g. `cron(0 0 * * ? *)` or `rate(20 minutes)`. The card shows the schedule of the board's environment; every environment's schedule is in Settings.
- Koppler never runs a job on this Mac. It is always the deployed one: Run leaves it alone, as it does an outside system. It has no URL, health check or local state.
- A job has a card in Discover only, so a flow is drawn completely, with the job's own calls. Plan and Live draw no job card: a local app's card says when a job uses the same deployed database, and the Apps list has a folded Scheduled jobs group (decided on the canvas, Nov 2026).

## To design

1. **How a job reads as a job:** the schedule on the card in words (every 20 min, daily 00:00 UTC), with the expression on hover. Colour stays for state only.
2. **A job is always deployed:** the job card on a board beside local and deployed apps, and while the board runs. Nothing on it suggests it can be started here: no Run, Stop or Restart, no local-state light.
3. **The zoomed-out card** for a job.
4. **The Apps list row** for a job, so jobs are told apart from services at a glance.
5. **Settings for a job:** the Schedule field per environment, and the fields a service has that a job does not (URL, health check, how to start it).
6. **A feature board** where a phase starts from a job: Nightly settlement reads the orders database and calls Payments API, in Discover and on the map.

## Content to use

Acme Shop. Orders API (.NET, a service). Nightly settlement (`cron(0 0 * * ? *)` on qa and prod) and Fraud check (`rate(20 minutes)` on prod, `rate(1 hour)` on qa), both from Orders API's repo. Payments API, the orders database, Notifications API.

## Rules that stay

- Patch bay: Barlow, Barlow Semi Condensed, Sometype Mono; square corners; hairlines; sentence-case sans for words, mono for values; white as the only filled button; colour only for state (local, deployed, live, warn, prod).
- Names are the Acme Shop examples, never a real stack.

## Open points (with your default)

- The schedule mark: a clock glyph with words, or words only - default: a clock glyph and words in mono.
- Whether the card says which app it shares a repo with ("from Orders API") - default: yes, on the glance line.

## How to work

- Re-read the published canvas before editing; it may have changed since you last wrote it.
- Edit in place. Never delete or rename a file without asking; stop and report the question instead.

## Done means

- One line per section: what it shows.
- Each open point you decided, and why.
- Each state above you could not draw, and why.
- Anything you could not check, with the reason.
