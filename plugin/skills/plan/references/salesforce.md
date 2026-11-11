# Reading a Salesforce org's links

Salesforce is one outside card in the stack.
Koppler has no Salesforce parser: you read the org's repos when the user asks, and record what you find on that card with the usual commands.

## When

Only on request: "map how Salesforce talks to our apps", or a `koppler-facts` prompt about the Salesforce card.
Read only the Salesforce repos the request touches, from the user's clone or from GitHub (`gh api`, `gh repo clone` into a scratch folder).
Never query a live org, never read its data, and never touch PROD.

## What to read

An SFDX repo has `sfdx-project.json` at its root and its metadata under `force-app/main/default/` (or the folders `packageDirectories` names).

| What                 | Where                                                                                | What it tells                                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| Named credentials    | `namedCredentials/*.namedCredential-meta.xml` (`<endpoint>`, or the `Url` parameter) | An API Salesforce calls, and its address                                                                                               |
| Remote site settings | `remoteSiteSettings/*.remoteSite-meta.xml` (`<url>`)                                 | An address Apex may call without a named credential                                                                                    |
| Platform events      | `objects/*__e/`                                                                      | An event Salesforce publishes, or reads with a trigger                                                                                 |
| Outbound messages    | `workflows/*.workflow-meta.xml` (`<outboundMessages>`, `<endpointUrl>`)              | A call a workflow makes                                                                                                                |
| Apex                 | `classes/*.cls`, `triggers/*.trigger`                                                | Which class calls a credential (`callout:<Name>`), publishes an event (`EventBus.publish`), or reads one (`trigger ... on <Event>__e`) |
| Flows                | `flows/*.flow-meta.xml`                                                              | A flow that creates an `__e` record (publishes) or calls an Apex action or external service                                            |

A credential often comes in pairs, one per environment (for example `OrdersApi` and `OrdersApi_Sandbox`).
Match each address to an app's deployed address (`koppler stack get apps.<id>.deployedUrl`, and each `envs.<env>.deployedUrl`) to know which app it is and on which environment.
An address no app owns is an outside system of its own: propose it, do not guess.

Calls into Salesforce come from the other apps' repos (a `*.my.salesforce.com` address, an SDK, a Pub/Sub API subscriber): `koppler sync` finds them by address once the Salesforce card has its `url`.

## Recording it

Propose every link first, in one list: what it is, the app at the other end, and the file it was read from.
After the user's yes:

- The card, once: `koppler add --outside "Salesforce" --url <org address> --why "<what the org is for>"`.
- A call it makes: `koppler stack set apps.salesforce.consumes.<app> '{"how":"unknown","found":"<owner/repo> <file>:<line>"}'`. Name the Apex class or flow in `found`'s file, so the link panel says which part makes the call.
- An event it publishes: add the event as a queue if the stack has none (`koppler stack set queues.<id> '{"name":"<Event>__e","type":"other"}'`, or `eventbridge` when Event Relay forwards it), then `koppler stack set apps.salesforce.publishes.<id> '{"via":"<owner/repo> <file>:<line>"}'`.
- An app that reads that event: `koppler stack set apps.<app>.reads.<id> '{}'`, with `via` if its repo shows how.

Discover then draws each link with its source in the link panel, and a "?" on any call that has none.
