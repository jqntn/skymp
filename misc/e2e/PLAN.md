# Coop play that works: shared NPCs and script sync

## Context

A playtest with two players showed no NPCs in Riverwood. Research found these problems in the server-owned world:

- The server skips every human NPC. The banned race list holds the 10 playable races, 15 other race ids, and Mannequin (`WorldState.h:256-267`, check at `WorldState.cpp:526-537`).
- The server also skips NPCs that are unique, essential, protected, in a crime faction, or initially disabled (`WorldState.cpp:411-537`).
- The client world cleaner deletes real actors within 8192 units, unless a FormView protects them or they are quest actors (`worldCleanerService.ts:42-117`). In this plan, the real actor is the ESP actor that the local engine loads.
- The client shows a server NPC as a `placeAtMe` clone. Quest scripts on the leader act on the real actor, and nobody sees it (`formView.ts:136-310`).
- NPCs cannot change cells (`MovementValidation.cpp:21`). The server has no AI, so NPCs in empty interiors never move.
- Client Papyrus blocks all script events except OnUpdate, after the client calls `blockPapyrusEvents(true)` (`FridaHooks.cpp:43-83`, `blockPapyrusEventsService.ts`). Only quest and alias events run, and only on the leader. Thus the Bleak Falls Barrow puzzles fail, and the first dragon never sets MQ104 stage 90.
- Quest items disappear. The Dragonstone is on the boss draugr (ACHR `0x9BCD6`), and the Golden Claw is on Arvel. The server cannot loot a corpse (`MpObjectReference.cpp:1422-1571`).
- Items from scripts disappear within 5 s. `containersService.ts:22-26` reports only a transfer between two containers, and `remoteServer.ts:84-88` applies the server inventory again every 5 s.

Decisions from the user:
1. The server owns the world. This stays an MMO with parties.
2. A party plays quests together with shared NPCs. All members see the same Alvor and the same dragon.

Result: a party of 2 plays MQ102, MQ103, and MQ104, from the Helgen exit to Lydia. All members see the same NPCs, and the progress persists. Phasing for several parties comes after this result.

## Model

- The server holds all NPCs and persists them.
- One client hosts each NPC. The hoster runs the real actor, not a clone. The actor keeps its native AI, packages, scenes, and scripts.
- The hoster sends movement, animation, health, and death of the NPC.
- The other clients puppet their own real actor of the same NPC, with the same form ID.
- A client can claim an NPC that its engine loads in its own cell, within 4096 units. The server then takes the cell and the position from the hoster.
- This claim rule gives NPC schedules, door transitions, and AI in rooms that the server does not simulate.

Script events run on one authority client:

| Script | Authority |
|---|---|
| Quest and alias scripts | The leader (this exists) |
| ESP object scripts | The leader |
| Actor scripts | The hoster of the actor |
| Word walls | All clients |

The authority client reports the results: activations, animations, and item gains. The server stores the results and relays them.

Terms: "delete" destroys a ref, an actor, or a file. "Remove" takes an item out of a list, a set, the grid, or an inventory.

## The loop

The loop follows `misc/e2e/LOOP.md`: the checks, the scoreboard, one pass, the rules, self-improvement, and when to stop and ask the user. This section holds the rules of this project.

**Mandate (user decision, 2026-10-12):**
- Goal: a production-ready result, with all S, step, G, and P checks passing. Then the user plays the gates (Verification, level 5).
- The loop's work includes game runs and wiki commits, and it can start the game at any time.

**Checks:**
- Ids: S (spikes), 1A.1 to 2B.5 (phase steps), G1 and G2 (gates), and P (production checks). One script per id in `misc/e2e/checks/`. The ids marked "2 engines" need the second engine of phase 0 step 0.
- ENV examples: the game or the server did not start, a check ran past its timeout, or the game crashed during the load.
- Each spike result has a next step (phase 0 step 3), so a spike result is never the stop condition "a result has no next step".

**Runner:** `node misc/e2e/run.js` runs level 1, then all checks in the order of this plan, and writes `misc/e2e/out/scoreboard.md`. A speed example: a changeForms snapshot as the start state of a check, in place of a quest replay.

**Memory files:** in `misc/e2e/` and `misc/e2e/out/`, all in git as LOOP.md says (user decision, 2026-10-12). `out/backup/` stays ignored: it holds this PC's ini and world backups, which the runner restores at start.
**Commits (user decisions, 2026-10-12):**
- The user allowed commits for this loop only. After each reviewed PASS, commit on `feat/coop-party`. Use a Conventional Commits subject line with the id, for example `fix(coop): keep the hoster on a cell change (G1.4)`. No body and no co-author.
- Then push: `git push fork feat/coop-party` (`fork` is https://github.com/jqntn/skymp). Never push to `origin` (skyrim-multiplayer/skymp), and never force-push. The user squashes later.

## Phase 0: spikes

Do these first. Their results set the scope of phases 1 and 2.

0. Test harness. All later steps use it.
   - `misc/e2e/driver.js` is a SkyrimPlatform plugin for tests only. It never ships. The runner copies it into `Data/Platform/PluginsDev` before the game starts, and deletes it after the game stops. `PluginsDev` is in the `PluginFolders` list of SkyrimPlatform and is empty today.
   - Do not write to a plugin folder while the game runs. A write makes SkyrimPlatform reload all plugins, the client too (`SkyrimPlatform.cpp:103-130`, `DirectoryMonitor.cpp`).
   - The driver gets commands from the runner at `http://127.0.0.1:<port>` with `sp.HttpClient` (cpp-httplib 0.40, plain HTTP works). The callback comes in the `tick` phase, where game functions do not work. Thus the driver queues each command and runs it on `update`. Then it posts the result. A failed request has `status` 0 and does not reject. The runner records ENV.
   - Plugins do not share `storage`: each plugin gets its own (`storageProxy.js`). Thus the driver reads the game with the SkyrimPlatform API, and the probe reads the hosters on the server.
   - `misc/e2e/probe.js` is the gamemode of the test server. It answers state queries from the runner on 127.0.0.1: `mp.get`, `mp.getActorPos`, hosters, and quest logs.
   - `misc/e2e/run.js` copies `build/dist/server` to `build/dist/e2e-server` with a baseline world. It starts the server and the client (`skse64_loader.exe`), runs the checks, stops the processes, and writes the scoreboard.
   - Level 1 runs `ctest`. `ctest` deletes `build/dist/server/world/changeForms` and overwrites `server-settings.json` and `gamemode.js` in that folder (`cmake/run_integration_test.cmake`). The playtest uses that folder. Thus the runner backs up the three before `ctest` and restores them after.
   - Each build copies `build/dist/client` into the game folder and overwrites `skymp5-client-settings.txt` (`INSTALL_CLIENT_DIST`, `GENERATE_CLIENT_SETTINGS`). Thus the runner writes the settings of a run after the build. The loop does not build while a Skyrim process runs that the runner did not start.
   - Bots from `mp.createBot()` in the probe are the other party members until a second engine exists.
   - Add `misc/e2e/out/` to `.gitignore`.
   - Skyrim has no headless mode: AI, Havok, and Papyrus run in the render loop. Thus the runner uses a low-cost mode for the run:
     - `bAlwaysActive=1` in `Skyrim.ini` `[General]`, so the game runs without focus. It is already 1. The runner checks it.
     - A 640x400 window with the Low preset: `iSize W`, `iSize H`, and the quality keys in `SkyrimPrefs.ini` `[Display]`.
     - `FramerateLimit=30` in `[Render]` of `Data/SKSE/Plugins/SSEDisplayTweaks.ini`. It is 240 today.
     - The runner restores the three ini files at the end.
   - Checks use API calls (`activate`, `setStage`, `Ui.invokeString`) before key presses, because key input can need focus.
   - Each check has a timeout. The runner kills the game and the server after a timeout and records ENV.
   - The runner writes the ids of its processes to a file, and it stops only those processes. If another Skyrim process runs (the user plays), the runner waits.
   - The runner backs up the ini files before it changes them. At the start of a run, if a backup exists, the runner restores it first. Thus a crashed run does not leave the game in low-cost mode.
   - Before a run, the runner checks that `SkyrimSE.exe` is version 1.6.1170, the version of the installed SKSE (`skse64_1_6_1170.dll`). If it is not, the result is ENV, and the loop stops: Steam updated the game. The user set Steam to update Skyrim only when the user starts it (2026-10-12). The version check stays as a guard.
   - A UDP proxy in the runner sits between the clients and the server. It can add delay and packet loss (see P7).
   - S0: the client connects and sends the player position and a screenshot. The server sees the same position within 64 units.
   - Second engine on this PC (user decision, 2026-10-12):
     - Fix `Detach()` (`skyrim-platform/src/platform_se/skyrim_platform/main.cpp:443-447`). It runs on `DLL_PROCESS_DETACH` (`tilted/reverse/Entry.cpp:123-124`). Kill only the current process and its own CEF children, not all processes by name. `FlowManager::CloseProcess` is the code to change. This fix ships.
     - Plan edit (loop, 2026-10-12): no hook is needed. The engine rejects a second instance only when it starts from the same folder. A second instance from `build/e2e-game2/` ran 10 min next to the first, without hooks. The loop deleted the four hooks of the first plan (`FindWindowA`, `OpenMutexA`, `CreateMutexA`, `CreateMutexW`).
     - S0c (added by the loop, 2026-10-12): a second instance starts from the same folder as engine 1, and the engine rejects it. Engine 1 still runs 10 s later. With the old `Detach()`, the exit of the rejected instance kills engine 1. A normal quit (`Debug.quitGame`) does not reach `Detach()`.
     - The runner makes `build/e2e-game2/`, a hard-link copy of the game folder. Hard links work: the user and `Users` have full control of the game files, and the game and `build/` are on the same drive C:. The copy has its own `skymp5-client-settings.txt` with a second profile id, and a `steam_appid.txt` with 489830.
     - At each run, the runner copies the skymp files (`Data/Platform`, `Data/SKSE/Plugins`, the driver) into `build/e2e-game2/`, and does not link them. A build replaces these files, and a hard link keeps the old version.
     - The two instances write the same log files in `My Games`. Thus the driver sends its log lines to the runner over HTTP.
     - S0b: two instances run for 2 min with different profile ids. The server sees two users, and neither process exits. (User decision, 2026-10-12: 2 min, was 10 min.)
1. NPC puppet spike, in a git worktree (see the rules in LOOP.md):
   - Plan edit (loop, 2026-10-12): the spike changes are the same as phase 1 steps 1A.1 and 1B.1, so the loop made them as real phase 1 code on the branch, with tests, not in a worktree. S1.1 also needed 1A.5 (the property path), the bounded write of 1A.2, the cleaner bullet of 1B.4, and the resurrect fix of 1B.3. The banned race list keeps Mannequin, AlduinRace, and UndeadDragonRace; DragonRace is not banned, because Mirmulnir must load (phase 1A step 1).
   - Clear the banned race list and the flag filter.
   - Make `FormView` use the real actor. Skip `localImmortal`.
   - S1.1 (2 engines): Alvor, Gerdur, and Hadvar have the same position on two clients within 1 s.
   - S1.2 (2 engines): dialogue works on the two clients.
   - S1.4 (2 engines): a puppet does not start dialogue, a scene, or combat by itself. Its position comes only from the hoster.
   - S1.3, schedule test: at 8:00 game time, a client arrives in Riverwood, and no player was there before. Pass: Alvor is at the forge, not in his house. A FAIL means that the local engine does not run schedules for NPCs in unloaded cells.
   - S1.6 (2 engines, added by the loop, 2026-10-12): the hoster's NPC walks and stops. The puppet plays a moving animation (`Speed` > 20) in 80% of the samples where the hoster's `Speed` has been above 20 for 0.5 s, and an idle animation (`Speed` < 20) in 80% of the samples where the hoster has stood for 0.5 s. (User decision, 2026-10-12: the 0.5 s allows for network delay at a start or a stop. The loop had proposed 1 s.) This guards the puppet AI switch of phase 1B step 2: with AI off, the old offset hold no longer animates.
   - S1.5 (2 engines, added by the loop from the S1.2 review, 2026-10-12): engine 2 hosts an NPC. The player of engine 1 talks to the puppet, picks a topic, and closes the dialogue. Then the hoster moves the NPC, and the puppet on engine 1 follows within 1 s, as in S1.1.
2. Server Papyrus spike:
   - Add `"archives": ["Skyrim - Misc.bsa"]` to the server settings.
   - S2: do a test of the Bleak Falls Barrow pillars and the claw door on the server VM. See `ScriptStorageFactory.cpp:48-63` (`AddBsa` reads `archives`) and the pillars workaround at `MpObjectReference.cpp:457-477` (a ref can activate itself even when it has the parent-activation-only flag).
   - If S2 passes, phase 2B step 2 gets much smaller.
3. Hook and loot spike, with client debug logs:
   - S3.1: does `hooks.sendAnimationEvent` fire for `PlayAnimation` on activators? The code says yes: the hook is on the animation graph of all references, not only actors (`FridaHooks.cpp:167-195`, `refr = rcx - 0x38`, `game/Offsets.h:24`). S3.1 proves it in the game.
   - S3.2: does `containerChanged` fire for a script `AddItem`?
   - S3.3: does `activationService` receive a script `activate()` on a blocked ref?
   - S3.4: does an alias item ref stay after `applyInventory`, with the fix in phase 2A step 3?
     - Plan edit (loop, 2026-10-12): S3.4 is BLOCKED until phase 2A step 1. An alias item ref meets `resetBase` only when the client applies a corpse or container inventory. The quest items of MQ102-104 are created in actors (Golden Claw: MS13 alias 11 in Arvel; Dragonstone: MQ103 alias 18 in alias 52), the server opens a corpse only after the corpse branch of 2A.1, and a server `mp.set` of a container inventory does not reach the client. SP `Quest.getAlias` returns null for every quest; `ObjectReference.getNumReferenceAliases` (SKSE) works from the item side. When 2A.1 is in, S3.4 loots the Golden Claw from Arvel's corpse and checks that the same ref keeps its alias.
   - The result of each spike sets the next step. There is no open case:
     - S1.1, S1.2, S1.4, S3.1, S3.4: a FAIL is a bug. Fix it like a FAIL of a check.
     - S1.3 FAIL (user decision, 2026-10-12): accept it, and continue. NPCs pause while no player is near. When a player arrives, they continue from their last server position and walk to the place of their schedule. Skip the "first movement" bullet of phase 1B step 4. Add this to "Known limits" on the wiki.
     - S2 PASS: phase 2B step 2 keeps only the parts that the server VM does not do. S2 FAIL: do all of phase 2B step 2.
       - Plan edit (loop, 2026-10-12): S2 PASS with the archives setting (check-level only; the production server settings do not have it yet). The server VM ran both puzzles: pillars, lever, gate, rings, keyhole, door. What it does not do, so phase 2B step 2 keeps it: (a) the opened state is not saved (`lastAnimation` is not written to the change form, `SetOpen` does not set `isOpen` on activators), so a restart closes the gate and the door; (b) the natives `DisableLinkChain` and `Quest.IsRunning` are missing, so the keyhole never sets MS13 stage 50; (c) STAT markers and MSTT refs are not loaded, so script properties that point to them are None (the door FX, `puzzleDoorActivator`); (d) scripts get OnLoad only after a player-profile actor is near, and `PlayAnimationAndWait` waits for a client reply (15 s timeout without one). From the S2 review: (e) `PlaceAtMe` is not supported, so traps do no damage; `SetNoFavorAllowed` is missing; (f) a bare `"Skyrim - Misc.bsa"` resolves inside `dataDir`, so production needs the BSA there or an absolute path; (g) S2 does not show that a client sees the gate move or can walk through it (`DisableLinkChain` keeps the collision); G2.2 covers that.
     - S3.2 FAIL: the client compares the player inventory every 500 ms to find script gains and losses.
       - Plan edit (loop, 2026-10-12): S3.2 PASS: `containerChanged` fires for a script AddItem (0 -> player). The S3.2 review found that the client's own re-apply of the server inventory fires the same kind of event (player -> 0, 1 s later), so phase 2A step 5 must ignore container changes while the client applies a server inventory (or compare with the server state), or it reports fake script losses and gains.
     - S3.3 FAIL: the authority finds script activations with `hooks.sendPapyrusEvent` for `OnActivate`.
       - Plan edit (loop, 2026-10-12): S3.3 PASS: a script `activate()` on blocked refs (the BFB lever's script on its dart traps) raises SP's `activate` event with the ESP caster, so `activationService` gets it; today it drops casters that are not the player or a clone, which phase 2B step 2 changes. Refs with parent-activation-only (XAPD flag 1) raise nothing for a non-parent caster. Registering any `sp.hooks.sendPapyrusEvent` handler from JS froze the game in the test, so phase 1B step 5 keeps its C++ set and nothing should rely on that JS hook.

## Phase 1A: shared NPCs on the server

1. **Load filters**, in `WorldState.cpp` `AttachEspmRecord`:
   - Delete the flag filter (:472) and the crime faction filter (:480-506).
   - Shrink `bannedEspmCharacterRaceIds` to Mannequin `0x10760a`. First, name the 15 race ids without a comment (`WorldState.h:257-259`) with espm. Keep an id that is not a race of human NPCs. Keep the StartsDead (:411-422) and Deleted (:439-445) skips.
   - Load InitiallyDisabled refs (:431-437) with `isDisabled = true`. A client claim enables them later. Mirmulnir and the MQ104 soldiers appear this way.
   - Give non-unique ESP NPCs a default `spawnDelay` of 43200 s. Today all actors get 25 s (`MpChangeForms.h:109`), and `AttachEspmRecord` does not set it. `test_isdead.js` sets 0 with `mp.set`, so it is not affected.
2. **Host protocol**, in `ActionListener::OnHostAttempt` (:653):
   - Reuse `MsgType.Host`. Add the optional fields `worldOrCell`, `pos`, `rot`, `release`, and `disabled` to `cpp/messages/HostMessage.h` and to the client message type.
   - Reject a claim with a location in these cases:
     - The NPC has a user.
     - The cell is not the cell of the claimer.
     - The distance is more than 4096.
     - The id is not a CELL or WRLD record.
   - Grant: keep the rule that exists (`ActionListener.cpp:680-684`: the hoster is 0, or its last movement update is more than 2 s old). Write `hosters` first. Then call `Enable`, `SetCellOrWorld`, and `SetPos`. After that, run the HostStart code that exists.
   - Release: clear the hoster. Then call `UpdateHoster(0)`. If the message asks for it, call `Disable`.
   - Fix the unchecked write at :691, with a resize as at :177. Fix the log format at :685.
3. **Hoster cleanup**: in `onUnsubscribe` (`PartOne.cpp:881`), if the listener is the hoster, clear the hoster. Then send HostStop. This step applies to a disconnect, a cell change, and an exit from the grid.
4. **Movement, health, and death of hosted NPCs**:
   - In `OnUpdateMovement`, an update for an NPC skips `MovementValidation` (`ActionListener.cpp:136-144`). A cell change calls `SetCellOrWorld`. Note: today the packet goes to the neighbours (:119) before the validation.
   - Copy `healthPercentage` and `isDead` from the message. `UpdateMovement` already carries the two values (`movementGet.ts`).
   - In `MpActor::SetPercentage` (:652, health 0 or less) and `SetPercentages` (:683, health exactly 0), do not call `Kill` for ESP NPCs. The hoster engine selects death or bleedout.
   - In `RespawnWithDelay` (:1351), return early for ESP NPCs with the Unique flag.
5. **Property path fix**: `PreparePropertyMessage_` (`MpObjectReference.cpp:64-66`) sends the raw ESP id. Thus the client takes the ESP branch (`remoteServer.ts:732`, `skipFormViewCreation` at :915-920), and that branch handles only inventory, isOpen, isHarvested, and disabled. `isHostedByOther` and `tIsDead` never get to the FormView of an ESP NPC. Fix: at :732, if `forms[getId(msg.idx)]` exists, take the model branch (:752-754).

## Phase 1B: shared NPCs on the client

1. **Real actor in FormView** (`formView.ts`):
   - For `model.refrId > 0x100000000`, use the real ESP id. When the model is dead, also take the ref. If `isDisabled()` is true, call `enable()` on the actor.
   - Delete the alias bridge (:35-52, :327-336, `hidesOriginal`, `getEspRefrId`).
   - Do not apply these to a real actor:
     - `localImmortal` (1e6 health and magicka, :319-324)
     - `SpawnProcess` (:198-203)
     - Aggression (:272)
     - the visible name (:116-117, :304-306)
     - the equipment (:568-592)
   - In `destroy()`, release the puppet holds on a real actor. Do not delete the actor.
   - Skip ids at `0x100000000` or more in the clone view (`formViewArray.ts:61-69`).
2. **Puppet and hosted state**:
   - Puppet: call `startDeferredKill`. Save the current `attackDamageMult`. Then set it to 0.
   - Puppet: find the smallest call set that stops the own AI of a puppet and keeps the hold. The candidates are `setDontMove`, `enableAI(false)`, `stopCombat`, and the Aggression value (`skyrimPlatform.ts:1931`, :2073, :2105). Test each candidate in S1.4.
   - Hosted actor: call `endDeferredKill`. Then restore `attackDamageMult`.
   - Call `blockActivation(false)` on real actors. Skip `movementApply.ts:58` and the NPC case in `ObjectReferenceEx.dealWithRef` for ids below `0xff000000`.
   - In `teleportIfNeed` (`movementApply.ts:208-216`), call `moveRefrToPosition` for a real actor. Do not throw.
3. **Death and hits**:
   - In `resurrectActor` (`deathService.ts:102-113`), call `actor.resurrect()` for a real actor. Today it throws `RespawnNeededError` for each non-player, and `remoteServer.ts:802-804` then disables and deletes the actor. For an ESP id, that is the real actor.
   - Accept a hosted ESP aggressor at `hitService.ts:19` and a hosted ESP caster at `activationService.ts:30-32`.
   - Block KillMove for all ids. Today the hook covers only ids from `0xff000000` to `0xffffffff` (`deathService.ts:31-43`).
   - In `sendActorValuePercentage` (`sendInputsService.ts:148`), if `_refrId` has a value, return. Today it sends the actor values of the player for hosted NPCs.
4. **Host policy and world cleaner** (`worldCleanerService.ts` `processOneActor`):
   - Never delete actors with an id below `0xff000000`.
   - If all these conditions are true for a real actor, claim it with a location:
     - `is3DLoaded()` is true.
     - `isDisabled()` and `isDead()` are false.
     - The actor has no hoster and no FormView.
     - The actor is in my cell, within 4096.
   - First movement of a real actor. Skip this bullet if S1.3 fails, because then the server position is better than the local position.
     - The condition at `formView.ts:472` is `model.isHostedByOther || !this.movState.everApplied`.
     - If `isHostedByOther` is false and the loaded real actor is in the cell of the player, skip the first `applyMovement`. Then host the actor at once.
     - Today the first update moves the real actor to an out-of-date server position, even when nobody hosts it.
     - After a host grant, `sendInputsService.ts:113-134` sends the local position. Thus a later move by a quest script needs no change.
   - If a HostStop arrives for an actor without a FormView, hide it with `disableNoWait`. Then try the claim again every 5 s.
   - In `sendInputsService.ts`, release a hosted actor that is gone, unloaded, or disabled. Remove it from `storage['hosted']`.
   - Party rule: when the leader is in the same cell, within 4096, a member releases a quest alias actor (`CoopService.isQuestActor`). The member waits 10 s before it claims that actor again. The leader then hosts it.
   - Replay: no claims and no hosted movement while `CoopService.reporting` is false.
5. **Actor script events on the hoster**:
   - In `PapyrusTESModPlatform.cpp/.h`, add a set of form ids behind a `std::shared_mutex`, because SendEvent runs on VM threads.
   - Add the JS native `setPapyrusEventsAllowedForms(ids)` in `DevApi.cpp/.h`. It replaces the whole set.
     - Plan edit (loop, 2026-10-13): also `getPapyrusEventsAllowedForms()`, which returns the set. The 1B.5 check reads it, because a check cannot put a puppet into combat to raise an event (LESSONS).
   - In `FridaHooks.cpp`, after the quest block (:44-50), if `selfId` (:26, set at :32 and :36) is in the set, allow the event.
   - The client calls the native on HostStart, HostStop, and release, with `storage['hosted']`. It does not add dragons (see phase 2B step 3).
     - Plan edit (loop, 2026-10-13): the client compares `storage['hosted']` at each update and calls the native when it changes, so HostStart, HostStop, and release take the same path. Bleak Falls Barrow has no dragon, so the 1B.5 check does not test the dragon rule. The 2B.3 check must also show that a hoster does not allow the script events of a dragon it hosts.

**Tests for phase 1:**
- C++ unit tests with the tag `[NpcHost]` in `unit/`. The door test at `unit/PartOne_ActivateTest.cpp:242-292` is a template.
- The integration test `misc/tests/test_npc_host.js`, with `misc/tests/test_npc_host.settings.json` = `{"npcEnabled": true}`, in the style of `misc/tests/test_coop.js`. Its ctest name is `integration_test_npc_host`.
- `test_isdead.js` must still pass. It expects a respawn of the ESP crab with `spawnDelay` 0.

**Gate 1 checks:**
- G1.1: Ralof walks to Riverwood.
- G1.2: Alvor goes from his house to the forge. Gerdur and Alvor open the dialogue menu on the client.
- G1.3 (2 engines): Gerdur and Alvor talk on the two clients.
- G1.4: A killed bandit stays dead after 30 s and after a server restart.
- G1.5: The Whiterun guards, Balgruuf, and Farengar are there, and MQ103 starts.

## Phase 2A: server fixes and quest items

1. **Container and corpse fixes** in `MpObjectReference.cpp`, with Catch2 tests:
   - Call `EnsureBaseContainerAdded` inside `AddItem` (:820-826) and `AddItems` (:853). Today an add to an unopened ESP container sets `baseContainerAdded` and loses its base loot (:1950-1954).
   - Add a corpse branch to the CONT branch of `ProcessActivateNormal` (:1515): `(t == CONT || (AsActor() && AsActor()->IsDead())) && actorActivator`.
2. **Disabled state** (`MpObjectReference.cpp:510-536`):
   - For an ESP non-actor ref, `Disable()` changes only the change form. Only the Papyrus wrapper sends a `Disable` SpSnippet (`PapyrusObjectReference.cpp:471-476`). Send an update from `Disable()` and `Enable()`.
   - For an ESP actor, `Disable()` removes it from the grid. The puppet clients then destroy the FormView, and the real actor stays enabled. Send `isDisabled` before the grid removal, and the client disables the real actor.
   - Fix the name mismatch: the server sends `props.isDisabled` (`CreateActorMessage.h:73`), but the client reads `props['disabled']` (`remoteServer.ts:303`, :746).
3. **Alias item refs**: in `sync/inventory.ts:330` (`resetBase`), call `removeAllItems(null, false, false)`. Today the call is `removeAllItems(null, false, true)`, which removes quest items and deletes alias item refs, so `MQ103BookScript` and `MS13GoldenClawScript` never run.
4. **Quest items**, in `coop.ts`, `coopService.ts`, and a new pure module `skymp5-server/ts/systems/questItems.ts` with unit tests:
   - Extend `questInfo` (`coop.ts:253`) with the ALCO and ALCA "In" pairs and the holder alias (ALFR or ALUA).
   - On the first live stage of a quest from the leader, find the holder. ALFR gives the ref. Otherwise the server sends `aliasFillRequest`, and the leader replies with `quest.getAlias(id).getReference()`.
   - Examine the reply: the ref must be an ESP ACHR or REFR. For ALUA, the ACHR base must equal the ALUA value.
   - Call `AddItem` on the holder. Record each grant in a new property `private.coopCreated`, so that a replay does not add the item again.
   - Alias events run only on the leader. Thus, in the `onTakeItem` gamemode event (`TakeItemEvent.cpp`), if a member that is not the leader takes a registered item, return false. If an earlier handler exists, chain it. `coop.ts` reaches the server through `ctx.svr`, which is the `mp` object (`ts/index.ts:83`).
5. **Script item gains and losses**, in `containersService.ts`, `coop.ts`, and a new pure module `skymp5-server/ts/systems/scriptItems.ts` with unit tests:
   - Client: a container change with one missing container, or with no container menu open, is a script transfer. Send `scriptItems {gains, losses, dialogue}`. Then patch the local inventory at once.
   - Server: always accept losses.
   - Server: accept gains only within 15 s after a stage or a live `questApply`, or during a dialogue. Never accept gains within 10 s after a replay.
   - Server limits: playable item types only. Gold is 1000 or less, and other items are 5 or less for each base in each window.
   - Shortcut: these rules do not stop a cheater. Use a whitelist from the VMAD properties later.

## Phase 2B: results from the authority client

1. **Papyrus policy**, in `FridaHooks.cpp`:
   - Extend the leader flag (`GetQuestPapyrusEventsAllowed`) to ESP non-actor refs (`RE::FormType::Reference`, id below `0xff000000`). This includes OnInit, OnLoad, and OnCellAttach.
   - Add `WordWall` to the name loop at :58-74, so that word walls run on all clients. Today the loop allows only names that start with `SKI_` and `defaultDisableHavokOnLoad`.
2. **Activations and animations**, in a new client `scriptAuthorityService.ts`, `activationService.ts`, and `coop.ts`. Skip the parts that spike 2 makes unnecessary.
   - `espActivate`: the authority sees a script activation with an ESP caster. It sends the caster and the target. The server examines them and calls `Activate` with `callPapyrusFunction`.
   - `espAnim`: the authority sends animation events of ESP non-actor refs from `hooks.sendAnimationEvent`. The server examines the name (`/^\w{1,64}$/`), the authority, the cell, the distance (8192), and duplicate events (2 s). Then it calls `PlayAnimation`.
   - `proxyActivate`: a member who activates a scripted ESP activator sends the target. The server examines the distance (1024) and the cell of the leader, and forwards it. The leader calls `refr.activate(Game.getPlayer(), false)`.
   - All writes to ref state use one function, `writeRefState(party, ref, op)`, in `coop.ts`. Phasing then writes to the party copy.
3. **Dragon soul**, in `coop.ts` and `scriptAuthorityService.ts`:
   - The coop `onDeath` gamemode event (`DeathEvent.cpp`) finds a dragon: the base NPC_ VMAD holds `dragonActorSCRIPT`. It sends `dragonSoul` to party members within 8192.
   - Each client adds 1 to `DragonSouls` and to DragonsAbsorbed.
   - If the quest runs and the stage is not done, the leader sets MQ104 stage 90.
4. **Replay safety**:
   - While `reporting` is false, do not send a new packet. Wait for the 3 s settle time.
   - After the replay, apply the ESP props again from the cached CreateActor messages in `remoteServer.ts`.
5. **Integration test**: in `misc/tests/test_coop.js`, bots send `aliasFills`, `scriptItems`, `espActivate`, and `onTakeItem`. Then the test examines `mp.get(ref, "inventory")` and `isOpen`.

**Gate 2 checks:** the real client is the leader, and a bot is the member.
- G2.1: The Golden Claw is on Arvel, and the game sets MS13 stage 40.
- G2.2: The member turns the pillars. The gate and the claw door open on the server and on the leader client.
- G2.3: The leader loots the boss, and the game sets MQ103 stage 180. Farengar takes the Dragonstone.
- G2.4: The leader and the member get the soul of Mirmulnir, and the game sets MQ104 stage 90. Lydia becomes the follower of the leader.
- G2.5: Rewards stay after 10 s, and the players can equip them. After each step, the players log in again, and the state stays.
- G2.6 (2 engines): G2.2 and G2.4 with a real client as the member.

## Phase 3: after the result (not in this plan)

Phasing for several parties: party copies of refs, the phase filter, form id translation, and dungeon instances. The wiki page Testing-and-Limits lists it under "Next steps". `writeRefState` in phase 2B prepares this work.

## Docs

Update only the wiki at https://github.com/jqntn/skymp/wiki. Do not update other docs.

- Home: the Status and "Changes from the first plan" sections.
- Architecture: the host model and the script authority table.
- Parties: the release rule for quest actors.
- Quest-Sync: quest items, script items, and the results from the authority client.
- Testing-and-Limits: the loop, the harness, the check ids, "Known limits", and "Next steps".
- When all checks of a gate pass, update the Status on Home and the pages of that phase.
- Edit a clone of `https://github.com/jqntn/skymp.wiki.git` at `C:\Users\jqntn\source\repos\skymp.wiki`, outside the repo. Commit with the loop commit rules, then push the wiki clone to its remote (user decision, 2026-10-12).

## Verification

Write the test for each server rule before the rule.

**Level 1, after each step:**
1. Build: `cmake --build . --config Release` in `build`.
2. C++ unit tests: `unit/Release/unit.exe "[NpcHost]"` and the other new tags, in `build`.
3. Server TS tests: `yarn test` in `skymp5-server`.
4. Integration tests, in `build`:
   - CAUTION: Copy the world before you run `ctest`. `ctest` deletes `build/dist/server/world/changeForms`.
   - Run `ctest -C Release -R "integration_test_(coop|npc_host|isdead)"`.

**Level 2, at the end of each phase:**
- Run all unit tags and all integration tests, because the new load filters change the NPCs that load.
- Run them again with `npcEnabled` false. The tests that exist on `main` must pass.

**Level 3, one real client and bots:**
- The harness of phase 0 step 0 runs this level: `node misc/e2e/run.js`.
- The checks read these sources:
  - the server: `mp.getActorPos`, hosters, `isDead`, and inventory
  - the client: positions, quest stages, and menus, through the SkyrimPlatform API
  - the log lines that the driver sends
  - screenshots of the game window
- A bot has no engine, so it cannot be a puppet. The ids marked "2 engines" need level 4.

**Level 4, a second engine:**
- Result of a test on 2026-10-11: Skyrim does not run twice on the same PC. There are two blocks:
  - The engine exits a second instance within 1 s, before it makes a window. `SkyrimSE.exe` imports `FindWindowA`, `SetForegroundWindow`, and `OpenMutexA`.
  - When a process exits, SkyrimPlatform `Detach()` (`main.cpp:443-447`) kills all processes with the name `SkyrimSE.exe`. Thus the second instance also kills the first.
- The user selected the dev hook on this PC. Phase 0 step 0 found that a second folder is enough (no hook), and S0b checks it.
- The second engine runs the "2 engines" checks. Examples are the same position within 1 s, and no fight between the puppet hold and the AI packages.

**Level 5, two players:**
- Two clients with new profile ids play the Gate 1 and Gate 2 lists above.
- `node misc/e2e/run.js --watch` runs only the server asserts of each gate check and prints PASS or FAIL for each step.

**Production checks (all must pass for the result):**
- P1, persistence: at each gate step, kill the server process (not a clean stop). Then restart it, log in the players again, and compare the state.
- P2, hoster loss: the hoster closes the game in combat, changes cell, or leaves the party. The server clears the hoster within 5 s and keeps the last state of the NPC.
- P3 (2 engines): after a hoster loss, another client takes the NPC within 5 s. The NPC must not jump, appear twice, or die.
- P4, abuse: a bot test sends bad packets. The server must reject and log each one. The bad packets are:
  - claims from the wrong cell, from too far, on the actor of a player, or with an id that is not a cell
  - `scriptItems` outside the window or above the gold limit
  - repeated `espAnim` events
- P5 (2 engines), load: compare the server with `main`. Use two clients and 10 moving bots for 1 hour in Whiterun. Limits (user decision, 2026-10-12): tick time, memory, and bandwidth for each client are at most 25% more than `main`. Load time is at most 2 times the load time of `main`.
- P6: solo play without a party still works.
- P7, network: the G1 and G2 checks pass with a delay of 150 ms and a packet loss of 2% on the proxy.
- P8 (added by the loop from the S0 review, 2026-10-12): a client logs in and stays 20 s in the world. The client log has no `[Exception]` line. Today the client throws `failed to call custom Serialize for type struct Equipment: failed to get key 'inv'` at each login.

Limit: these checks show that a trusted party can play MQ102 to MQ104. They do not make a public server safe. The `scriptItems` rules do not stop a cheater, and several parties need phase 3.

## Risks, highest first

| Risk | Spike or fallback |
|---|---|
| The puppet hold (`keepOffsetFromActor`, `translateTo`) fights alias packages on real actors. | Spike 1 (S1.1, S1.4), phase 1B step 2 |
| Corpse looting and quest items on NPCs. | Spike 3, phase 2A step 1 |
| The animation hook does not fire for the activators, or it echoes. | Spike 3 |
| A replay moves an NPC to an out-of-date position. Then a claim overwrites newer server state. | No claims while `reporting` is false (phase 1B step 4) |
| The Papyrus hook runs on VM threads. | `shared_mutex` (phase 1B step 5) |
| Many solo players are each an authority for the same shared ref. | Phasing in phase 3 |
| Leveled NPCs can look different on each client. | Accept for the gates |
