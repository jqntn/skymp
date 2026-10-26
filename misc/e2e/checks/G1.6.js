const NPCS = [["Faendal", 0x1348c], ["Alvor", 0x13482], ["Hilde", 0x35534]];
const RIVERWOOD = { cellOrWorldDesc: "3c:Skyrim.esm", pos: [19157, -46588, -94], rot: [0, 0, 0] };
const WHITERUN_PORCH = { cellOrWorldDesc: "1a26f:Skyrim.esm", pos: [26691, 1678, -1404], rot: [0, 0, 0] };
const SAMPLES = 20;
const HOSTER_MOVES = 3;
const PUPPET_MOVES = 0.5;
const POSE_TOLERANCE = 12;
const ARMS_DOWN = 25;
const NOT_APOSE = 15;
const RESEAT_MS = 12000;

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
    const bones = (id, n) => ctx.drv(`const N = sp.NetImmerse; const a = sp.Actor.from(sp.Game.getFormEx(${id})); if (!a || !a.is3DLoaded()) return null; const pl = sp.Game.getPlayer(); pl.setAngle(0, 0, pl.getAngleZ() + pl.getHeadingAngle(a));
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
    const sitOf = (id, n) => ctx.drv(`const a = sp.Actor.from(sp.Game.getFormEx(${id})); return a && a.is3DLoaded() ? a.getSitState() : -1;`, n).catch(() => -1);
    const hipsOf = async (id, n) => { const b = await bones(id, n).catch(() => null); return b ? b.hips : null; };
    const reseat = async (id, p, hosterHips) => {
      await ctx.drv(`const a = sp.Actor.from(sp.Game.getFormEx(${id})); sp.Debug.sendAnimationEvent(a, "IdleForceDefaultState"); return 0;`, p);
      const t0 = Date.now();
      let up = false;
      while (!up && Date.now() - t0 < 3000) {
        const hips = await hipsOf(id, p);
        up = (await sitOf(id, p)) === 0 || (hips !== null && hips - hosterHips > POSE_TOLERANCE);
        if (!up) await ctx.sleep(200);
      }
      if (!up) return { up };
      while (Date.now() - t0 < RESEAT_MS) {
        const hips = await hipsOf(id, p);
        if ((await sitOf(id, p)) !== 0 && hips !== null && Math.abs(hips - hosterHips) <= POSE_TOLERANCE) return { up, back: Date.now() - t0 };
        await ctx.sleep(250);
      }
      return { up };
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
        const syncFrom = Date.now();
        const synced = await ctx.waitFor(async () => (await sitOf(id, h)) === (await sitOf(id, p)), 20000, `${name} has the same sit state on both engines`).then(() => true).catch(() => false);
        const syncMs = Date.now() - syncFrom;
        await ctx.sleep(3000);
        let w = await window(id, h, p);
        for (let k = 0; k < 3 && w.hoster && (w.hoster.motion < HOSTER_MOVES || !w.hoster.settled || !w.puppet?.settled); k++) w = await window(id, h, p);
        const owner = (await hosters())[NPCS.findIndex(([, x]) => x === id)];
        const seated = await ctx.drv(`const a = sp.Actor.from(sp.Game.getFormEx(${id})); return a ? a.getSitState() : -1;`, h);
        ctx.evidence.push(`${name}, hoster engine ${h} (server ${hex(owner)}): hoster ${round(w.hoster) || "not loaded"}; puppet engine ${p}: ${round(w.puppet) || "not loaded"}; sit states matched ${synced ? `after ${syncMs} ms` : "never in 20 s"}`);
        if (owner !== actors[h - 1]) fails.push(`${name} changed hoster to ${hex(owner)} during the samples`);
        else if (!w.hoster || !w.puppet) fails.push(`${name} is not loaded on both engines`);
        else {
          if (w.hoster.motion >= HOSTER_MOVES) {
            moved++;
            if (w.puppet.motion < PUPPET_MOVES) frozen.push(`${name} (hands moved ${w.puppet.motion.toFixed(1)} while the hoster's moved ${w.hoster.motion.toFixed(1)}, hoster sit state ${seated})`);
            if (w.puppet.motion < PUPPET_MOVES && seated === 0) fails.push(`${name} on engine ${p} stands frozen (hands moved ${w.puppet.motion.toFixed(1)}) while the hoster's NPC, not seated, moves its hands ${w.hoster.motion.toFixed(1)}`);
          }
          if (w.hoster.dz >= ARMS_DOWN && w.puppet.dz < NOT_APOSE && w.puppet.motion < PUPPET_MOVES) {
            fails.push(`${name} on engine ${p} holds its arms up without moving (an A-pose): drop ${w.puppet.dz.toFixed(1)}, motion ${w.puppet.motion.toFixed(1)} while the hoster's arms hang (${w.hoster.dz.toFixed(1)})`);
          }
          if (Math.abs(w.hoster.hips - w.puppet.hips) > POSE_TOLERANCE) {
            fails.push(`${name} on engine ${p} does not hold the hoster's posture: hips ${w.puppet.hips.toFixed(1)} vs ${w.hoster.hips.toFixed(1)}`);
          } else if (seated === 3 && (await sitOf(id, p)) === 3) {
            const r = await reseat(id, p, w.hoster.hips);
            const hosterStill = (await sitOf(id, h)) === 3;
            ctx.evidence.push(`${name}: the puppet on engine ${p}, stood up by a script while the hoster sits, ${!r.up ? "did not stand up (not exercised)" : r.back !== undefined ? `sat again after ${(r.back / 1000).toFixed(1)} s` : `did not sit again within ${RESEAT_MS / 1000} s (hoster still seated ${hosterStill})`}`);
            if (r.up && r.back === undefined && hosterStill) fails.push(`${name} on engine ${p}, stood up by a script, did not sit again within ${RESEAT_MS / 1000} s while the hoster stayed seated`);
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
