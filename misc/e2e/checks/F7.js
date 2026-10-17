const fs = require("fs");
const path = require("path");
const DRAGON = 0x5a6ca;
const SPOT = [7572, -39162, 3807];
const SAMPLE_S = 40;
const GRACE_MS = 10000;
const LATE_MS = 8000;
const MIN_FLYING = 10;
const MAX_DIST = 1000;
const AWAY = { cellOrWorldDesc: "3c:Skyrim.esm", pos: [12155.9, -71991.3, 6015.5], rot: [0, 0, 0] };

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
    const hex = (v) => (v >>> 0).toString(16);
    const send = (n, content) => ctx.drv(`sp.mpClientPlugin.send(JSON.stringify({ t: 1, contentJsonDump: ${JSON.stringify(JSON.stringify(content))} }), true); return 0;`, n);
    const server = () => ctx.probe(`const d = mp.get(${DRAGON}, "locationalData"); return { pos: d.pos.map(Math.round), hoster: mp.get(${DRAGON}, "hoster") || 0, dead: !!mp.get(${DRAGON}, "isDead") };`);
    const local = (n) => ctx.drv(`const a = sp.Actor.from(sp.Game.getFormEx(${DRAGON})); if (!a) return null; return { pos: [a.getPositionX(), a.getPositionY(), a.getPositionZ()].map(Math.round), loaded: a.is3DLoaded(), flying: a.isFlying(), state: a.getFlyingState(), dead: a.isDead() };`, n);
    const dist = (a, b) => Math.round(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
    const heal = () => ctx.probe(`for (const a of [${leader}, ${member}]) { if (!mp.get(a, "isDead")) mp.set(a, "percentages", { health: 1, magicka: 1, stamina: 1 }); } return 0;`);
    const fails = [];

    await send(1, { customPacketType: "partyInvite", target: member });
    await ctx.sleep(1500);
    await send(2, { customPacketType: "partyAccept", inviter: leader });
    const joined = await ctx.waitFor(() => fs.readFileSync(path.join(ctx.dir, "server.log"), "utf8").includes(`Coop: ${hex(member)} joined party`), 15000, "engine 2 joins the party").then(() => true).catch(() => false);
    ctx.assert.ok(joined, "engine 2 did not join engine 1's party");

    await ctx.probe(`mp.set(${member}, "locationalData", ${JSON.stringify(AWAY)}); return 0;`);
    const playerPos = (n) => ctx.drv(`const p = sp.Game.getPlayer(); return sp.Ui.isMenuOpen("Loading Menu") ? null : [p.getPositionX(), p.getPositionY(), p.getPositionZ()].map(Math.round);`, n);
    const away = await ctx.waitFor(() => playerPos(2).then((p) => !!p && dist(p, AWAY.pos) < 500).catch(() => false), 120000, "the member is at the Helgen exit").then(() => true).catch(() => false);
    ctx.assert.ok(away, "the server could not move the member away from the Western Watchtower");
    await ctx.sleep(3000);
    const far = await playerPos(2);
    await ctx.probe(`mp.callPapyrusFunction("method", "ObjectReference", "Enable", { type: "form", desc: mp.getDescFromId(${DRAGON}) }, [false]); return 0;`);
    const hosted = await ctx.waitFor(() => server().then((s) => s.hoster === leader), 30000, "the leader hosts the dragon").then(() => true).catch(() => false);
    ctx.assert.ok(hosted, `the leader does not host the enabled dragon (server ${JSON.stringify(await server())}, the member was ${dist(far, SPOT)} units away)`);
    const tookOff = await ctx.waitFor(() => local(1).then((l) => !!l && l.flying).catch(() => false), 30000, "the leader's dragon takes off").then(() => true).catch(() => false);
    ctx.assert.ok(tookOff, "the leader's dragon did not take off within 30 s of the leader's host");
    for (const end = Date.now() + LATE_MS; Date.now() < end;) {
      await heal();
      await ctx.sleep(1000);
    }
    const loc = await ctx.probe(`return mp.get(${leader}, "locationalData");`);
    await ctx.probe(`mp.set(${member}, "locationalData", ${JSON.stringify({ ...loc, pos: [loc.pos[0] + 150, loc.pos[1], loc.pos[2] + 30] })}); return 0;`);
    const loaded = await ctx.waitFor(() => local(2).then((l) => !!l && l.loaded).catch(() => false), 60000, "the dragon is loaded on the member's client").then(() => true).catch(() => false);
    ctx.assert.ok(loaded, "the dragon is not loaded on the member's client after the member came next to the leader");
    const loadedAt = Date.now();
    ctx.evidence.push(`A: party formed; the member started ${dist(far, SPOT)} units away; the server enabled Mirmulnir ${hex(DRAGON)}, hosted by the leader ${hex(leader)}, who took off; ${LATE_MS / 1000} s later the server moved the member ${hex(member)} next to the leader, and the dragon loaded on the member's client`);

    const samples = [];
    while (Date.now() - loadedAt < SAMPLE_S * 1000) {
      const t = Math.round((Date.now() - loadedAt) / 100) / 10;
      await heal();
      const [s, l1, l2] = [await server(), await local(1), await local(2)];
      samples.push({ t, s, l1, l2, d: l2 ? dist(l2.pos, s.pos) : -1 });
      await ctx.sleep(1000);
    }
    const flying = samples.filter((x) => x.s.hoster === leader && x.l1 && x.l1.loaded && x.l1.flying && !x.s.dead && x.t * 1000 >= GRACE_MS);
    const travel = flying.slice(1).reduce((sum, x, i) => sum + dist(x.s.pos, flying[i].s.pos), 0);
    const hoverStarts = flying.filter((x, i) => i > 0 && flying[i - 1].l1.state === 2 && x.l1.state === 3).length;
    const far2 = flying.filter((x) => !x.l2 || !x.l2.loaded || x.d > MAX_DIST);
    const grounded = flying.filter((x) => x.l2 && x.l2.loaded && !x.l2.flying);
    const hosters = [...new Set(samples.map((x) => x.s.hoster))];
    ctx.evidence.push(`B: every 1 s for ${SAMPLE_S} s after the load: ${samples.map((x) => `${x.t}s server ${JSON.stringify(x.s.pos)}${x.l1 && x.l1.flying ? " flying" : ""}${x.s.hoster === leader ? "" : ` hoster ${hex(x.s.hoster)}`}, leader ${x.l1 ? `${JSON.stringify(x.l1.pos)} state ${x.l1.state}${x.l1.loaded ? "" : " unloaded"}` : "none"}, member ${x.l2 ? `${JSON.stringify(x.l2.pos)} state ${x.l2.state}` : "none"} ${x.d}${x.l2 && !x.l2.loaded ? " unloaded" : ""}`).join("; ")}`);
    ctx.evidence.push(`C: ${flying.length} samples flying and hosted by the leader from ${GRACE_MS / 1000} s; the server's dragon travelled ${travel} units in them; ${hoverStarts} hover starts (state 2 to 3) among them; the member's copy was not flying in ${grounded.length} and over ${MAX_DIST} units from the server's position in ${far2.length} (max ${Math.max(0, ...flying.map((x) => x.d))}); the member's copy at the load: state ${samples[0].l2 ? samples[0].l2.state : "none"}; hosters seen ${JSON.stringify(hosters.map(hex))}`);
    if (flying.length < MIN_FLYING) fails.push(`the dragon flew hosted by the leader in only ${flying.length} samples (need ${MIN_FLYING})`);
    if (grounded.length) fails.push(`the member's copy was not flying while the leader's flew in ${grounded.length} of ${flying.length} samples: ${grounded.slice(0, 5).map((x) => `${x.t}s state ${x.l2.state}`).join(", ")}`);
    if (far2.length) fails.push(`the member's copy of the flying dragon was over ${MAX_DIST} units from the server's position in ${far2.length} of ${flying.length} samples: ${far2.slice(0, 5).map((x) => `${x.t}s ${x.d}`).join(", ")}`);
    ctx.shot("F7-member", 2);
    ctx.assert.ok(!fails.length, fails.join("; "));
  },
};
