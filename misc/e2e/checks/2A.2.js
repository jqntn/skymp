const BARREL = 0x20570;
const WHITERUN = { cellOrWorldDesc: "1a26f:Skyrim.esm", pos: [21272, -7816, -3608], rot: [0, 0, 0] };
const AWAY = { cellOrWorldDesc: "3c:Skyrim.esm", pos: [20837, -45138, -21], rot: [0, 0, 0] };
const WAIT_MS = 5000;

module.exports = {
  engines: 2,
  timeout: 15 * 60000,
  setup: async (ctx) => {
    await ctx.character(1);
    await ctx.character(2);
  },
  async run(ctx) {
    const actors = [await ctx.ready(1), await ctx.ready(2)];
    const hex = (v) => (v >>> 0).toString(16);
    const ref = (id) => `const r = sp.ObjectReference.from(sp.Game.getFormEx(${id}));`;
    const local = (id, n) => ctx.drv(`${ref(id)} return r ? { loaded: r.is3DLoaded(), disabled: r.isDisabled() } : null;`, n);
    const setDisabled = (id, v) => ctx.probe(`mp.set(${id}, "isDisabled", ${v}); return mp.get(${id}, "isDisabled");`);
    const until = (id, n, v, label) => ctx.waitFor(() => local(id, n).then((l) => !!l && l.disabled === v), WAIT_MS, label).then(() => true).catch(() => false);
    const goTo = async (n, loc) => {
      await ctx.probe(`mp.set(${actors[n - 1]}, "locationalData", ${JSON.stringify(loc)}); return 0;`);
      await ctx.waitFor(() => ctx.drv(`const p = sp.Game.getPlayer(); return !sp.Ui.isMenuOpen("Loading Menu") && p.is3DLoaded() && Math.abs(p.getPositionY() - ${loc.pos[1]}) < 500;`, n).catch(() => false), 120000, `engine ${n}'s player is at ${loc.pos}`);
    };
    const fails = [];

    await goTo(1, WHITERUN);
    await goTo(2, { ...WHITERUN, pos: [WHITERUN.pos[0] + 150, WHITERUN.pos[1], WHITERUN.pos[2]] });
    for (const n of [1, 2]) {
      await ctx.waitFor(() => local(BARREL, n).then((l) => !!l && l.loaded).catch(() => false), 60000, `the barrel is loaded on engine ${n}`);
    }
    await ctx.sleep(3000);
    const loadedOn = (id, n) => local(id, n).then((l) => !!l && l.loaded && !l.disabled).catch(() => false);
    const serverView = (id) => ctx.probe(`const n = mp.get(${id}, "neighbors") || []; const l = mp.get(${id}, "locationalData"); return { hoster: mp.get(${id}, "hoster") || 0, listeners: [${actors}].filter((a) => n.includes(a)), at: l ? [l.cellOrWorldDesc, ...l.pos.map(Math.round)] : null };`);
    const npc = await ctx.waitFor(() => ctx.drv(`const p = sp.Game.getPlayer(); const seen = []; for (let i = 0; i < 200; i++) { const a = sp.Game.findRandomActor(p.getPositionX(), p.getPositionY(), p.getPositionZ(), 3000); if (a && a.getFormID() < 0xff000000 && a.getFormID() !== 0x14 && !a.isDead() && !a.isDisabled() && a.is3DLoaded() && !seen.includes(a.getFormID())) seen.push(a.getFormID()); } return seen;`, 1)
      .then(async (ids) => {
        for (const id of ids) {
          const hoster = await ctx.probe(`return mp.get(${id}, "hoster") || 0;`);
          if (actors.includes(hoster) && (await loadedOn(id, 2)) && (await serverView(id)).listeners.length === 2) return id;
        }
        return 0;
      }), 60000, "an ESP NPC near the barrel that a player hosts and the server streams to both players");
    const hosterEngine = actors.indexOf(await ctx.probe(`return mp.get(${npc}, "hoster") || 0;`)) + 1;
    const puppetEngine = 3 - hosterEngine;

    ctx.evidence.push(`barrel ${hex(BARREL)} before: engine 1 ${JSON.stringify(await local(BARREL, 1))}, engine 2 ${JSON.stringify(await local(BARREL, 2))}; NPC ${hex(npc)} hosted by engine ${hosterEngine} (${hex(actors[hosterEngine - 1])}), engine ${puppetEngine} shows a puppet; before: ${JSON.stringify(await local(npc, hosterEngine))} / ${JSON.stringify(await local(npc, puppetEngine))}`);
    for (const [label, id] of [["barrel", BARREL], ["NPC", npc]]) {
      if (id === npc) ctx.evidence.push(`NPC ${hex(id)} on the server before the disable: ${JSON.stringify(await serverView(id))}`);
      const server = await setDisabled(id, true);
      const off = await Promise.all([1, 2].map((n) => until(id, n, true, `the ${label} is disabled on engine ${n}`)));
      ctx.evidence.push(`${label} ${hex(id)}: server isDisabled ${server}; within ${WAIT_MS / 1000} s of the server disable: engine 1 ${JSON.stringify(await local(id, 1))}, engine 2 ${JSON.stringify(await local(id, 2))}`);
      off.forEach((ok, i) => ok || fails.push(`the ${label} ${hex(id)} stays enabled on engine ${i + 1} after a server disable`));
      const serverOn = await setDisabled(id, false);
      const on = await Promise.all([1, 2].map((n) => until(id, n, false, `the ${label} is enabled on engine ${n}`)));
      ctx.evidence.push(`${label} ${hex(id)}: server isDisabled ${serverOn}; within ${WAIT_MS / 1000} s of the server enable: engine 1 ${JSON.stringify(await local(id, 1))}, engine 2 ${JSON.stringify(await local(id, 2))}`);
      on.forEach((ok, i) => ok || fails.push(`the ${label} ${hex(id)} stays disabled on engine ${i + 1} after a server enable`));
      if (id === npc) {
        ctx.evidence.push(`NPC ${hex(id)} on the server after the enable: ${JSON.stringify(await serverView(id))}`);
        const rehosted = await ctx.waitFor(() => serverView(id).then((v) => v.hoster !== 0), 30000, "the NPC has a hoster again").then(() => true).catch(() => false);
        ctx.evidence.push(`NPC ${hex(id)} hoster within 30 s of the enable (not asserted): ${rehosted ? hex((await serverView(id)).hoster) : "none"}`);
      }
    }

    await goTo(1, AWAY);
    await ctx.waitFor(() => local(BARREL, 1).then((l) => !l || !l.loaded).catch(() => true), 60000, "the barrel unloads on engine 1").catch(() => {});
    const awayListeners = await ctx.probe(`const n = mp.get(${BARREL}, "neighbors") || []; return [${actors}].filter((a) => n.includes(a));`).then((l) => l.map(hex));
    await setDisabled(BARREL, true);
    ctx.evidence.push(`barrel ${hex(BARREL)} disabled while engine 1's player is away; players the server streams the barrel to at the disable: ${JSON.stringify(awayListeners)}`);
    await goTo(1, WHITERUN);
    await ctx.waitFor(() => local(BARREL, 1).then((l) => !!l && l.loaded !== undefined).catch(() => false), 60000, "the barrel is back on engine 1").catch(() => {});
    await ctx.sleep(WAIT_MS);
    const late = await local(BARREL, 1);
    ctx.evidence.push(`barrel ${hex(BARREL)} disabled on the server while engine 1's player was away: engine 1 ${JSON.stringify(late)} after the return`);
    if (!late || !late.disabled) fails.push(`the barrel ${hex(BARREL)} disabled on the server while engine 1's player was away is enabled on engine 1`);
    await setDisabled(BARREL, false);

    ctx.assert.ok(!fails.length, fails.join("; "));
  },
};
