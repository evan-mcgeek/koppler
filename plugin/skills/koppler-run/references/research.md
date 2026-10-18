# A stack from a description

The user describes a flow in words ("order updates from the Orders API to the app") or attaches a diagram (a drawing, a screenshot, an Excalidraw export).
You turn it into a proposed stack and a wired board. The description is a lead, not a fact: every fact comes from the repos.

## 1. Read the description

List every named thing and every arrow between them:
- apps, APIs, lambdas, workers, front ends;
- databases, caches, queues, topics and event buses;
- outside systems (Salesforce, Firebase, Kafka, a SaaS).

Show the list back to the user in one short message and fix what they correct before searching.

## 2. Find each one

`koppler discover --find "<name>,<name>"` searches the stack, then the clones on this Mac, then GitHub in the user's own organisations (through their `gh` login).
- One match: use it.
- Several or none: ask which, showing the candidates; never pick one yourself. An archived repo is rarely the one meant; say so.
- Not cloned: give the clone command and ask before cloning anything.

Things that never run locally (a SaaS, an S3 bucket) become apps with an `outside` reason, so the stack still names them.

## 3. Confirm the facts from the repos

For every app that is cloned: `koppler discover` (local ports, tunnels, calls, conflicts) and `koppler discover --deployed` (deployed addresses, settings, secret names, calls from the Terraform).
Its kind, how it runs, its addresses and who it calls come from there, not from the description.
Where a repo disagrees with the drawing (a call that does not exist, a direction the other way round), say so and ask.

## 4. Propose, then write

Show the proposal before writing anything:
- the `stack.json` additions (apps, their facts, `consumes` for each confirmed call, `outside` systems);
- a board: the apps and the cables of the flow, as a shared or local board;
- open questions, one line each.

Make them only after the user's yes, with `koppler stack set` (never by writing `stack.json`); the board is built on the canvas, or with `koppler board new` and `koppler board edit`, and it goes to the team with Share with team on the canvas or `koppler board share "<name>"`, which opens a pull request on the stack's repo; open one only when the user asks.
A shared stack's change is for the user to commit (or `koppler link pr` for a linked one).

Queues, topics and event buses go under `queues`, with `publishes` / `reads` on each app (`references/stack.md`); confirm both ends from the repos and the Terraform, as for a call.

## Trace what feeds a queue

A queue an app reads is often the end of a chain: a Kafka topic piped onto an event bus, whose rule forwards to another account's bus, which a rule hands to a Lambda.
`koppler discover --deployed` drafts what it can read from the Terraform, and `koppler discover --deployed --aws` checks it against what AWS runs (read-only, the apps' own profiles): `FOUND` lines are links the stack misses. Trace the rest by hand, in every clone, and record each link with `koppler stack set queues.<id>.feeds.<other> '{"via":"pipe"}'`:
- **Kafka topics read:** `aws_pipes_pipe` and `awscc_pipes_pipe` with `self_managed_kafka_parameters` or `managed_streaming_kafka_parameters`; `topic_name`, often `each.key` over a list variable whose values are in the `.tfvars` (a commented-out item is not read). Also Lambda event source mappings on an MSK or Kafka source.
- **Kafka topics written:** app settings such as `KafkaSettings/Topic`, `Kafka__Topic` and `BootstrapServers` in the Terraform locals and `appsettings*.json`; the app `publishes` that topic.
- **Event buses:** `aws_cloudwatch_event_bus`; its rules (`aws_cloudwatch_event_rule` with `event_bus_name`) and their targets (`aws_cloudwatch_event_target`): a queue, a Lambda, an API destination, or another account's bus by its ARN (`event-bus/<name>`, often in a map per environment in the locals).
- **The other end of a bus forwarded by ARN:** search every clone for the bus name without its environment word (`customer_service_bus`); the repo that declares it holds the rules that read it.
- **SNS:** `aws_sns_topic_subscription` (`protocol` sqs, lambda or https, and its `endpoint`); an https subscription is a call to that app.
- **Pipes from SQS:** an `aws_pipes_pipe` whose `source` is a queue (often through `terraform_remote_state` outputs) and whose `target` is an API destination or a Lambda: that queue is read, with `via`.
- **Who reads at the end:** a Lambda in an app's repo targeted by a pipe or rule is that app reading the queue: `reads.<queue>.via` (`"rule to Lambda"`), not a card of its own.
Never read a secret on the way (Kafka credentials, connection strings): only names, addresses and topic names.
