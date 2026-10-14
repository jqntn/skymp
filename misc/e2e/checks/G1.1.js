const fs = require("fs");
const path = require("path");

const SETTINGS = path.join(__dirname, "..", "..", "..", "skymp5-server", "ts", "settings.ts");
const MQ102 = 0x4e50d;
const MQ102B = 0x2610a;
const RALOF = 0x2bf9e;
const RIVERWOOD_MARKER = [19157, -46588, -144];
const REACH = 1500;
const MAX_STEP = 1000;

module.exports = {
  engines: 1,
  gameHour: 12,
  timeout: 15 * 60000,
  setup: async (ctx) => {
    const startLog = fs.readFileSync(SETTINGS, "utf8").match(/questStages: (\[\[[^\n]*\]\]),/)[1];
    const actor = await ctx.character(1);
    await ctx.probe(`mp.set(${actor}, "private.questLog", ${startLog}); return 0;`);
    ctx.evidence.push(`start log from settings.ts: ${startLog}`);
  },
  async run(ctx) {
    const actor = await ctx.ready(1);
    const hex = (v) => (v >>> 0).toString(16);
    const round = (p) => p.map(Math.round).join(",");
    const ralof = `const a = sp.Actor.from(sp.Game.getFormEx(${RALOF}));`;
    const server = () => ctx.probe(`const l = mp.get(${RALOF}, "locationalData"); return { cell: l.cellOrWorldDesc, pos: l.pos, hoster: mp.get(${RALOF}, "hoster") || 0 };`);
    const local = () => ctx.drv(`${ralof} const q = sp.Quest.from(sp.Game.getFormEx(${MQ102B})); const m = sp.Quest.from(sp.Game.getFormEx(${MQ102})); const k = a && a.getCurrentPackage(); const sc = a && a.getCurrentScene(); const w = a && a.getWorldSpace();
      return { loaded: !!a && a.is3DLoaded(), world: w ? w.getFormID() : 0, pos: a ? [a.getPositionX(), a.getPositionY(), a.getPositionZ()] : [0, 0, 0], pkg: k ? k.getFormID() : 0, scene: sc ? sc.getFormID() : 0, combat: !!a && a.isInCombat(), mq102b: q.getCurrentStageID(), mq102: m.getCurrentStageID(), player: [sp.Game.getPlayer().getPositionX(), sp.Game.getPlayer().getPositionY()] };`);
    const follow = () => ctx.drv(`${ralof} const p = sp.Game.getPlayer(); if (!a || !a.is3DLoaded() || p.getDistance(a) < 400) return 0;
      const r = a.getAngleZ() * Math.PI / 180; p.setPosition(a.getPositionX() - 200 * Math.sin(r), a.getPositionY() - 200 * Math.cos(r), a.getPositionZ() + 50); return 1;`);
    const fromMarker = (pos) => Math.hypot(pos[0] - RIVERWOOD_MARKER[0], pos[1] - RIVERWOOD_MARKER[1]);

    const first = await server();
    ctx.evidence.push(`start: server Ralof ${first.cell} at ${round(first.pos)}, hoster ${hex(first.hoster)}, ${Math.round(fromMarker(first.pos))} units from the Riverwood marker`);
    const samples = [];
    let s = first;
    let l = await local();
    let follows = 0;
    const arrived = await ctx.waitFor(async () => {
      s = await server();
      l = await local().catch((e) => ({ err: String(e) }));
      follows += await follow().catch(() => 0);
      samples.push({ t: Date.now(), server: s.pos.map(Math.round), cell: s.cell, hoster: s.hoster, local: l });
      return s.cell.startsWith("3c:") && fromMarker(s.pos) < REACH;
    }, 6 * 60000, "Ralof reaches Riverwood").catch(() => false);
    const path = samples.reduce((d, x, i) => i ? d + Math.hypot(x.server[0] - samples[i - 1].server[0], x.server[1] - samples[i - 1].server[1]) : 0, 0);
    const walk = samples.slice(Math.max(0, samples.findIndex((x) => x.hoster)));
    const step = (x, i) => i ? Math.hypot(x.server[0] - walk[i - 1].server[0], x.server[1] - walk[i - 1].server[1]) : 0;
    const longest = walk.reduce((m, x, i) => step(x, i) > m.d ? { d: step(x, i), at: x.server } : m, { d: 0, at: null });
    const packages = [...new Set(samples.map((x) => x.local && x.local.pkg).filter(Boolean).map(hex))];
    const scenes = [...new Set(samples.map((x) => x.local && x.local.scene).filter(Boolean).map(hex))];
    ctx.evidence.push(`end: server Ralof ${s.cell} at ${round(s.pos)}, hoster ${hex(s.hoster)}, ${Math.round(fromMarker(s.pos))} units from the marker; server path ${Math.round(path)} units in ${samples.length} samples; player moved to Ralof ${follows} times`);
    ctx.evidence.push(`local Ralof: loaded ${l.loaded}, world ${hex(l.world || 0)}, at ${round(l.pos || [0, 0, 0])}, combat ${l.combat}; packages seen ${packages}; scenes seen ${scenes}; MQ102B stage ${l.mq102b}, MQ102 stage ${l.mq102}`);
    ctx.evidence.push(`walk from the first hosted sample: ${walk.length} samples, longest step ${Math.round(longest.d)} units${longest.at ? ` (to ${longest.at.slice(0, 2)})` : ""}`);
    ctx.evidence.push(`server positions every 10th sample: ${samples.filter((_, i) => i % 10 === 0).map((x) => `${x.cell.split(":")[0]}@${x.server.slice(0, 2)}`).join(" ")}`);
    ctx.shot("G1_1-end");

    ctx.assert.ok(arrived, `Ralof did not reach Riverwood in 10 min: server ${s.cell} at ${round(s.pos)}, ${Math.round(fromMarker(s.pos))} units from the marker`);
    ctx.assert.ok(longest.d <= MAX_STEP, `Ralof did not walk: the server position jumped ${Math.round(longest.d)} units in one sample (to ${longest.at && longest.at.slice(0, 2)})`);
  },
};
