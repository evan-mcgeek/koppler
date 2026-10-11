# 1. TypeScript and a framework for the canvas

Status: accepted on 2026-10-10.
Decides issue [#64](https://github.com/evan-mcgeek/koppler/issues/64) and sets the plan for [#65](https://github.com/evan-mcgeek/koppler/issues/65).

## Where the code is today

Koppler works, but it is hard for a person to read and change.

| Measure | Value |
|---|---|
| `canvas.html` | 4,727 lines, 400 KB, one file |
| CSS in it | 981 lines, one global sheet |
| Script in it | 3,499 lines, 173 top-level functions, 209 top-level variables |
| Markup built as strings | 39 `innerHTML` assignments, 33 inline SVG icons |
| Event handlers wired by hand | 247 |
| Lines over 160 characters | 548 in the canvas, 77 in `koppler.mjs`; the longest is 1,518 |
| `koppler.mjs` | 912 lines: the CLI, the run engine, Stop and revert, and every command |
| `status-watch.mjs` | 697 lines: the HTTP server, status publishing and secret handling |
| Duplicated helpers | `readJson` and `load` in 4 modules each; `writeJson`, `fail`, `text`, `read`, `temp` in 3 each |
| Data files run as code | `vm.runInNewContext` in 12 places |

How the canvas is wired matters for the options:

- It is one page with no build step, served by the local server.
- Its data arrives as script tags (`registry.js`, `local.js`, `state.js`) and a `status.js` polled every two seconds.
- Five modules (`kinds`, `plan`, `presets`, `ports`, `logfmt`) are written by hand to work both as browser globals and as Node modules.
- One `render()` rebuilds the board; nothing is a component.
- Nothing is typed, so the shape of a stack, a board or a run exists only in the code that reads it.

Two things found on the way:

- Opening the canvas inside Lavish no longer works: the page loads `temp/registry.js` next to itself, and state moved to `~/.local/state/koppler`.
- The project had no runtime dependencies when this was written; the schema library (Zod) is now its one.

## Decision 1: TypeScript

| Option | For | Against |
|---|---|---|
| A. Stay on JavaScript | No change | The data shapes stay implicit; refactoring 12,000 lines without types is where regressions come from |
| B. JSDoc types checked by `tsc` | No build step | Verbose, weaker, and unusual for a codebase this size |
| **C. TypeScript, strict** | The standard; types for the stack, board and run are shared by the engine and the canvas; the compiler checks every refactor step | A build step for what is published |

**Decided: C.**
TypeScript in strict mode everywhere.
Node runs TypeScript directly from 24.12, but not for files inside `node_modules`, so the published package ships compiled JavaScript and keeps Node 22 as its minimum.
Development and tests run the TypeScript sources.

## Decision 2: the canvas

| Option | For | Against |
|---|---|---|
| A. Framework-free modules and a bundler | Smallest change, no new concepts | Keeps hand-written rendering and 247 hand-wired handlers; the spaghetti moves into files but stays |
| **B. Svelte 5, with Svelte Flow** | Least boilerplate; markup, script and styles of a component sit in one file, with styles scoped to it; the result reads closest to plain HTML and CSS | Smaller community than React; Svelte Flow reached 1.0 in 2025 |
| C. React, with React Flow | The most widely used; React Flow 12 is the more mature of the two | More boilerplate; hooks need discipline |

**Decided: B, Svelte 5 with TypeScript, built with Vite.**
The goal is code a person can read, and a Svelte component is the shortest path from today's page to that.

Svelte Flow (from the same team and on the same core as React Flow) covers what the canvas needs:

| Canvas feature | With Svelte Flow |
|---|---|
| Pan, zoom, drag, select, keyboard access | Built in; replaces most of the roughly 250 lines of pointer code |
| App, tunnel, queue and outside cards | Custom node components |
| Cables as curves through waypoints | A custom edge component that draws our own path |
| Sockets that slide along a side | Handles positioned by our slot order |
| Re-plugging a cable's end | Built in (edge reconnect) |
| Arrange | Stays our own algorithm; it only sets positions |
| Zoomed-out card form | A card variant chosen from the viewport zoom |

What it does not give us, and stays our code: the cable geometry, the slot ordering, Arrange, and the plan and review logic.
Those move out of the page into plain typed modules with unit tests first, so they survive the move unchanged.

The risk is the socket behaviour (sliding, reordering, starting a cable from an occupied socket), which took several rounds to get right.
So the first canvas step is a spike: one card type, cables with waypoints and sliding sockets on Svelte Flow, compared against today's canvas.
If the spike fights the library, the fallback is Svelte for everything around the board and our own SVG layer for cables.

Around the board:

- **State:** one typed store for the board, and a small data layer that polls the server; no data as script tags, the server answers with JSON.
- **Styles:** the existing design tokens in one file, and each component's styles scoped inside it.
- **Icons:** one icon set as components, replacing 33 inline SVG strings.
- **Lavish:** opening the canvas as a file inside Lavish is dropped; it is already broken, and the canvas has its own messages panel. The canvas is always served by Koppler's server.

## Decision 3: structure, tools and standards

One package, `app/`, with folders that each have one job, and imports allowed only downwards:

```
app/src/
  core/     the stack, boards, runs: types, validation, kinds, plan, presets (no I/O)
  engine/   processes, tunnels, queues, branches, the action log, secrets, discovery
  cli/      one file per command, argument parsing, help
  server/   the HTTP server: router, one handler per endpoint, status publishing
  canvas/   the Svelte app
```

- **Tests:** Vitest for units; Playwright for the canvas, starting from the checks already scripted by hand (Arrange, reload, cables, recent boards, the Run review).
- **Lint and format:** ESLint with typescript-eslint, and Prettier at 120 columns.
- **CI:** type check, lint, unit tests, canvas tests, package check.
- **Validation:** the stack schema defined once (Zod), which also gives the JSON Schema that issue #42 asks for.
- **Dependencies:** build-time only for the canvas (Svelte, Svelte Flow and Vite are bundled into it); the CLI gets the schema library as its one runtime dependency.

The standards the refactor holds to:

- **Single responsibility:** a module does one job and says which in its first line; a function fits on a screen.
- **KISS:** no abstraction without two real uses; no class where a function does.
- **DRY:** one home for JSON files, paths, process handling and output formatting.
- **YAGNI:** nothing is built for a case that does not exist yet; dead code and old migrations go.
- **Readable:** lines up to 120 columns, names that say what a thing is, comments only for why.

## How the refactor goes

Behaviour does not change during the refactor; each step is one pull request that passes every existing test.

1. **Safety net.** Turn the hand-run browser checks into Playwright tests, and the security demo into a kept end-to-end test.
2. **Tooling.** TypeScript (allowing JavaScript at first), ESLint, Prettier, Vitest, CI.
3. **Shared helpers and data.** One module each for JSON files, paths and output; data files become JSON, and `vm.runInNewContext` goes.
4. **Core.** Types and the schema for the stack, boards and runs; `kinds`, `plan`, `presets`, `ports`, `logfmt` become typed modules used by both sides.
5. **CLI and engine.** `koppler.mjs` splits into commands, the run engine, and Stop and revert; each engine area converts to TypeScript in its own pull request.
6. **Server.** A router and one handler per endpoint; the remaining server issues (#20, #27) are fixed as part of it.
7. **Canvas logic out.** Cable geometry, slots, Arrange and the plan view move into typed, tested modules, still used by the old page.
8. **Canvas spike** on Svelte Flow, then the decision to proceed or fall back.
9. **Canvas rebuild,** area by area: shell and toolbar, side panel, cards, cables, popovers, the Run review; the old page is deleted when the Playwright tests pass on the new one.

Steps 1 to 6 do not depend on the canvas choice and can start as soon as Decision 1 is accepted.

## Order

The remaining security and bug issues are fixed first, on the current code.
The refactor starts after them, so it does not carry known holes and each fix is reviewed on its own.
