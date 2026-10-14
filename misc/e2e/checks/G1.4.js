const BANDIT = 0x1ebf6;
const HOLD_MS = 31000;
const APPEARANCE = { isFemale: false, raceId: 0x13746, weight: 50, skinColor: -1, hairColor: -1, headpartIds: [], headTextureSetId: 0, options: new Array(19).fill(0), presets: new Array(4).fill(0), tints: [], name: "E2eBanditKiller" };

module.exports = {
  engines: 1,
  timeout: 12 * 60000,
  setup: async (ctx) => {
    const actor = await ctx.character(1);
    await ctx.probe(`mp.set(${actor}, "appearance", ${JSON.stringify(APPEARANCE)}); return 0;`);
  },
  async run(ctx) {
    const actor = await ctx.ready(1);
    const hex = (v) => (v >>> 0).toString(16);
    const npc = `const a = sp.Actor.from(sp.Game.getFormEx(${BANDIT}));`;
    const server = () => ctx.probe(`return { dead: !!mp.get(${BANDIT}, "isDead"), hoster: mp.get(${BANDIT}, "hoster") || 0, user: mp.getUserByActor(${actor}) };`);
    const local = () => ctx.drv(`${npc} return a ? { loaded: a.is3DLoaded(), dead: a.isDead(), disabled: a.isDisabled() } : null;`);
    const calm = `const p = sp.Game.getPlayer(); for (let i = 0; i < 300; i++) { const r = sp.Game.findRandomActor(p.getPositionX(), p.getPositionY(), p.getPositionZ(), 4096); if (r && r.getFormID() !== 0x14 && r.getFormID() !== ${BANDIT}) { r.setActorValue("Aggression", 0); r.stopCombat(); } } return 0;`;

    const base = await ctx.probe(`const n = mp.lookupEspmRecordById(${BANDIT}).record.fields.find((f) => f.type === "NAME").data; const b = (n[0] | (n[1] << 8) | (n[2] << 16) | (n[3] << 24)) >>> 0; return { id: b, editorId: mp.lookupEspmRecordById(b).record.editorId, type: mp.lookupEspmRecordById(b).record.type };`);
    const loc = await ctx.npcLocation(BANDIT);
    await ctx.probe(`mp.set(${actor}, "locationalData", ${JSON.stringify({ ...loc, pos: [loc.pos[0] + 300, loc.pos[1], loc.pos[2] + 50] })}); return 0;`);
    await ctx.waitFor(() => local().then((l) => !!l && l.loaded).catch(() => false), 120000, "the bandit is loaded");
    await ctx.drv(calm).catch(() => 0);
    await ctx.waitFor(() => server().then((s) => s.hoster === actor), 30000, "the client hosts the bandit");
    const before = await server();
    ctx.evidence.push(`bandit ${hex(BANDIT)} (base ${hex(base.id)} ${base.type} ${base.editorId}) in ${loc.cellOrWorldDesc} at ${loc.pos.map(Math.round)}; hosted by the player ${hex(before.hoster)}, server dead ${before.dead}`);
    ctx.assert.ok(!before.dead, "the bandit is already dead on the server");

    await ctx.drv(`${npc} a.kill(sp.Game.getPlayer()); return 0;`);
    const killedAt = Date.now();
    await ctx.waitFor(() => server().then((s) => s.dead), 15000, "the server has the bandit dead");
    let s = await server();
    let l = await local();
    while (Date.now() - killedAt < HOLD_MS && s.dead && l && l.dead) {
      await ctx.sleep(1000);
      s = await server();
      l = await local();
    }
    ctx.evidence.push(`${Math.round((Date.now() - killedAt) / 1000)} s after the kill: server dead ${s.dead}, client dead ${l && l.dead}, disabled ${l && l.disabled}`);
    ctx.shot("G1_4-dead");
    ctx.assert.ok(s.dead && l && l.dead, `the bandit did not stay dead for ${HOLD_MS / 1000} s (server ${s.dead}, client ${l && l.dead})`);

    await ctx.restartServer();
    const restarted = await server();
    await ctx.waitFor(() => server().then((x) => x.user < 65535).catch(() => false), 180000, "the client is online again after the restart");
    await ctx.waitFor(() => ctx.drv(`const p = sp.Game.getPlayer(); return !sp.Ui.isMenuOpen("Loading Menu") && !sp.Ui.isMenuOpen("RaceSex Menu") && !!p && p.is3DLoaded();`).catch(() => false), 180000, "the client is back in the world");
    await ctx.sleep(10000);
    const after = await server();
    const afterLocal = await local();
    ctx.evidence.push(`after a server kill and restart: server dead ${restarted.dead} at once, ${after.dead} 10 s after the client came back (user ${after.user}); client dead ${afterLocal && afterLocal.dead}, disabled ${afterLocal && afterLocal.disabled}`);
    ctx.shot("G1_4-restart");
    ctx.assert.ok(restarted.dead && after.dead, "the server lost the bandit's death after a restart");
    ctx.assert.ok(afterLocal && afterLocal.dead, "the client shows the bandit alive after the server restart");
  },
};
