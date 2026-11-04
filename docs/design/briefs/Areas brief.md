# Areas: show only your part of a big stack

For Claude Design, working on this canvas, Koppler.
Koppler runs a few apps of a stack locally, wired to each other, while the rest call a deployed environment.

## The job

A stack for a whole product grows to 30-40 apps and a dozen team boards, and each person works on one part of it.
Areas are a label on apps, so the board menu and the side panel's Apps list show only the areas a person picks.
Design it as one canvas file, `Koppler Areas.dc.html`, in Patch bay: Mono, plus Paper to check light.
One numbered section per item under "To design".
Issue: https://github.com/evan-mcgeek/koppler/issues/680

## Read first

- `Board picker brief.md` and `Koppler Board Picker.dc.html`: the board menu in the bar this builds on (340 px, Find a board, Team boards, Your boards, the stack as the first row at 1010), and section 4: the side panel then starts with Apps.
- `Koppler Design System.dc.html`: the Apps list ("Apps · 5 of 6 on the board", Sort A-Z, the "Find or filter: a name, .net, lambda" field, rows of kind | name | light), type, schemes, components.
- `Side panel brief.md`: a parallel round on the same Apps list (rows with hover-only actions, a resizable panel). Design the area filter so it fits either width, 280 to 560 px.
- `Koppler Settings Panel.dc.html`: the settings side panel and its channel index, for the Areas tab and the app's Areas field.
- `Koppler Discover.dc.html`: the Discover map, for how hidden apps leave it.

## Settled (do not redesign)

- An area is defined once in the stack (an id and a name). An app has a list of areas and can be in several. An app with no area shows in every area.
- A board's area is worked out from its apps: the area most of its apps belong to, counting only apps that have one. A tie goes to the smaller area. A board can set its area by hand, and go back to worked out.
- One choice of areas per person, per stack, kept on their Mac. The board menu and the Apps list show the same choice. All on is the same as no filter.
- Team boards group under their area, then a "No area" group. Your boards stay one list, each showing its area as a value.
- Find a board searches every board, also those the areas hide; a hidden match says so.
- Discover hides apps outside the chosen areas.
- Apps on the current board always show in the Apps list, even outside the chosen areas.
- The Apps list's "Find or filter" field stays; the area filter narrows the list first, and the field filters within it.
- A view, not a boundary: environments, runs and secrets are unchanged. Nothing is renamed.
- A stack with no areas shows nothing new.

## To design

1. **The area filter.** How a person picks areas, in the board menu and above the Apps list, next to the existing "Find or filter" field. Several can be on at once. Also how the control reads when every area is on, and when one is.
2. **How an area is marked** on a board row, an app row and a card. Colour is for state only in Patch bay, so not a colour per area.
3. **The board menu with areas** at 1440 and at 1010 (stack as the first row): team boards grouped by area, No area last, your boards as one list, and a line saying how many boards the areas hide, with a way to show them all.
4. **Find a board while areas filter:** a match in a hidden area, and how it differs from a shown one.
5. **The current board outside the chosen areas:** the bar's board segment and the menu.
6. **A board whose area was set by hand**, and one whose apps tie; where a person sets or clears a board's area.
7. **The Apps list filtered:** apps in one area, in several, in none, and the count in the heading (shown of total). Every app filtered out except the board's own. Areas and the Find or filter field both on.
8. **The app's Areas field** in the app's settings: pick several of the stack's areas.
9. **An Areas tab in the stack's settings:** add, rename, remove an area, with how many apps and boards each has. What removing one used by apps asks.
10. **Discover with areas on:** the map with the other areas' apps gone, and how the person knows some are hidden.

## Content to use

Acme Shop examples. Areas: Payments, Shipping, Notifications, Accounts.
Apps: Web Shop and Mobile App (no area), Orders API (Payments, Shipping), Payments API, Basket, Pricing (Payments), Shipping API, Carrier Gateway (Shipping), Notifications API, Push Sender (Notifications), Accounts API (Accounts).
Team boards: Checkout (Payments), Refunds (Payments), Track a parcel (Shipping), Push to phone (Notifications), Sign up (Accounts), Smoke test (No area: only Web Shop and Mobile App), Order emails (set by hand to Notifications).
Your boards: Refund debugging, Carrier timeouts.

## Rules that stay

- Patch bay: Barlow, Barlow Semi Condensed, Sometype Mono; square corners; hairlines; sentence-case sans for words, mono for values, mono caps only for codes; white as the only filled button; colour only for state (local, deployed, live, warn, prod).
- Names are the Acme Shop examples, never a real stack.

## Open points (with your default)

- The filter control (chips, a segmented control, a checklist behind a button) - default: the one that fits the bar and the 340 px menu best; show the runner-up beside it.
- How an area is marked - default: the area name as a mono value, no new colour.

## How to work

- Re-read the published canvas before editing; it may have changed since you last wrote it.
- Edit in place. Never delete or rename a file without asking; stop and report the question instead.

## Done means

- One line per section: what it shows.
- Each open point you decided, and why.
- Each state above you could not draw, and why.
- Anything you could not check, with the reason.
