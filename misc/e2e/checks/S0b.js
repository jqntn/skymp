const MINUTES = 10;

module.exports = {
  engines: 2,
  timeout: (MINUTES + 6) * 60000,
  setup: async (ctx) => {
    await ctx.character(1);
    await ctx.character(2);
  },
  async run(ctx) {
    const ready = (n) => ctx.ready(n).catch((e) => {
      ctx.assert.ok(ctx.running(n), `engine ${n} exited before it reached the world`);
      throw e;
    });
    const a1 = await ready(1);
    const a2 = await ready(2);
    ctx.assert.notEqual(a1, a2);
    ctx.evidence.push(`engine 1 pid ${ctx.gamePids[1]} actor ${a1.toString(16)}, engine 2 pid ${ctx.gamePids[2]} actor ${a2.toString(16)}`);
    ctx.shot("S0b-engine1", 1);
    ctx.shot("S0b-engine2", 2);

    const start = Date.now();
    let samples = 0;
    while (Date.now() - start < MINUTES * 60000) {
      await ctx.sleep(30000);
      const mins = ((Date.now() - start) / 60000).toFixed(1);
      for (const n of [1, 2]) ctx.assert.ok(ctx.running(n), `engine ${n} exited after ${mins} min`);
      const online = await ctx.probe(`return mp.get(0, "onlinePlayers");`);
      ctx.assert.ok(online.includes(a1) && online.includes(a2), `server online players after ${mins} min: ${online.map((a) => a.toString(16))}`);
      samples++;
    }
    ctx.evidence.push(`${samples} samples over ${MINUTES} min: both processes alive, server online players include ${a1.toString(16)} and ${a2.toString(16)}`);
    ctx.shot("S0b-engine1-end", 1);
    ctx.shot("S0b-engine2-end", 2);
    ctx.assert.equal(ctx.shots.length, 4, "missing screenshots");
  },
};
