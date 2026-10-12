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
