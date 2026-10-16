const fs = require("fs");
const path = require("path");
const DRAGON = 0x5a6ca;
const SPOT = [7572, -39162, 3807];
const FLY_MS = 6000;
const SETTLE_MS = 60000;
const REST_MOVE = 50;
const REST_S = 8;
const MAX_DIST = 500;

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
    const server = () => ctx.probe(`const d = mp.get(${DRAGON}, "locationalData"); return { pos: d.pos.map(Math.round), cell: d.cellOrWorldDesc, hoster: mp.get(${DRAGON}, "hoster") || 0, dead: !!mp.get(${DRAGON}, "isDead") };`);
    const local = (n) => ctx.drv(`const a = sp.Actor.from(sp.Game.getFormEx(${DRAGON})); if (!a) return null; const ref = [a.getPositionX(), a.getPositionY(), a.getPositionZ()].map(Math.round);
      const node = ["NPC Pelvis [Pelv]", "NPC Pelvis"].find((name) => a.is3DLoaded() && sp.NetImmerse.hasNode(a, name, false));
      const pos = node ? [sp.NetImmerse.getNodeWorldPositionX(a, node, false), sp.NetImmerse.getNodeWorldPositionY(a, node, false), sp.NetImmerse.getNodeWorldPositionZ(a, node, false)].map(Math.round) : ref;
      return { pos, ref, node: node || "", loaded: a.is3DLoaded(), dead: a.isDead() };`, n);
    const dist = (a, b) => Math.round(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
    const fails = [];

    await send(1, { customPacketType: "partyInvite", target: member });
    await ctx.sleep(1500);
    await send(2, { customPacketType: "partyAccept", inviter: leader });
    const joined = await ctx.waitFor(() => fs.readFileSync(path.join(ctx.dir, "server.log"), "utf8").includes(`Coop: ${hex(member)} joined party`), 15000, "engine 2 joins the party").then(() => true).catch(() => false);
    ctx.assert.ok(joined, "engine 2 did not join engine 1's party");

    await ctx.probe(`mp.callPapyrusFunction("method", "ObjectReference", "Enable", { type: "form", desc: mp.getDescFromId(${DRAGON}) }, [false]); return 0;`);
    const shown = await Promise.all([1, 2].map((n) => ctx.waitFor(() => local(n).then((l) => !!l && l.loaded).catch(() => false), 30000, `the dragon is loaded on engine ${n}`).then(() => true).catch(() => false)));
    ctx.assert.ok(shown.every(Boolean), `the enabled dragon is not loaded on both engines (${shown.join(", ")})`);
    await ctx.sleep(FLY_MS);
    const alive = { server: await server(), 1: await local(1), 2: await local(2) };
    ctx.evidence.push(`A: party formed; the server enabled Mirmulnir ${hex(DRAGON)}; after ${FLY_MS / 1000} s: server ${JSON.stringify(alive.server)} (hoster ${hex(alive.server.hoster)}), engine 1 ${JSON.stringify(alive[1])}, engine 2 ${JSON.stringify(alive[2])}; leader ${hex(leader)}, member ${hex(member)}`);

    await ctx.probe(`mp.set(${DRAGON}, "isDead", true); return 0;`);
    const death = await server();
    const samples = { 1: [], 2: [], server: [] };
    const started = Date.now();
    const sample = async () => {
      const t = Math.round((Date.now() - started) / 1000);
      for (const n of [1, 2]) samples[n].push({ t, ...(await local(n)) });
      samples.server.push({ t, ...(await server()) });
    };
    let restedAt = 0;
    while (Date.now() - started < SETTLE_MS && !restedAt) {
      await ctx.sleep(1000);
      await sample();
      const s = samples.server;
      if (s.length > REST_S && s.slice(-REST_S - 1).every((x) => dist(x.pos, s[s.length - 1].pos) < REST_MOVE)) restedAt = Date.now();
    }
    const rest = samples.server[samples.server.length - 1];
    const last = { 1: samples[1][samples[1].length - 1], 2: samples[2][samples[2].length - 1] };
    ctx.evidence.push(`B: the server killed the dragon at ${JSON.stringify(death.pos)} in ${death.cell} (hoster ${hex(death.hoster)}); the server's position stayed within ${REST_MOVE} units for ${REST_S} s ${restedAt ? `${Math.round((restedAt - started) / 1000)} s after the kill` : `not within ${SETTLE_MS / 1000} s`}, at ${JSON.stringify(rest.pos)} (hoster ${hex(rest.hoster)}, ${dist(rest.pos, death.pos)} units from the kill point)`);
    for (const n of [1, 2]) ctx.evidence.push(`B: engine ${n} every 1 s: ${samples[n].map((s) => `${s.t}s ${JSON.stringify(s.pos)}${s.dead ? "" : " alive"}${s.loaded ? "" : " unloaded"}`).join("; ")}`);
    ctx.evidence.push(`B: server every 1 s: ${samples.server.map((s) => `${s.t}s ${JSON.stringify(s.pos)}`).join("; ")}`);
    if (!restedAt) fails.push(`the server's position of the dead dragon did not come to rest within ${SETTLE_MS / 1000} s`);
    for (const n of [1, 2]) {
      const s = last[n];
      const d = s ? dist(s.pos, rest.pos) : -1;
      ctx.evidence.push(`B: engine ${n} at the end: ${s ? `body (${s.node || "no pelvis node, ref position"}) ${JSON.stringify(s.pos)}, ref position ${JSON.stringify(s.ref)}, dead ${s.dead}, loaded ${s.loaded}, body ${d} units from the server's corpse position` : "no dragon"}`);
      if (!s || !s.dead) fails.push(`engine ${n}: the dragon is not dead`);
      else if (!s.loaded) fails.push(`engine ${n}: the corpse is not loaded`);
      else if (!s.node) fails.push(`engine ${n}: the corpse has no pelvis node to measure`);
      else if (d > MAX_DIST) fails.push(`engine ${n}: the corpse's body lies ${d} units from the server's corpse position (${JSON.stringify(s.pos)} vs ${JSON.stringify(rest.pos)})`);
    }
    const NODES = ["NPC Head", "NPC Head [Head]", "NPC Pelvis", "NPC Pelvis [Pelv]", "NPC COM [COM ]", "NPC Spine1", "NPC Spine1 [Spn1]", "NPC Tail1", "NPC L Hand [LHnd]", "NPC R Hand [RHnd]"];
    for (const n of [1, 2]) {
      const nodes = await ctx.drv(`const a = sp.Actor.from(sp.Game.getFormEx(${DRAGON})); const z = a.getPositionZ(); const out = {};
        for (const name of ${JSON.stringify(NODES)}) { if (sp.NetImmerse.hasNode(a, name, false)) out[name] = [sp.NetImmerse.getNodeWorldPositionX(a, name, false) - a.getPositionX(), sp.NetImmerse.getNodeWorldPositionY(a, name, false) - a.getPositionY(), sp.NetImmerse.getNodeWorldPositionZ(a, name, false) - z].map(Math.round); }
        return out;`, n);
      ctx.evidence.push(`C: engine ${n} corpse pose, node offsets from the dragon's position: ${JSON.stringify(nodes)}`);
    }
    for (const [n, side] of [[1, -1], [2, 1]]) {
      await ctx.drv(`const a = sp.Actor.from(sp.Game.getFormEx(${DRAGON})); const p = sp.Game.getPlayer(); const deg = ${30 * side}; const r = deg * Math.PI / 180;
        const node = ["NPC Pelvis [Pelv]", "NPC Pelvis"].find((name) => sp.NetImmerse.hasNode(a, name, false)); const at = node ? [sp.NetImmerse.getNodeWorldPositionX(a, node, false), sp.NetImmerse.getNodeWorldPositionY(a, node, false), sp.NetImmerse.getNodeWorldPositionZ(a, node, false)] : [a.getPositionX(), a.getPositionY(), a.getPositionZ()];
        p.setPosition(at[0] - 600 * Math.sin(r), at[1] - 600 * Math.cos(r), at[2] + 120); p.setAngle(12, 0, deg); return 0;`, n);
    }
    await ctx.sleep(4000);
    ctx.shot("F1-engine1", 1);
    ctx.shot("F1-engine2", 2);
    const again = { server: await server(), 1: await local(1), 2: await local(2) };
    for (const n of [1, 2]) {
      const s = again[n];
      const d = s ? dist(s.pos, again.server.pos) : -1;
      ctx.evidence.push(`D: after both players stood next to the corpse for 4 s: engine ${n} ${s ? `body ${JSON.stringify(s.pos)}, dead ${s.dead}, loaded ${s.loaded}, ${d} units from the server's position ${JSON.stringify(again.server.pos)}` : "no dragon"}`);
      if (!s || !s.dead || !s.loaded || !s.node || d > MAX_DIST) fails.push(`engine ${n}, next to the corpse: ${s ? `dead ${s.dead}, loaded ${s.loaded}, body ${d} units from the server's position` : "no dragon"}`);
    }
    ctx.assert.ok(!fails.length, fails.join("; "));
  },
};
