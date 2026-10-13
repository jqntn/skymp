const ALVOR = 0x13482;
const GERDUR = 0x13489;
const FORGE = [20587, -45138, -81];
const HOUSE_LOWER_FLOOR = [-503, 96, 60];
const RIVERWOOD_MARKER = [19157, -46588, -144];
const RADIUS = 500;
const HOLD_MS = 5000;

module.exports = {
  engines: 1,
  gameHour: 7.975,
  timeout: 15 * 60000,
  setup: async (ctx) => {
    await ctx.character(1);
  },
  async run(ctx) {
    const actor = await ctx.ready(1);
    const hex = (v) => (v >>> 0).toString(16);
    const round = (p) => p.map(Math.round).join(",");
    const npc = (id) => `const a = sp.Actor.from(sp.Game.getFormEx(${id}));`;
    const server = (id) => ctx.probe(`const l = mp.get(${id}, "locationalData"); return { cell: l.cellOrWorldDesc, pos: l.pos, hoster: mp.get(${id}, "hoster") || 0 };`);
    const local = (id) => ctx.drv(`${npc(id)} const c = a && a.getParentCell(); const k = a && a.getCurrentPackage(); const p = sp.Game.getPlayer();
      return { ai: !!a && a.isAIEnabled(), loaded: !!a && a.is3DLoaded(), cell: c ? c.getFormID() : 0, pos: a ? [a.getPositionX(), a.getPositionY(), a.getPositionZ()] : [0, 0, 0], pkg: k ? k.getFormID() : 0, dist: a ? p.getDistance(a) : -1, hour: sp.GlobalVariable.from(sp.Game.getFormEx(0x38)).getValue() };`);
    const teleport = (loc) => ctx.probe(`mp.set(${actor}, "locationalData", ${JSON.stringify(loc)}); return 0;`);
    const fromForge = (s) => Math.hypot(s.pos[0] - FORGE[0], s.pos[1] - FORGE[1]);
    const atForge = (s) => s.cell.startsWith("3c:") && fromForge(s) < RADIUS;

    const start = await server(ALVOR);
    ctx.evidence.push(`start: server Alvor in ${start.cell} at ${round(start.pos)}, hoster ${hex(start.hoster)}`);
    ctx.assert.ok(!start.cell.startsWith("3c:"), `Alvor does not start in his house: ${start.cell}`);
    const house = parseInt(start.cell, 16);
    const away = await local(ALVOR);
    if (away.cell === house) {
      await ctx.drv(`${npc(ALVOR)} const w = sp.Game.getFormEx(0x3c); sp.TESModPlatform.moveRefrToPosition(a, sp.Cell.from(w), sp.WorldSpace.from(w), ${FORGE.join(", ")}, 0, 0, 0); return 0;`);
    }
    await ctx.drv(`sp.Cell.from(sp.Game.getFormEx(${house})).setPublic(true); return 0;`);
    await teleport({ cellOrWorldDesc: start.cell, pos: HOUSE_LOWER_FLOOR, rot: [0, 0, 0] });
    await ctx.waitFor(() => ctx.drv(`const c = sp.Game.getPlayer().getParentCell(); return !!c && c.getFormID() === ${house} && c.isAttached();`).catch(() => false), 120000, "the player is in Alvor's house");
    await ctx.waitFor(() => local(ALVOR).then((l) => !l.ai).catch(() => false), 30000, "the client applied its view of Alvor (AI off for an NPC that nobody hosts)");
    await ctx.sleep(2000);
    const engine = await local(ALVOR);
    ctx.evidence.push(`before the player came, the client had Alvor in ${hex(away.cell)} at ${round(away.pos)}, AI ${away.ai}${away.cell === house ? ", so the check moved him to the forge" : ""}; 2 s after the client applied its view of him (AI off), the client has him in ${hex(engine.cell)} at ${round(engine.pos)}`);
    ctx.assert.ok(engine.cell !== house, `the client moved Alvor, whom nobody hosts, from its own position to the stale server position in his house (${round(engine.pos)})`);
    await ctx.drv(`${npc(ALVOR)} const h = sp.Game.getFormEx(${house}); sp.TESModPlatform.moveRefrToPosition(a, sp.Cell.from(h), sp.WorldSpace.from(h), ${start.pos.join(", ")}, 0, 0, 0); return 0;`);
    await ctx.waitFor(() => local(ALVOR).then((l) => l.loaded && l.cell === house).catch(() => false), 120000, "Alvor is loaded in his house");
    const before = await local(ALVOR);
    ctx.evidence.push(`in the house on the lower floor, out of his way (set public so the teleported player is no trespasser): game hour ${before.hour.toFixed(3)}, the check moved Alvor home for the start state; local Alvor cell ${hex(before.cell)} package ${hex(before.pkg)}`);

    const cells = [];
    const hosters = new Set();
    let s = start;
    let teleports = 0;
    let heldSince = 0;
    const arrived = await ctx.waitFor(async () => {
      s = await server(ALVOR);
      const me = await server(actor);
      if (s.hoster) hosters.add(hex(s.hoster));
      if (cells[cells.length - 1] !== s.cell) cells.push(s.cell);
      if (s.cell !== me.cell && s.cell.startsWith("3c:")) {
        teleports++;
        await teleport({ cellOrWorldDesc: s.cell, pos: [RIVERWOOD_MARKER[0], RIVERWOOD_MARKER[1], RIVERWOOD_MARKER[2] + 50], rot: [0, 0, 0] });
      }
      if (!atForge(s)) {
        heldSince = 0;
        return false;
      }
      heldSince = heldSince || Date.now();
      return Date.now() - heldSince >= HOLD_MS;
    }, 8 * 60000, "Alvor at the forge").catch(() => false);
    const after = await local(ALVOR).catch((e) => ({ err: String(e) }));
    ctx.evidence.push(`end: server Alvor in ${s.cell} at ${round(s.pos)}, ${Math.round(fromForge(s))} units from the forge marker, hoster ${hex(s.hoster)}; server cells ${cells.join(" -> ")}; hosters seen ${[...hosters].join(",") || "none"}; player cell changes ${teleports}; local Alvor package ${hex(after.pkg || 0)}, game hour ${after.hour ? after.hour.toFixed(3) : "?"}`);
    ctx.shot("G1_2-forge");
    ctx.assert.ok(arrived, `Alvor did not reach the forge: server ${s.cell} at ${round(s.pos)}, ${Math.round(fromForge(s))} units from it`);

    for (const [name, id] of [["Gerdur", GERDUR], ["Alvor", ALVOR]]) {
      const loc = await ctx.probe(`return mp.get(${id}, "locationalData");`);
      await teleport({ ...loc, pos: [loc.pos[0] + 100, loc.pos[1], loc.pos[2] + 50] });
      await ctx.waitFor(() => ctx.drv(`${npc(id)} return !sp.Ui.isMenuOpen("Loading Menu") && !!a && a.is3DLoaded();`).catch(() => false), 120000, `${name} is loaded`);
      await ctx.sleep(2000);
      let seen = false;
      for (let k = 0; k < 24 && !seen; k++) {
        const d = [90, 150, 60][Math.floor(k / 8)];
        await ctx.drv(`${npc(id)} const p = sp.Game.getPlayer(); const r = (a.getAngleZ() + ${(k % 8) * 45}) * Math.PI / 180;
          p.setPosition(a.getPositionX() + ${d} * Math.sin(r), a.getPositionY() + ${d} * Math.cos(r), a.getPositionZ()); return 0;`);
        await ctx.sleep(700);
        seen = await ctx.drv(`${npc(id)} return sp.Game.getPlayer().hasLOS(a);`);
      }
      ctx.assert.ok(seen, `${name}: no spot near the NPC with line of sight`);
      let ok = false;
      for (let attempt = 0; attempt < 2 && !ok; attempt++) {
        await ctx.drv(`${npc(id)} a.activate(sp.Game.getPlayer(), false); return 0;`);
        ok = await ctx.waitFor(() => ctx.drv(`${npc(id)} return sp.Ui.isMenuOpen("Dialogue Menu") && a.isInDialogueWithPlayer();`), 10000, `${name} dialogue`).catch(() => false);
      }
      const where = await server(id);
      ctx.evidence.push(`${name} (${hex(id)}) in ${where.cell} at ${round(where.pos)}, hoster ${hex(where.hoster)}: Dialogue Menu open and in dialogue with the player: ${ok}`);
      ctx.shot(`G1_2-${name}`);
      ctx.assert.ok(ok, `${name}: no dialogue menu`);
    }
  },
};
