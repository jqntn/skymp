const fs = require("fs");
const path = require("path");
const BFB02 = "371dd:Skyrim.esm";
const LOOK = 0x709d4;
const LOOK_POS = [-7876, 188, 652];
const WALL = 0x709d1;
const SHOUT_GLOBAL = 0x7096d;
const MS13 = 0x39645;
const STAGE = 60;
const SPOTS = { 1: 135, 2: 180 };
const DISTANCE = 250;

module.exports = {
  engines: 2,
  timeout: 15 * 60000,
  setup: async (ctx) => {
    await ctx.character(1);
    await ctx.character(2);
  },
  async run(ctx) {
    const actors = [await ctx.ready(1), await ctx.ready(2)];
    const [leader, member] = actors;
    const hex = (v) => (v >>> 0).toString(16);
    const send = (n, content) => ctx.drv(`sp.mpClientPlugin.send(JSON.stringify({ t: 1, contentJsonDump: ${JSON.stringify(JSON.stringify(content))} }), true); return 0;`, n);
    const state = (n) => ctx.drv(`const p = sp.Game.getPlayer(); const t = sp.ObjectReference.from(sp.Game.getFormEx(${LOOK})); const c = p.getParentCell();
      return { heading: Math.round(p.getAngleZ()), global: sp.GlobalVariable.from(sp.Game.getFormEx(${SHOUT_GLOBAL})).getValue(), ms13: sp.Quest.from(sp.Game.getFormEx(${MS13})).getCurrentStageID(), cell: c ? c.getFormID() : 0, dist: t ? Math.round(p.getDistance(t)) : -1, los: t ? p.hasLOS(t) : false };`, n);
    const fmt = (s) => `shout global ${s.global}, MS13 stage ${s.ms13}, ${s.dist} units from the wall's look target, line of sight ${s.los}, heading ${s.heading}`;
    const fails = [];

    await send(1, { customPacketType: "partyInvite", target: member });
    await ctx.sleep(1500);
    await send(2, { customPacketType: "partyAccept", inviter: leader });
    const joined = await ctx.waitFor(() => fs.readFileSync(path.join(ctx.dir, "server.log"), "utf8").includes(`Coop: ${hex(member)} joined party`), 15000, "engine 2 joins the party").then(() => true).catch(() => false);
    ctx.assert.ok(joined, "engine 2 did not join engine 1's party");

    const before = { 1: await state(1), 2: await state(2) };
    ctx.evidence.push(`party joined; before the wall: engine 1 ${fmt(before[1])}; engine 2 ${fmt(before[2])}`);
    ctx.assert.ok(before[1].global === 0 && before[2].global === 0, "a player already knows the word before the wall");

    const spot = (n) => [LOOK_POS[0] + DISTANCE * Math.sin((SPOTS[n] * Math.PI) / 180), LOOK_POS[1] + DISTANCE * Math.cos((SPOTS[n] * Math.PI) / 180), 560];
    const facing = (n) => (SPOTS[n] + 180) % 360;
    const face = (n) => ctx.drv(`sp.Game.getPlayer().setAngle(0, 0, ${facing(n)}); return 0;`, n);
    for (const n of [1, 2]) {
      await ctx.probe(`mp.set(${actors[n - 1]}, "locationalData", ${JSON.stringify({ cellOrWorldDesc: BFB02, pos: spot(n), rot: [0, 0, facing(n)] })}); return 0;`);
    }
    for (const n of [1, 2]) {
      await ctx.waitFor(() => ctx.drv(`const r = sp.ObjectReference.from(sp.Game.getFormEx(${WALL})); return !sp.Ui.isMenuOpen("Loading Menu") && !!r && r.is3DLoaded();`, n).catch(() => false), 120000, `the word wall is loaded on engine ${n}`);
    }
    for (const n of [1, 2]) {
      const [x, y, z] = spot(n);
      await ctx.drv(`sp.Game.getPlayer().setPosition(${x}, ${y}, ${z}); return 0;`, n);
      await face(n);
    }
    const at = Date.now();
    const learned = { 1: null, 2: null };
    while (Date.now() - at < 20000 && (!learned[1] || !learned[2])) {
      for (const n of [1, 2]) {
        if (learned[n]) continue;
        const s = await state(n);
        if (s.global === 1) learned[n] = ((Date.now() - at) / 1000).toFixed(1);
        else if (!s.los) await face(n);
      }
      await ctx.sleep(500);
    }
    await ctx.sleep(3000);
    const after = { 1: await state(1), 2: await state(2) };
    ctx.evidence.push(`at the wall: engine 1 (leader) ${fmt(after[1])}, learned after ${learned[1] || "-"} s; engine 2 (member) ${fmt(after[2])}, learned after ${learned[2] || "-"} s`);
    ctx.shot("wordwall-engine2", 2);

    for (const n of [1, 2]) {
      const who = n === 1 ? "engine 1 (leader)" : "engine 2 (member)";
      if (after[n].cell !== 0x371dd || after[n].dist >= 300 || !after[n].los) fails.push(`${who} is not in front of the wall (${fmt(after[n])})`);
      else if (after[n].global !== 1 || after[n].ms13 !== STAGE) fails.push(`${who} did not learn the word within 20 s: ${fmt(after[n])} (the wall script sets the global to 1 and MS13 to stage ${STAGE})`);
    }
    ctx.assert.ok(!fails.length, fails.join("; "));
  },
};
