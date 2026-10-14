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
       - User decision, 2026-10-13 (replaces the server-position part of the decision above): the client position wins for an NPC that nobody hosts. The local engine does run schedules off-screen (a G1.2 probe at 7:59 had Alvor on the forge marker while the server still had him in his house), and the first update pulled him to the stale server position into a cell that was not loaded yet; NPCs pulled that way often stall. So the first update of an unhosted real NPC keeps its local position, and a claim reports it when a player is near (phase 1B step 4, first movement). Later on 2026-10-13 the stall turned out to come from the player standing near the NPC, not from the pull, and G1.2 (before its start assert) passed without this change; the user kept it, because the client runs the AI and the server position of an NPC that nobody hosts is stale. User decision, 2026-10-13 (asked about the side effect): the client position wins always, also over a server-side move (gamemode `mp.set`, later the server VM of phase 2B) of an NPC that nobody hosts; the first client that sees him keeps its own position and its claim overwrites the server move. Checks that put players near an NPC go to the position that the client has (`ctx.npcLocation`), and S1.6 places Hadvar on the clients as well as on the server.
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
     - Plan edit (loop, 2026-10-13, user decision of the same day): do it for every real actor that nobody hosts and that is not dead, loaded or not, in any cell. The first update keeps the local position; the FormView or the world cleaner claims the actor when it is loaded near the player. A puppet (`isHostedByOther`) and a dead actor still take the server movement.
     - The condition at `formView.ts:495` is `model.isHostedByOther || !this.movState.everApplied`.
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
  - Plan edit (loop, 2026-10-13): G1.1 needed two changes that no phase 1 step names. The default start log in `settings.ts` gains MQ102B stage 5 and MQ102 stage 15 (the cave exit, which moves Ralof out of the keep). The world cleaner leaves the AI of actors whose race the server does not load (Alduin) on, so that Alduin's flyover ends. The check reads the start log from `settings.ts`.
- G1.2: Alvor goes from his house to the forge. Gerdur and Alvor open the dialogue menu on the client.
  - Plan edit (loop, 2026-10-13, check change approved by the user that day): with the client position winning, the client engine can have Alvor at work already when the player arrives. The check then moves the local Alvor into his loaded house at his server position as the start state, so he still walks through the door to the forge.
  - Plan edit (loop, 2026-10-13, check change asked by the user that day): Alvor does not leave his house while the player stands near him on the same floor (his dialogue target turns to the player and he waits by the door, also when the client never hosts or touches him). The check no longer follows him: the player waits on the lower floor of the house, then at the Riverwood marker outside (about 2000 units from the forge, close enough to host him). The start also proves the first movement of an NPC that nobody hosts and that is not loaded (user decision above): before the player comes, the client has Alvor at the forge (the check puts him there if he is at home); 2 s after the player enters the house, the client must not have moved him to the stale server position in the house. Then the check moves him home for the walk.
- G1.3 (2 engines): Gerdur and Alvor talk on the two clients.
  - Plan edit (loop, 2026-10-13): the check talks through, as S1.5: on the puppet engine, then on the hoster engine, the player opens the dialogue, picks the first topic, gets an answer other than the greeting, and closes the dialogue. Opening the menu alone did not depend on any phase 1 rule.
- G1.4: A killed bandit stays dead after 30 s and after a server restart.
- G1.5: The Whiterun guards, Balgruuf, and Farengar are there, and MQ103 starts.
  - Plan edit (loop, 2026-10-13): MQ103 runs from the game start (stage 5 is a start-up stage), so "MQ103 starts" means stage 10 (Balgruuf's task after MQ102 stage 160), on the client and in the server quest log. The check starts with the settings.ts log and MQ102 stage 30, puts the player at the Dragonsreach porch (at least 2 guards loaded, alive, and hosted by the player), then in Dragonsreach (Balgruuf and Farengar the same), and talks to Balgruuf (first topic not picked yet) until MQ103 stage 10.
- User decisions, 2026-10-13 (playtest with two players; checks approved as written, in this order: G1.6, G1.7, G1.8, then phase 2A, then G1.9):
  - G1.6 (2 engines): engine 2 hosts the Riverwood NPCs, then engine 1 arrives. On engine 1, each NPC that engine 2 hosts within 3000 units has its right hand at least 30 units below its right shoulder (an A-pose puts them level) for 10 s, and a walking NPC passes the S1.6 walk test. Then the same with the engines swapped. (Playtest: all NPCs that the friend hosted stood in an A-pose.)
    - Plan edit (loop, 2026-10-13, user decision of the same day: the loop picks measures itself, the user wants the bugs fixed): the hand-below-shoulder measure fails on normal NPCs (on the hoster: Faendal 22, Alvor working 24, children 27), and a frozen puppet measures about 34 and never moves. New measure for Faendal, Alvor, and Hilde, with both players within 250 units: 20 samples over 2 s on both engines, hands relative to the pelvis in the NPC frame. When the hoster's hands move 3 units or more, the puppet's move 1 unit or more; the shoulder-to-hand drop and the head height (means) are within 6 units of the hoster's; at least one NPC moves on the hoster in each direction. Cause found: `enableAI(false)` on a puppet stops its animation graph (0 movement in every sample), and S1.6 reads only the Speed graph variable.
    - Plan edit (loop, 2026-10-13): the drop and head means compare the phase of looping work animations, not the pose (Faendal picking up wood on both engines: head 21 vs 50). The pose test now compares the hips height (pelvis above the actor's feet, within 6 units), which tells sitting, kneeling, and standing apart. Both players face the NPC. A standing idle has no hand motion even on the hoster, so a direction where no NPC moves is not a failure; instead an A-pose test runs on every NPC: when the hoster's shoulder-to-hand drop is 25 units or more (arms hanging), the puppet's is 15 or more or its hands move 0.5 units or more (an A-pose holds the arms up and still; a puppet at the tanning rack had its hands up mid-stroke, moving 4.0) (gestures sent by the test played on the hoster, but did not move its hands 3 units). A frozen puppet measures 0.0 and a live idle 0.7 or more, so the puppet's hands must move 0.5 units or more when the hoster's move 3 or more. Known gap, not in this check: a puppet at a work station (grindstone, tanning rack) holds the station pose but does not play the work loop, which the engine drives only with AI on (a one-frame AI pulse on the puppet moved Alvor's hands 43.8 units, then 1.1 again).
    - Findings (loop, 2026-10-14): a standing idle has no skeleton motion relative to the pelvis, on the hoster too (Faendal 0.000), so 0 hand motion while standing is not a freeze. `IdleForceDefaultState` stands a seated puppet up (Alvor at the grindstone, hips 46 to 71); a furniture enter sent one frame later is dropped, one second later it works; `Actor::StopInteractingQuick` leaves the graph in the seated pose with sit state 0 (stuck). The work loop at a station (Hilde tanning: hands 27.8 on the hoster, 4.6 on the puppet) needs the AI: no idle form, graph event, or graph variable differs, and a one-frame AI pulse starts it. Fix in G1.6: the hoster sends a `SkympStand` event when a hosted NPC leaves furniture or is standing at hosting start; a puppet that another player hosts stands up with `IdleForceDefaultState` on that event or when it loads seated (its animations then wait 1 s); puppet animations wait until the graph is ready. Work loops stay a known gap.
    - Plan edit (loop, 2026-10-14, how only): the hips tolerance is 12 units (sitting, kneeling, and standing differ by 20 or more; Faendal bent over the woodpile differs from upright by 6 to 9, which is torso posture, not a sitting state). A window is sampled again (up to 3 more) while the hoster's hands move less than 3 units or the hips of either engine move more than 12 units inside it (sitting down or standing up). At least one NPC must move its hands on a hoster over the two directions, or the frozen test did not run. The frozen test fails when, over both directions, no puppet moves its hands while its hoster's do (the playtest bug and the red build, where every puppet measures 0.0); a single still puppet while its hoster works (Alvor at the forge, Faendal carrying wood) is the work-loop gap and goes to the evidence.
    - Findings (loop, 2026-10-14, after the review): a puppet kneeling at the tanning rack (Hilde) that becomes hosted keeps its skeleton 29 units below its reference (feet under the ground) on the new hoster, also while walking; `IdleForceDefaultState`, `IdleStopInstant`, and `queueNiNodeUpdate` keep it, a disable/enable clears it, so a client that takes over a seated NPC that another player hosted disables it and enables it 0.3 s later. The moving-while-seated stand-up was removed: Faendal carries wood with a non-zero sit state. Known gaps: a hoster's AI can stall after the woodpile pickup when hosting starts just before it (Faendal stays bent with sit state 0 and plays no further event); after `SkympStand` a puppet loses the carry pose.
  - G1.7 (2 engines): for Gerdur, Alvor, and Sven, hosted by engine 2, engine 1 faces the NPC and presses the activate key (a real key press, not `activate()`). The dialogue opens, and a topic gets an answer other than the greeting. (Playtest: no player could talk to an NPC hosted by the other, except Gerdur once.)
    - Plan edit (loop, 2026-10-14, how only): a key press from the runner does not reach the game (the window has no input focus on the runner desktop: no activate event even for an NPC the engine hosts), so the check calls `PlayerCharacter::ActivatePickRef` on the game thread (`sp.activatePickRef()`), the call the activate key handler makes, with the NPC under the crosshair; a JS `activate()` takes another path and already opened the dialogue with a puppet.
    - Plan edit (loop, 2026-10-14, how only): engine 2 hosts the NPC and its AI is off on engine 1 at each activation (the talk starts on a puppet; engine 1 sometimes runs the AI of an NPC it does not host for a moment). The aim points at the NPC's head node, so a seated NPC behind a table is in the crosshair; the crosshair search repeats for up to 180 s. The player presses up to 5 times, 1 s after the aim, with the NPC aimed again before each new press, and the dialogue must open within 8 s of a press: the activation of the harness misses some presses on any NPC, also one the engine hosts with its AI on (Faendal hosted by engine 1: 5 of 6 missed right after the aim, 2 of 6 after 0.6 s, 3 of 8 after 1.25 s; the NPC's dialogue target becomes the player, but no menu opens; causes seen: the placed player still falling, the NPC walking 284 units away before the press, one at 59 units with no cause found), so a single press is not a measure. At game hour 12 with 3 presses, Faendal (walking with firewood) needed the third press in each of 3 runs and Sven (walking his patrol) the second. The check runs at game hour 20.25: during his work hours (8:00 to 20:00) Alvor can sit at the sharpening wheel under the forge roof, where no placement around him gets him into the crosshair, on his hoster too (beams and posts in the way; he stayed there for more than 180 s); at 20:00 he eats at home with Sigrid and Dorthe (AlvorSigridDortheEat20x1), Gerdur is home after her meal (GerdurEatHome19x1), and Sven plays at the inn (SvenPlayInn10x16). Each NPC has 240 s for the crosshair search and the presses. The press must fire the player's activate event on the NPC, and engine 2 must still host the NPC when the dialogue opens and after it closes.
    - Findings (loop, 2026-10-14): G1.7 passes at 27b7617e without a client or server change: puppets hosted by engine 2 (Gerdur seated at her table and standing, Sven, Faendal) took the dialogue from the player's activation and answered a topic, also with `updateAnimations` off (6 of 6 single presses with AI off on engine 1, runs of 04:26 and 04:29). The playtest failure does not reproduce; the earlier FAIL runs of this check came from experimental builds that toggled the AI of puppets, and from presses right after the aim. A takeover (the client that talks to an NPC hosts it, granted by the server within 1024 units) was built and dropped: no red run needed it, and the new hoster restarts quest scenes on the NPC (Sven took the Riverwood intro scene package on engine 1 and refused the dialogue). Collision does not decide the crosshair: a seated puppet with collision off is picked and takes the dialogue.
    - Findings (loop, 2026-10-14, escalation): no harness press is faithful on the runner. On NPCs the engine hosts itself, `ActivatePickRef` from a game-thread task missed 2 to 5 of 6 to 8 presses, and an Activate `ButtonEvent` sent through `BSInputDeviceManager` missed 4 of 8 (3 with no activate event). Keys injected into the buffered DirectInput keyboard read (`GetDeviceData` hook) or into `BSInputEventQueue` from the input listener produced no button event at all: the game does not read the keyboard of an unfocused window on the hidden desktop. So a puppet miss rate cannot be measured, and G1.7 stays FAIL. Pending for the user: a hand check with real keys on two PCs (talk to Gerdur, Alvor and Sven hosted by the other player). The attempts are in the stash "G1.7 harness press attempts" and out/backup.
  - G1.8 (2 engines): when an NPC hosted by engine 2 speaks (a topic answer to engine 2's player, and the Sven and Hilde scene at the Riverwood entrance), engine 1 plays the same line from the same NPC within 1 s, without subtitles.
    - Plan edit (loop, 2026-10-14, how only): a native hook on `Actor::SpeakSoundFunction` (AE id 37542, SE 36541 unverified) reports each voice file that an actor plays (calls that return true) as the SP event `speakSound`. "Plays the same line" is: engine 1 reports the same voice file for the same NPC from 0 to 1 s after engine 2, one report of engine 1 for each report of engine 2, with engine 2 still the hoster at the end; engine 1 reports with no match are logged. "Without subtitles" is: the game's subtitle list (`SubtitleManager`, harness native `getSubtitles`) on engine 1 holds no subtitle of these NPCs and none with the text of an engine 2 subtitle; engine 2's own subtitles are the control in both parts (the check fails when it sees none), and both engines have the same subtitle INI settings. Engine 2's player opens the talk with a script `activate()` as in G1.3 (G1.7 found no faithful key press), at game hour 12. The scene is RiverwoodIntroSceneHildeSoldierScene (quest DialogueRiverwoodIntroScene 954d9; it starts when the player is within 2400 units of Hilde and 1000 of Sven), Hilde is the reference 35534; the check takes engine 2's lines over up to 150 s (at least 4, from both NPCs) and compares once engine 2 says no new line for 3 s; the topic part needs at least 2 voice files (greeting and answer).
    - Findings (loop, 2026-10-14): a puppet plays no line of its hoster (red: 0 of 10). Fix: the hoster sends each line of an NPC it hosts as a `SkympSpeak:<file>` pseudo-animation on the reliable NPC animation queue (G1.6); the server relays it and does not keep it as the NPC's last animation; the other clients call the speak function on the puppet (native `speakSound`, no subtitle), 69 to 106 ms after the hoster. Engine 2 reports each topic line twice (16 to 33 ms apart), and engine 1 plays both. Engine 1 also runs its own copy of the scene: in each run its puppet Hilde said 954CC locally (without a subtitle) about 0.35 s into the scene part, a line engine 2 did not say then; not in the pass condition, a follow-up (block local speech on puppets that another player hosts).
  - G1.9 (2 engines): in a party, each client shows a compass marker for each other member, within 10° of the member's direction, and no marker for players outside the party. The marker is an overlay of the client's web UI, not a plugin.

## Phase 2A: server fixes and quest items

1. **Container and corpse fixes** in `MpObjectReference.cpp`, with Catch2 tests:
   - Call `EnsureBaseContainerAdded` inside `AddItem` (:820-826) and `AddItems` (:853). Today an add to an unopened ESP container sets `baseContainerAdded` and loses its base loot (:1950-1954).
   - Add a corpse branch to the CONT branch of `ProcessActivateNormal` (:1515): `(t == CONT || (AsActor() && AsActor()->IsDead())) && actorActivator`.
   - Check 2A.1 (2 engines, user decision 2026-10-13): engine 2 hosts a bandit and kills it. Engine 1 opens the corpse and takes an item. Engine 1 has the item, and the server and engine 2 no longer have it on the corpse. (Playtest: a player could not loot an NPC killed by the party and hosted by the other player.)
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
