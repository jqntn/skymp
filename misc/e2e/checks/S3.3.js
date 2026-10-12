const LEVER = 0xaa8c3;
const DARTS = [0x39fdd, 0x3720f, 0x2ad49, 0x2ad43];

module.exports = {
  engines: 1,
  timeout: 5 * 60000,
  setup: (ctx) => ctx.character(1, { pos: [4992, -1150, -760], angleZ: 180, worldOrCell: 0x371de }),
  async run(ctx) {
    await ctx.ready(1);
    const ref = (id) => `sp.ObjectReference.from(sp.Game.getFormEx(${id}))`;
    await ctx.waitFor(() => ctx.drv(`return ${JSON.stringify([LEVER, ...DARTS])}.every((id) => { const r = sp.ObjectReference.from(sp.Game.getFormEx(id)); return !!r && r.is3DLoaded(); });`).catch(() => false), 60000, "the lever and the dart traps are loaded");
    await ctx.sleep(3000);
    const parents = await ctx.probe(`return ${JSON.stringify(DARTS)}.filter((id) => mp.lookupEspmRecordById(id).record.fields.some((f) => f.type === "XAPD" || f.type === "XAPR"));`);
    const blocked = await ctx.drv(`return ${JSON.stringify(DARTS)}.map((id) => sp.ObjectReference.from(sp.Game.getFormEx(id)).isActivationBlocked());`);
    await ctx.drv(`globalThis.e2eS33 = [];
      const id = (r) => (r ? r.getFormID() : 0);
      globalThis.e2eS33Handle = sp.on("activate", (e) => globalThis.e2eS33.push([id(e.caster), id(e.target)]));
      return 0;`);
    await ctx.sleep(1500);
    const quiet = await ctx.drv(`return globalThis.e2eS33.length;`);
    await ctx.drv(`${ref(LEVER)}.activate(sp.Game.getPlayer(), false); return 0;`);
    await ctx.sleep(2000);
    const seen = await ctx.drv(`const s = globalThis.e2eS33; sp.unsubscribe(globalThis.e2eS33Handle); return s;`);
    const scripted = DARTS.filter((d) => seen.some((r) => r[0] === LEVER && r[1] === d));
    const hex = (v) => v.toString(16);
    ctx.evidence.push(`dart traps ${DARTS.map(hex).join(", ")} activation blocked ${JSON.stringify(blocked)}; ${quiet} activate events before; the player pulls the unsolved lever ${hex(LEVER)}, whose script calls refActOnFailure0N.activate(self): ${JSON.stringify(seen.map((r) => r.map(hex)))} (rows: caster, target); dart traps with activation parents in Skyrim.esm: ${JSON.stringify(parents.map(hex))}, so the lever's script made these calls; activationService gets the same event and today drops casters that are not the player or a clone`);
    ctx.assert.ok(blocked.every(Boolean), "a dart trap is not activation-blocked");
    ctx.assert.deepEqual(parents, [], "a dart trap has activation parents, so the event may not come from the script");
    ctx.assert.equal(quiet, 0, "activate fired before any activation");
    ctx.assert.deepEqual(scripted, DARTS, "the activate event missed a script activation of a blocked dart trap");
  },
};
