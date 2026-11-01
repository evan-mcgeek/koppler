# Fixing a bug

A bug is fixed once a test that went red on it goes green.
Flaky tests are bugs too.

## 1. Gather

Collect what the user saw: their words and screenshots, `<state>/debug.jsonl`, `koppler history session`, the app logs.
Search open and closed issues for the same bug.

Done when: you can state the bug as steps, expected result and actual result.

## 2. Settle what is right, when unclear

Most bugs are clear: the expected result is obvious, or the docs say it.
When it is not (two readings of the docs, a behaviour the user may have meant, a fix that changes what others rely on), run the `grilling` skill on just that question before reproducing.
Otherwise skip, and say why in one line.

## 3. Reproduce

Reproduce it end to end, the way the user met it: the same board, card, zoom, theme and environment.
On the user's live canvas, only read (`koppler-readonly-board-repro`); change things on a throwaway server that holds a copy of the real state.
Then turn it into a red check: an e2e or unit test that fails on this bug. For a flake, use `--repeat-each` until it fails.

Done when: one command goes red on this bug and only this bug.

## 4. File

A bug the user reported, or one bigger than a line: draft a short issue (steps, expected, actual, likely cause), show it, and file it on a yes with the label `bug`; its card goes in Bugs, then In Progress.
When several bugs come in at once (a session review, a feedback round), show them as one `lavish` table (what went wrong, the evidence, already reported or not) and file the rows the user picks.
A small bug met while working on something else is fixed in that PR, and the PR says so.

## 5. Find the cause

Use the `diagnosing-bugs` skill.
Grep every caller of the code you are about to change; fix it once, where they all meet.
A flake's cause is named (a race, a shared file, a port), and the fix removes it; a retry or a longer wait only hides it.

Done when: you can say why the red check fails, in one sentence.

## 6. Fix

Fix the cause.
The red check goes green; keep it as the regression test.

## 7. Verify, review, ship

Run steps 6 to 8 of `docs/workflow/feature.md`: the gate, also under load, screenshots of any screen it touches, `code-review`, the PR with `Closes #<issue>` and a line per step, the merge once CI and the review are done, and the card to Testing after the merge.

## 8. Prevent

Ask what would have caught this earlier: a check, a test, a rule in these files, or a skill.
Propose it to the user in one line, and add it after a yes.
