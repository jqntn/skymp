const NPCS = [["Faendal", 0x1348c], ["Sven", 0x13491], ["Hilde", 0x35534], ["Alvor", 0x13482]];
const RIVERWOOD = { cellOrWorldDesc: "3c:Skyrim.esm", pos: [19157, -46588, -94], rot: [0, 0, 0] };
const WHITERUN_PORCH = { cellOrWorldDesc: "1a26f:Skyrim.esm", pos: [26691, 1678, -1404], rot: [0, 0, 0] };
const MENU = "Dialogue Menu";
const HOLD = 100;
const FACE = 60;
const TALK_MS = 8000;

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
    const inWorld = (world) => `const p = sp.Game.getPlayer(); return !sp.Ui.isMenuOpen("Loading Menu") && !!p && p.is3DLoaded() && !!p.getWorldSpace() && p.getWorldSpace().getFormID() === ${world};`;
    const go = async (n, loc, world) => {
      await ctx.probe(`mp.set(${actors[n - 1]}, "locationalData", ${JSON.stringify(loc)}); return 0;`);
      await ctx.waitFor(() => ctx.drv(inWorld(world), n).catch(() => false), 120000, `engine ${n} arrives in ${hex(world)}`);
    };
    const npc = (id) => `const a = sp.Actor.from(sp.Game.getFormEx(${id}));`;
    const server = (id) => ctx.probe(`const l = mp.get(${id}, "locationalData"); return { hoster: mp.get(${id}, "hoster") || 0, pos: l.pos };`);
    const local = (id, n) => ctx.drv(`${npc(id)} if (!a || !a.is3DLoaded()) return null; const p = sp.Game.getPlayer(); return { pos: [a.getPositionX(), a.getPositionY(), a.getPositionZ()], heading: a.getAngleZ(), sit: a.getSitState() };`, n).catch(() => null);
    const dist = (a, b) => Math.round(Math.hypot(a[0] - b[0], a[1] - b[1]));

    await go(1, WHITERUN_PORCH, 0x1a26f);
    await go(2, RIVERWOOD, 0x3c);
    let picked = null;
    for (let t0 = Date.now(); !picked && Date.now() - t0 < 120000;) {
      for (const [name, id] of NPCS) {
        const s = await server(id);
        if (s.hoster !== actors[1]) continue;
        const a = await local(id, 2);
        if (!a || a.sit !== 0) continue;
        await ctx.sleep(1500);
        const b = await local(id, 2);
        if (b && b.sit === 0 && dist(a.pos, b.pos) > 60) { picked = [name, id]; break; }
      }
      if (!picked) await ctx.sleep(3000);
    }
    ctx.assert.ok(picked, "not exercised: no NPC hosted by engine 2 walked in Riverwood within 2 min");
    const [name, id] = picked;
    const at = await server(id);
    await go(1, { cellOrWorldDesc: "3c:Skyrim.esm", pos: [at.pos[0] - 200, at.pos[1], at.pos[2] + 30], rot: [0, 0, 0] }, 0x3c);
    await ctx.waitFor(async () => !!(await local(id, 1)), 60000, `${name} is loaded on engine 1`);
    let open = false;
    for (let k = 0; k < 4 && !open; k++) {
      await ctx.drv(`${npc(id)} const p = sp.Game.getPlayer(); p.setPosition(a.getPositionX() + 120 * Math.sin(a.getAngleZ() * Math.PI / 180), a.getPositionY() + 120 * Math.cos(a.getAngleZ() * Math.PI / 180), a.getPositionZ() + 20); return 0;`, 1);
      await ctx.sleep(1000);
      await ctx.drv(`${npc(id)} const p = sp.Game.getPlayer(); p.setAngle(0, 0, p.getAngleZ() + p.getHeadingAngle(a)); return 0;`, 1);
      await ctx.sleep(1000);
      await ctx.drv(`sp.once("update", () => sp.Actor.from(sp.Game.getFormEx(${id})).activate(sp.Game.getPlayer(), false)); return 0;`, 1);
      open = await ctx.waitFor(() => ctx.drv(`return sp.Ui.isMenuOpen("${MENU}");`, 1), 6000, "the dialogue opens on engine 1").then(() => true).catch(() => false);
    }
    ctx.assert.ok(open, `not exercised: engine 1 could not open a dialogue with ${name}`);
    const hosterAtTalk = (await server(id)).hoster;
    const start = { server: (await server(id)).pos, engine2: (await local(id, 2))?.pos };
    const talker = await ctx.drv(`const p = sp.Game.getPlayer(); return [p.getPositionX(), p.getPositionY()];`, 1);
    let farServer = 0;
    let farEngine2 = 0;
    let worstFacing = 0;
    let shutAt = 0;
    for (const t0 = Date.now(); Date.now() - t0 < TALK_MS;) {
      if (!shutAt && !(await ctx.drv(`return sp.Ui.isMenuOpen("${MENU}");`, 1))) shutAt = Date.now() - t0;
      const s = await server(id);
      const e2 = await local(id, 2);
      farServer = Math.max(farServer, dist(s.pos, start.server));
      if (e2 && start.engine2) {
        farEngine2 = Math.max(farEngine2, dist(e2.pos, start.engine2));
        if (Date.now() - t0 > 3000) {
          const want = (Math.atan2(talker[0] - e2.pos[0], talker[1] - e2.pos[1]) * 180) / Math.PI;
          worstFacing = Math.max(worstFacing, Math.abs((((e2.heading - want) % 360) + 540) % 360 - 180));
        }
      }
      await ctx.sleep(500);
    }
    await ctx.drv(`sp.TESModPlatform.closeMenu("${MENU}"); return 0;`, 1).catch(() => 0);
    const closedAt = (await server(id)).pos;
    const resumed = await ctx.waitFor(async () => dist((await server(id)).pos, closedAt) > 60, 30000, `${name} moves again after the dialogue`).then(() => true).catch(() => false);
    ctx.evidence.push(`${name} ${hex(id)} walked on engine 2 (hoster ${hex(hosterAtTalk)}); during ${TALK_MS / 1000} s of dialogue on engine 1 (${shutAt ? `closed by itself after ${shutAt} ms` : "open throughout"}): moved up to ${farServer} units on the server, ${farEngine2} on engine 2; worst facing on engine 2 ${Math.round(worstFacing)} degrees off the talker; moved again within 30 s after the close: ${resumed}`);
    const fails = [];
    if (shutAt) fails.push(`the dialogue with ${name} closed by itself on engine 1 after ${shutAt} ms`);
    if (hosterAtTalk !== actors[1]) fails.push(`${name} was hosted by ${hex(hosterAtTalk)}, not engine 2, at the talk`);
    if (farServer > HOLD) fails.push(`${name} moved ${farServer} units on the server during the dialogue`);
    if (farEngine2 > HOLD) fails.push(`${name} moved ${farEngine2} units on engine 2 during the dialogue`);
    if (worstFacing > FACE) fails.push(`${name} turned ${Math.round(worstFacing)} degrees away from the talker on engine 2`);
    if (!resumed) fails.push(`${name} did not move again within 30 s after the dialogue`);
    ctx.assert.ok(!fails.length, fails.join("; "));
  },
};
