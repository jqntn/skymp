const ALVOR = 0x13482;
const RIVERWOOD = { cellOrWorldDesc: "3c:Skyrim.esm", pos: [20228, -46108, -142], rot: [0, 0, 60] };
const WHITERUN = { cellOrWorldDesc: "1a26f:Skyrim.esm", pos: [21272, -7816, -3608], rot: [0, 0, 0] };
const FAR = { cellOrWorldDesc: "3c:Skyrim.esm", pos: [12156, -71991, 6016], rot: [0, 0, 0] };

module.exports = {
  engines: 2,
  timeout: 20 * 60000,
  setup: async (ctx) => {
    await ctx.character(1);
    await ctx.character(2);
  },
  async run(ctx) {
    const actors = [await ctx.ready(1), await ctx.ready(2)];
    const goTo = async (n, loc) => {
      await ctx.probe(`mp.set(${actors[n - 1]}, "locationalData", ${JSON.stringify(loc)}); return 0;`);
      await ctx.waitFor(() => ctx.drv(`const p = sp.Game.getPlayer(); return !sp.Ui.isMenuOpen("Loading Menu") && p.is3DLoaded() && Math.hypot(p.getPositionX() - ${loc.pos[0]}, p.getPositionY() - ${loc.pos[1]}) < 500;`, n).catch(() => false), 120000, `engine ${n}'s player is at ${loc.pos}`);
    };
    const local = (n) => ctx.drv(`const a = sp.Actor.from(sp.Game.getFormEx(${ALVOR})); const p = sp.Game.getPlayer(); const c = a && (a.getWorldSpace() || a.getParentCell());
      return a ? { loaded: a.is3DLoaded(), disabled: a.isDisabled(), d: Math.round(a.getDistance(p)), cell: c ? c.getFormID() : 0, pos: [a.getPositionX(), a.getPositionY(), a.getPositionZ()].map(Math.round) } : null;`, n);
    const server = () => ctx.probe(`const l = mp.get(${ALVOR}, "locationalData"); return { hoster: mp.get(${ALVOR}, "hoster") || 0, pos: l.pos.map(Math.round), cell: l.cellOrWorldDesc };`);
    const shown = (l) => !!l && !l.disabled && l.loaded && l.d < 4096;
    const near = (s, l) => s.cell.startsWith("3c:") && l.cell === 0x3c && Math.hypot(s.pos[0] - l.pos[0], s.pos[1] - l.pos[1]) < 500;
    const fails = [];

    await goTo(2, WHITERUN);
    const start = await server();
    ctx.assert.ok(!start.cell.startsWith("3c:") && start.hoster === 0, `not exercised: the server does not have Alvor at his ESP spot indoors with no hoster (${JSON.stringify(start)})`);
    await goTo(1, RIVERWOOD);
    const seen = await ctx.waitFor(() => local(1).then((l) => shown(l) && l.cell === 0x3c && l), 60000, "engine 1 shows Alvor outdoors").catch(() => null);
    const seenAt = Date.now();
    ctx.evidence.push(`unseen: the server has Alvor in his house ${JSON.stringify(start)}, nobody there; engine 1 in Riverwood shows him ${JSON.stringify(seen)}`);
    ctx.assert.ok(seen, "not exercised: engine 1 does not show Alvor outdoors in Riverwood");
    let adopted = null;
    let adoptedAt = 0;
    for (const t0 = Date.now(); Date.now() - t0 < 10000 && !adoptedAt; await ctx.sleep(250)) {
      const [l, s] = await Promise.all([local(1), server()]);
      adopted = { l, s };
      if (shown(l) && s.hoster === actors[0] && near(s, l)) adoptedAt = Date.now() - seenAt;
    }
    ctx.evidence.push(`unseen: ${adoptedAt ? `${adoptedAt} ms` : "not within 10 s"} after engine 1 showed him, engine 1 ${JSON.stringify(adopted.l)}, server ${JSON.stringify(adopted.s)}`);
    if (!adoptedAt || adoptedAt > 5000) fails.push(`unseen: the server did not take the position where engine 1 shows Alvor and give him to engine 1 within 5 s (${adoptedAt || "> 10000"} ms)`);

    const atAlvor = await server();
    await goTo(2, { cellOrWorldDesc: atAlvor.cell, pos: [atAlvor.pos[0] + 150, atAlvor.pos[1], atAlvor.pos[2] + 50], rot: [0, 0, 0] });
    await goTo(1, FAR);
    await ctx.waitFor(() => server().then((s) => s.hoster === actors[1]), 15000, "engine 2 runs Alvor").catch(() => 0);
    const before = await server();
    const strayed = await ctx.waitFor(async () => {
      const l = await local(1);
      if (shown(l)) return l;
      await ctx.drv(`const a = sp.Actor.from(sp.Game.getFormEx(${ALVOR})); const p = sp.Game.getPlayer(); a.enable(false); sp.TESModPlatform.moveRefrToPosition(a, null, sp.WorldSpace.from(sp.Game.getFormEx(0x3c)), p.getPositionX() + 300, p.getPositionY(), p.getPositionZ(), 0, 0, 0); return 0;`, 1);
      return false;
    }, 15000, "engine 1 shows a stray Alvor next to its player", Error, 1500).catch(() => null);
    const strayAt = Date.now();
    ctx.evidence.push(`seen: engine 2 runs Alvor in Riverwood (${JSON.stringify(before)}); engine 1, near the Helgen exit, shows a stray copy ${JSON.stringify(strayed)}`);
    ctx.assert.ok(before.hoster === actors[1] && strayed, "not exercised: engine 2 does not run Alvor or engine 1 shows no stray copy");
    const hidden = await ctx.waitFor(() => local(1).then((l) => !shown(l)), 5000, "engine 1 hides the stray").then(() => Date.now() - strayAt).catch(() => 0);
    const after = await server();
    ctx.evidence.push(`seen: engine 1 ${hidden ? `hid the stray after ${hidden} ms` : `still shows it after 5 s: ${JSON.stringify(await local(1))}`}; server ${JSON.stringify(after)}`);
    if (!hidden) fails.push("seen: engine 1 still shows a stray Alvor 5 s after it appeared, while engine 2 runs the server copy");
    if (after.cell !== before.cell || Math.hypot(after.pos[0] - before.pos[0], after.pos[1] - before.pos[1]) > 500 || after.hoster !== actors[1]) fails.push(`seen: the stray report changed the server copy (${JSON.stringify(before)} -> ${JSON.stringify(after)})`);
    ctx.assert.ok(!fails.length, fails.join("; "));
  },
};
