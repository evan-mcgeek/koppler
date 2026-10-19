# Design

Koppler's look, Patch bay, was designed in [Claude Design](https://claude.ai/design).
This folder keeps what came out of it, so the design travels with the code.

- `images/`: each design file rendered, to read on GitHub.
- `sources/`: the design files themselves (`.dc.html`). They open in Claude Design; on their own they do not render, because they load Claude Design's runtime (`support.js`), which is not ours to publish.
- `briefs/`: what was asked of Claude Design, in order.

| Design | What it settles |
|---|---|
| [Design system](images/design-system.png) | Colours and schemes, type, space, shape, components, the board, the review, the landing hero and social card |
| [Patch bay fixes](images/patch-bay-fixes.png) | State colours, type hierarchy, icons, tunnel and queue cards, the review, focus, cable ends |
| [Settings panel](images/settings-panel.png) | The settings side panel; the canvas uses option 1b |
| [Databases](images/databases.png) | Databases as their own cards ([#509](https://github.com/evan-mcgeek/koppler/issues/509)) |

The mark is `sources/KopplerMark.dc.html`; the canvas draws it in `app/canvas/Mark.svelte` and `app/canvas/public/favicon.svg`.
Names, hosts and apps in these files are examples (Acme Shop), not anyone's real stack.
