const BANDIT = 0x1ebf6;
const CLEAR_MS = 5000;
const KEEP_MS = 10000;
const INTERIOR = { cellOrWorldDesc: "165a8:Skyrim.esm", pos: [-803, 386, 320], rot: [0, 0, 0] };
const APPEARANCE = { isFemale: false, raceId: 0x13746, weight: 50, skinColor: -1, hairColor: -1, headpartIds: [], headTextureSetId: 0, options: new Array(19).fill(0), presets: new Array(4).fill(0), tints: [], name: "E2eHoster" };

module.exports = {
  engines: 1,
  timeout: 15 * 60000,
  setup: async (ctx) => {
    const actor = await ctx.character(1);
    await ctx.probe(`mp.set(${actor}, "appearance", ${JSON.stringify(APPEARANCE)}); return 0;`);
  },
  async run(ctx) {
    const actor = await ctx.ready(1);
    const hex = (v) => (v >>> 0).toString(16);
    const npc = `const a = sp.Actor.from(sp.Game.getFormEx(${BANDIT}));`;
    const server = () => ctx.probe(`const l = mp.get(${BANDIT}, "locationalData"); return { hoster: mp.get(${BANDIT}, "hoster") || 0, dead: !!mp.get(${BANDIT}, "isDead"), health: mp.get(${BANDIT}, "percentages").health, cell: l.cellOrWorldDesc, pos: l.pos.map(Math.round) };`);
    const heal = () => ctx.probe(`mp.set(${actor}, "percentages", { health: 1, magicka: 1, stamina: 1 }); return 0;`).catch(() => 0);
    const dist = (a, b) => Math.round(Math.hypot(...a.pos.map((v, i) => v - b.pos[i])));
    const loc = await ctx.npcLocation(BANDIT);
    const near = { ...loc, pos: [loc.pos[0] + 300, loc.pos[1], loc.pos[2] + 50] };
    const fails = [];
    const goNear = async () => {
      await ctx.probe(`mp.set(${actor}, "locationalData", ${JSON.stringify(near)}); return 0;`);
      await ctx.waitFor(() => ctx.drv(`${npc} return !sp.Ui.isMenuOpen("Loading Menu") && !!a && a.is3DLoaded();`).catch(() => false), 120000, "the bandit is loaded");
      return ctx.waitFor(async () => (await heal(), (await server()).hoster === actor), 30000, "the client hosts the bandit").then(() => true).catch(() => false);
    };
    const wound = async () => {
      const h0 = (await server()).health;
      await ctx.drv(`${npc} a.damageActorValue("Health", a.getActorValue("Health") * 0.5); return 0;`).catch(() => 0);
      return ctx.waitFor(async () => (await server()).health < Math.min(0.9, h0 - 0.1), 10000, "the server has the bandit wounded").then(() => true).catch(() => false);
    };
    const loss = async (label, cause) => {
      const last = await server();
      ctx.assert.ok(last.hoster === actor && last.health < 0.9, `not exercised: before the ${label} the hoster is ${hex(last.hoster)} and the bandit's health ${last.health}`);
      const at = Date.now();
      await cause();
      let s = await server();
      while (s.hoster !== 0 && Date.now() - at < CLEAR_MS + 25000) {
        await ctx.sleep(250);
        s = await server();
      }
      const clearedAfter = s.hoster === 0 ? Date.now() - at : null;
      await ctx.sleep(KEEP_MS);
      const kept = await server();
      ctx.evidence.push(`${label}: before ${JSON.stringify(last)}; hoster cleared ${clearedAfter === null ? "never in 30 s" : `${(clearedAfter / 1000).toFixed(1)} s`} after, then ${JSON.stringify(s)}; ${KEEP_MS / 1000} s later ${JSON.stringify(kept)} (moved ${dist(last, kept)} from before, ${dist(s, kept)} from the clear)`);
      if (clearedAfter === null || clearedAfter > CLEAR_MS) fails.push(`${label}: the server cleared the hoster ${clearedAfter === null ? "not within 30 s" : `after ${(clearedAfter / 1000).toFixed(1)} s`}, not within ${CLEAR_MS / 1000} s`);
      if (kept.dead !== s.dead || kept.cell !== s.cell || dist(s, kept) > 50 || Math.abs(kept.health - s.health) > 0.05) fails.push(`${label}: the NPC did not keep its last state (${JSON.stringify(last)} -> clear ${JSON.stringify(s)} -> ${JSON.stringify(kept)})`);
    };

    ctx.assert.ok(await goNear(), "not exercised: the client did not host the bandit");
    await wound();
    await loss("cell change", () => ctx.probe(`mp.set(${actor}, "locationalData", ${JSON.stringify(INTERIOR)}); return 0;`));

    ctx.assert.ok(await goNear(), "not exercised: the client did not host the bandit again");
    const fighting = await ctx.waitFor(async () => (await heal(), ctx.drv(`${npc} return a.getCombatState() === 1;`).catch(() => false)), 30000, "the bandit fights the player").then(() => true).catch(() => false);
    ctx.evidence.push(`the bandit fights the hoster ${fighting}`);
    ctx.assert.ok(fighting, "not exercised: the bandit is not in combat with its hoster");
    await wound();
    await loss("the hoster closes the game in combat", () => ctx.drv("sp.Debug.quitGame(); return 0;").catch(() => 0));

    ctx.assert.ok(!fails.length, fails.join("; "));
    throw new ctx.Blocked("the hoster leaves the party: a player who leaves a party is still in the world and near the NPC, so it is not clear which NPCs the server must take from him (the user decides: (a) the server clears his hosts of quest-alias actors of the party's shared quests, (b) it clears all his hosts, which he claims again at once since nobody yields to him, or (c) leaving the party is not a hoster loss)");
  },
};
