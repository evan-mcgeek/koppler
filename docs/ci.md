# Checking the stack in CI

The team's `stack.json` lives in a repo of its own, or in one of the apps' repos.
Every change to it can be checked the way `koppler stack set` checks a change, before it is merged.

## The check

```bash
npx -y koppler stack check stack.json
```

It prints `stack.json: OK`, or each problem with where it is, and exits 1.
It runs every check: the shape of each field, the apps a call names, the environments, the queues, the kinds, and settings that would make an app load other code.

## On GitHub

Add `.github/workflows/stack.yml` to the stack's repo:

```yaml
name: Stack
on: [pull_request, push]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npx -y koppler stack check stack.json
```

## In an editor

`koppler stack schema` prints the JSON Schema of `stack.json`.
Keep it next to the file and name it at the top, so the editor checks and completes fields as they are typed:

```bash
koppler stack schema > stack.schema.json
```

```json
{ "$schema": "./stack.schema.json", "name": "Acme", "envs": ["qa", "prod"], "apps": {} }
```

## Proposing what was learned

What an agent learns while running the apps (a port, a call, a tunnel) goes into the copy of `stack.json` on that Mac, with `koppler stack set`.
`koppler stack propose` opens a pull request on the stack's repo with those changes, made on the file as the team has it on GitHub, so nobody else's change is undone.
A stack linked from GitHub does the same with `koppler link --pr`.
