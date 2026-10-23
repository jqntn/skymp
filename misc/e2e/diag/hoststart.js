const ALVOR = 0x13482;
const SPAWN = [20837, -45138, -21];

module.exports = {
  gameHour: 8,
  timeout: 10 * 60000,
  setup: async (ctx) => {
    await ctx.character(1, { pos: SPAWN, angleZ: 270, worldOrCell: 0x3c });
  },
  async run(ctx) {
    const actor = await ctx.ready(1);
    const local = () => ctx.drv(`const a = sp.Actor.from(sp.Game.getFormEx(${ALVOR})); if (!a) return null; const w = a.getWorldSpace(); const c = a.getParentCell(); const h = sp.storage["hosted"];
      return { w: w ? w.getFormID().toString(16) : 0, c: c ? c.getFormID().toString(16) : 0, pos: [a.getPositionX(), a.getPositionY(), a.getPositionZ()].map(Math.round), loaded: a.is3DLoaded(), disabled: a.isDisabled(), ai: a.isAIEnabled(), hosted: Array.isArray(h) && h.includes(${ALVOR + 0x100000000}) };`).catch((e) => String(e));
    const server = () => ctx.probe(`const l = mp.get(${ALVOR}, "locationalData"); return { hoster: mp.get(${ALVOR}, "hoster") || 0, cell: l.cellOrWorldDesc, pos: l.pos.map(Math.round) };`);
    ctx.evidence.push(`at the forge: local ${JSON.stringify(await local())}, server ${JSON.stringify(await server())}`);
    const near = await ctx.npcLocation(ALVOR);
    await ctx.probe(`mp.set(${actor}, "locationalData", ${JSON.stringify({ ...near, pos: [near.pos[0] + 200, near.pos[1], near.pos[2] + 50] })}); return 0;`);
    const t0 = Date.now();
    for (let i = 0; i < 60; i++) {
      ctx.evidence.push(`${Date.now() - t0} ms: local ${JSON.stringify(await local())}, server ${JSON.stringify(await server())}`);
      await ctx.sleep(250);
    }
  },
};
