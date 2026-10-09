# The canvas

The canvas is a page in your browser where you build what should run, run it and watch it.
It is served on your machine only, and its address stays the same across restarts.

## Boards and presets

The board holds the apps you want running locally.
Every board you build is saved as you change it, per stack.
Presets are boards the team shares in `stack.json`; one click loads one.
**Share** copies your board as JSON, ready to add to the stack as a preset.

## Cards

Each app is a card with:

- **Who starts it:** Koppler, from the terminal, or you, from your IDE.
- **Device**, for a mobile app: iOS simulator, Android emulator or a phone on the same Wi-Fi.
- **Branch:** the clone's branch, or another one to switch to. Uncommitted changes can be set aside or taken along, and come back on Stop.
- **Note:** an instruction for the agent about this app, such as a feature flag or a test account (needs the [agent add-on](../README.md#the-agent-add-on)).
- **Local libraries:** when another of your clones publishes a package the app depends on, the app can use your local copy instead.
- **Status, steps and log** once it runs.

Apps you have not cloned yet show greyed out, with the command to clone them.

## Cables

A cable from one card to another points the caller at the local copy of that app.
Every call without a cable goes to the deployed app of the chosen environment.

- Drag from a card's socket to another card to plug a cable.
- Let go on the empty board to drop a waypoint; click to add more, click a card to finish, press Escape to cancel.
- Slide a cable's end along its side to reorder the cables on that side.
- Pull an end away from its side to start a new cable from that port.
- **Arrange** lays the board out by who calls whom.

Cables are always curves, so any board you see is one you could draw yourself.

## Tunnels, queues and outside systems

These appear next to the app that uses them, and show or hide with it.

- **Tunnels** carry an app to a deployed database or service. Koppler opens one per host and port, shared by the apps that need it, and moves a clashing one to a free port. Each can be left out of a run.
- **Queues** (SQS, SNS, EventBridge, Kafka) show which apps publish and read. A switch on the card picks **Deployed** (local apps use the environment's queue) or **Local** (Koppler starts an SQS emulator or a Kafka broker in Docker and points every app on that queue at it). A queue can be hidden and shown again from its app.
- **Outside systems** (for example Salesforce) are dashed cards: things the apps call that are never run locally.

## Environment

The environment picker lists the stack's environments.
Unplugged calls, tunnels and deployed queues follow it.

On a production environment the review shows anything that blocks the run first, keeps the plan's header and footer in view, and pressing Run there is the confirmation.
Queries against production stay in your own terminal.

## Run and Stop

**Run** shows the plan first: what starts, restarts and stops, and what you have to do before (a sign-in, a secret, a `sudo` step).
Nothing starts, stops or restarts until you confirm it there; then Koppler runs the board by itself.

With the agent add-on, Run's menu has two more ways: **Run with a note** passes an instruction for the whole run to the agent, and **Get a checklist** asks the agent for a per-app checklist instead of changing anything.
The agent answers on the canvas, with buttons for its questions.
The agent chip in the toolbar shows whether one is connected; without one, those requests wait until it connects.

**Stop** stops what Koppler started and undoes the run: changed settings, linked libraries, switched branches.
**Stop apps, keep changes** stops the processes and leaves the changes in place.

## Side panels

- **Credentials:** the secrets the apps on the board need for this environment. Set, test or remove a value; a value is never shown.
- **Flow check:** tests every connection of the running board; with the agent add-on, it can hand failures to the agent to explain.
- **History:** recent runs and Stops and how each ended.
- **Logs:** each app's log opens as a tab under the board.
