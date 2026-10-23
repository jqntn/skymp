const ALVOR = 0x13482;
const SIGRID = 0x13483;
const HOUSE = 0x133c8;
const SPAWN = [20837, -45138, -21];

module.exports = {
  gameHour: 8,
  timeout: 10 * 60000,
  setup: async (ctx) => {
    await ctx.character(1, { pos: SPAWN, angleZ: 270, worldOrCell: 0x3c });
  },
  async run(ctx) {
    const actor = await ctx.ready(1);
    const state = (id) => ctx.drv(`const a = sp.Actor.from(sp.Game.getFormEx(${id})); const p = sp.Game.getPlayer(); const c = a.getParentCell(); const w = a.getWorldSpace(); const pc = p.getParentCell();
      return { cell: c ? c.getFormID().toString(16) : 0, w: w ? w.getFormID().toString(16) : 0, pos: [a.getPositionX(), a.getPositionY(), a.getPositionZ()].map(Math.round), loaded: a.is3DLoaded(), disabled: a.isDisabled(), ai: a.isAIEnabled(), player: pc ? pc.getFormID().toString(16) : 0, ppos: [p.getPositionX(), p.getPositionY(), p.getPositionZ()].map(Math.round) };`).catch((e) => String(e));
    const near = await ctx.npcLocation(ALVOR);
    await ctx.probe(`mp.set(${actor}, "locationalData", ${JSON.stringify({ ...near, pos: [near.pos[0] + 200, near.pos[1], near.pos[2] + 50] })}); return 0;`);
    await ctx.waitFor(() => ctx.drv(`const p = sp.Game.getPlayer(); const c = p.getParentCell(); return !sp.Ui.isMenuOpen("Loading Menu") && p.is3DLoaded() && !!c && c.getFormID() === ${HOUSE};`).catch(() => false), 120000, "the player is loaded in Alvor's house");
    await ctx.sleep(3000);
    ctx.evidence.push(`in the house: Alvor ${JSON.stringify(await state(ALVOR))}, Sigrid ${JSON.stringify(await state(SIGRID))}`);
    const r1 = await ctx.drv(`const a = sp.Actor.from(sp.Game.getFormEx(${ALVOR})); const p = sp.Game.getPlayer(); try { const r = a.moveTo(p, 100, 0, 0, false); return String(r && r.then ? "promise" : r); } catch (e) { return "threw " + e; }`).catch((e) => String(e));
    await ctx.sleep(1500);
    ctx.evidence.push(`moveTo(player) on Alvor returned ${r1}; after 1.5 s ${JSON.stringify(await state(ALVOR))}`);
    const r2 = await ctx.drv(`const a = sp.Actor.from(sp.Game.getFormEx(${SIGRID})); const p = sp.Game.getPlayer(); try { sp.TESModPlatform.moveRefrToPosition(a, sp.Cell.from(sp.Game.getFormEx(${HOUSE})), null, p.getPositionX() + 100, p.getPositionY(), p.getPositionZ(), 0, 0, 0); return "ok"; } catch (e) { return "threw " + e; }`).catch((e) => String(e));
    await ctx.sleep(1500);
    ctx.evidence.push(`moveRefrToPosition on Sigrid returned ${r2}; after 1.5 s ${JSON.stringify(await state(SIGRID))}`);
    const r3 = await ctx.drv(`const a = sp.Actor.from(sp.Game.getFormEx(${ALVOR})); const p = sp.Game.getPlayer(); try { a.disableNoWait(false); a.moveTo(p, 100, 0, 0, false); a.enableNoWait(false); return "ok"; } catch (e) { return "threw " + e; }`).catch((e) => String(e));
    await ctx.sleep(2000);
    ctx.evidence.push(`disable, moveTo(player), enable on Alvor returned ${r3}; after 2 s ${JSON.stringify(await state(ALVOR))}`);
    const r4 = await ctx.drv(`const p = sp.Game.getPlayer(); try { p.moveTo(p, 0, 0, 0, false); return "ok"; } catch (e) { return "threw " + e; }`).catch((e) => String(e));
    ctx.evidence.push(`moveTo on the player itself returned ${r4}; Papyrus check: ${await ctx.drv(`return String(sp.Utility.getCurrentRealTime());`).catch((e) => String(e))}`);
  },
};
