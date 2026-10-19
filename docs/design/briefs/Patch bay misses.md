# Patch bay: misses in the built canvas

Patch bay is now built into the Koppler canvas (Mono scheme, dark only).
A review of the build against this design system found the misses below.

Note: `Koppler Settings Panel.dc.html` in this project was written by Claude Code, not by Claude Design, following this system. Its option 1b is what the canvas now uses.

Please design the fixes as one canvas file, `Koppler Patch Bay Fixes.dc.html`, with one numbered section per item.
Show the canvas as it is today next to your fix.
Keep every surface's real content: Orders API, Mobile App, Web Shop, Payments API, Catalog API, the Database (Postgres) tunnel on localhost:5432, Order events (SQS).

## System questions (decide these first; the rest follows)

1. One colour does four jobs. In Mono, local = ink = white, so a running LED, a selected segment, a local cable and the filled Run button all look the same. Give state its own signal: running, starting, failed, not on this board, selected.
2. Mono capitals are on almost everything: every field label, every toolbar word, every header button, card footers, section names. Nothing stands out because everything is shouted. Set a hierarchy: where mono caps belong, where sentence-case sans belongs, and where plain mono (values like branches and hosts) belongs.
3. The settings panel's channel index is numbered 01 to 08, but its sections are not a sequence. Either a reason for the numbers or a marker without them.

## Surface misses

4. Icons are left where Patch bay uses words: the header gear, the sidebar toggle, the sidebar's bottom-left gear, the "Az" sort glyph, and the refresh, gear and x icons on tunnel and queue cards.
5. The tunnel card (Database) and the queue card (Order events) still use the old look: 13px sans, an untagged kind ("SQS" is grey text, not an outlined tag like .NET), and a queue card with a heavy solid white border. Design them as part of the same family as the app cards.
6. The Review dialog: the focused Branch input shows the browser's blue rounded ring; "Started by" is a native dropdown while the card uses a Koppler | Me switch; "CALLS DEPLOYED QA" wraps onto two lines; nothing in it uses the deployed colour.
7. Header status: "All running" is bare text, while "Agent: Checkout flow" is a bordered chip. Make them one pair.
8. Two segmented controls disagree: QA | PROD is mono caps, Edit | Live is sans.
9. A card's "DETAILS" link reads as another label, not something to click; "Add repos..." and "Add outside system..." in the sidebar read as bold text, not actions.
10. Arrowheads are still on cables into tunnel and queue cards (Database to Payments API, Database to Order events), while cables between apps have none.
11. Focus: no visible keyboard focus style is defined. Give one, square and in the system's colours, for buttons, inputs, tabs and cards.

Keep to the system's own rules: square corners, hairlines, words instead of icons, white as the only filled button.
