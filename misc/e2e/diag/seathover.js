const GERDUR = 0x13489;
const AWAY = { cellOrWorldDesc: "1a26f:Skyrim.esm", pos: [26691, 1678, -1404], rot: [0, 0, 0] };

module.exports = {
  engines: 2,
  timeout: 15 * 60000,
  setup: async (ctx) => {
    await ctx.character(1);
    await ctx.character(2);
  },
  async run(ctx) {
    const actors = [await ctx.ready(1), await ctx.ready(2)];
    const npc = `const a = sp.Actor.from(sp.Game.getFormEx(${GERDUR}));`;
    const server = () => ctx.probe(`const l = mp.get(${GERDUR}, "locationalData"); return { hoster: mp.get(${GERDUR}, "hoster") || 0, cell: l.cellOrWorldDesc, pos: l.pos };`);
    const put = (n, loc) => ctx.probe(`mp.set(${actors[n - 1]}, "locationalData", ${JSON.stringify(loc)}); return 0;`);
    const loaded = (n) => ctx.waitFor(() => ctx.drv(`${npc} return !sp.Ui.isMenuOpen("Loading Menu") && !!a && a.is3DLoaded();`, n).catch(() => false), 120000, `Gerdur is loaded on engine ${n}`);
    const near = async (n, dy) => {
      const at = await server();
      await put(n, { cellOrWorldDesc: at.cell, pos: [at.pos[0] + (dy ? 0 : 300), at.pos[1] + dy, at.pos[2] + 50], rot: [0, 0, 180] });
      await loaded(n);
    };
    const state = (n) => ctx.drv(`${npc} const f = a.getFurnitureReference(); return [Math.round(a.getPositionX()), Math.round(a.getPositionY()), Math.round(a.getPositionZ()), a.getSitState(), f ? f.getFormID().toString(16) : 0, a.isAIEnabled() ? 1 : 0, a.getAnimationVariableBool("bAnimationDriven") ? 1 : 0, Math.round(a.getAnimationVariableFloat("Speed"))];`, n);
    const watch = async (label, n, ms) => {
      const out = [];
      for (const end = Date.now() + ms; Date.now() < end; await ctx.sleep(400)) out.push(await state(n));
      ctx.evidence.push(`${label}: [x, y, z, sit, furniture, AI, bAnimationDriven, Speed] ${JSON.stringify(out)}`);
      return out;
    };

    await put(1, AWAY);
    await near(2, 0);
    await ctx.waitFor(() => server().then((s) => s.hoster === actors[1]), 60000, "engine 2 runs Gerdur");
    const seats = await ctx.drv(`${npc} const out = []; const c = a.getParentCell(); const n = c ? c.getNumRefs(40) : 0;
      for (let i = 0; i < n; i++) { const r = c.getNthRef(i, 40); if (!r || r.isDisabled() || r.isFurnitureInUse(false)) continue; const b = r.getBaseObject(); const name = b ? b.getName() : ""; const d = a.getDistance(r); if (d < 2500 && /chaise|banc|tabouret|chair|bench|stool/i.test(name)) out.push([r.getFormID(), Math.round(d)]); }
      return out.sort((x, y) => x[1] - y[1]).slice(0, 4).map((x) => x[0]);`, 2);
    let seated = false;
    for (const id of seats) {
      await ctx.drv(`sp.ObjectReference.from(sp.Game.getFormEx(${id})).activate(sp.Actor.from(sp.Game.getFormEx(${GERDUR})), false); return 0;`, 2);
      if (await ctx.waitFor(() => ctx.drv(`${npc} return !!a && a.getSitState() === 3;`, 2), 40000, "Gerdur sits").then(() => true).catch(() => false)) { seated = true; break; }
    }
    ctx.assert.ok(seated, "not exercised: Gerdur did not sit");
    const seatZ = (await state(2))[2];
    await near(1, 400);
    await ctx.waitFor(() => ctx.drv(`${npc} return !!a && a.getSitState() === 3;`, 1), 30000, "Gerdur is seated on engine 1").catch(() => {});
    ctx.evidence.push(`seated on engine 2 at z ${seatZ}; engine 1 before the transfer ${JSON.stringify(await state(1))}`);
    await put(2, AWAY);
    await ctx.waitFor(() => server().then((s) => s.hoster === actors[0]), 10000, "engine 1 runs Gerdur");
    const after = await watch("engine 1 after the transfer", 1, 6000);
    const last = after[after.length - 1];
    const hover = last[3] === 0 && last[2] - seatZ > 15;
    ctx.evidence.push(`hover: ${hover} (z ${last[2]}, seated z ${seatZ})`);
    if (!hover) return;
    await ctx.drv(`${npc} sp.Debug.sendAnimationEvent(a, "IdleForceDefaultState"); return 0;`, 1);
    const a1 = await watch("after IdleForceDefaultState", 1, 2400);
    if (a1[a1.length - 1][2] - seatZ <= 15) return;
    await ctx.drv(`${npc} const c = a.getParentCell(); sp.TESModPlatform.moveRefrToPosition(a, c, null, a.getPositionX(), a.getPositionY(), a.getPositionZ(), a.getAngleX(), a.getAngleY(), a.getAngleZ()); return 0;`, 1);
    await watch("after moveRefrToPosition to itself", 1, 2400);
  },
};
