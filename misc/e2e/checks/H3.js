const GERDUR = 0x13489;
const AWAY = { cellOrWorldDesc: "1a26f:Skyrim.esm", pos: [26691, 1678, -1404], rot: [0, 0, 0] };
const LOOK = (name) => ({ isFemale: false, raceId: 0x13746, weight: 50, skinColor: -1, hairColor: -1, headpartIds: [], headTextureSetId: 0, options: new Array(19).fill(0), presets: new Array(4).fill(0), tints: [], name });
const JUMP = 100;
const COMBAT_MS = 1000;
const SEAT_MS = 5000;

module.exports = {
  engines: 2,
  timeout: 25 * 60000,
  setup: async (ctx) => {
    await ctx.character(1);
    await ctx.character(2);
  },
  async run(ctx) {
    const actors = [await ctx.ready(1), await ctx.ready(2)];
    const names = ["E2eOne", "E2eTwo"];
    for (const n of [1, 2]) await ctx.probe(`mp.set(${actors[n - 1]}, "appearance", ${JSON.stringify(LOOK(names[n - 1]))}); return 0;`);
    const hex = (v) => (v >>> 0).toString(16);
    const heal = (n) => ctx.probe(`mp.set(${actors[n - 1]}, "percentages", { health: 1, magicka: 1, stamina: 1 }); return 0;`).catch(() => 0);
    const server = () => ctx.probe(`const l = mp.get(${GERDUR}, "locationalData"); return { dead: !!mp.get(${GERDUR}, "isDead"), hoster: mp.get(${GERDUR}, "hoster") || 0, cell: l.cellOrWorldDesc, pos: l.pos };`);
    const npc = `const a = sp.Actor.from(sp.Game.getFormEx(${GERDUR}));`;
    const put = (n, loc) => ctx.probe(`mp.set(${actors[n - 1]}, "locationalData", ${JSON.stringify(loc)}); return 0;`);
    const loaded = (n) => ctx.waitFor(() => ctx.drv(`${npc} return !sp.Ui.isMenuOpen("Loading Menu") && !!a && a.is3DLoaded();`, n).catch(() => false), 120000, `Gerdur is loaded on engine ${n}`);
    const near = async (n, from) => {
      const at = await server();
      await put(n, { cellOrWorldDesc: at.cell, pos: [at.pos[0] + (from ? 0 : 300), at.pos[1] + (from ? 400 : 0), at.pos[2] + 50], rot: [0, 0, 180] });
      await loaded(n);
    };
    const hosts = (n) => ctx.waitFor(() => server().then((s) => s.hoster === actors[n - 1] && !s.dead), 60000, `engine ${n} runs Gerdur`);
    const record = (n) => ctx.drv(`globalThis.e2eH3 = { t0: Date.now(), s: [] };
      if (!globalThis.e2eH3Update) { globalThis.e2eH3Update = true; sp.on("update", () => { const g = globalThis.e2eH3; const a = sp.Actor.from(sp.Game.getFormEx(${GERDUR})); if (!g || !a || g.s.length > 4000) return;
        const t = a.isInCombat() ? a.getCombatTarget() : null; const f = a.getFurnitureReference();
        g.s.push([Date.now(), a.getPositionX(), a.getPositionY(), a.getPositionZ(), a.getSitState(), f ? f.getFormID() : 0, t ? (t.getFormID() === 0x14 ? "player" : t.getDisplayName()) : "", a.isDead() ? 1 : 0, a.isAIEnabled() ? 1 : 0, Math.round(sp.Game.getPlayer().getPositionZ())]); }); }
      return 0;`, n);
    const copies = (n) => ctx.drv(`${npc} const name = a ? a.getDisplayName() : ""; let c = 0; for (let id = 0xff000000; id < 0xff004000; id++) { let o = null; try { const f = sp.Game.getFormEx(id); o = f && f.getType() === 62 ? sp.Actor.from(f) : null; } catch (e) {} if (o && !o.isDisabled() && o.getDisplayName() === name) c++; } return c;`, n);
    const fails = [];

    const transfer = async (label, from, to) => {
      await record(to);
      await ctx.sleep(1500);
      const before = await server();
      await put(from, AWAY);
      const left = Date.now();
      let at = 0;
      for (const t0 = Date.now(); Date.now() - t0 < 5000 && !at; await ctx.sleep(50)) {
        if ((await server()).hoster === actors[to - 1]) at = Date.now();
      }
      await ctx.sleep(Math.max(SEAT_MS, COMBAT_MS) + 500);
      const s = (await ctx.drv(`return globalThis.e2eH3.s;`, to)).filter((x) => x[0] >= left - 1000);
      const after = s.filter((x) => x[0] >= (at || left));
      let jump = 0;
      for (let i = 1; i < s.length; i++) jump = Math.max(jump, Math.hypot(s[i][1] - s[i - 1][1], s[i][2] - s[i - 1][2], s[i][3] - s[i - 1][3]));
      const c = await copies(to);
      const k = s.findIndex((x, i) => i && Math.hypot(x[1] - s[i - 1][1], x[2] - s[i - 1][2], x[3] - s[i - 1][3]) === jump);
      ctx.evidence.push(`${label}: samples around the largest step (t from the transfer, x, y, z, sit, furniture, target, dead, AI, player z): ${JSON.stringify(s.slice(Math.max(0, k - 4), k + 4).map((x) => [x[0] - (at || left), ...x.slice(1, 4).map(Math.round), ...x.slice(4)]))}`);
      ctx.evidence.push(`${label}: the first 3 s on engine ${to}, every 8th sample: ${JSON.stringify(after.filter((x, i) => i % 8 === 0 && x[0] - (at || left) <= 3000).map((x) => [x[0] - (at || left), ...x.slice(1, 4).map(Math.round), ...x.slice(4)]))}`);
      ctx.evidence.push(`${label}: engine ${to} runs Gerdur ${at ? at - left : "never"} ms after engine ${from} left; ${s.length} samples on engine ${to}, largest step ${jump.toFixed(0)} units, dead ${after.some((x) => x[7])}, copies ${c}; first after ${JSON.stringify(after[0])}, last ${JSON.stringify(after[after.length - 1])}; server before ${JSON.stringify(before)}`);
      if (!at) fails.push(`${label}: engine ${to} did not run Gerdur within 5 s`);
      if (jump > JUMP) fails.push(`${label}: Gerdur jumped ${jump.toFixed(0)} units on engine ${to} at the transfer`);
      if (after.some((x) => x[7])) fails.push(`${label}: Gerdur died on engine ${to}`);
      if (c > 0) fails.push(`${label}: engine ${to} shows ${c} spawned copies of Gerdur besides the real one`);
      return { at, after };
    };

    await put(1, AWAY);
    await near(2, false);
    await hosts(2);
    const seats = await ctx.drv(`${npc} const out = []; const c = a.getParentCell(); const n = c ? c.getNumRefs(40) : 0;
      for (let i = 0; i < n; i++) { const r = c.getNthRef(i, 40); if (!r || r.isDisabled() || r.isFurnitureInUse(false)) continue; const b = r.getBaseObject(); const name = b ? b.getName() : ""; const d = a.getDistance(r); if (d < 2500 && /chaise|banc|tabouret|chair|bench|stool/i.test(name)) out.push([r.getFormID(), Math.round(d)]); }
      return out.sort((x, y) => x[1] - y[1]).slice(0, 4).map((x) => x[0]);`, 2);
    let seat = 0;
    for (const id of seats) {
      await ctx.drv(`sp.ObjectReference.from(sp.Game.getFormEx(${id})).activate(sp.Actor.from(sp.Game.getFormEx(${GERDUR})), false); return 0;`, 2);
      if (await ctx.waitFor(() => ctx.drv(`${npc} return !!a && a.getSitState() === 3;`, 2), 40000, `Gerdur sits on ${hex(id)}`).then(() => true).catch(() => false)) {
        seat = id;
        break;
      }
    }
    ctx.assert.ok(seat, `not exercised: Gerdur did not sit on any of ${seats.map(hex).join(", ")}`);
    seat = await ctx.drv(`${npc} const f = a.getFurnitureReference(); return f ? f.getFormID() : 0;`, 2);
    ctx.assert.ok(seat, "not exercised: Gerdur sits on engine 2 without being bound to a furniture");
    await near(1, true);
    const seatedOn1 = await ctx.waitFor(() => ctx.drv(`${npc} return !!a && a.getSitState() === 3;`, 1), 30000, "Gerdur is seated on engine 1").then(() => true).catch(() => false);
    ctx.assert.ok(seatedOn1, "not exercised: engine 1 does not show Gerdur seated before the seat transfer");
    ctx.assert.ok((await server()).hoster === actors[1], "not exercised: engine 2 no longer runs Gerdur before the seat transfer");
    const seated = await transfer("seat", 2, 1);
    const window = seated.after.filter((x) => x[0] <= seated.at + SEAT_MS);
    const stood = window.find((x) => x[4] !== 3);
    ctx.evidence.push(`seat: on engine 1 Gerdur ${stood ? `stood up ${stood[0] - seated.at} ms after the transfer (the AI's furniture state does not transfer: activate binds no NPC, Skyrim has no SnapIntoInteraction)` : `stayed seated for ${SEAT_MS / 1000} s`}; furniture at the end ${hex(window.length ? window[window.length - 1][5] : 0)}`);
    if (!window.length) fails.push("seat: no sample on engine 1 after the transfer");

    await near(2, true);
    await ctx.sleep(3000);
    ctx.assert.ok((await server()).hoster === actors[0], "not exercised: engine 1 no longer runs Gerdur before the combat transfer");
    const target = await ctx.drv(`for (let id = 0xff000000; id < 0xff004000; id++) { let o = null; try { const f = sp.Game.getFormEx(id); o = f && f.getType() === 62 ? sp.Actor.from(f) : null; } catch (e) {} if (o && o.getDisplayName() === "${names[1]}") { ${npc} a.startCombat(o); return id; } } return 0;`, 1);
    ctx.assert.ok(target, "not exercised: engine 1 does not show engine 2's player");
    const fighting = await ctx.waitFor(async () => { await heal(1); await heal(2); return ctx.drv(`${npc} const t = a && a.isInCombat() ? a.getCombatTarget() : null; return !!t && t.getDisplayName() === "${names[1]}";`, 1); }, 15000, "Gerdur fights engine 2's player on engine 1").then(() => true).catch(() => false);
    ctx.assert.ok(fighting, "not exercised: Gerdur does not fight engine 2's player on engine 1");
    for (let i = 0; i < 4; i++) { await heal(2); await ctx.sleep(1000); }
    const fought = await transfer("combat", 1, 2);
    const engaged = fought.after.find((x) => x[6] === "player");
    ctx.evidence.push(`combat: Gerdur fights engine 2's player on engine 2 ${engaged ? `${engaged[0] - fought.at} ms after the transfer` : "never"}`);
    if (!engaged || engaged[0] - fought.at > COMBAT_MS) fails.push(`combat: Gerdur did not fight engine 2's player on engine 2 within ${COMBAT_MS} ms of the transfer`);
    await ctx.drv(`${npc} if (a) a.stopCombat(); return 0;`, 2).catch(() => 0);
    ctx.assert.ok(!fails.length, fails.join("; "));
  },
};
