# The check loop: a template

A method to reach a production result with an autonomous agent loop. The agent runs checks, takes the first failure, fixes it, and runs the checks again, until all checks pass. This file holds the method only. A project plan (`PLAN.md`) holds the goal, the steps, and the pass conditions, and refers to this file.

Mandate: the goal is that all checks of the plan pass in 3 runs in a row. The loop repeats passes without a pause until the goal or a stop condition. It has autonomy for all work in the plan (code, builds, tests, runs of the system, commits, and pushes), and it asks the user only at a stop condition.

Start: `/loop <path>/PLAN.md`. Each wake runs one pass. All state is on disk, so a new session or another PC continues with the same command.

## What a project plan must have

1. **Context:** the problem, with file and line references, and the decisions of the user.
2. **Result:** one sentence that the user can verify by hand.
3. **Phases and steps:** each step has an id (for example 1A.2). A step says how, not only what.
4. **Pass conditions:** each step, gate, spike, and production check has an id and one pass condition that a script can assert. Gates (G1, G2) are end-to-end checks after a phase. Spikes (S1, S2) answer open questions before a phase, and each spike result names its next step.
5. **Harness:** phase 0 step 0 describes the harness, and the loop builds it as its first fix. Describe it in enough detail:
   - one command that runs all checks in plan order and writes the scoreboard;
   - how the checks read the system (APIs, a probe, logs, screenshots);
   - how the harness starts, stops, and isolates the system, and how it restores state after a crash;
   - what counts as ENV (a harness fault, not a code fault).
6. **Verification levels:** fast tests after each step (build, unit tests), the scoreboard, and what the user plays or reviews at the end.
7. **Risks:** the highest first, each with its spike or fallback.

A vague harness description gives a weak harness, and every later PASS depends on it.

## Checks

- Each id has one script in `checks/`. The script runs actions, waits, and asserts on the system. A script can set up its start state, but it must not set the state that it checks.
- The result is PASS, FAIL, ENV, or BLOCKED with a reason. An id without a script is a FAIL; the first fix is to write the script.
- Red first: a new check must FAIL on the code before the fix. A check that passes before the fix proves nothing; rewrite it. When a fix has several parts, revert each part alone and run the check: a part that the check does not need is either dead code or untested, so extend the check or delete the part.
- A level 1 FAIL (build, unit tests) comes before all checks. The fix for a gate is the steps before that gate, in order.
- Each step has a step check with its id: a unit test tag, a bot test, or a driver check.
- ENV: the runner kills the processes and retries 2 times. 3 ENV results in a row stop the loop. Each ENV cause gets a fix in the harness.
- A driver check passes only with 3 PASS results in a row; one FAIL in 3 runs is a FAIL. Intermediate passes run each check once; the goal run (`--final`) runs each 3 times.

## Scoreboard

- The runner writes `out/results.json` (the latest result and evidence per id) and renders `out/scoreboard.md` from it. A partial run (`--only`) merges into it.
- It appends each check run to `out/history.jsonl`, for the retro.
- Each PASS has evidence in the scoreboard: values from the system, log lines, screenshots, and the time.
- The scoreboard is the progress of the plan.
- If a full run takes more than 30 min, the next task is a faster harness.

## One pass

1. Read `HANDOFF.md`, `out/scoreboard.md`, `out/log.md`, and `LESSONS.md`. These files are the memory of the loop, not the conversation.
2. Run the scoreboard.
3. Take the first FAIL in plan order. Regressions come first.
4. Reproduce it at the lowest level: a unit test, then a bot test, then the driver.
5. Find the root cause and fix it. Keep the test from step 4 as a regression test.
6. Run the scoreboard again. If a check that passed before fails now, fix it first.
7. Review: a new subagent gets only the pass condition, the check script, and the evidence, not the fix. It answers: does the script test the pass condition, and does the evidence show a PASS? A PASS counts only when the review agrees.
8. If the review agrees, commit and push (see Rules). If the fix failed, `git stash push -m "<id> fix <n>"`. Do not reset, so that no attempt is lost.
9. Add one line to `out/log.md`: the id, the cause, the fix, the result, and the number of fixes for this id so far.
10. Rewrite `HANDOFF.md`: the commits, the uncommitted work and its state, the user decisions and the pending ones, the status of each failing or flaky id, the next steps, and the runner usage. Also update it during a pass, after each check result, fix, or decision, because context compaction can run mid-pass.

## Rules

- A pass condition does not change without the approval of the user. Do not weaken, skip, or delete a check or a test to get a PASS.
- Each bug that a playtest or a review finds becomes a new check id. It must FAIL first.
- The loop adds a new check for each risk that it finds outside the existing checks.
- Spike code goes in a git worktree. Discard the worktree after the result is in the log.
- Commits: one commit per reviewed PASS, Conventional Commits subject line with the id, for example `fix(scope): keep the hoster on a cell change (G1.4)`. The commit includes the plan and the memory files (see Files). Then push to the remote that the plan names. Never force-push. The plan sets the remote and any other commit rule of the user.
- When all checks of a gate pass, notify the user and go on.
- Record each decision of the user in the plan with its date, and add a log line.

## Self-improvement

- Plan edits: the loop can change the steps of the plan (the how), never the pass conditions (the what). Examples are line numbers, file names, the order of steps, and a better approach that the code shows. Each plan edit gets a log line.
- Lessons: `LESSONS.md` holds facts that the loop learned about the system and the harness. An example is the wait time after a load before an action works. Add a lesson after each ENV, each flaky result, and each fix that needed more than one try.
- Retro, every 10 passes: a new subagent reads the log, the lessons, and the scoreboard history. It finds repeated ENV causes, slow checks, flaky checks, and fixes that failed for the same reason. Its proposals become the next tasks, before the next FAIL.
- Check the checks, in each retro: for each passing check, revert its fix commit in a worktree and run the check. It must FAIL. If it passes, the check is weak; rewrite it.
- Escalation: after 3 failed fixes for one id, a new Plan subagent gets the pass condition, the log lines, the lessons, and the stashed attempts, and proposes a different approach. Then the loop tries 2 more fixes.

## Stop and ask the user when

- All checks pass in 3 runs in a row. Then the user verifies the result by hand.
- A check stays FAIL after the escalation.
- A result has no next step in the plan.
- A fix needs a change to a pass condition or to a decision of the user.
- Only BLOCKED checks remain.

## Files

Paths are relative to the folder of the plan. All memory files are in git, so that the loop can resume on another PC.

| File | Written by | Rebuilt by a run |
|---|---|---|
| `PLAN.md` | the user and the loop (plan edits) | no |
| `LOOP.md` | the user | no |
| `HANDOFF.md` | the loop, during each pass | no |
| `LESSONS.md` | the loop | no |
| `out/log.md` | the loop, one line per pass or decision | no |
| `out/history.jsonl` | the runner, one line per check run | no |
| `out/results.json`, `out/scoreboard.md` | the runner | yes, by a full run |
| `checks/*.js`, the runner, the probes | the loop | no |

Keep machine-local files out of git: backups of local settings that the runner restores, run folders, screenshots, and process logs.

## Plan skeleton

```markdown
# <Result in a few words>

## Context
<The problem, with file:line references. The decisions of the user, with dates.>

Result: <one sentence that the user can verify by hand>.

## The loop
Follows LOOP.md. Project rules:
- Runner: `node <path>/run.js [--only IDs] [--final]`.
- Commits: <branch>, push to <remote>.
- <Other decisions of the user, with dates.>

## Phase 0: spikes
0. Test harness. <What it starts, how checks read the system, what is ENV, how it restores state.>
1. S1: <question>. Pass: <condition>. If FAIL: <next step>.

## Phase 1: <name>
1. **<Step name>** (<files>): <how>. Step check 1.1: <pass condition>.

**Gate 1 checks:**
- G1.1: <end-to-end pass condition>.

## Verification
<Level 1: build and unit tests. Level 2: the scoreboard. Level 3: the user.>
<Production checks P1..Pn.>

## Risks, highest first
| Risk | Spike or fallback |
|---|---|
```
