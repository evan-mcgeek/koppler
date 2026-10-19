# Databases on the board: brief

Koppler is getting databases as their own cards. The behaviour is settled; nothing has a look yet. Please design it as one canvas file, `Koppler Databases.dc.html`, in Patch bay (Mono scheme, plus one light scheme to check), with one numbered section per item below.

Real content to use: two local apps, Orders API and Payments API. One tunnel, `db.qa.acme.example` on `localhost:5432`, leads to one Aurora Postgres server holding both apps' databases: **Orders** (the Orders API's) and **Payments** (the Payments API's). A cache, **Cache (Valkey)** on `localhost:6379`, is the same kind of card. Environments QA and PROD.

## What is settled (do not redesign)

- Each database or cache is its own card, named from the code and renamable, its kind as a tag (POSTGRES, MYSQL, VALKEY).
- The board reads app -> tunnel -> database. Several databases can share one tunnel card.
- Showing the tunnel is optional per app: hidden, that app's cable runs straight to its database card. By default the tunnel shows when two or more apps on the board share it, and is hidden when only one app uses it.
- Each database card has its own Deployed | Local switch. Deployed is the real QA or PROD database through the tunnel. Local is a database the user already runs on their Mac; its address is asked once and kept on this Mac.
- The tunnel opens first, once, while any database behind it is Deployed.
- Local is allowed on PROD; Deployed PROD keeps asking first.

## To design

1. **The database card.** Name, kind tag, Deployed | Local switch (the shared segmented control), state line, and what it says per state: reachable, not answering, tunnel down, Local not answering, not on this board. It replaces today's tunnel card for a database.
2. **The tunnel card.** Small, shared by several database cards. Host and local port, its state, Reconnect. How it shows that two databases hang from it.
3. **Cables.** App -> tunnel -> database, with two databases behind one tunnel. Then the same board with the tunnel hidden for one app: its cable runs straight to its database. How a deployed vs a local database cable looks.
4. **Showing or hiding the tunnel per app.** Where the control lives (the app card, its toolbar, the tunnel card) and what it is called, given the default above.
5. **Switching a database to Local.** The first time: asking for its address (host, port, database name), kept on this Mac. Later: the switch alone. What Local looks like on the card and the cable, so a local database is never mistaken for the deployed one.
6. **One database Local, another Deployed, same tunnel.** The tunnel stays open for the deployed one. Make that legible.
7. **PROD.** A Deployed PROD database card and its guard; a Local database on a PROD board.
8. **The Run review.** How databases read in it: which are Deployed through which tunnel, which are Local and where.
9. **Stack settings.** A Databases tab in the stack's settings panel (the channel index from `Koppler Settings Panel.dc.html`): the list of databases, each with kind, tunnel and hosts entry per environment, and which apps use it.
10. **An app that needs a code change to reach a Local database.** How the card says Koppler will change one line for the run and undo it on Stop.

Keep the system's rules: square corners, hairlines, sentence-case sans for words, mono for values, mono caps only for codes, white as the only filled button, icons only where fix 4 allows them.
