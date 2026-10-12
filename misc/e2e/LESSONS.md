# Lessons of the e2e loop

Facts about the engine, the server, and the harness. Add one after each ENV, each flaky result, and each fix that needed more than one try.

## Harness

- In low-cost mode, `skse64_loader.exe` to in-world takes about 10 s. A full S0 run is about 20 s.
- The client logs in automatically with the `profileId` of `skymp5-client-settings.txt`. No key press is needed.
- A new profile id spawns the player with RaceMenu open, and SkyrimPlatform cannot close a menu. `ctx.character(engine)` in `setup` creates the server actor first, so the spawn system loads it and does not open RaceMenu.
- The driver gets the `[Script]` lines of skymp5-client through the `consoleMessage` event.
- The server log goes to stdout (spdlog). `server.log` in the run folder has it.
- SSEDisplayTweaks `FramerateLimit` does not apply in menus. `UIFramerateLimit` does. `My Games/.../SKSE/SSEDisplayTweaks.log` confirms both at 30, but the in-game counter still shows 40 to 50.
- Level 1 costs about 2 min: incremental build 42 s, `ctest -C Release` 45 s, `yarn test` 1 s.
- `ctx.character` only calls `mp.createActor`. It does not set the `questStages` of the start point or the `spawnPoint` property as `spawn.ts` does. A check of the first login, the quest log, or a respawn must set them itself or use a real first login.
- Two Skyrim instances run side by side when the second one starts from another folder (`build/e2e-game2`, a hard-link copy). The engine rejects a second instance from the same folder within about 1 s. No hook is needed.
- `Debug.quitGame` and `Win32.exitProcess` end the process without `DLL_PROCESS_DETACH`, so SkyrimPlatform `Detach()` does not run. The early exit of a rejected instance does run it.
- In S0b, the screenshot right after `ready()` can be black on the second engine. 10 min later it shows the world.
- The client always shows "LOAD ORDER WARNING ... could not receive server mod list" for 5 s: `getServerMods` asks the master API, which answers 400 in offline mode. The playtest server has the same warning.
- A second engine costs about 10 s more to boot. S0b runs 10 min per run, so S0b alone takes 32 min of each full run.
- `mp.set(actor, "locationalData", { cellOrWorldDesc, pos, rot })` teleports a player across cells. A client `setPosition` into another cell is rejected and teleported back.
- Editor locations: Alvor 0x13482 and Gerdur 0x13489 are in their house interiors, Hadvar 0x2bfa2 is at Helgen (20044, -79479). The ESM scan in the probe (`mp.lookupEspmRecordById` over 0..0x110000) takes 6 s.
- The unit test `GetPartOne()` clears `bannedEspmCharacterRaceIds`. A test of the race filter must restore `WorldState().bannedEspmCharacterRaceIds`.
- MQ101AlduinREF does not resolve to AlduinRace through its template, so it is not a test of the ban. The mannequin 0x1028fd and the undead dragon 0x83588 are.
- `pathToReference` in a small interior stalls when players stand in the way. `translateTo` 200 units on the hoster gives a sure movement for a sync check.
- A server crash shows as "fetch failed" in a check. `server.log` ends with `[e2e] server exited with code N`; 3221225477 is an access violation.
- S1.1 had two ENV "engine N driver did not answer in 15 s" in a full run right after S0c, and none in 4 runs alone. A driver timeout now names the check line, and each retry keeps its own run folder (`n-retryK`).
- Game time is real UTC time plus `hoursOffset` in the client settings. The runner sets it per check (`gameHour`, default 12). At 12:00 Alvor's family wants to go out and refuses dialogue in the house; at 02:00 in a house, the owner can attack a trespassing player. The Sleeping Giant Inn (Orgnar 0x13486, Delphine 0x13485) is public at all hours.
- `keepOffsetFromActor` and `setDontMove` on an NPC block dialogue: the NPC targets the player but the Dialogue Menu never opens. Releasing the hold after the activation is too late. Standing puppets now have no offset hold; `translateTo` keeps their position.
- An NPC's AI can target the player with a greeting (`getDialogueTarget() == player`) without a dialogue. Only `isInDialogueWithPlayer()` means a real dialogue.
- Calls that are harmless on `placeAtMe` clones break real actors: `clearKeepOffsetFromActor` every frame on a hosted actor and `setOpen(false)` every 133 ms stopped dialogue on a seated NPC.
- `node misc/e2e/run.js --no-l1 --check <file>` runs an ad-hoc diagnostic check script under the id `adhoc`.
- The runner starts each game on a hidden Windows desktop (`skymp-e2e`, `desktop.ps1`), muted (`fAudioMasterVolume=0`). Rendering and `PrintWindow` work there. `--visible` uses the normal desktop.
- The cursor was locked to the hidden game window by SSEDisplayTweaks `[Window] LockCursor=true` and by DirectInput exclusive mouse. The runner sets `LockCursor=false` and Skyrim.ini `[Controls] bBackgroundMouse=1` for a run. The cursor clip then stays the full screen from launch to in-world.
- A runner that dies mid-run (here the PC slept for 6 h) leaves the ini files changed. The next start of `run.js` restores them, and kills the processes in `pids.json`. A stale runner can still hold port 7793.
- The seated Orgnar sometimes ignores a scripted `activate` (1 in 6 alone, 3 in 6 on the hoster after the other player talked first). A second activation after 10 s always worked.
- Once in a full run, engine 2 exited about 11 s after the launch at the start of S0b, with no client or crash log; the retry passed. Watch for a repeat.
- `server exited with code 1` at the end of a run is the runner's `taskkill /F`, not a crash.
- `enableAI(false)` on a puppet stops greetings, NPC chatter and combat, and player dialogue still opens. `resetAI()` first clears a dialogue target set before the actor became a puppet. With AI off, `keepOffsetFromActor` no longer animates: the client drives the puppet's graph with `moveStart`/`moveStop` and the `Speed` and `Direction` animation variables from the hoster's movement.
- The old offset hold left puppets walking in place: the puppet's `Speed` was 62 while the hoster's NPC stood.
- An engine can exit before its driver connects, with no log (seen right after a client install). `ready()` relaunches it up to 2 times.
- Teleporting both players straight from the Helgen exit to Hadvar at Helgen left Hadvar not loaded on engine 1 for 120 s; going through Alvor's house first works.
- A FormView is destroyed and created again when the player changes cell during a teleport. Any state it restores on destroy (here AI on) is live for a moment: Orgnar greeted the player in that moment and kept the target frozen once AI was off again. `resetAI()` and disable/enable do not clear that target.
- Each build gives every file of the client dist a new time in the game folder, so the old mtime sync copied about 400 MB (CEF included) into `build/e2e-game2` before its first launch. In full runs engine 2 then exited early 3 launches in a row. The runner now re-links each changed file (a fresh hard link per run), so engine 2 always has the current files and no new data.
- When engine 2 exits early, its skyrim-platform.log (shared file, rewritten at its start) ends after "NirnLab loader ... API version is ok": it dies around WinMain, where the engine rejects a second instance. The SKSE logs in My Games are shared by both engines, so read them with care.
- One hidden desktop per engine (`skymp-e2e-<n>`) fixed the engine 2 early exit: the full run at 13:56 had no relaunch, where 3 of the runs before it with one shared desktop did. The second-instance check looks for the first window on the same desktop.
- A hoster sends `SpeedSampled` as the NPC speed, and it decays for about 1 s after the NPC stops. The client's lag prediction (`speed * 0.2` ahead) then drove the puppet up to 69 units past the stop point (S1.1, Hadvar), and it snapped back about 1 s later. Real ESP puppets now skip that prediction.
- The game is French: base names are localized or empty (the smithing workbench is "Établi"), so never find refs by name. `mp.lookupEspmRecordById(id).record` in a probe gives the type and editorId (0x2c308 is RiverwoodBlacksmithWorkMarker, 0x133c8 is RiverwoodAlvorsHouse).
- `setPosition` on a puppet is not visible in the same driver call, and a translateTo in flight can undo it before the next sample. Call `stopTranslation()` first and read the position over the next frames (`sp.once("update")` in a promise; the driver awaits promises).
- A puppet with AI off opens the dialogue and shows its greeting, but the greeting never ends and no topic gets an answer (S1.5). The client turns AI on while the puppet is in dialogue with the local player. S1.2 only checked that the menu opens, so it missed this.
- Dialogue topics can be picked without key input: `sp.Ui.setInt("Dialogue Menu", "_root.DialogueMenu_mc.TopicList.selectedIndex", 0)` then `sp.Ui.invokeBool(..., "_root.DialogueMenu_mc.onSelectionClick", true)` once the greeting subtitle is empty; `onCancelPress` closes the menu. Text fields read fine with `getString`; numeric fields come back empty.
- Server Papyrus: `"archives": [<abs path to Skyrim - Misc.bsa>]` in the server settings gives the VM all vanilla scripts. A check sets it with `settings` in its module. `"logLevel": "trace"` logs every Papyrus event, method call and property set (numPillarsSolved, numRingsSolved), which makes script progress testable from server.log.
- The server sends OnInit/OnCellLoad/OnLoad to a ref only when a player-profile actor subscribes near it. `mp.createActor` without a profile id never triggers it; a bot that logs in (`loginWithSkympIo`) and is moved with `mp.set(actor, "locationalData", ...)` does. Script states (`GetState` through `mp.callPapyrusFunction`) are readable from the probe.
- With a bot as the only listener, `PlayAnimationAndWait` waits its 15 s timeout for a client reply, so a pillar or ring stays busy for 15 s after each turn.
- SkyrimPlatform hides its own synchronous native calls from hooks: `CallNativeApi` sets `Override`, and `OnSendAnimationEventEnter` returns early while it is set. So `ref.playAnimation(...)` from JS never reaches `hooks.sendAnimationEvent`; a latent call (`playAnimationAndWait`) takes the promise path without `Override` and does, like a Papyrus script's call. Hook handlers can use closures and `globalThis`.
- Registering a `sp.hooks.sendPapyrusEvent` handler from JS (even filtered to one ref id) froze the game: the driver never answered again. Avoid that hook; `hooks.sendAnimationEvent` works.
- A JS synchronous native call runs under `Override`, so the client's Papyrus event block is skipped for the events it raises: `lever.activate(player)` from JS ran the lever's own script on the client. Do not mistake that for the normal client behaviour.
- Parent-activation-only refs (XAPD flag 1, e.g. the BFB gate) raise no TESActivateEvent for a caster that is not one of their activation parents.
- SP `Quest.getAlias(id)` returns null for every quest on the client (MS13, MQ103 at stage 5). Use `ref.getNumReferenceAliases()` / `getNthReferenceAlias(n)` (SKSE) from the item ref instead; `dropObject` gives the ref of a persistent inventory item.
- A server `mp.set(container, "inventory", ...)` on an ESP container in the player's neighbourhood did not change the client's container within 4 s. The client applies a container inventory on CreateActor props and on UpdateProperty for ESP refs, so the server apparently does not send it on that set.
