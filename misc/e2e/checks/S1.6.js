const HADVAR = 0x2bfa2;
const ALVOR = 0x13482;
const MOVING = 20;
const HOLD_MS = 500;

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
      const loc = await ctx.probe(`return mp.get(${id}, "locationalData");`);
      for (const actor of actors) await ctx.probe(`mp.set(${actor}, "locationalData", ${JSON.stringify(loc)}); return 0;`);
      for (const n of [1, 2]) {
        await ctx.waitFor(() => ctx.drv(`const a = sp.Actor.from(sp.Game.getFormEx(${id})); return !sp.Ui.isMenuOpen("Loading Menu") && !!a && a.is3DLoaded();`, n).catch(() => false), 120000, `${id.toString(16)} is loaded on engine ${n}`);
      }
    };
    await teleport(ALVOR);
    await teleport(HADVAR);
    const hoster = await ctx.waitFor(() => ctx.probe(`return mp.get(${HADVAR}, "hoster");`), 30000, "Hadvar gets a hoster");
    const h = actors.indexOf(hoster) + 1;
    ctx.assert.ok(h > 0, `Hadvar hoster ${hoster.toString(16)} is not a player engine`);
    const p = 3 - h;
    await ctx.sleep(2000);

    const state = `const a = sp.Actor.from(sp.Game.getFormEx(${HADVAR})); return [a.getPositionX(), a.getPositionY(), a.getAnimationVariableFloat("Speed")];`;
    const samples = [];
    const stable = (s, test) => {
      const w = samples.filter((x) => x.t <= s.t && x.t >= s.t - HOLD_MS);
      return w[0].t <= s.t - 0.6 * HOLD_MS && w.every((x) => test(x.host[2]));
    };
    const movingOf = () => samples.filter((s) => stable(s, (v) => v > MOVING));
    const standingOf = () => samples.filter((s) => stable(s, (v) => v < 1));
    const sample = async (n) => {
      for (let i = 0; i < n; i++) {
        const [hs, ps] = await Promise.all([ctx.drv(state, h), ctx.drv(state, p)]);
        samples.push({ t: Date.now(), host: hs, puppet: ps });
        await ctx.sleep(300);
      }
    };
    for (const [dx, dy] of [[600, 0], [-600, 0], [0, 600], [0, -600], [600, 0], [-600, 0]]) {
      if (movingOf().length >= 10 && standingOf().length >= 10) break;
      await ctx.drv(`const a = sp.Actor.from(sp.Game.getFormEx(${HADVAR})); const pl = sp.Game.getPlayer(); pl.setPosition(a.getPositionX() + ${dx}, a.getPositionY() + ${dy}, a.getPositionZ()); return 0;`, h);
      await ctx.sleep(500);
      await ctx.drv(`sp.Actor.from(sp.Game.getFormEx(${HADVAR})).pathToReference(sp.Game.getPlayer(), 1); return 0;`, h);
      await sample(20);
      await ctx.drv(`sp.Actor.from(sp.Game.getFormEx(${HADVAR})).moveTo(sp.Actor.from(sp.Game.getFormEx(${HADVAR})), 0, 0, 0, false); return 0;`, h);
      await sample(10);
    }
    const moving = movingOf();
    const animated = moving.filter((s) => s.puppet[2] > MOVING);
    const standing = standingOf();
    const idle = standing.filter((s) => s.puppet[2] < MOVING);
    const pathOf = (k) => samples.reduce((d, s, i) => i ? d + Math.hypot(s[k][0] - samples[i - 1][k][0], s[k][1] - samples[i - 1][k][1]) : 0, 0);
    const walked = pathOf("host");
    const puppetWalked = pathOf("puppet");
    ctx.evidence.push(`hoster engine ${h}, Hadvar walked ${walked.toFixed(0)} units on the hoster and ${puppetWalked.toFixed(0)} on the puppet; ${moving.length} samples with hoster Speed > ${MOVING} for ${HOLD_MS} ms, puppet Speed > ${MOVING} in ${animated.length}; ${standing.length} samples with hoster Speed < 1 for ${HOLD_MS} ms, puppet Speed < ${MOVING} in ${idle.length}`);
    ctx.evidence.push(`Speed pairs (hoster/puppet): ${samples.map((s) => `${Math.round(s.host[2])}/${Math.round(s.puppet[2])}`).join(" ")}`);
    ctx.shot("S1_6-puppet", p);
    ctx.assert.ok(walked > 300, `Hadvar walked only ${walked.toFixed(0)} units on the hoster`);
    ctx.assert.ok(puppetWalked > 0.5 * walked, `the puppet moved only ${puppetWalked.toFixed(0)} of ${walked.toFixed(0)} units`);
    ctx.assert.ok(moving.length >= 10, `only ${moving.length} moving samples`);
    ctx.assert.ok(animated.length >= 0.8 * moving.length, `puppet animated in ${animated.length} of ${moving.length} moving samples`);
    ctx.assert.ok(standing.length >= 10, `only ${standing.length} standing samples`);
    ctx.assert.ok(idle.length >= 0.8 * standing.length, `puppet idle in ${idle.length} of ${standing.length} standing samples`);
  },
};
