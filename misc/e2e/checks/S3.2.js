const SWEETROLL = 0x64b3d;

module.exports = {
  engines: 1,
  timeout: 5 * 60000,
  setup: (ctx) => ctx.character(1),
  async run(ctx) {
    await ctx.ready(1);
    await ctx.drv(`globalThis.e2eS32 = [];
      const id = (r) => (r ? r.getFormID() : 0);
      globalThis.e2eS32Handle = sp.on("containerChanged", (e) => { if (id(e.baseObj) === ${SWEETROLL}) globalThis.e2eS32.push([id(e.oldContainer), id(e.newContainer), id(e.baseObj), e.numItems]); });
      return 0;`);
    await ctx.sleep(1500);
    const quiet = await ctx.drv(`return globalThis.e2eS32.length;`);
    const before = await ctx.drv(`return sp.Game.getPlayer().getItemCount(sp.Game.getFormEx(${SWEETROLL}));`);
    await ctx.drv(`sp.Game.getPlayer().addItem(sp.Game.getFormEx(${SWEETROLL}), 2, true); return 0;`);
    await ctx.sleep(1500);
    const added = await ctx.drv(`const s = globalThis.e2eS32; sp.unsubscribe(globalThis.e2eS32Handle); return s;`);
    const after = await ctx.drv(`return sp.Game.getPlayer().getItemCount(sp.Game.getFormEx(${SWEETROLL}));`);
    const hex = (rows) => JSON.stringify(rows.map((r) => r.map((v, i) => (i < 3 ? v.toString(16) : v))));
    ctx.evidence.push(`sweetrolls before ${before}; ${quiet} events before any change; events in the 1.5 s after addItem(2) from a script call: ${hex(added)} (rows: old container, new container, base, count); sweetrolls after ${after}`);
    ctx.assert.equal(quiet, 0, "containerChanged fired before any change");
    ctx.assert.ok(added.some((r) => r[0] === 0 && r[1] === 0x14 && r[3] === 2), "containerChanged did not fire for the script AddItem to the player");
  },
};
