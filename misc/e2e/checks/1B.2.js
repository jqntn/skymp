const ALVOR = 0x13482;

module.exports = {
  engines: 2,
  timeout: 8 * 60000,
  setup: async (ctx) => {
    await ctx.character(1);
    await ctx.character(2);
  },
  async run(ctx) {
    const actors = [await ctx.ready(1), await ctx.ready(2)];
    const npc = `const a = sp.Actor.from(sp.Game.getFormEx(${ALVOR}));`;
    const loaded = `${npc} return !sp.Ui.isMenuOpen("Loading Menu") && !!a && a.is3DLoaded();`;
    const loc = await ctx.probe(`return mp.get(${ALVOR}, "locationalData");`);
    const away = await ctx.probe(`return mp.get(${actors[1]}, "locationalData");`);
    await ctx.probe(`mp.set(${actors[1]}, "locationalData", ${JSON.stringify(loc)}); return 0;`);
    await ctx.waitFor(() => ctx.drv(loaded, 2).catch(() => false), 120000, "Alvor is loaded on engine 2");
    await ctx.waitFor(async () => (await ctx.probe(`return mp.get(${ALVOR}, "hoster");`)) === actors[1], 30000, "engine 2 hosts Alvor");
    await ctx.probe(`mp.set(${actors[0]}, "locationalData", ${JSON.stringify(loc)}); return 0;`);
    await ctx.waitFor(() => ctx.drv(loaded, 1).catch(() => false), 120000, "Alvor is loaded on engine 1");
    await ctx.sleep(4000);
    ctx.assert.equal(await ctx.probe(`return mp.get(${ALVOR}, "hoster");`), actors[1], "engine 2 lost the host");

    const state = `${npc} return { damageMult: a.getActorValue("attackDamageMult"), ai: a.isAIEnabled(), blocked: a.isActivationBlocked(), dead: a.isDead(), health: a.getActorValue("health") };`;
    const puppet = await ctx.drv(state, 1);
    const hoster = await ctx.drv(state, 2);
    const healthAfterHit = await ctx.drv(`${npc} a.damageActorValue("health", 100000); return a.getActorValue("health");`, 1);
    await ctx.sleep(2000);
    const hit = { ...(await ctx.drv(state, 1)), healthAfterHit };
    const serverDead = await ctx.probe(`return mp.get(${ALVOR}, "isDead");`);
    ctx.evidence.push(`puppet on engine 1: ${JSON.stringify(puppet)}; hoster engine 2: ${JSON.stringify(hoster)}; puppet after 100000 local damage: ${JSON.stringify(hit)}; server isDead ${serverDead}`);

    await ctx.probe(`mp.set(${actors[1]}, "locationalData", ${JSON.stringify(away)}); return 0;`);
    const newHoster = await ctx.waitFor(async () => (await ctx.probe(`return mp.get(${ALVOR}, "hoster");`)) === actors[0], 30000, "engine 1 takes the host").catch(() => false);
    await ctx.sleep(3000);
    const taken = await ctx.drv(state, 1);
    const serverDeadAfter = await ctx.probe(`return mp.get(${ALVOR}, "isDead");`);
    ctx.evidence.push(`engine 2 leaves; engine 1 hosts the damaged puppet: ${!!newHoster}; Alvor on engine 1 now ${JSON.stringify(taken)}; server isDead ${serverDeadAfter}`);

    ctx.assert.equal(puppet.damageMult, 0, "the puppet deals damage");
    ctx.assert.ok(!puppet.ai && !puppet.blocked, "the puppet has AI or blocked activation");
    ctx.assert.ok(healthAfterHit <= 0, `the local damage did not take the puppet's health to 0 (${healthAfterHit})`);
    ctx.assert.ok(!hit.dead, "the puppet died from local damage");
    ctx.assert.ok(hoster.damageMult > 0 && hoster.ai && !hoster.blocked, "the hosted actor lost its damage, AI, or activation");
    ctx.assert.equal(serverDead, false, "the server killed Alvor");
    ctx.assert.ok(newHoster, "engine 1 did not take the host after engine 2 left");
    ctx.assert.ok(!taken.dead && taken.health > 0, "the damaged puppet died when it became the hosted actor");
    ctx.assert.equal(taken.damageMult, hoster.damageMult, "the damage mult was not restored when the puppet became the hosted actor");
    ctx.assert.ok(taken.ai, "the new hosted actor has no AI");
    ctx.assert.equal(serverDeadAfter, false, "the server killed Alvor after the host switch");
  },
};
