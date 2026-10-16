const fs = require("fs");
const path = require("path");
const DRAGON = 0x5a6ca;
const MQ104 = 0x2610c;
const SPOT = [7572, -39162, 3807];
const CELL = 4096;
const SAMPLE_S = 120;
const MAX_LAG = 1500;

module.exports = {
  engines: 2,
  timeout: 12 * 60000,
  setup: async (ctx) => {
    await ctx.character(1, { pos: SPOT, angleZ: 0, worldOrCell: 0x3c });
    await ctx.character(2, { pos: [SPOT[0] + 150, SPOT[1], SPOT[2]], angleZ: 0, worldOrCell: 0x3c });
  },
  async run(ctx) {
    const actors = [await ctx.ready(1), await ctx.ready(2)];
    const [leader, member] = actors;
    const engineOf = { [leader]: 1, [member]: 2 };
    const hex = (v) => (v >>> 0).toString(16);
    const send = (n, content) => ctx.drv(`sp.mpClientPlugin.send(JSON.stringify({ t: 1, contentJsonDump: ${JSON.stringify(JSON.stringify(content))} }), true); return 0;`, n);
    const server = () => ctx.probe(`const d = mp.get(${DRAGON}, "locationalData"); const p = (a) => mp.get(a, "locationalData").pos.map(Math.round);
      return { pos: d.pos.map(Math.round), hoster: mp.get(${DRAGON}, "hoster") || 0, dead: !!mp.get(${DRAGON}, "isDead"), players: [p(${leader}), p(${member})], playersDead: [!!mp.get(${leader}, "isDead"), !!mp.get(${member}, "isDead")] };`);
    const local = (n) => ctx.drv(`const a = sp.Actor.from(sp.Game.getFormEx(${DRAGON})); if (!a) return null; return { pos: [a.getPositionX(), a.getPositionY(), a.getPositionZ()].map(Math.round), loaded: a.is3DLoaded(), state: a.getFlyingState(), dead: a.isDead() };`, n);
    const dist = (a, b) => Math.round(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
    const cell = (p) => [Math.trunc(p[0] / CELL), Math.trunc(p[1] / CELL)];
    const cellsApart = (a, b) => { const [x1, y1] = cell(a); const [x2, y2] = cell(b); return Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2)); };
    const fails = [];

    await send(1, { customPacketType: "partyInvite", target: member });
    await ctx.sleep(1500);
    await send(2, { customPacketType: "partyAccept", inviter: leader });
    const joined = await ctx.waitFor(() => fs.readFileSync(path.join(ctx.dir, "server.log"), "utf8").includes(`Coop: ${hex(member)} joined party`), 15000, "engine 2 joins the party").then(() => true).catch(() => false);
    ctx.assert.ok(joined, "engine 2 did not join engine 1's party");

    await ctx.drv(`return sp.Quest.from(sp.Game.getFormEx(${MQ104})).setCurrentStageID(60);`, 1);
    const hosted = await ctx.waitFor(() => server().then((s) => !!engineOf[s.hoster]), 30000, "a player hosts the dragon").then(() => true).catch(() => false);
    ctx.assert.ok(hosted, `nobody hosts the enabled dragon (server ${JSON.stringify(await server())})`);
    const first = await server();
    ctx.evidence.push(`A: party formed at the Western Watchtower; the leader set MQ104 to 60 by script (its fragment enables Mirmulnir ${hex(DRAGON)}, who then patrols); first hoster ${hex(first.hoster)} (leader ${hex(leader)}, member ${hex(member)})`);

    const samples = [];
    const started = Date.now();
    let hosterOfLast = first.hoster;
    const heal = () => ctx.probe(`for (const a of [${leader}, ${member}]) { if (!mp.get(a, "isDead")) mp.set(a, "percentages", { health: 1, magicka: 1, stamina: 1 }); } return 0;`);
    while (Date.now() - started < SAMPLE_S * 1000) {
      await heal();
      const t = Math.round((Date.now() - started) / 100) / 10;
      const s = await server();
      const l = { 1: await local(1), 2: await local(2) };
      const owner = engineOf[s.hoster] || engineOf[hosterOfLast];
      const apart = cellsApart(s.pos, s.players[owner - 1]);
      const own = engineOf[s.hoster] ? l[engineOf[s.hoster]] : null;
      samples.push({ t, s, l, apart, ownLoaded: !!own && own.loaded, lag: own ? dist(own.pos, s.pos) : -1, toMember: dist(s.pos, s.players[1]) });
      if (s.hoster) hosterOfLast = s.hoster;
      if (s.dead) break;
      await ctx.sleep(1000);
    }
    const fmt = (x) => `${x.t}s server ${JSON.stringify(x.s.pos)} hoster ${hex(x.s.hoster)} ${x.apart} cells from its hoster, lag ${x.lag}; leader copy ${x.l[1] ? `${JSON.stringify(x.l[1].pos)} state ${x.l[1].state}${x.l[1].loaded ? "" : " unloaded"}` : "none"}; member copy ${x.l[2] ? `${JSON.stringify(x.l[2].pos)} state ${x.l[2].state}${x.l[2].loaded ? "" : " unloaded"}` : "none"}, member ${x.toMember} away`;
    ctx.evidence.push(`B: every 1 s for ${SAMPLE_S} s: ${samples.map(fmt).join(" | ")}`);
    const unhosted = samples.filter((x) => !engineOf[x.s.hoster]);
    const stale = samples.filter((x) => engineOf[x.s.hoster] && x.lag > MAX_LAG);
    const unloadedHosted = samples.filter((x) => engineOf[x.s.hoster] && !x.ownLoaded);
    const stuck = samples.filter((x, i) => x.apart >= 2 && i + 1 < samples.length && dist(samples[i + 1].s.pos, x.s.pos) < 50);
    const far = samples.filter((x) => x.apart >= 2);
    const travel = samples.slice(1).reduce((sum, x, i) => sum + dist(x.s.pos, samples[i].s.pos), 0);
    ctx.evidence.push(`C: ${samples.length} samples; ${far.length} with the dragon 2 or more cells from its hoster (at most ${Math.max(0, ...samples.filter((x) => engineOf[x.s.hoster]).map((x) => x.apart))} while hosted); ${unhosted.length} without a player hoster; ${stale.length} where the server was over ${MAX_LAG} units from the hoster's own copy; ${unloadedHosted.length} hosted samples with the hoster's own copy unloaded (the game still moves it); ${stuck.length} 2-cell samples after which the server's dragon did not move; the server's dragon travelled ${travel} units; hosters seen ${JSON.stringify([...new Set(samples.map((x) => hex(x.s.hoster)))])}`);
    if (samples.some((x) => x.s.dead)) fails.push("the dragon died during the window (the check does not kill him)");
    if (samples.some((x) => x.s.playersDead.some(Boolean))) fails.push(`setup not held: a player died at ${samples.find((x) => x.s.playersDead.some(Boolean)).t} s`);
    if (!far.length) fails.push("not exercised: the dragon never flew 2 cells from its hoster");
    if (unhosted.length) fails.push(`the server had no player hosting the dragon in ${unhosted.length} of ${samples.length} samples, from ${unhosted[0].t} s (${unhosted[0].apart} cells from the last hoster, ${unhosted[0].toMember} units from the member)`);
    if (stale.length) fails.push(`the server's dragon was over ${MAX_LAG} units from its hoster's own copy in ${stale.length} samples: ${stale.slice(0, 5).map((x) => `${x.t}s ${x.lag}`).join(", ")}`);
    if (stuck.length) fails.push(`the server's dragon did not move after ${stuck.length} samples 2 cells from its hoster: ${stuck.slice(0, 5).map((x) => `${x.t}s`).join(", ")}`);
    ctx.shot("F5-leader", 1);
    ctx.assert.ok(!fails.length, fails.join("; "));
  },
};
