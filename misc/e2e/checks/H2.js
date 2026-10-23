const WATCH = [0x13482, 0x13483, 0x13484, 0x13489, 0x1348a, 0x1348b, 0x1348c, 0x35534, 0x2bfa2, 0x2bf9e];
const RIVERWOOD = { cellOrWorldDesc: "3c:Skyrim.esm", pos: [20228, -46108, -142], rot: [0, 0, 60] };
const WHITERUN = { cellOrWorldDesc: "1a26f:Skyrim.esm", pos: [21272, -7816, -3608], rot: [0, 0, 0] };
const STAND_MS = 60000;
const BACK_MS = 30000;

module.exports = {
  engines: 2,
  timeout: 20 * 60000,
  setup: async (ctx) => {
    await ctx.character(1);
    await ctx.character(2);
  },
  async run(ctx) {
    const actors = [await ctx.ready(1), await ctx.ready(2)];
    const hex = (v) => (v >>> 0).toString(16);
    const goTo = async (n, loc) => {
      await ctx.probe(`mp.set(${actors[n - 1]}, "locationalData", ${JSON.stringify(loc)}); return 0;`);
      await ctx.waitFor(() => ctx.drv(`const p = sp.Game.getPlayer(); return !sp.Ui.isMenuOpen("Loading Menu") && p.is3DLoaded() && Math.abs(p.getPositionY() - ${loc.pos[1]}) < 500;`, n).catch(() => false), 120000, `engine ${n}'s player is at ${loc.pos}`);
    };
    const state = () => ctx.probe(`return ${JSON.stringify(WATCH)}.map((id) => { try { const l = mp.get(id, "locationalData"); return { id, hoster: mp.get(id, "hoster") || 0, cell: [l.cellOrWorldDesc, Math.trunc(l.pos[0] / 4096), Math.trunc(l.pos[1] / 4096)].join(",") }; } catch (e) { return { id, hoster: -1, cell: "" }; } });`);
    const fails = [];
    const stand = async (label, ms) => {
      const samples = [];
      for (const t0 = Date.now(); Date.now() - t0 < ms; await ctx.sleep(1000)) samples.push(await state());
      const changes = WATCH.map((id, i) => [hex(id), samples.reduce((c, s, k) => c + (k && s[i].hoster !== samples[k - 1][i].hoster ? 1 : 0), 0)]).filter(([, c]) => c);
      const split = samples.map((s) => {
        const byCell = {};
        for (const x of s.filter((x) => x.hoster > 0)) (byCell[x.cell] ||= new Set()).add(x.hoster);
        return Object.entries(byCell).filter(([, h]) => h.size > 1).map(([c, h]) => `${c}: ${[...h].map(hex).join("/")}`);
      }).find((x) => x.length);
      ctx.evidence.push(`${label}: ${samples.length} samples, last ${JSON.stringify(samples[samples.length - 1].map((x) => [hex(x.id), hex(x.hoster), x.cell]))}, changes ${JSON.stringify(changes)}`);
      if (changes.length) fails.push(`${label}: hosters changed ${JSON.stringify(changes)}`);
      if (split) fails.push(`${label}: a cell has two hosters: ${split.join("; ")}`);
      return samples[samples.length - 1];
    };

    await goTo(2, WHITERUN);
    await goTo(1, RIVERWOOD);
    const first = await ctx.waitFor(async () => { const s = await state(); return s.filter((x) => x.hoster === actors[0]).length >= 3 && s; }, 60000, "engine 1 runs the Riverwood NPCs");
    await goTo(2, { ...RIVERWOOD, pos: [RIVERWOOD.pos[0] + 150, RIVERWOOD.pos[1], RIVERWOOD.pos[2]] });
    const before = await stand("both in Riverwood", STAND_MS);
    const ran = before.filter((x) => x.hoster === actors[0]).map((x) => x.id);
    ctx.evidence.push(`engine 1 (${hex(actors[0])}) runs ${ran.map(hex).join(", ")}; engine 2 is ${hex(actors[1])}; first sample ${JSON.stringify(first.map((x) => [hex(x.id), hex(x.hoster)]))}`);
    ctx.assert.ok(ran.length >= 3, `not exercised: engine 1 runs ${ran.length} watched NPCs`);

    const left = Date.now();
    await ctx.probe(`mp.set(${actors[0]}, "locationalData", ${JSON.stringify(WHITERUN)}); return 0;`);
    let movedAt = 0;
    for (const t0 = Date.now(); Date.now() - t0 < 3000; await ctx.sleep(100)) {
      const s = await state();
      if (ran.every((id) => s.find((x) => x.id === id).hoster === actors[1])) {
        movedAt = Date.now() - left;
        break;
      }
    }
    const after = await state();
    ctx.evidence.push(`engine 1 left for Whiterun: ${movedAt ? `every NPC it ran is run by engine 2 after ${movedAt} ms` : `not all moved within 3 s: ${JSON.stringify(after.map((x) => [hex(x.id), hex(x.hoster)]))}`}`);
    if (!movedAt || movedAt > 1000) fails.push(`the NPCs engine 1 ran were not all run by engine 2 within 1 s (${movedAt || "> 3000"} ms)`);

    await goTo(1, RIVERWOOD);
    const back = await stand("engine 1 back in Riverwood", BACK_MS);
    const regained = back.filter((x) => ran.includes(x.id) && x.hoster === actors[0]).map((x) => hex(x.id));
    if (regained.length) fails.push(`engine 1 took back ${regained.join(", ")} after its return`);
    ctx.assert.ok(!fails.length, fails.join("; "));
  },
};
