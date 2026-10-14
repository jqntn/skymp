const HADVAR = 0x2bfa2;
const ALVOR = 0x13482;
const ROAD = [17000, -47100, -105];
const STOPS = [[17600, -47120, -120], [16400, -47060, -30]];
const MOVING = 20;
const HOLD_MS = 500;
const SWING_RATIO = 1 / 3;
const MIN_HOSTER_SWING = 20;
const MIN_STRETCH = 5;

module.exports = {
  engines: 2,
  timeout: 10 * 60000,
  setup: async (ctx) => {
    await ctx.character(1);
    await ctx.character(2);
  },
  async run(ctx) {
    const actors = [await ctx.ready(1), await ctx.ready(2)];
    const teleport = async (id) => {
      const loc = await ctx.npcLocation(id);
      for (const actor of actors) await ctx.probe(`mp.set(${actor}, "locationalData", ${JSON.stringify(loc)}); return 0;`);
      for (const n of [1, 2]) {
        await ctx.waitFor(() => ctx.drv(`const a = sp.Actor.from(sp.Game.getFormEx(${id})); return !sp.Ui.isMenuOpen("Loading Menu") && !!a && a.is3DLoaded();`, n).catch(() => false), 120000, `${id.toString(16)} is loaded on engine ${n}`);
      }
    };
    await ctx.probe(`mp.set(${HADVAR}, "locationalData", { cellOrWorldDesc: "3c:Skyrim.esm", pos: ${JSON.stringify(ROAD)}, rot: [0, 0, 0] }); return 0;`);
    for (const n of [1, 2]) await ctx.drv(`const a = sp.Actor.from(sp.Game.getFormEx(${HADVAR})); const w = sp.Game.getFormEx(0x3c); sp.TESModPlatform.moveRefrToPosition(a, sp.Cell.from(w), sp.WorldSpace.from(w), ${ROAD.join(", ")}, 0, 0, 0); return 0;`, n);
    await teleport(ALVOR);
    await teleport(HADVAR);
    const hoster = await ctx.waitFor(() => ctx.probe(`return mp.get(${HADVAR}, "hoster");`), 30000, "Hadvar gets a hoster");
    const h = actors.indexOf(hoster) + 1;
    ctx.assert.ok(h > 0, `Hadvar hoster ${hoster.toString(16)} is not a player engine`);
    const p = 3 - h;
    const calm = `const p = sp.Game.getPlayer(); for (let i = 0; i < 300; i++) { const r = sp.Game.findRandomActor(p.getPositionX(), p.getPositionY(), p.getPositionZ(), 4096); if (r && r.getFormID() !== 0x14 && r.isAIEnabled()) { r.setActorValue("Aggression", 0); r.stopCombat(); } } return 0;`;
    await Promise.all([ctx.drv(calm, 1), ctx.drv(calm, 2)]);
    await ctx.sleep(2000);

    const state = `const a = sp.Actor.from(sp.Game.getFormEx(${HADVAR})); const pl = sp.Game.getPlayer(); pl.setAngle(0, 0, pl.getAngleZ() + pl.getHeadingAngle(a)); const N = sp.NetImmerse; const t = a.getAngleZ() * Math.PI / 180; const f = (b) => N.getNodeWorldPositionX(a, b, false) * Math.sin(t) + N.getNodeWorldPositionY(a, b, false) * Math.cos(t); return [a.getPositionX(), a.getPositionY(), a.getAnimationVariableFloat("Speed"), f("NPC L Foot [Lft ]") - f("NPC R Foot [Rft ]")];`;
    const samples = [];
    const stable = (s, test) => {
      const w = samples.filter((x) => x.t <= s.t && x.t >= s.t - HOLD_MS);
      return w[0].t <= s.t - 0.6 * HOLD_MS && w.every((x) => test(x.host[2]));
    };
    const movingOf = () => samples.filter((s) => stable(s, (v) => v > MOVING));
    const standingOf = () => samples.filter((s) => stable(s, (v) => v < 1));
    const flee = `const a = sp.Actor.from(sp.Game.getFormEx(${HADVAR})); a.setDontMove(false); if (!a.isInCombat()) { a.setActorValue("Confidence", 0); a.startCombat(sp.Game.getPlayer()); } return 0;`;
    const sample = async (n, kick) => {
      for (let i = 0; i < n; i++) {
        if (kick) await ctx.drv(kick, h);
        const [hs, ps] = await Promise.all([ctx.drv(state, h), ctx.drv(state, p)]);
        samples.push({ t: Date.now(), host: hs, puppet: ps });
        await ctx.sleep(300);
      }
    };
    const pathOf = (k) => samples.reduce((d, s, i) => i ? d + Math.hypot(s[k][0] - samples[i - 1][k][0], s[k][1] - samples[i - 1][k][1]) : 0, 0);
    for (let i = 0; i < 10; i++) {
      if (movingOf().length >= 10 && standingOf().length >= 10 && pathOf("host") > 300) break;
      const [x, y, z] = STOPS[i % STOPS.length];
      await ctx.drv(`sp.Game.getPlayer().setPosition(${x}, ${y}, ${z}); return 0;`, h);
      await ctx.sleep(500);
      await sample(20, flee);
      await ctx.drv(`const a = sp.Actor.from(sp.Game.getFormEx(${HADVAR})); a.stopCombat(); a.setDontMove(true); return 0;`, h);
      await sample(10);
    }
    const moving = movingOf();
    const animated = moving.filter((s) => s.puppet[2] > MOVING);
    const standing = standingOf();
    const idle = standing.filter((s) => s.puppet[2] < MOVING);
    const stretchesOf = (xs) => {
      const set = new Set(xs);
      const out = [[]];
      for (const s of samples) set.has(s) ? out[out.length - 1].push(s) : out[out.length - 1].length && out.push([]);
      return out.filter((x) => x.length >= MIN_STRETCH);
    };
    const swingIn = (k, xs) => xs.slice(1).reduce((d, s, i) => d + Math.abs(s[k][3] - xs[i][k][3]), 0) / (xs.length - 1);
    const legs = stretchesOf(moving).map((xs) => ({ n: xs.length, host: swingIn("host", xs), puppet: swingIn("puppet", xs) }));
    const still = stretchesOf(standing).map((xs) => ({ n: xs.length, host: swingIn("host", xs), puppet: swingIn("puppet", xs) }));
    const walked = pathOf("host");
    const puppetWalked = pathOf("puppet");
    const st = await ctx.drv(`const a = sp.Actor.from(sp.Game.getFormEx(${HADVAR})); const k = a.getCurrentPackage(); const sc = a.getCurrentScene(); return { ai: a.isAIEnabled(), combat: a.isInCombat(), pkg: k ? k.getFormID().toString(16) : 0, sit: a.getSitState(), scene: sc ? sc.getFormID().toString(16) : 0, dialogue: a.isInDialogueWithPlayer() };`, h);
    const puppetAi = await ctx.drv(`return sp.Actor.from(sp.Game.getFormEx(${HADVAR})).isAIEnabled();`, p);
    ctx.evidence.push(`Hadvar on the hoster after the moves: ${JSON.stringify(st)}; puppet AI on: ${puppetAi}`);
    ctx.evidence.push(`hoster engine ${h}, Hadvar walked ${walked.toFixed(0)} units on the hoster and ${puppetWalked.toFixed(0)} on the puppet; ${moving.length} samples with hoster Speed > ${MOVING} for ${HOLD_MS} ms, puppet Speed > ${MOVING} in ${animated.length}; ${standing.length} samples with hoster Speed < 1 for ${HOLD_MS} ms, puppet Speed < ${MOVING} in ${idle.length}`);
    const fmt = (xs) => xs.map((l) => `${l.n} samples: hoster ${l.host.toFixed(1)}, puppet ${l.puppet.toFixed(1)}`).join("; ") || "none";
    ctx.evidence.push(`foot swing (mean change of the left foot minus the right foot along the heading between consecutive samples) per moving stretch: ${fmt(legs)}; per standing stretch: ${fmt(still)}`);
    ctx.evidence.push(`foot stride pairs (hoster/puppet): ${samples.map((s) => `${Math.round(s.host[3])}/${Math.round(s.puppet[3])}`).join(" ")}`);
    ctx.evidence.push(`Speed pairs (hoster/puppet): ${samples.map((s) => `${Math.round(s.host[2])}/${Math.round(s.puppet[2])}`).join(" ")}`);
    ctx.shot("S1_6-puppet", p);
    ctx.assert.ok(walked > 300, `Hadvar walked only ${walked.toFixed(0)} units on the hoster`);
    ctx.assert.ok(puppetAi === false, `the puppet Hadvar on engine ${p} has its own AI on`);
    ctx.assert.ok(puppetWalked > 0.5 * walked, `the puppet moved only ${puppetWalked.toFixed(0)} of ${walked.toFixed(0)} units`);
    ctx.assert.ok(moving.length >= 10, `only ${moving.length} moving samples`);
    ctx.assert.ok(animated.length >= 0.8 * moving.length, `puppet animated in ${animated.length} of ${moving.length} moving samples`);
    const measured = legs.filter((l) => l.host >= MIN_HOSTER_SWING);
    ctx.assert.ok(measured.length > 0, `no moving stretch of ${MIN_STRETCH} samples where the hoster's feet swing ${MIN_HOSTER_SWING} or more, so the foot measure does not work: ${fmt(legs)}`);
    const sliding = measured.filter((l) => l.puppet < SWING_RATIO * l.host);
    ctx.assert.ok(!sliding.length, `the puppet does not play the moving animation in ${sliding.length} of ${measured.length} moving stretches: ${fmt(sliding)}`);
    ctx.assert.ok(standing.length >= 10, `only ${standing.length} standing samples`);
    ctx.assert.ok(idle.length >= 0.8 * standing.length, `puppet idle in ${idle.length} of ${standing.length} standing samples`);
  },
};
