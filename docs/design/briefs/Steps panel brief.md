# Steps panel: a flow you can read

For Claude Design, working on this canvas, Koppler.
Koppler maps how a stack's apps fit together. In Discover, a feature board (a flow) is a list of phases, each a list of numbered steps; the panel on the left lists them and the map draws each step as a link with its number.

## The job

On real flows the steps panel is nearly unreadable and far too long. The user enjoys Discover; this panel is the part that fails.
The agent that writes a flow puts its findings in each step's note: class and method names, config paths, field names, dates, often 300 to 500 characters with no spaces to break on. Today every note shows in full, so one phase fills the window, and the step itself (who calls whom) drowns in grey.
Design the fix as one canvas file, `Koppler Steps Panel.dc.html`, in Patch bay: Mono, plus Paper to check light. One numbered section per item under "To design".

## Today (as built)

- Panel 300 px wide, padding 16 x 18, scrolls on its own. Above the steps: the board name (26 px display), "Feature board · 3 steps", the request in a box, then "Walk through the steps".
- A phase: an 18 px ink square with its number, then the name at 600 15 px. Some names already start with their own number, so it reads "1 1. Campaign switch".
- A step row: the number ("2.3", mono 11 px, 30 px column), then three lines stacked at 2 px gap: the from app (500 14 px), the verb and the to app ("calls Payments API", 13 px), the note (12 px, `--ink-muted`), breaking anywhere. Hairline under each row, 9 px vertical padding.
- A step picked on the map (or walked to) is tinted and scrolled into view. A proposed step adds Proposed with Accept and Drop. Comments show as a count at the row's end; a remove button shows on hover.
- The walk-through bar at the bottom of the map already shows the picked step's note in full.

## Read first

- `Koppler Discover.dc.html`: Discover, the map, the panel as first designed.
- `Koppler Discover and Run.dc.html` and `Koppler Side Panel.dc.html`: the side panel's width, rows and the resizable edge.
- `Readability brief.md` and the type scale it settled in `Koppler Design System.dc.html`: sizes, weights and muted contrast for small text.

## Settled (do not redesign)

- The panel stays on the left, beside the map; phases and numbered steps stay, with the numbers the map shows.
- The note keeps every word the agent wrote: the full text is always one action away, and the walk-through bar keeps showing it.
- Picking a step on the map picks its row, and the reverse; proposed steps keep Accept and Drop; comments and remove keep their place.
- The exported page (view only, for non-technical readers) uses the same panel without the editing controls.

## To design

1. **A step at rest:** who does what to whom as one readable line or two (e.g. "Orders API → Payments API", with the verb), and how much of the note shows: none, a first line, or a clamp with a way to open it.
2. **A step opened:** the full note set as readable text, with technical identifiers (class names, paths, field names) told apart from prose without turning the panel into code.
3. **A step picked or walked to:** how it differs from at rest; whether it opens by itself.
4. **A phase:** its header, its number shown once even when the name carries its own, and whether a phase can fold to just its header.
5. **The whole panel** on a real-sized flow (3 phases, 9 steps, long notes) at 1440 x 900: what fits in one screen before and after, side by side with today's.
6. **The same on the exported page** (no editing controls), Mono and Paper.

## Content to use

Acme Shop, flow "Black Friday discount", long notes on purpose:

- Phase "1. Campaign switch": 1.1 Web Shop calls Orders API, note: "featureFlags query now returns discountCampaign (BLACK_FRIDAY when /OrdersApi/Parameters/DiscountCampaign/BlackFriday FeatureFlag=true and today UTC is between StartDate 2026-11-09 and EndDate 2026-12-03; DiscountCampaignCalculator) and discountVariant (POST_ORDER once today > active)".
- Phase "2. Discount code (CRM to shop)": 2.1 Code Generator uses CRM Account, note: "AccountChangeHandlers.FlagAccountForCodes sets CodeId__c = CODE_PENDING on non-staff accounts; GenerateDiscountCodeBatch fills the code, then FlagAccountForShortURL + GenerateShortLinkBatch fill ShortURL__c."; 2.2 CRM Replication uses CRM Account, note: "Replicates Account (CodeId__c) out of the CRM for Customer Graph."; 2.3 Customer Graph calls CRM; 2.4 Customer Service API calls Customer Graph, note: "GetCustomerByIdCS reads Account codeid__c as discountURL; CustomerMapper builds {shopUrl}/discount/?code={token}."
- Phase "3. Checkout": 3.1 Web Shop calls Basket; 3.2 Basket calls Payments API, note: "Applies the code before tax."; 3.3 Payments API publishes to Order events (no note).

## Rules that stay

- Patch bay: Barlow, Barlow Semi Condensed, Sometype Mono; square corners; hairlines; sentence-case sans for words, mono for values, mono caps only for codes; colour only for state.
- Names are the Acme Shop examples, never a real stack.

## Open points (with your default)

- How much note shows at rest - default: one line, clamped, opening on a click of the row; a step with no note takes no extra line.
- A phase name that starts with its own number - default: the app drops a leading "1." that matches the phase, so the number shows once in its square.
- Notes this long are partly a content problem - default: design for them as they are; say if a short summary line written by the agent (plus the full detail) would read clearly better, and the app will ask the agent for one.

## How to work

- Re-read the published canvas before editing; it may have changed since you last wrote it.
- Edit in place. Never delete or rename a file without asking; stop and report the question instead.

## Done means

- One line per section: what it shows.
- Each open point you decided, and why.
- Anything you could not draw or check, with the reason.
