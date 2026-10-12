# Loop handoff

Rewritten at the end of each pass and committed with the loop commits. Read it with the scoreboard, the log, and LESSONS.md at the start of a pass. The plan is misc/e2e/PLAN.md, in git; start the loop with `/loop misc/e2e/PLAN.md`.

## Rules

- Repo C:\Users\jqntn\source\repos\skymp, branch feat/coop-party.
- Local commits are allowed for this loop only (Conventional Commits, subject line only, no body, no co-author, never push).
- No comments in code.

## Committed

- c1b87732: S0 harness.
- c267a8e2: S0b/S0c. SkyrimPlatform Detach kills only its own process tree.
- a2651591: S1.1. Real-actor NPC hosting, load filters, hoster binding, property path fix, [NpcHost] tests.
- e056c035: S1.2. Dialogue with hosted and puppet NPCs, hidden desktop, mute, free cursor.
- `test(e2e): run each engine on its own hidden desktop and relaunch early exits (S0b)`: runner changes below.
- `fix(coop): run NPC AI only on the hoster and animate puppets from its movement (S1.1, S1.3, S1.4, S1.6)`: client, checks, plan, lessons, this file.
- `fix(coop): let players talk through a dialogue with a puppet NPC (S1.5)`: AI on while a puppet is in dialogue with the local player; S1.5 check.
- `test(e2e): run the Bleak Falls Barrow puzzles on the server VM (S2)`: S2 check (bot player, archives setting, trace log); plan edit with the 2B.2 scope.
- `test(e2e): prove the client hooks and events that script sync needs (S3.1, S3.2, S3.3)`: S3.1 animation hook on an activator, S3.2 containerChanged on a script AddItem, S3.3 activate event for a script activate() on blocked refs; plan edits for 2A.5 and 1B.5/2B.2.
- `test(e2e): block S3.4 until the corpse branch of 2A.1`: S3.4 reports BLOCKED with the reason; plan edit.
- `feat(coop): claim, release and clean up NPC hosts on the server (1A.1, 1A.2, 1A.3)`: `ctx.unit(tag)` step checks; [1A.1] load filter tests (exact banned list, StartsDead/Deleted reasons, Mirmulnir, fixture flags); host claims with a location (NPCs only, same cell, 4096, finite pos, 2 s rule), release by the hoster, hoster cleared on unsubscribe (HostStop) and on disconnect.
- `feat(coop): take hosted NPC movement, health and death from the hoster (1A.4, 1A.5)`: NPC movement skips player validation (cell change allowed; non-cell or missing record and non-finite position rejected), health and death from the hoster (essential NPCs cannot be killed this way), no Kill at health 0 for ESP NPCs, no respawn for unique ESP NPCs; 1A.5 step check reuses the S1.1 follow metric (red with the remoteServer fix reverted).
- `fix(coop): keep puppet NPCs harmless and alive until the hoster decides (1B.1, 1B.2)`: 1B.1 check (real actor, no clone, no immortality, own name, hosted; source asserts); puppets get deferred kill and attackDamageMult 0, restored when hosted or destroyed; a puppet hit to 0 is resurrected on release unless the server says dead (then its server health is reapplied); the hold is re-armed if lost.
- `fix(coop): send hits and activations of hosted NPCs and keep revived NPCs alive (1B.3)`: client accepts hosted ESP aggressors and casters, blocks KillMove for all ids, sends no actor values for hosted NPCs, drives puppet AI from the actor's real state; server ignores a hoster's death for 3 s after a respawn (RespawnedWithin, [1B.3] unit test); 1B.3 check gives engine 2 an appearance so engine 1 renders it.

## What the last two commits hold

- Client:
  - ESP actors run AI only on the client that hosts them: worldCleanerService turns AI off on objectLoaded for unhosted actors, FormView turns it on when hosted here, destroy keeps it off. Puppets get stopCombat.
  - Puppet locomotion: moveStart/moveStop and the Speed/Direction animation variables from the hoster's movement (movementApply.applyLocomotion).
  - Real ESP puppets skip the lag prediction in translateTo (the hoster's SpeedSampled decays for about 1 s after a stop, so the prediction overshot by up to 69 units).
- Checks: S1.1 (asserts net move and one hoster), S1.3 (judged against RiverwoodBlacksmithWorkMarker 0x2c308, held 5 s, ACCEPTED if not at the forge), S1.4 (frenzy + 150-unit nudge on puppets, positive control on the hoster), S1.6 (0.5 s hold, at least 10 moving and 10 standing samples, the puppet must move).
- Runner: ACCEPTED result; re-links changed skymp files into build/e2e-game2; per-engine liveness in ready(); relaunch of an early-exited engine (15 s backoff, 2 times, SKSE logs saved as early-exit-*); --final; one hidden desktop per engine (`skymp-e2e-<n>`); S0b 2 min.

## Uncommitted

- misc/e2e/checks/P8.js: red (client Equipment serialize exception at login). Stays uncommitted until P8 is reached in plan order.

## User decisions (2026-10-12)

- Games run on hidden desktops, one per engine, muted. During runs, LockCursor=false and bBackgroundMouse=1; the runner restores the ini files afterwards.
- S0b runs 2 min.
- Each check runs once per pass. --final runs the driver checks 3 times in a row for the goal.
- The loop keeps this handoff file and the plan in git.
- S1.6 holds for 0.5 s (the loop had proposed 1 s).
- No pending user decisions.

## Status

- Full run at 13:56 UTC (560 s): L1, S0, S0b, S0c, S1.1, S1.2, S1.3, S1.4, S1.6 PASS; no engine relaunch with one desktop per engine. S1.5 and later have no script. P8 red.
- After the prediction fix: S1.1 3/3 PASS (worst 14.5 units), S1.4 3/3 PASS (new version), S1.6 3/3 PASS (0.5 s), S1.3 PASS (new version).
- Reviews: S1.1, S1.3, S1.4, S1.5 and S1.6 agree (YES/YES).
- S3.1, S3.2, S3.3 PASS (reviewed). Findings in the plan: SP hides its own synchronous native calls from hooks (Override), a JS sendPapyrusEvent hook freezes the game, the client's inventory re-apply looks like a script loss.
- S2 PASS: the server VM runs the pillars and the claw door with the archives setting; what it does not do is listed in the plan (phase 0 step 3, S2 PASS bullet).
- S1.5: red before the fix (a puppet with AI off never finished its greeting, so no topic got an answer), PASS after; S1.2 and S1.4 still PASS.
- Known gaps from the reviews, for later steps:
  - S1.3: the server still has Alvor in RiverwoodAlvorsHouse (0x133c8) while the client shows him at the forge. The claim with location of phase 1B step 4 must fix this; its check should assert that the server agrees.
  - S1.4: the positive control makes only Orgnar fight; dialogue and scenes are not provoked; engine 1 was never a puppet engine.

## Next steps

1. 1B.4 (host policy and world cleaner): never delete actors below 0xff000000; claim a real actor with a location (3D loaded, enabled, alive, no hoster, no FormView, same cell, within 4096) using the 1A.2 location claim; HostStop for an actor without FormView hides it and retries the claim every 5 s; release hosted actors that are gone/unloaded/disabled; party rule for quest alias actors; no claims while CoopService.reporting is false. The "first movement" bullet is skipped (S1.3 PASS... check the plan: it says skip if S1.3 FAILS; S1.3 passed on the client, so decide with the plan text). Write red-first checks.
2. Then 1B.5, G1, 2A (S3.4 comes back with 2A.1), 2B, G2, P. P8 stays red until reached.
3. Watch in play: a hosted NPC's hits on its own hoster's player now also reach the server (possible double damage; hosted clones already behaved so). The 1B.3 hit scenario is flaky (ENV and retry).
4. Open: custom gamemode properties on ESP NPCs (LESSONS). 1B.1 coverage partial. 1B.2: resurrect side effects untested.

## Runner

- Command: `node misc/e2e/run.js [--no-l1] [--only IDs] [--runs N] [--final] [--check file] [--visible]`
- L1 rebuilds the client and installs it; use --no-l1 only when nothing in the client changed.
- Ports: 7790 server, 7791 UI, 7792 probe, 7793 runner. Kill a stale runner that holds 7793.
- A crashed run is restored by the next start.
- `mp.lookupEspmRecordById(id).record` in a probe gives the record type and editorId (useful to name refs and cells; the game itself is French).
