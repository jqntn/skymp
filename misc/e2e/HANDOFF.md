# Loop handoff

Rewritten at the end of each pass and committed with the loop commits. Read it with the scoreboard, the log, and LESSONS.md at the start of a pass. The plan is misc/e2e/PLAN.md and the method misc/e2e/LOOP.md, both in git; start the loop with `/loop misc/e2e/PLAN.md`.

## Rules

- Repo C:\Users\jqntn\source\repos\skymp, branch feat/coop-party.
- Commits are allowed for this loop only (Conventional Commits, subject line only, no body, no co-author). After each commit, `git push fork feat/coop-party` (user decision, 2026-10-12). Never push to `origin`, never force-push.
- No comments in code.
- Update this file after each check result, fix, or decision, not only at the end of a pass (auto-compaction may run mid-pass).

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
- `feat(coop): host NPCs from the local engine and yield quest actors to the party leader (1B.4)`: real-actor claims with a location, release of lost hosts, hide and retry on HostStop, first movement skip, replay gate, party rule with the native getReferenceAliasQuests, server OpenContainer only to the activator's own user; 1B.4 check; S1.1, S1.4, S1.6 check edits.
- `feat(coop): run actor script events only on the hoster (1B.5)`: see below.

## What the last commit holds (1B.5)

- SkyrimPlatform: a set of allowed form ids behind a `std::shared_mutex` (PapyrusTESModPlatform), the natives `setPapyrusEventsAllowedForms(ids)` (replaces the set) and `getPapyrusEventsAllowedForms()` (DevApi, declared in skyrimPlatform.ts), and the SendEvent hook (FridaHooks) allows an event when its self id is in the set.
- Client: sendInputsService compares the ESP ids of `storage['hosted']` at each update and calls the setter when they change (HostStart, HostStop and release take the same path), without actors that have the ActorTypeDragon keyword.
- Check 1B.5 (2 engines, Bleak Falls Barrow): ambush draugr whose ref has masterAmbushScript (Variable01 0 -> 1 when the ambush ends). Engine 1 hosts draugr 9bcb9: startCombat runs the script; with the list emptied by the driver it stays blocked; engine 2 (puppet) does not list it. Boss 9bcd6: hosted by engine 1 (listed), engine 1 leaves the cell, engine 2 takes it, engine 1 comes back: engine 1 no longer lists it, engine 2 lists it and runs the script.
- Red proofs: pre-fix build (no native, startCombat on the hosters left Variable01 0), hook allowing every actor (the puppet ran its own ambush script), client never removing ids (the former hoster kept the boss). Review: AGREE WITH NOTES; the vacuity notes were applied (new hoster's boss still waiting, puppet assert split out).
- Plan edits: the getter in step 5; the dragon rule is tested in the 2B.3 check.
- The 1B.4 commit holds: real-actor claims with a location, release of lost hosts, hide and retry on HostStop, the first movement skip, the replay gate, the party rule with getReferenceAliasQuests, and OpenContainer only to the activator's own user (details in the 1B.4 log lines).

## Uncommitted

- misc/e2e/checks/P8.js: red (client Equipment serialize exception at login). Stays uncommitted until P8 is reached in plan order.

## User decisions (2026-10-12)

- Games run on hidden desktops, one per engine, muted. During runs, LockCursor=false and bBackgroundMouse=1; the runner restores the ini files afterwards.
- S0b runs 2 min.
- Each check runs once per pass. --final runs the driver checks 3 times in a row for the goal.
- The loop keeps this handoff file and the plan in git.
- S1.6 holds for 0.5 s (the loop had proposed 1 s).
- The loop's memory is in git, to resume on another PC: PLAN, LOOP (project-neutral method template), HANDOFF, LESSONS, out/log.md, out/scoreboard.md, out/results.json, out/history.jsonl. Screenshots, run folders and out/backup/ stay local.
- The loop pushes each commit to `fork` (jqntn/skymp) and the wiki commits to the wiki remote.
- No pending user decisions.

## Status

- Regression run 2026-10-13 01:22-01:38 UTC with 1B.5: L1, S0, S0b, S0c, S1.1-S1.6, S2, S3.1-S3.3, 1A.1-1A.5, 1B.1-1B.5 all PASS. S3.4 BLOCKED until 2A.1.
- First FAIL in plan order: G1.1 (no check script).
- No game, server or runner is running between passes.

## Next steps

1. Gate 1: G1.1 (Ralof walks to Riverwood), G1.2, G1.3 (2 engines), G1.4, G1.5. Write each check red first; the fix for a gate is the phase 1 steps, so a FAIL means a missing or broken step.
2. Then 2A (S3.4 comes back with 2A.1), 2B (2B.3 also tests that a hoster does not allow a dragon's script events), G2, P. P8 stays red until reached.
3. Watch:
   - S1.2 had a flaky period (LESSONS). The 1B.4 claim after a replay failed once (23:20).
   - Review gaps of 1B.4: the member's 10 s wait is not observed, a non-quest actor near the leader, release when unloaded or gone, claims of dead actors or from another cell. Add them when a step touches that code.
   - The Helgen intro battle runs forever once players host it (S1.1 and S1.6 calm it). G1.1 (Ralof walks to Riverwood) will show it.
   - A puppet's loaded copy whose FormView is destroyed stays frozen and visible (no HostStop for non-hosters).
   - A real actor whose first movement ran before the player was in place is never moved again (LESSONS).
   - A hosted NPC's hits on its own hoster's player also reach the server (possible double damage). The 1B.3 hit scenario is flaky (ENV and retry).
   - Custom gamemode properties on ESP NPCs (LESSONS). 1B.1 coverage partial. 1B.2: resurrect side effects untested.
   - 1B.5: hosted actors now run their own script events. Watch for scripts that act twice or fight the server (packages, item adds) in G1 and G2. HostStop and release remove ids through the same diff; no separate test for each.

## Runner

- Command: `node misc/e2e/run.js [--no-l1] [--only IDs] [--runs N] [--final] [--check file] [--visible]`
- L1 rebuilds the client and installs it; use --no-l1 only when nothing in the client changed.
- Ports: 7790 server, 7791 UI, 7792 probe, 7793 runner. Kill a stale runner that holds 7793.
- A crashed run is restored by the next start.
- `mp.lookupEspmRecordById(id).record` in a probe gives the record type and editorId (useful to name refs and cells; the game itself is French).
