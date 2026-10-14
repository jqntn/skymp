const NPCS = [["Faendal", 0x1348c], ["Alvor", 0x13482], ["Hilde", 0x35534]];
const RIVERWOOD = { cellOrWorldDesc: "3c:Skyrim.esm", pos: [19157, -46588, -94], rot: [0, 0, 0] };
const WHITERUN_PORCH = { cellOrWorldDesc: "1a26f:Skyrim.esm", pos: [26691, 1678, -1404], rot: [0, 0, 0] };
const SAMPLES = 20;
const HOSTER_MOVES = 3;
const PUPPET_MOVES = 0.5;
const POSE_TOLERANCE = 12;
const ARMS_DOWN = 25;
const NOT_APOSE = 15;

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
    const hosters = () => ctx.probe(`return ${JSON.stringify(NPCS.map(([, id]) => id))}.map((id) => mp.get(id, "hoster") || 0);`);
    const bones = (id, n) => ctx.drv(`const N = sp.NetImmerse; const a = sp.Actor.from(sp.Game.getFormEx(${id})); if (!a || !a.is3DLoaded()) return null;
      const g = (b) => [N.getNodeWorldPositionX(a, b, false), N.getNodeWorldPositionY(a, b, false), N.getNodeWorldPositionZ(a, b, false)];
      const pel = g("NPC Pelvis [Pelv]"); const t = a.getAngleZ() * Math.PI / 180;
      const rel = (v) => { const dx = v[0] - pel[0], dy = v[1] - pel[1]; return [dx * Math.cos(t) - dy * Math.sin(t), dx * Math.sin(t) + dy * Math.cos(t), v[2] - pel[2]]; };
      return { r: rel(g("NPC R Hand [RHnd]")), l: rel(g("NPC L Hand [LHnd]")), dz: g("NPC R UpperArm [RUar]")[2] - g("NPC R Hand [RHnd]")[2], head: g("NPC Head [Head]")[2] - pel[2], hips: pel[2] - a.getPositionZ() };`, n);
    const window = async (id, h, p) => {
      const t = { [h]: [], [p]: [] };
      for (let i = 0; i < SAMPLES; i++) {
        const [bh, bp] = await Promise.all([bones(id, h), bones(id, p)]);
        if (bh) t[h].push(bh);
        if (bp) t[p].push(bp);
        await ctx.sleep(100);
      }
      const stats = (x) => x.length < SAMPLES / 2 ? null : {
        motion: Math.max(...["r", "l"].map((k) => Math.max(...x.map((s) => Math.hypot(...s[k].map((v, i) => v - x[0][k][i])))))),
        dz: x.reduce((a, s) => a + s.dz, 0) / x.length,
        head: x.reduce((a, s) => a + s.head, 0) / x.length,
        hips: x.reduce((a, s) => a + s.hips, 0) / x.length,
        settled: Math.max(...x.map((s) => s.hips)) - Math.min(...x.map((s) => s.hips)) <= POSE_TOLERANCE,
      };
      return { hoster: stats(t[h]), puppet: stats(t[p]) };
    };
    const round = (s) => s && `motion ${s.motion.toFixed(1)}, drop ${s.dz.toFixed(1)}, head ${s.head.toFixed(1)}, hips ${s.hips.toFixed(1)}`;

    const fails = [];
    let movedTotal = 0;
    const frozenTotal = [];
    for (const [h, p] of [[2, 1], [1, 2]]) {
      await go(p, WHITERUN_PORCH, 0x1a26f);
      await go(h, RIVERWOOD, 0x3c);
      const hosted = await ctx.waitFor(() => hosters().then((hs) => hs.every((x) => x === actors[h - 1])), 120000, `engine ${h} hosts ${NPCS.map(([n]) => n).join(", ")}`).catch(() => false);
      const hs = await hosters();
      ctx.evidence.push(`engine ${h} hosts: ${NPCS.map(([n], i) => `${n} ${hex(hs[i])}`).join(", ")}`);
      if (!hosted) {
        fails.push(`engine ${h} does not host all of ${NPCS.map(([n]) => n).join(", ")}`);
        continue;
      }
      await go(p, { ...RIVERWOOD, pos: [RIVERWOOD.pos[0] + 150, RIVERWOOD.pos[1], RIVERWOOD.pos[2]] }, 0x3c);
      let moved = 0;
      const frozen = [];
      for (const [name, id] of NPCS) {
        for (const [n, side] of [[h, 1], [p, -1]]) {
          await ctx.drv(`const a = sp.Actor.from(sp.Game.getFormEx(${id})); const pl = sp.Game.getPlayer(); if (!a) return 0; const r = (a.getAngleZ() + 90 * ${side}) * Math.PI / 180;
            const x = a.getPositionX() + 250 * Math.sin(r), y = a.getPositionY() + 250 * Math.cos(r); pl.setPosition(x, y, a.getPositionZ() + 20); pl.setAngle(0, 0, Math.atan2(a.getPositionX() - x, a.getPositionY() - y) * 180 / Math.PI); return 0;`, n);
        }
        await ctx.sleep(3000);
        let w = await window(id, h, p);
        for (let k = 0; k < 3 && w.hoster && (w.hoster.motion < HOSTER_MOVES || !w.hoster.settled || !w.puppet?.settled); k++) w = await window(id, h, p);
        const owner = (await hosters())[NPCS.findIndex(([, x]) => x === id)];
        ctx.evidence.push(`${name}, hoster engine ${h} (server ${hex(owner)}): hoster ${round(w.hoster) || "not loaded"}; puppet engine ${p}: ${round(w.puppet) || "not loaded"}`);
        if (owner !== actors[h - 1]) fails.push(`${name} changed hoster to ${hex(owner)} during the samples`);
        else if (!w.hoster || !w.puppet) fails.push(`${name} is not loaded on both engines`);
        else {
          if (w.hoster.motion >= HOSTER_MOVES) {
            moved++;
            if (w.puppet.motion < PUPPET_MOVES) frozen.push(`${name} (hands moved ${w.puppet.motion.toFixed(1)} while the hoster's moved ${w.hoster.motion.toFixed(1)})`);
          }
          if (w.hoster.dz >= ARMS_DOWN && w.puppet.dz < NOT_APOSE && w.puppet.motion < PUPPET_MOVES) {
            fails.push(`${name} on engine ${p} holds its arms up without moving (an A-pose): drop ${w.puppet.dz.toFixed(1)}, motion ${w.puppet.motion.toFixed(1)} while the hoster's arms hang (${w.hoster.dz.toFixed(1)})`);
          }
          if (Math.abs(w.hoster.hips - w.puppet.hips) > POSE_TOLERANCE) {
            fails.push(`${name} on engine ${p} does not hold the hoster's posture: hips ${w.puppet.hips.toFixed(1)} vs ${w.hoster.hips.toFixed(1)}`);
          }
        }
      }
      ctx.shot(`G1_6-puppets-engine${p}`, p);
      ctx.evidence.push(`${moved} NPC(s) moved on the hoster engine ${h}, so the motion test ran for them; still on engine ${p}: ${frozen.join(", ") || "none"}`);
      movedTotal += moved;
      frozenTotal.push(...frozen.map((f) => `${f} on engine ${p}`));
    }
    if (!movedTotal) fails.push("no NPC moved its hands on a hoster, so the frozen test did not run");
    else if (frozenTotal.length === movedTotal) fails.push(`every puppet is frozen: ${frozenTotal.join(", ")}`);
    ctx.assert.ok(!fails.length, fails.join("; "));
  },
};
