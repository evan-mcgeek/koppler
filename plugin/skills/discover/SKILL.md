---
name: discover
description: Use when the user wants to understand how part of their stack works without running it ("how does checkout work", "what listens to Orders API", "what calls X", "find me how this feature works", "map this flow"), wants a stack or board made from a description or a diagram, or when the Koppler canvas sends a koppler-feature or koppler-comment prompt from Discover. It reads the stack and its repos, makes a feature board whose steps it proposes in phases, answers comments on it, and shares it as a page. Not for running apps on this Mac: that is koppler:plan.
---

# Koppler Discover

Discover is Koppler's door for understanding and sharing a flow; Run is the door for running a slice of it on this Mac (the koppler:plan skill).
Everything here reads the stack and the repos and writes only feature boards: nothing runs, nothing is started, no secret is touched.
It needs the `koppler` command on the PATH (`koppler --version`); when it fails, tell the user how to install it (`npm i -g koppler`) and stop.
To have the canvas's Discover requests reach this session, connect it as the koppler:plan skill says (`/koppler:plan connect`); its rules for talking to the user on the canvas (`koppler say`) and for ending each request (`koppler history done`, then listening again) hold here too.
Before a koppler command or flag you have not used this session, read its `--help` as the **koppler:help** skill says; never guess one.

## A question about the stack

"How does checkout work", "what listens to Orders API", "what happens when a payment fails": the answer is a feature board the user can read, walk through and share, and a short reply in the chat.

1. Read what the stack knows: `koppler stack get apps` (calls, queues, databases, outside systems), `koppler guide` for the whole picture, `koppler discover --find "<name>"` for a name the user used that is not an app's.
2. Read the repos of the apps on the way for what the stack does not record: the call, the route, the event, the handler. A fact is what the code shows, never a guess from a name.
3. Make the board, named after the question: `koppler board new "<question, shortened>" --request "<the question in the user's words>"`.
4. Propose its steps, in order, in phases: `koppler board edit "<board>" --phase "<phase>" --propose-step <from>:<to>="<what happens on it, where in the code>"`. A card is an app's id, `queue:<id>` or `database:<id>`; a link used again in a later phase is a step there too, with its own note.
5. Reply in a few lines: the flow in words, the board's name, and what you could not find. The user accepts each step on the board (Discover, the board menu, or Ask about on its home).

Never use `--step` for your own findings, and never change the stack: accepting a step on the board is what records a new link.

## The canvas's prompts

- A `koppler-feature` prompt comes from **Ask about** or a new feature board in Discover: `data.board` names the board and `data.request` is the feature or question in the user's words. Do steps 1, 2 and 4 above on that board; do not make another.
- A `koppler-comment` prompt is a comment the user left on a feature board, on a card or a step: `data.board` names the board and `data.comment` the thread. Look into what it asks in the stack and the repos, then answer in the thread with `koppler board edit "<board>" --reply <comment id>="<your answer>"`. When the answer is a step the feature misses, put `--phase "<phase>" --propose-step <from>:<to>="<why>"` in the same command: it is drawn dashed in the thread and on the map until the user keeps or undoes it. The user resolves the thread; on a team board the thread is the team's, so answer for the team.

## A stack or a board from a description

When the user describes a flow in words or attaches a diagram, and the stack does not have its apps yet, follow `references/research.md`: list what is named, find each one, confirm the facts from the repos, then propose the stack additions and a board, and make them only after a yes.

## Sharing

A feature board becomes a view-only page anyone can open in a browser: `koppler export "<file>.html" --board "<board>" [--env <env>]`, or **Share** in Discover's bar.
It shows the map, the steps, the walk-through and each app's description, never a host, route or setting.

## Rules

- **Never write a Koppler JSON file yourself.** Boards change through `koppler board new` / `koppler board edit`, the stack through `koppler stack set` after the user says yes.
- **Never touch secrets.** Discover never needs one; do not read, fetch, print or source any.
- **Facts from the code.** When the code does not settle a link, say so in the step's note or in the reply, instead of proposing it as certain.
