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
- `test(e2e): keep a killed bandit dead after a server restart (G1.4)`: G1.4 check and ctx.restartServer in run.js; red with the ESP NPC spawnDelay reverted.
- `test(e2e): bring the Whiterun guards, Balgruuf and Farengar and start MQ103 (G1.5)`: G1.5 check; plan edits (G1.5 measure; playtest decisions G1.6-G1.9 and the 2A.1 check); runner ORDER (G1.1-G1.8, 2A, G1.9, 2B); lessons (torch unit test flake, rolling-release zip, Steam).
- `fix(coop): animate puppet NPCs and sync their furniture states (G1.6)`: see the G1.6 Status bullet.
- `fix(coop): create quest items in their holders on the server (S3.4)`: questItems.ts and coop grants (aliasFillRequest/aliasFill), SP natives getQuestAliasReference and getInventoryReferences, S3.4 check; see the S3.4 Status bullet.
- `fix(coop): let players loot corpses that another player hosts (2A.1)`: see the 2A.1 Status bullet and the 2A.1 findings in PLAN.
- `fix(coop): play hosted NPC voice lines on the other clients (G1.8)`: SP hook on the actor speak function (Offsets `SpeakSound`, AE 37542, SE 36541 unverified) sends the SP event `speakSound` for played voice files; natives `speakSound(formId, file)` (no subtitle) and `getSubtitles()`; the client relays lines of hosted NPCs as `SkympSpeak:<file>` on the NPC animation queue and plays them on puppets; the server does not keep them as the last animation; G1.8 check.
- `fix(coop): show server disables of ESP refs and NPCs on the clients (2A.2)`: see the 2A.2 Status bullet and the 2A.2 findings in PLAN.

## What the last commit holds (G1.2)

- Client: formView.ts (first update keeps the local position of an unhosted, not-dead real NPC; no movement or animation apply on NPCs hosted here), remoteServer.ts and hostAttempts.ts (Teleport resolves the local refr id on arrival; teleportingHosts), sendInputsService.ts (no location claim while a teleport is pending; a hidden host is re-enabled as soon as its FormView exists).
- Check G1.2 (1 engine, gameHour 7.975): the house is set public; the client Alvor is put at the forge if he is home, and the start asserts the client does not move him to the stale server position in the house; then he is moved home, the player waits on the lower floor (-503,96,60), then at the Riverwood marker once Alvor is outside; PASS when the server has him within 500 units of the forge for 5 s, then Gerdur and Alvor open the dialogue menu.
- Plan edits under S1.3 (decisions: kept, and the client position wins always), 1B.4 first movement and G1.2; lessons: proximity stall at load doors, off-screen schedules, probes, npcLocation.
- Runner: `ctx.npcLocation(id, engine = 1)`. Check edits (how only): S1.1 (and 1A.5), S1.6, 1B.1, 1B.2 go to the client position of the NPC; S1.6 places Hadvar on both clients; S1.1 waits until the puppet is at the hoster position before the move.
- Regression after the check edits: S1.6, 1B.1, 1B.2, 1B.4, G1.1 PASS; S1.1 and 1A.5 2/2; G1.2 3/3. The other checks passed in the 15:20-15:51 regression with the same client. The installed client matches HEAD (L1 at 16:50).

## Uncommitted

- G1.7 work is in the stash "G1.7 harness press attempts" (not in the tree).
- Nothing for 2A.2 (committed).
- misc/e2e/checks/P8.js: red (client Equipment serialize exception at login). Stays uncommitted until P8 is reached in plan order.

## User decisions (2026-10-12)

- Games run on hidden desktops, one per engine, muted. During runs, LockCursor=false and bBackgroundMouse=1; the runner restores the ini files afterwards.
- S0b runs 2 min.
- Each check runs once per pass. --final runs the driver checks 3 times in a row for the goal.
- The loop keeps this handoff file and the plan in git.
- S1.6 holds for 0.5 s (the loop had proposed 1 s).
- The loop's memory is in git, to resume on another PC: PLAN, LOOP (project-neutral method template), HANDOFF, LESSONS, out/log.md, out/scoreboard.md, out/results.json, out/history.jsonl, out/attempts.jsonl (every attempt with a build stamp, since retro 1). Screenshots, run folders and out/backup/ stay local.
- The loop pushes each commit to `fork` (jqntn/skymp) and the wiki commits to the wiki remote.
- User decision 2026-10-13 (evening): the loop picks measures and check details itself and does not ask; the user wants the bugs fixed. The G1.5 guard reading stays (the user did not test it).

## Status

- Regression run 2026-10-13 03:23-03:45 UTC with the G1.1 change: L1, S0, S0b, S0c, S1.1-S1.5, S2, S3.1-S3.3, 1A.1-1A.5, 1B.1-1B.5, G1.1 PASS. S3.4 BLOCKED until 2A.1.
- S1.6 (check edit, committed): the old moves (600 units from Hadvar by the Riverwood mill) put the hoster player inside a building and in the river, and Hadvar's package MQ101HadvarHoldPosition (always valid in a test game) fights keepOffsetFromActor (standing still or walking in place, about 25% of runs). Now Hadvar starts at (17000,-47100,-105) on the road west of Riverwood, the hoster player alternates between fixed stops (17600,-47120,-120) and (16400,-47060,-30), the walk command is a flee (Confidence 0, startCombat(player); stopCombat and setDontMove(true) stop him), and the move loop (up to 10 legs) ends only when the moving and standing counts and a hoster path over 300 units are reached. Asserts unchanged. Flee: 8 of 8 PASS (3 official runs). Red proof (puppet Speed frozen at 0): FAIL, 0 of 88 animated. Review AGREE WITH NOTES: in about a third of runs Hadvar mostly runs in place (path 350-394 units), so the walked > 300 guard (unchanged from HEAD) is weak; the red proof covers only the moving half; Confidence 0 stays on the hoster (fresh world each run).
- G1.2 PASS (2026-10-13, commit `fix(coop): keep client positions of unhosted NPCs and re-enable hidden hosts (G1.2)`): client changes: (a) formView.ts: the first update of a real NPC that nobody hosts and that is not dead keeps the local position (user decision); (b) fix 4: no movement or animation apply on NPCs hosted here (the server echoes them); (c) fixes 1+3: onTeleportMessage resolves the local refr id on arrival and blocks location claims for that NPC (teleportingHosts) until the move is applied; (d) updateHiddenHosts re-enables a hidden host as soon as its FormView exists. Check: the player no longer follows Alvor (he does not leave through a load door while the player is near him); it waits on the house lower floor (-503,96,60), then at the Riverwood marker; the start asserts (a). Red: without (a) 3/3 FAIL, without (d) 3/3 FAIL; (b) and (c) alone each passed 2 runs, removed together 2 FAILs. Fix 5 (resetAI) dropped. Review AGREE WITH NOTES: known risks below.
- User decisions 2026-10-13: the client position wins for an NPC nobody hosts, and it stays after the stall turned out to have another cause (the client runs the AI); it wins always, also over server-side moves of such an NPC; the G1.2 check must not keep the player near Alvor.
- G1.5 PASS 3/3 (2026-10-13 22:30 local). Start: settings.ts log and MQ102 stage 30. Guards near the Dragonsreach porch (37058, 37070, sometimes 37057; each must be loaded on the client and hosted by the player), Balgruuf and Farengar in Dragonsreach, then the talk: MQ102 75 -> 110 -> 150 (MQ103 8) -> 160 (MQ103 10) on the client and in the server log. Red: race filter back (all four parts FAIL), world cleaner deletes again (guards FAIL), coop questStage ignored (server log FAIL). Review AGREE WITH NOTES, fixed: guards paired, asserts collected, MQ103 below 10 at the start, shot after the fade.
- Playtest 2026-10-13 (user and a friend, two PCs, fresh world): NPCs hosted by the other player are in an A-pose from the start and never animate (both directions, no mods); no talk to an NPC the other hosts (Gerdur once); no corpse loot on the other side; no voice or scene lines on the other side. Checks G1.6-G1.9 and 2A.1 approved (PLAN).
- G1.6 PASS 3/3 (2026-10-14, commit `fix(coop): animate puppet NPCs and sync their furniture states (G1.6)`): native `updateAnimations` animates loaded AI-off actors each frame (WorldCleaner); hosted NPC animations are queued and sent reliably (client reliable sends are now ordered), the server relays them reliably and keeps the last one for NPCs (cleared on respawn); the hoster sends `SkympStand` when a hosted NPC's sit state drops to 0 and at host start when standing; a puppet that another player hosts stands up on `SkympStand` or when it loads seated, unless the hoster's last animation is a furniture idle; a client that takes over a seated NPC another player hosted disables it and enables it 300 ms later (sunk skeleton otherwise). Red without `updateAnimations`: every puppet 0.0. Known gaps (PLAN G1.6): work loops at stations, the carry pose after `SkympStand`, a hoster's AI stall after the woodpile pickup, gestures as the last animation keep a seated spawn seated. Diagnostics in scratchpad adhoc/g16diag*.js.
- S3.4 PASS 3/3 (2026-10-14): MS13 stage 10 makes the server create the Golden Claw and Arvel's Journal in Arvel (create-in aliases, holder from the leader's aliasFill); the corpse keeps the claw ref after the server's corpse inventory is applied, the player loots the same ref, and the claw script sets MS13 40. At game start other quests also grant items to forced-ref holders (4b2d9 aliases 9 and 12, c18e1 alias 19). Still open in 2A step 4: the leader-only take of registered items; quest item ids are taken as global ids (official master files only). The Dragonstone path (MQ103 alias 18 in the location-filled boss alias 52) goes through aliasFill and is not tested yet (G2).
- 2A.2 PASS 3/3 (2026-10-14 11:31 local): server Disable/Enable of an ESP ref send the `isDisabled` property to the listeners (actors before the grid removal), Papyrus wrappers no longer send a SpSnippet; client applies `isDisabled` to the real ref of an NPC with a view and reads `props.isDisabled` at creation. Check 2A.2 became 2 engines (the 1-engine version passed without the client NPC apply). Red on the current check without the client apply (both engines). Review AGREE WITH NOTES, applied. Untested: engine 1 as the puppet; a hosted NPC that the server does not stream to the other player (one failed run with Brenuin before the precondition).
- 2A.1 PASS 3/3 (2026-10-14): server corpse branch for dead ESP actors, EnsureBaseContainerAdded in AddItem/AddItems, corpse inventory sent to listeners at death and on change; client: corpses (dead on the server or in the hoster's movement, and dead locally) block local activation and take the server inventory without resetBase, openInventory(true) for AI-off corpses, waitMenuMode in the container open/close loops (the close activation was never sent before, so containers stayed occupied). Red with the current check on the pre-fix build. Review AGREE WITH NOTES, applied. Unit 283/283. Risk until 2A.3/2A.4: client-created quest items in actors (Golden Claw, Dragonstone) are removed when the server's corpse inventory is applied.
- G1.8 PASS 3/3 twice (2026-10-14, commit `fix(coop): play hosted NPC voice lines on the other clients (G1.8)`): lines on engine 1 52 to 134 ms after engine 2, no subtitle on engine 1; red without the relay call: 0 of 10. Review AGREE WITH NOTES, all applied. Engine 1's local copy of the scene makes puppet Hilde say 954CC once per run (no subtitle, no match on engine 2): follow-up, block local speech on puppets that another player hosts.
- G1.7 FAIL after the escalation (2026-10-14 05:55): see the two G1.7 log lines and the G1.7 findings in PLAN. No harness press is faithful on the hidden desktops, so the puppet case cannot be measured. Product code is at HEAD. Stash "G1.7 harness press attempts" holds checks/G1.7.js and the natives (`pressKey` via BSInputEventQueue, pumped from the input listener); out/backup holds the dropped takeover and EndDialogue patch and the diagnostics. Pending for the user: a hand check with real keys on two PCs. Open lead: the Dialogue Menu of a puppet stayed open with the NPC out of dialogue after a cancel during the greeting.
- No game, server or runner is running between passes.

## Next steps

0. Retro 1 (2026-10-14, see the log line): harness tasks done. Still to do before 2A.3: red runs on the current check version (LOOP "check the checks"). Red on the current version is recorded for 2A.1, 2A.2, G1.5 and the door part of 1B.3. Red only on an older version: S0b, S0c, S1.1, 1A.5, G1.4, S1.4, S1.6, S1.2, S1.5, G1.3, S3.4, 1B.1, 1B.2, 1B.4, 1B.5, G1.1, G1.2, G1.6, G1.8. No red: S1.3, 1A.1, 1A.2, 1A.3, 1A.4 (S0, S2, S3.1-S3.3 have no product fix). The revert targets are the fix commits named in the retro (`git log --oneline`). Run S1.6 3 times on the current version.
   - 2A.3 state: check misc/e2e/checks/2A.3.js written (FreeformIvarstead02, Reyda's necklace created in the unlocked satchel d9b78 near Ivarstead; the Dragonstone is created in the Bleak Falls boss draugr 9bcd6, a corpse, so it never meets resetBase). First run FAIL, but for another reason: the client never reported FFI02 stage 10 (no `Coop: quest d9b64` line on the server), so the server did not create the necklace and the open showed 0. Find why the stage report is missing before the resetBase red.
1. Phase 2A: 2A.3 (resetBase keeps quest items), 2A.4 (rest: leader-only take), 2A.5 (script item gains and losses); each needs its check (the plan has none yet for 2A.2-2A.5 except through G2), then G1.9. G1.7 waits for the user's hand check (or a harness that can press keys: a visible run with focus is the untried option).
2. Then 2B (2B.3 also tests that a hoster does not allow a dragon's script events), G2, P. P8 stays red until reached.
3. Watch:
   - S1.2 had a flaky period (LESSONS). The 1B.4 claim after a replay failed once (23:20).
   - S1.6: Hadvar sometimes runs in place even when fleeing (path about 350 units); if S1.6 flakes in --final, an escort-based walk (Ralof with the start log, as in G1.1) is the next option. Between 03:33 and 04:12 UTC NPCs walked in place everywhere (cause unknown).
   - Review gaps of 1B.4: the member's 10 s wait is not observed, a non-quest actor near the leader, release when unloaded or gone, claims of dead actors or from another cell. Add them when a step touches that code.
   - The Helgen intro battle runs forever once players host it (S1.1 and S1.6 calm it). G1.1 did not meet it (Ralof is hosted at the cave exit).
   - G1.1: every login replays the whole quest log, so MQ102B stage 0 moves Ralof into the keep and MQ102 stage 15 moves him to the exit again on each client (and enables Alduin, who now flies away on his own). The server position wins only through the FormView's first movement (see the first-movement lesson). Each client also has its own Alduin. G1.1 ran once per build; road combat (wolves) is untested.
   - A puppet's loaded copy whose FormView is destroyed stays frozen and visible (no HostStop for non-hosters).
   - 2A.2: an NPC has no hoster right after a server enable (a client claims it again within 30 s in the final runs). A hosted NPC that the server does not stream to the other player stayed hidden on the hoster after the enable once (Brenuin, 09:06 run 2).
   - A real actor whose first movement ran before the player was in place is never moved again (LESSONS).
   - A hosted NPC's hits on its own hoster's player also reach the server (possible double damage). The 1B.3 hit scenario is flaky (ENV and retry).
   - Custom gamemode properties on ESP NPCs (LESSONS). 1B.1 coverage partial. 1B.2: resurrect side effects untested.
   - 1B.4 failed its start condition once in a full regression (engine 1 claimed Alvor before the first server read); it passed alone. Watch it in --final.
   - G1.4 (review): on load, RespawnWithDelay restarts the 12 h timer from the restart, not from the death, so each restart pushes a respawn back; the restart half has no red proof (the server log shows the reload); a death not saved yet can be lost if the server dies right after the kill (P1).
   - G1.2 risks (review): a teleportingHosts entry stays if the ragdoll promise never resolves or moveRefrToPosition throws (no claim of that NPC for the session); two pending teleports for one NPC unblock after the first; G1.2 asserts no walk (a snap to the forge would pass); with (a), a new view of an NPC whose hoster left keeps the client spot, so the next claim moves the server NPC there (a follower left by a player who disconnected).
   - 1B.5: hosted actors now run their own script events. Watch for scripts that act twice or fight the server (packages, item adds) in G1 and G2. HostStop and release remove ids through the same diff; no separate test for each.

## Runner

- Command: `node misc/e2e/run.js [--no-l1] [--only IDs] [--runs N] [--final] [--check file] [--visible]`
- L1 rebuilds the client and installs it; use --no-l1 only when nothing in the client changed.
- Ports: 7790 server, 7791 UI, 7792 probe, 7793 runner. Kill a stale runner that holds 7793.
- A crashed run is restored by the next start.
- `mp.lookupEspmRecordById(id).record` in a probe gives the record type and editorId (useful to name refs and cells; the game itself is French).
