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
- `feat(coop): run actor script events only on the hoster (1B.5)`: SP allowed form set with setter and getter natives, SendEvent hook allows listed ids, client sets the hosted ESP ids without dragons; 1B.5 check (ambush draugr and boss in Bleak Falls Barrow).
- `fix(coop): start new characters at the cave exit with Ralof outside and let Alduin fly (G1.1)`: start log with MQ102B 5 and MQ102 15, world cleaner keeps the AI of the server's banned races, G1.1 check (details in the G1.1 log line).
- `test(e2e): make Hadvar flee on the Riverwood road in the puppet animation check (S1.6)`: see the Status bullet on S1.6.
- `fix(coop): keep client positions of unhosted NPCs and re-enable hidden hosts (G1.2)`: see below.
- `test(e2e): talk to Gerdur and Alvor on both clients (G1.3)`: G1.3 check (2 engines, talk through on the puppet and the hoster engine for Gerdur and Alvor); red with the S1.5 puppet AI-in-dialogue rule reverted.

## What the last commit holds (G1.2)

- Client: formView.ts (first update keeps the local position of an unhosted, not-dead real NPC; no movement or animation apply on NPCs hosted here), remoteServer.ts and hostAttempts.ts (Teleport resolves the local refr id on arrival; teleportingHosts), sendInputsService.ts (no location claim while a teleport is pending; a hidden host is re-enabled as soon as its FormView exists).
- Check G1.2 (1 engine, gameHour 7.975): the house is set public; the client Alvor is put at the forge if he is home, and the start asserts the client does not move him to the stale server position in the house; then he is moved home, the player waits on the lower floor (-503,96,60), then at the Riverwood marker once Alvor is outside; PASS when the server has him within 500 units of the forge for 5 s, then Gerdur and Alvor open the dialogue menu.
- Plan edits under S1.3 (decisions: kept, and the client position wins always), 1B.4 first movement and G1.2; lessons: proximity stall at load doors, off-screen schedules, probes, npcLocation.
- Runner: `ctx.npcLocation(id, engine = 1)`. Check edits (how only): S1.1 (and 1A.5), S1.6, 1B.1, 1B.2 go to the client position of the NPC; S1.6 places Hadvar on both clients; S1.1 waits until the puppet is at the hoster position before the move.
- Regression after the check edits: S1.6, 1B.1, 1B.2, 1B.4, G1.1 PASS; S1.1 and 1A.5 2/2; G1.2 3/3. The other checks passed in the 15:20-15:51 regression with the same client. The installed client matches HEAD (L1 at 16:50).

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

- Regression run 2026-10-13 03:23-03:45 UTC with the G1.1 change: L1, S0, S0b, S0c, S1.1-S1.5, S2, S3.1-S3.3, 1A.1-1A.5, 1B.1-1B.5, G1.1 PASS. S3.4 BLOCKED until 2A.1.
- S1.6 (check edit, committed): the old moves (600 units from Hadvar by the Riverwood mill) put the hoster player inside a building and in the river, and Hadvar's package MQ101HadvarHoldPosition (always valid in a test game) fights keepOffsetFromActor (standing still or walking in place, about 25% of runs). Now Hadvar starts at (17000,-47100,-105) on the road west of Riverwood, the hoster player alternates between fixed stops (17600,-47120,-120) and (16400,-47060,-30), the walk command is a flee (Confidence 0, startCombat(player); stopCombat and setDontMove(true) stop him), and the move loop (up to 10 legs) ends only when the moving and standing counts and a hoster path over 300 units are reached. Asserts unchanged. Flee: 8 of 8 PASS (3 official runs). Red proof (puppet Speed frozen at 0): FAIL, 0 of 88 animated. Review AGREE WITH NOTES: in about a third of runs Hadvar mostly runs in place (path 350-394 units), so the walked > 300 guard (unchanged from HEAD) is weak; the red proof covers only the moving half; Confidence 0 stays on the hoster (fresh world each run).
- G1.2 PASS (2026-10-13, commit `fix(coop): keep client positions of unhosted NPCs and re-enable hidden hosts (G1.2)`): client changes: (a) formView.ts: the first update of a real NPC that nobody hosts and that is not dead keeps the local position (user decision); (b) fix 4: no movement or animation apply on NPCs hosted here (the server echoes them); (c) fixes 1+3: onTeleportMessage resolves the local refr id on arrival and blocks location claims for that NPC (teleportingHosts) until the move is applied; (d) updateHiddenHosts re-enables a hidden host as soon as its FormView exists. Check: the player no longer follows Alvor (he does not leave through a load door while the player is near him); it waits on the house lower floor (-503,96,60), then at the Riverwood marker; the start asserts (a). Red: without (a) 3/3 FAIL, without (d) 3/3 FAIL; (b) and (c) alone each passed 2 runs, removed together 2 FAILs. Fix 5 (resetAI) dropped. Review AGREE WITH NOTES: known risks below.
- User decisions 2026-10-13: the client position wins for an NPC nobody hosts, and it stays after the stall turned out to have another cause (the client runs the AI); it wins always, also over server-side moves of such an NPC; the G1.2 check must not keep the player near Alvor.
- No game, server or runner is running between passes.

## Next steps

1. Gate 1: G1.4, G1.5. Write each check red first; the fix for a gate is the phase 1 steps, so a FAIL means a missing or broken step.
2. Then 2A (S3.4 comes back with 2A.1), 2B (2B.3 also tests that a hoster does not allow a dragon's script events), G2, P. P8 stays red until reached.
3. Watch:
   - S1.2 had a flaky period (LESSONS). The 1B.4 claim after a replay failed once (23:20).
   - S1.6: Hadvar sometimes runs in place even when fleeing (path about 350 units); if S1.6 flakes in --final, an escort-based walk (Ralof with the start log, as in G1.1) is the next option. Between 03:33 and 04:12 UTC NPCs walked in place everywhere (cause unknown).
   - Review gaps of 1B.4: the member's 10 s wait is not observed, a non-quest actor near the leader, release when unloaded or gone, claims of dead actors or from another cell. Add them when a step touches that code.
   - The Helgen intro battle runs forever once players host it (S1.1 and S1.6 calm it). G1.1 did not meet it (Ralof is hosted at the cave exit).
   - G1.1: every login replays the whole quest log, so MQ102B stage 0 moves Ralof into the keep and MQ102 stage 15 moves him to the exit again on each client (and enables Alduin, who now flies away on his own). The server position wins only through the FormView's first movement (see the first-movement lesson). Each client also has its own Alduin. G1.1 ran once per build; road combat (wolves) is untested.
   - A puppet's loaded copy whose FormView is destroyed stays frozen and visible (no HostStop for non-hosters).
   - A real actor whose first movement ran before the player was in place is never moved again (LESSONS).
   - A hosted NPC's hits on its own hoster's player also reach the server (possible double damage). The 1B.3 hit scenario is flaky (ENV and retry).
   - Custom gamemode properties on ESP NPCs (LESSONS). 1B.1 coverage partial. 1B.2: resurrect side effects untested.
   - 1B.4 failed its start condition once in a full regression (engine 1 claimed Alvor before the first server read); it passed alone. Watch it in --final.
   - G1.2 risks (review): a teleportingHosts entry stays if the ragdoll promise never resolves or moveRefrToPosition throws (no claim of that NPC for the session); two pending teleports for one NPC unblock after the first; G1.2 asserts no walk (a snap to the forge would pass); with (a), a new view of an NPC whose hoster left keeps the client spot, so the next claim moves the server NPC there (a follower left by a player who disconnected).
   - 1B.5: hosted actors now run their own script events. Watch for scripts that act twice or fight the server (packages, item adds) in G1 and G2. HostStop and release remove ids through the same diff; no separate test for each.

## Runner

- Command: `node misc/e2e/run.js [--no-l1] [--only IDs] [--runs N] [--final] [--check file] [--visible]`
- L1 rebuilds the client and installs it; use --no-l1 only when nothing in the client changed.
- Ports: 7790 server, 7791 UI, 7792 probe, 7793 runner. Kill a stale runner that holds 7793.
- A crashed run is restored by the next start.
- `mp.lookupEspmRecordById(id).record` in a probe gives the record type and editorId (useful to name refs and cells; the game itself is French).
