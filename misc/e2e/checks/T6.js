const BANDIT = ["bandit", 0x1ebf6];
const SITTER = ["Gerdur", 0x13489];
const AWAY = { cellOrWorldDesc: "1a26f:Skyrim.esm", pos: [26691, 1678, -1404], rot: [0, 0, 0] };
const LAG = 500;
const FIGHT_MS = 25000;

module.exports = {
  engines: 2,
  timeout: 25 * 60000,
  setup: async (ctx) => {
    await ctx.character(1);
    await ctx.character(2);
  },
  async run(ctx) {
    const actors = [await ctx.ready(1), await ctx.ready(2)];
    const hex = (v) => (v >>> 0).toString(16);
    const heal = (n) => ctx.probe(`mp.set(${actors[n - 1]}, "percentages", { health: 1, magicka: 1, stamina: 1 }); return 0;`).catch(() => 0);
    const server = (id) => ctx.probe(`const l = mp.get(${id}, "locationalData"); return { dead: !!mp.get(${id}, "isDead"), hoster: mp.get(${id}, "hoster") || 0, cell: l.cellOrWorldDesc, pos: l.pos };`);
    const npc = (id) => `const a = sp.Actor.from(sp.Game.getFormEx(${id}));`;
    const loaded = (id, n) => ctx.waitFor(() => ctx.drv(`${npc(id)} return !sp.Ui.isMenuOpen("Loading Menu") && !!a && a.is3DLoaded();`, n).catch(() => false), 120000, `${hex(id)} is loaded on engine ${n}`);
    const put = (n, loc) => ctx.probe(`mp.set(${actors[n - 1]}, "locationalData", ${JSON.stringify(loc)}); return 0;`);
    const fails = [];

    const fight = async (name, id, note) => {
      const at = await server(id);
      await put(1, { cellOrWorldDesc: at.cell, pos: [at.pos[0], at.pos[1] + 500, at.pos[2] + 50], rot: [0, 0, 180] });
      await loaded(id, 1);
      await ctx.sleep(3000);
      const seatWaitFrom = Date.now();
      if (note) await ctx.waitFor(() => ctx.drv(`${npc(id)} return !!a && a.getSitState() === 3;`, 1), 20000, `${name} is seated on engine 1`).catch(() => {});
      const seatWait = Date.now() - seatWaitFrom + 3000;
      for (const n of [1, 2]) {
        await ctx.drv(`const w = globalThis.e2eT6 = { id: ${id}, events: [], refused: [], log: [], t0: Date.now(), last: "" };
          if (globalThis.e2eT6Hook !== undefined) sp.hooks.sendAnimationEvent.remove(globalThis.e2eT6Hook);
          globalThis.e2eT6Hook = sp.hooks.sendAnimationEvent.add({ enter(c) { const g = globalThis.e2eT6; if (g.log.length < 150) g.log.push((Date.now() - g.t0) + " " + c.animEventName); }, leave(c) { const g = globalThis.e2eT6; if (!c.animationSucceeded && g.log.length < 150) g.log.push((Date.now() - g.t0) + " refused " + c.animEventName); if (/^(attack|bash)/i.test(c.animEventName)) (c.animationSucceeded ? globalThis.e2eT6.events : globalThis.e2eT6.refused).push([Date.now(), c.animEventName]); } }, ${id}, ${id});
          if (!globalThis.e2eT6Update) { globalThis.e2eT6Update = true; sp.on("update", () => { const s = globalThis.e2eT6; const a = sp.Actor.from(sp.Game.getFormEx(s.id)); if (a && s.log.length < 150) { const st = [a.getSitState(), a.isWeaponDrawn() ? 1 : 0, a.isAIEnabled() ? 1 : 0].join(","); if (st !== s.last) { s.last = st; s.log.push((Date.now() - s.t0) + " state " + st); } } }); }
          return 0;`, n);
      }
      const sitOnViewer = await ctx.drv(`${npc(id)} return a ? a.getSitState() : -1;`, 1);
      await ctx.drv(`${npc(id)} a.startCombat(sp.Game.getPlayer()); return 0;`, 2);
      for (const t0 = Date.now(); Date.now() - t0 < FIGHT_MS;) {
        await heal(1);
        await heal(2);
        await ctx.drv(`${npc(id)} const p = sp.Game.getPlayer(); if (a) p.setAngle(0, 0, p.getAngleZ() + p.getHeadingAngle(a)); return 0;`, 1).catch(() => 0);
        await ctx.sleep(1000);
      }
      await ctx.drv(`${npc(id)} if (a) a.stopCombat(); return 0;`, 2).catch(() => 0);
      const hoster = await ctx.drv(`return globalThis.e2eT6;`, 2);
      await ctx.sleep(LAG + 500);
      const viewer = await ctx.drv(`return globalThis.e2eT6;`, 1);
      const s = await server(id);
      const unused = [...viewer.events];
      const lags = [];
      const evMissed = hoster.events.filter((m) => { const i = unused.findIndex((t) => t[0] >= m[0] - 50 && t[0] <= m[0] + LAG && t[1] === m[1]); if (i >= 0) lags.push(unused.splice(i, 1)[0][0] - m[0]); return i < 0; });
      ctx.evidence.push(`${name}: engine 1 lag of each matched attack event (ms): ${JSON.stringify(lags)}`);
      const late = evMissed.map((m) => { const t = viewer.events.find((v) => v[1] === m[1] && v[0] > m[0] + LAG); return `${m[1]} at ${m[0] - hoster.events[0][0]} ms: ${t ? `${t[0] - m[0]} ms late` : "never"}`; });
      ctx.evidence.push(`${name} ${hex(id)}${note}: sit state on engine 1 at the start ${sitOnViewer}${note ? ` (${seatWait} ms after it loaded there)` : ""}; hoster at the end ${hex(s.hoster)} (engine 2 ${hex(actors[1])}), dead ${s.dead}; engine 2 attack events ${JSON.stringify(hoster.events.map((e) => e[1]))}, engine 1 ${JSON.stringify(viewer.events.map((e) => e[1]))}, refused by engine 1's graph at ${JSON.stringify(viewer.refused.map((e) => e[0] - (hoster.events[0] || [e[0]])[0]))} ms`);
      const before = fails.length;
      if (s.hoster !== actors[1]) fails.push(`${name}: hosted by ${hex(s.hoster)} at the end, not engine 2`);
      if (note && sitOnViewer !== 3) fails.push(`${name}: not exercised, not seated on engine 1 when the fight starts (sit state ${sitOnViewer})`);
      if (!hoster.events.length) fails.push(`${name}: not exercised, no attack event on engine 2`);
      else if (evMissed.length) fails.push(`${name}: engine 1 did not play ${evMissed.length} of ${hoster.events.length} attack events within ${LAG} ms: ${late.join(", ")}`);
      if (fails.length > before) ctx.evidence.push(`${name} on engine 1 (sit, weapon drawn, AI): ${viewer.log.join(" | ")}`);
    };

    await put(1, AWAY);
    const gloc = await ctx.npcLocation(SITTER[1], 2);
    await put(2, { ...gloc, pos: [gloc.pos[0] + 300, gloc.pos[1], gloc.pos[2] + 50] });
    await loaded(SITTER[1], 2);
    let seated = false;
    if (await ctx.waitFor(() => server(SITTER[1]).then((s) => s.hoster === actors[1] && !s.dead), 60000, `engine 2 hosts ${SITTER[0]}`).then(() => true).catch(() => false)) {
      const seats = await ctx.drv(`${npc(SITTER[1])} const out = []; const c = a.getParentCell(); const n = c ? c.getNumRefs(40) : 0;
        for (let i = 0; i < n; i++) { const r = c.getNthRef(i, 40); if (!r || r.isDisabled() || r.isFurnitureInUse(false)) continue; const b = r.getBaseObject(); const name = b ? b.getName() : ""; const d = a.getDistance(r); if (d < 2500 && /chaise|banc|tabouret|chair|bench|stool/i.test(name)) out.push([r.getFormID(), Math.round(d), name]); }
        return out.sort((x, y) => x[1] - y[1]).slice(0, 4);`, 2);
      ctx.evidence.push(`${SITTER[0]}: seats near her on engine 2 ${JSON.stringify(seats.map(([id, d, name]) => [hex(id), d, name]))}`);
      for (const [seat] of seats) {
        await ctx.drv(`sp.ObjectReference.from(sp.Game.getFormEx(${seat})).activate(sp.Actor.from(sp.Game.getFormEx(${SITTER[1]})), false); return 0;`, 2);
        seated = await ctx.waitFor(() => ctx.drv(`${npc(SITTER[1])} return !!a && a.getSitState() === 3;`, 2), 40000, `${SITTER[0]} sits on ${hex(seat)}`).then(() => true).catch(() => false);
        if (seated) break;
      }
    }
    if (!seated) fails.push(`seated: not exercised, ${SITTER[0]} did not sit on engine 2`);
    else {
      await ctx.sleep(5000);
      await fight(...SITTER, " (seated on engine 2 when the fight starts)");
    }
    await put(1, AWAY);
    const loc = await ctx.npcLocation(BANDIT[1], 2);
    await put(2, { ...loc, pos: [loc.pos[0] + 300, loc.pos[1], loc.pos[2] + 50] });
    await loaded(BANDIT[1], 2);
    if (!(await ctx.waitFor(() => server(BANDIT[1]).then((s) => s.hoster === actors[1] && !s.dead), 60000, "engine 2 hosts the living bandit").then(() => true).catch(() => false))) fails.push("bandit: not exercised, engine 2 does not host a living bandit");
    else await fight(...BANDIT, "");

    ctx.assert.ok(!fails.length, fails.join("; "));
  },
};
