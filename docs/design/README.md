# Design

Koppler's look, Patch bay, was designed in [Claude Design](https://claude.ai/design).
This folder keeps what came out of it, so the design travels with the code.

- `images/`: each design file rendered, to read on GitHub.
- `sources/`: the design files themselves (`.dc.html`), which open in Claude Design.
  On their own they do not render: they load Claude Design's runtime (`support.js`), which is not ours to publish.

| Design | What it settles |
|---|---|
| [Design system](images/design-system.png) | Colours and schemes, type, space, shape, components, the board, the review, the landing hero, the social card and the README banner |
| [Patch bay fixes](images/patch-bay-fixes.png) | State colours, type hierarchy, icons, tunnel and queue cards, the review, focus, cable ends |
| [Settings panel](images/settings-panel.png) | The settings side panel; the canvas uses option 1b |
| [Databases](images/databases.png) | Databases as their own cards ([#509](https://github.com/evan-mcgeek/koppler/issues/509)) |
| [Built while away review](images/built-while-away-review.png) | Card notes, link direction and two-line names, reviewed as built |
| [Link direction](images/link-direction.png) | Which way a link goes: a dot where it leaves, a ring and chevron where it lands |
| [Discover](images/discover.png) | The Discover view, feature boards, the zoomed-in calls level, planned and proposed cards ([#546](https://github.com/evan-mcgeek/koppler/issues/546)) |
| [Header](images/header.png) | The top bar at 1280 and narrower: Activity and Settings menus, and what gives way first |

The mark is `sources/KopplerMark.dc.html`; the canvas draws it in `app/canvas/Mark.svelte` and `app/canvas/public/favicon.svg`.
Names, hosts and apps in these files are examples (Acme Shop), not anyone's real stack.
