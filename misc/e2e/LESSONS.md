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
