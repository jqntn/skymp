const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

module.exports = {
  engines: 1,
  timeout: 5 * 60000,
  setup: (ctx) => ctx.character(1),
  async run(ctx) {
    const actor = await ctx.ready(1);
    const dir = ctx.engineDir(1);
    const before = new Set(ctx.skyrimPids());
    spawn(path.join(dir, "skse64_loader.exe"), [], { cwd: dir, detached: true, stdio: "ignore" }).unref();
    let second;
    await ctx.waitFor(() => (second = ctx.skyrimPids().find((p) => !before.has(p))), 30000, "a second SkyrimSE.exe starts from the same folder", Error, 100);
    ctx.own(second);
    const t = Date.now();
    await ctx.waitFor(() => !ctx.skyrimPids().includes(second), 60000, "the engine rejects the second instance");
    ctx.evidence.push(`second instance pid ${second} from the same folder exited after ${((Date.now() - t) / 1000).toFixed(1)} s`);
    await ctx.sleep(10000);
    ctx.assert.ok(ctx.running(1), `engine 1 (pid ${ctx.gamePids[1]}) died when the second instance exited`);
    const pos = await ctx.drv(`const p = sp.Game.getPlayer(); return [p.getPositionX(), p.getPositionY()];`, 1);
    ctx.evidence.push(`engine 1 (pid ${ctx.gamePids[1]}) still runs and answers 10 s later, player at ${pos.map(Math.round)}`);
    const online = await ctx.probe(`return mp.get(0, "onlinePlayers");`);
    const connects = fs.readFileSync(path.join(ctx.dir, "server.log"), "utf8").split("\n").filter((l) => / connect \d+$/.test(l.trim())).length;
    ctx.evidence.push(`server online players ${online.map((a) => a.toString(16))}, connect events in server.log: ${connects}`);
    ctx.assert.deepEqual(online, [actor], "engine 1 is not the only online player");
    ctx.assert.equal(connects, 1, "the rejected instance connected to the server");
    ctx.shot("S0c-engine1", 1);
    ctx.assert.equal(ctx.shots.length, 1, "no screenshot");
  },
};
