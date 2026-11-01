# Building a feature

Run these steps in order.
Each ends on its done-when line; reach it before moving on.

## 1. Start

- The feature has an issue. If not, draft one (what the user wants and why, in a few lines), show it, and file it on a yes with the label `enhancement`, plus `roadmap` when it is planned work.
- Move its card to In Progress.
- Branch off `origin/main` as `feat/<short-name>`. When an open PR touches the same files, build on top of it or wait for its merge.

Done when: the issue number, the card and the branch exist.

## 2. Read

Read the issue, `GLOSSARY.md`, the ADRs in `docs/adr/`, the docs the feature touches, and every file on its path end to end.
When the idea comes from another tool, use `borrow-ideas-from-external-project` and show what is worth borrowing as a `lavish` page.

Done when: you can name every file the change touches and every place the same behaviour already lives.

## 3. Grill, when anything is open

The feature is clear when the issue or the user already says what it does, where it shows, and how it behaves at its edges, and the code leaves one obvious way to build it.
Then skip this step and say why in one line ("Clear: the issue settles X and Y").

Otherwise, run the `grilling` and `domain-modeling` skills until every open decision is settled.
Facts come from the code and the stack; only decisions go to the user, each with your recommended answer.
Put each round on a `lavish` page when its answers have options to compare (layouts, flows, data shapes, a before and after); plain yes-or-no rounds stay in the chat.
New terms go in `GLOSSARY.md`; a decision that is hard to reverse becomes an ADR.
When in doubt whether it is clear, ask one short round: it costs less than building the wrong thing.

Done when: no decision is left open and the user confirms it, or the one-line reason to skip is given.

## 4. Size

- Fits one session: go to step 5.
- Spans several sessions: write the spec into the issue and split it into tracer-bullet issues, each naming the issues that block it. Show the spec and the issues as one `lavish` page (the issues and what blocks what), file them on a yes, then build them one by one through this file.
- Needs a new look (a new screen, a new control, a changed visual): brief Claude Design. Until the design comes back, build with the existing components and list the open design questions in the PR.

## 5. Build test-first

Use the `tdd` skill, one red-green slice at a time:

- Logic goes in `app/src/core` as a pure function, with a vitest test first.
- What the user sees gets an e2e test in `app/e2e/` that drives it as the user would, red before the code.
- A change to a file's format comes with its migration (see `AGENTS.md`).
- Docs the feature changes (`docs/*.md`, the shortcuts sheet, `--help`) change in the same commit.

Done when: every new behaviour has a test that went red, then green.

## 6. Verify

- Run the local CI gate (`koppler-local-ci-gate`). Green means every step passed and the e2e summary shows no failed or flaky test.
- Run each new e2e test with `--repeat-each 4`.
- Run the whole e2e suite once more under load, as slow as CI's runners: `npx playwright test --workers 16`. A test that fails only there is a flake, fixed before the push.
- Screenshot each changed screen and look at it, in light and dark. Fix what looks off, including misses next to the change.
- Run `npm run screenshots`; keep the images this feature changed, and restore the rest.

Done when: the gate is green, also under load, and you have looked at every changed screen.

## 7. Review

Run the `code-review` skill against `origin/main`, with the issue as the spec.
Fix each finding you can confirm in the code; say why you skipped the others.

## 8. Ship

Commit, push, and open the PR with the `pr` skill: `Closes #<issue>`, what changed, how it was tested, and a line per step of this file with its result (or why it was skipped).
Wait for the PR's CI (`gh pr checks <n> --watch`); merge, or give the user the merge command, only when every check passed and step 7 is done.
A failed check, even a flake, is fixed first (`docs/workflow/bugs.md`).
After the merge, move the card to Testing, and check the change in the user's running canvas (`koppler-merged-canvas-change-live-check`).

When the user said to build several features, run this file for each in turn and report once at the end on a `lavish` page: one row per PR with a screenshot of the change, and what to try together.
