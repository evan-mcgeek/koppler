# The canvas

The canvas is a page in your browser where you build what should run, run it and watch it.
It is served on your machine only, and its address stays the same across restarts.

## Boards and team boards

The board holds the apps you want running locally.
Every board you build is saved as you change it, per stack.
Team boards are boards the stack shares with everyone who uses it; one click opens one.
A team board you change becomes your own copy.
**Share with team** proposes your board as a team board of the stack: a pull request on the stack's repo on GitHub, made from the team's `stack.json` as it is there, so nothing else on your Mac goes with it. Your team gets it once the pull request is merged.
A stack that is not on GitHub keeps the board among its team boards in its file here, for you to commit.
The same is `koppler board share "<name>"` in the terminal.
A board file can also be opened, dropped on the page or linked from GitHub.
`koppler board new "<name>"` makes a board from the terminal, and `koppler board edit "<name>"` changes one, even one open on the canvas.

## Cards

<img alt="One feature, Checkout, worked on across four apps: the mobile app and web shop cabled to a local Orders API, which calls a local Payments API; each runs its feature/checkout branch, Orders API has its deployed QA database and a local SQS queue, two apps carry a note for the agent, and everything runs" src="images/board.png">

Each app is a card with:

- **Who starts it:** Koppler, from the terminal, or you, from your IDE.
- **Device**, for a mobile app: iOS simulator, Android emulator or a phone on the same Wi-Fi.
- **Branch:** the clone's branch, or another one to switch to. Uncommitted changes can be set aside or taken along, and come back on Stop.
- **Note:** an instruction for the agent about this app, such as a feature flag or a test account (needs the [agent add-on](../README.md#the-agent-add-on)).
- **Local libraries:** when another of your clones publishes a package the app depends on, the app can use your local copy instead.
- **Status, steps and log** once it runs.
  After a run starts an app, Koppler reads its log for its first 30 seconds: the **First 30 s** step says it found no errors, or shows the lines that tell of one and hands them to the agent.

Apps you have not cloned yet show greyed out, with the command to clone them.

Pointing at a card shows its actions above it: run it alone, stop or restart it while it runs, its log, its settings, and taking it off the board.

<img alt="A running card: its actions above it, its branch, all its steps done, and the deployed app it still calls" src="images/card.png" width="320">

## Settings

**Settings** in a card's tools, the gear on a queue or outside system, and **Stack settings** in the top bar's Settings menu open settings: every fact the stack holds about that thing, in tabs.

<img alt="An app's settings: its name, kind and slug, then tabs; Runs here shows its start command, local address, readiness check and more, each with a lock" src="images/settings.png" width="480">

- Changes are a draft until **Save**, which checks the whole stack and says where anything is wrong. **Discard** drops them, and closing with changes asks first.
- **Needs first** lists what an app needs before it runs, one row each: a tunnel, an AWS sign-in, a hosts entry, a sign-in of the stack's own, the local HTTPS certificate, a private package feed. **Add a need** asks which, then shows only that kind's fields.
- What Koppler knows is picked, not typed: the kind, the AWS profile (names from your AWS config), the project, launch settings, launch profile or script from the app's clone, the apps it calls, the queues it uses.
- **Environments** shows what each environment after the first uses: its own value, or the first one's.
- The lock beside a field keeps it as it is, for you, for commands and for the agent. Unlocking from the terminal (`koppler stack unlock`) asks you.
- **Ask the agent to fill in** has the agent read the repo and propose the empty fields; locked fields stay.

The same fields can be read and changed with `koppler stack get`, `set` and `unset`.

## Appearance

The canvas is dark, with square corners and hairlines, and colour only as a signal: one colour for what runs on your machine, one for what still calls the deployed environment, amber when something needs you, and red for PROD and failures.
**Appearance**, in the top bar's Settings menu or behind the gear at the bottom of the side pane, has eight schemes, five dark (Mono, the default, then Patch bay, Signal, Scope and Sodium) and three light (Paper, Blueprint and Workshop), and the local and deployed colours picked by hand over the scheme.
Warning and PROD colours are never among the picks, so a custom colour can never be mistaken for either.
PROD stays red and striped in every scheme.
Your choice is kept in this browser.
Nobody edits `stack.json` by hand.

## Cables

A cable from one card to another points the caller at the local copy of that app.
Every call without a cable goes to the deployed app of the chosen environment.

- Drag from a card's socket to another card to plug a cable.
- Let go on the empty board to drop a waypoint; click to add more, click a card to finish, press Escape to cancel.
- Slide a cable's end along its side to reorder the cables on that side.
- Pull an end away from its side to start a new cable from that port.
- Click a cable to pick it; the × in its middle, or Delete, unplugs it.
- Pick a card or a cable to see what it joins: its cables are drawn strong and the rest of the board fades.
- **Arrange** lays the board out by who calls whom.

Cables are always curves, so any board you see is one you could draw yourself.
A cable leaves its caller from a hollow ring and plugs into the app it calls at a solid socket.

## Databases, tunnels and queues

These appear next to the app that uses them, and show or hide with it.

<img alt="Orders API and Payments API, their databases Orders and Payments behind one tunnel to the Aurora cluster: the tunnel card has a row for each database, open for both, and each database card is deployed on QA and reachable" src="images/databases.png">

- **Databases** the stack names under `databases` each have a card, with a switch between **Deployed** (dashed: the environment's database, through its tunnel) and **Local** (solid: your own database on this Mac).
  The first time a database goes Local, its card asks where it runs (host, port, database name), with **Test connection**; the address is kept on this Mac only, never in the stack, and can be changed from the card or the database's settings.
  A run points each app at its local database through its setting, or the one line the stack says to change, undone on Stop. Deployed on PROD asks first.
- The tunnel card has a row per database behind it, and the line to each database leaves from its row. **Show tunnel** on an app's card draws its line through the tunnel card, or straight to the database; by default the tunnel shows when two or more apps on the board share it. A right click on a line does the same.

- **Tunnels** carry an app to a deployed database or service. Koppler opens one per host and port, shared by the apps that need it, and moves a clashing one to a free port. Each can be left out of a run, and one that runs can be restarted from its card when calls through it hang.
- **Queues** an app on the board publishes to or reads from show which apps do: SQS queues and Kafka topics, the ones Koppler can run here. A switch on the card picks **Deployed** (local apps use the environment's queue) or **Local** (Koppler starts an SQS emulator or a Kafka broker in Docker and points every app on that queue at it). A queue can be hidden and shown again from its app.
- Everything that never runs here is in Discover, not on the board: outside systems (a payment provider, a CRM), SNS topics and event buses, and what feeds a queue from further up. Click an outside system in the Apps list to open it there; add one with **Add outside system…** under the list.
- Every link with a direction leaves its sender as a small dot and lands in the receiver's ring, with a chevron pointing in: into a queue publishes, into an app from a queue reads, into another app calls. Database and tunnel links go both ways: a dot at each end.
- Pick a card, or Shift-click several, to trace them: their links stay lit and say what they do, everything else fades back. Point at a link and it says who does what.
- What a board hides stays hidden with that board: a board for one flow can leave out the queues of the others.
- Every card, not only an app's, takes a note for the agent, kept with the board and handed to the agent with the run. On a queue, a database or a tunnel, pick the card and choose **Add note** in its foot; a written note reads as text, and a click opens it to edit.

## Environment

The environment switch in the header lists the stack's environments.
Unplugged calls, tunnels and deployed queues follow it.
On PROD the whole page is framed in red, with a striped band under the header.

On a production environment the review shows anything that blocks the run first, keeps the plan's header and footer in view, and pressing Run there is the confirmation.
Queries against production stay in your own terminal.

## Run and Stop

**Run** shows the plan first: what starts, restarts and stops, and what you have to do before (a sign-in, a secret, a `sudo` step).
Nothing starts, stops or restarts until you confirm it there; then Koppler runs the board by itself.

<img alt="The review before a Run on QA: the four apps that start on feature/checkout with their notes for the agent, what keeps calling deployed QA, and the tunnel that opens" src="images/review.png" width="480">

With the agent add-on, Run's menu has two more ways: **Run with a note for the agent…** passes an instruction for the whole run, and **Get a checklist instead** asks the agent for a per-app checklist instead of changing anything.
The agent answers on the canvas, with buttons for its questions.
The agent chip in the toolbar says where the agent is:

- **Agent connected:** one is listening.
- **Agent working, N min:** it took a request and has not finished it.
- **Agent needs you:** it asked something; the question is in the inbox.
- **Agent quiet, N min:** it has been working for over ten minutes without a word.
- **No agent listening, N waiting:** requests wait until one connects.

The chip opens the agent's messages; with no agent listening, or one gone quiet, they offer **Connect an agent** with the steps.

**Stop** stops what Koppler started and undoes the run: changed settings, linked libraries, switched branches.
**Stop apps, keep changes** stops the processes and leaves the changes in place.
**Shut down Koppler**, in the same menu, stops everything and the canvas too.

## Views and shortcuts

**Discover** shows how the stack fits together around the board: its apps, and every app, queue, database, resource and outside system one step from them, read from the stack.
Nothing on it runs or changes the board.
Its tools are the board's: Select and Hand, Undo, Arrange (each press the next layout), Fit, zoom and Present, with the same keys; dragging over the map picks the cards in it, and the overview sits in the corner.
A card's **+N** brings in the links it leaves out; a dashed link was found in the code and is not in the stack yet, and **Confirm** in the panel keeps it there.
A card added or changed in your stack and not in the shared one yet (not committed in the stack's repo, or for a stack linked from GitHub, not merged there) is tagged **New** or **Changed**; its panel says which fields changed.
An app whose clone is on another branch than its repo's main one, or has files changed, says so on its card (`feat/refunds, 3 changed`); its panel names the apps that call it, which would meet those changes.
A call whose place in the code is known (where it was found, or the settings file the stack names) has **Open in editor**, which opens that file in the caller's clone, at its line, in VS Code or any editor that takes `vscode://` links.
A **?** on a link means the stack records the call without saying where it comes from (no setting, file or place in the code): **No source yet**.
Resources are what the stack's `resources` name: an S3 bucket's link says whether the app **reads**, **writes** or **both**; an API Gateway's panel lists its routes and what each hands to; a Step Functions panel lists what starts it and its steps in order.
**Read again** reads the code once more: your clones, and, with your `gh` login, the repos not cloned here, from a copy Koppler keeps for reading only (`koppler sync --github`).
An app whose repo holds other apps of the stack too (a Lambda in an API's repo) shows that repo above its name.
A queue or topic something sends to that nothing reads or passes on is flagged **Dead end · no readers**: its links stop at a bar.
Pick several cards (Shift-click) and **Plan a run with these** puts the cloned ones on the board; the rest stay deployed and are listed in **Left out**, with a clone command for each app.

<img alt="Discover on QA: the board's apps with what they touch one step away, Orders API picked and its links listed in the panel" src="images/discover.png">

A **feature board** (New feature board in the boards menu) is for one feature: the request it came from, and which of the stack's links it uses, as numbered steps in phases.
Describe the feature and **Hand it to the agent**: its proposals show dashed, each with Accept and Drop, until you accept them; accepting a link the stack does not have yet records it there.
Or start from an app, and add a picked card's links with **Add as a step**.
The panel on the right holds the request and the steps: pick a phase to dim the others, rename it, or take a step off.
**Walk through the steps**, or click a step's number on the map, to follow the feature one step at a time: → and ← move on and back, each step brought into view with its note, and Esc stops.

<img alt="A feature board, Checkout: its steps numbered in two phases on the map and in the panel, and one step the agent proposed, dashed, with Accept and Drop" src="images/feature-board.png">

To show the flows to people who never run Koppler, such as a product team, share the feature boards with the team, then run `koppler export`.
It writes one page that opens in any browser with nothing to install or load: pick a flow, move its cards about, and walk its steps.
It holds each flow's request, steps and app names, and nothing else of the stack: no addresses, settings or code.
Run in the stack repo's CI (`koppler export site/index.html --stack .`), it stays as current as the stack, behind your company's own sign-in.

**Plan** shows every field of a card; **Live** shows what runs, with short cards.

<img alt="The Live view: short cards with their state, every app running" src="images/live.png">

Zoomed out below 60%, cards are short in Plan too: pick one and its fields open in a panel on the right of the board, where they change the card as they would on it. The × or a click on the empty board closes it.

<img alt="Zoomed out: short cards, and the picked Orders API's branch, who starts it and its cables in the panel on the right" src="images/zoomed-out.png">

**Present** shows the board alone, full screen.

| Key                                        | What it does                                                                                                     |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `D` / `E` / `L`                            | Discover, Plan, Live                                                                                             |
| `P`, then `Esc`                            | Present, and back                                                                                                |
| `F`                                        | Fit the board in the window                                                                                      |
| `/`, or `Ctrl+K` (`Cmd` on a Mac)          | Find a card on Discover's map by name; one the map does not show yet is brought onto it                          |
| `V` / `H`, or hold `Space`                 | Select by dragging, or move around: while moving around, a click or drag never picks, lets go of or moves a card |
| `Ctrl+Z` / `Shift+Ctrl+Z` (`Cmd` on a Mac) | Undo, redo                                                                                                       |
| `Tab`, arrows                              | Move between cards, and move the picked card                                                                     |
| `Delete`                                   | Take the picked cards off the board                                                                              |
| `Ctrl+Enter` (`Cmd` on a Mac)              | Run                                                                                                              |
| `?`                                        | All shortcuts                                                                                                    |

## The top bar

It keeps its words at 1280 pixels and wider.
As the window narrows it gives them up one step at a time: Settings drops its word, then the wordmark, then the two chips join into one, then Activity drops its word, then the stack's name is cut short.
Run, Stop, the view switch and the environment keep their words at every width.
The mark opens the shortcuts and legend, as `?` does.
Discover runs nothing, so its bar has no status, Activity, Stop or Run, and it shows the board's name, since Discover has no side pane.

## Side panels

**Activity** in the top bar holds Logs, History and Traces; **Settings** holds Stack settings, Credentials and Appearance.

- **Credentials:** the secrets the apps on the board need for this environment. Set, test or remove a value; a value is never shown.
- **Flow check:** tests every connection of the running board; with the agent add-on, it can hand failures to the agent to explain.
- **History:** recent runs and Stops and how each ended.
- **Logs:** each app's log opens as a tab under the board.
  The All apps tab shows every app on the board in one stream, in the order the lines came, each with the app's name in its colour.
  The apps are tags above it: click one to leave it out or bring it back, and the pencil gives it a short name of your own in this log, kept with the board.
  Times are to the millisecond; one marked `~` is when Koppler first read the line, for a log Koppler did not write.
