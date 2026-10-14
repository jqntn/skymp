const BANDIT = 0x1ebf6;
const MENU = "ContainerMenu";

module.exports = {
  engines: 2,
  timeout: 15 * 60000,
  setup: async (ctx) => {
    await ctx.character(1);
    await ctx.character(2);
  },
  async run(ctx) {
    const actors = [await ctx.ready(1), await ctx.ready(2)];
    const hex = (v) => (v >>> 0).toString(16);
    const npc = `const a = sp.Actor.from(sp.Game.getFormEx(${BANDIT}));`;
    const calm = `const p = sp.Game.getPlayer(); for (let i = 0; i < 300; i++) { const r = sp.Game.findRandomActor(p.getPositionX(), p.getPositionY(), p.getPositionZ(), 4096); if (r && r.getFormID() !== 0x14 && r.getFormID() !== ${BANDIT}) { r.setActorValue("Aggression", 0); r.stopCombat(); } } return 0;`;
    const server = () => ctx.probe(`return { dead: !!mp.get(${BANDIT}, "isDead"), hoster: mp.get(${BANDIT}, "hoster") || 0, inv: (mp.get(${BANDIT}, "inventory") || { entries: [] }).entries };`);
    const serverCount = (ref, item) => ctx.probe(`return ((mp.get(${ref}, "inventory") || { entries: [] }).entries).filter((e) => e.baseId === ${item}).reduce((s, e) => s + e.count, 0);`);
    const localItems = (n) => ctx.drv(`${npc} const r = []; for (let i = 0; i < a.getNumItems(); i++) { const f = a.getNthForm(i); if (f) r.push({ baseId: f.getFormID(), count: a.getItemCount(f), type: f.getType(), name: f.getName() }); } return r;`, n);
    const corpseCount = (n, item) => ctx.drv(`${npc} return a.getItemCount(sp.Game.getFormEx(${item}));`, n);
    const playerCount = (n, item) => ctx.drv(`return sp.Game.getPlayer().getItemCount(sp.Game.getFormEx(${item}));`, n);
    const loaded = (n) => ctx.waitFor(() => ctx.drv(`${npc} return !sp.Ui.isMenuOpen("Loading Menu") && !!a && a.is3DLoaded();`, n).catch(() => false), 120000, `the bandit is loaded on engine ${n}`);

    const loc = await ctx.npcLocation(BANDIT, 2);
    await ctx.probe(`mp.set(${actors[1]}, "locationalData", ${JSON.stringify({ ...loc, pos: [loc.pos[0] + 300, loc.pos[1], loc.pos[2] + 50] })}); return 0;`);
    await loaded(2);
    await ctx.drv(calm, 2).catch(() => 0);
    await ctx.waitFor(() => server().then((s) => s.hoster === actors[1]), 60000, "engine 2 hosts the bandit");
    const at = await ctx.npcLocation(BANDIT, 2);
    await ctx.probe(`mp.set(${actors[0]}, "locationalData", ${JSON.stringify({ ...at, pos: [at.pos[0] - 300, at.pos[1], at.pos[2] + 50] })}); return 0;`);
    await loaded(1);
    await ctx.drv(calm, 1).catch(() => 0);
    const before = await server();
    ctx.evidence.push(`bandit ${hex(BANDIT)} in ${loc.cellOrWorldDesc}, hoster ${hex(before.hoster)} (engine 1's player ${hex(actors[0])}, engine 2's ${hex(actors[1])}), server dead ${before.dead}`);
    ctx.assert.ok(!before.dead, "the bandit is already dead on the server");
    ctx.assert.equal(before.hoster, actors[1], "engine 2 does not host the bandit once engine 1 is there");

    await ctx.drv(`${npc} a.kill(sp.Game.getPlayer()); return 0;`, 2);
    await ctx.waitFor(() => server().then((s) => s.dead), 15000, "the server has the bandit dead");
    await ctx.waitFor(() => ctx.drv(`${npc} return a.isDead();`, 1), 15000, "engine 1 shows the bandit dead");
    await ctx.sleep(3000);
    const dead = await server();
    ctx.evidence.push(`after engine 2 killed it: hoster ${hex(dead.hoster)}, server inventory ${JSON.stringify(dead.inv.map((e) => `${hex(e.baseId)} x${e.count}${e.worn ? " worn" : ""}`))}`);
    const items2 = await localItems(2);
    ctx.evidence.push(`engine 2 corpse inventory ${JSON.stringify(items2.map((e) => `${hex(e.baseId)} ${e.name} x${e.count}`))}`);
    const stock = dead.inv.filter((e) => e.count > 0);
    const pick = stock.find((e) => e.baseId !== 0xf) || stock[0];
    ctx.assert.ok(pick, "the corpse is empty on the server");
    const item = pick.baseId;
    const name = await ctx.drv(`const f = sp.Game.getFormEx(${item}); return f ? f.getName() : "";`, 1);
    const start = { server: await serverCount(BANDIT, item), player: await serverCount(actors[0], item), engine1: await playerCount(1, item), engine2: await corpseCount(2, item) };

    const openCorpse = async (n) => {
      await ctx.drv(`${npc} const p = sp.Game.getPlayer(); p.setPosition(a.getPositionX() + ${n === 1 ? 80 : -80}, a.getPositionY(), a.getPositionZ() + 20); return 0;`, n);
      await ctx.sleep(1500);
      let opened = false;
      for (let attempt = 0; attempt < 2 && !opened; attempt++) {
        await ctx.drv(`${npc} a.activate(sp.Game.getPlayer(), false); return 0;`, n);
        opened = await ctx.waitFor(() => ctx.drv(`return sp.Ui.isMenuOpen("${MENU}");`, n), 10000, `the corpse opens on engine ${n}`).catch(() => false);
      }
      ctx.evidence.push(`engine ${n} opens the corpse: ${opened}`);
      return opened;
    };
    const closeCorpse = async (n) => {
      await ctx.drv(`sp.TESModPlatform.closeMenu("${MENU}"); return 0;`, n).catch((e) => ctx.evidence.push(`closeMenu on engine ${n}: ${e.message}`));
      await ctx.waitFor(() => ctx.drv(`return !sp.Ui.isMenuOpen("${MENU}");`, n), 10000, `the corpse closes on engine ${n}`).catch(() => {});
    };

    const fails = [];
    const open = await openCorpse(1);
    if (open) {
      await ctx.sleep(1500);
      const shownCount = await corpseCount(1, item);
      const take = await server();
      ctx.evidence.push(`engine 1 corpse shows ${hex(item)} ${name} x${shownCount}; hoster at the take ${hex(take.hoster)}`);
      if (shownCount !== start.server) fails.push(`engine 1's loot menu shows ${shownCount} of the item, the server ${start.server}`);
      if (take.hoster !== actors[1]) fails.push(`the bandit is hosted by ${hex(take.hoster)} at the take, not by engine 2`);
      ctx.shot("2A_1-open", 1);
      const taken = await ctx.drv(`${npc} if (!sp.Ui.isMenuOpen("${MENU}")) return false; a.removeItem(sp.Game.getFormEx(${item}), 1, true, sp.Game.getPlayer()); return true;`, 1);
      if (!taken) fails.push("the loot menu closed on engine 1 before the take");
      await ctx.sleep(2000);
      await closeCorpse(1);
    }
    await ctx.sleep(5000);
    const end = { server: await serverCount(BANDIT, item), player: await serverCount(actors[0], item), engine1: await playerCount(1, item), engine2: await corpseCount(2, item) };
    const open2 = await openCorpse(2);
    if (open2) {
      await ctx.sleep(1500);
      end.engine2Menu = await corpseCount(2, item);
      ctx.shot("2A_1-engine2", 2);
      await closeCorpse(2);
      await ctx.sleep(3000);
    }
    const after = { server: await serverCount(BANDIT, item), player: await serverCount(actors[0], item) };
    ctx.evidence.push(`item ${hex(item)} ${name}: corpse on the server ${start.server} -> ${end.server} (${after.server} after engine 2 reopened it), on engine 2 ${start.engine2} -> ${end.engine2} (${end.engine2Menu} with its loot menu open after the take); engine 1's player on the server ${start.player} -> ${end.player} (${after.player} after the reopen), on engine 1 ${start.engine1} -> ${end.engine1}`);

    if (!open) fails.push("engine 1 cannot open the corpse");
    if (end.engine1 !== start.engine1 + 1) fails.push(`engine 1's player has ${end.engine1} of the item, expected ${start.engine1 + 1}`);
    if (end.player !== start.player + 1) fails.push(`the server gives engine 1's player ${end.player} of the item, expected ${start.player + 1}`);
    if (end.server !== start.server - 1) fails.push(`the corpse on the server has ${end.server} of the item, expected ${start.server - 1}`);
    if (start.engine2 !== start.server) fails.push(`before the take, the corpse on engine 2 has ${start.engine2} of the item, the server ${start.server}`);
    if (end.engine2 !== end.server || end.engine2 !== start.engine2 - 1) fails.push(`after the take, the corpse on engine 2 has ${end.engine2} of the item (before ${start.engine2}), the server ${end.server}`);
    if (!open2) fails.push("engine 2 cannot open the corpse after the take");
    else if (end.engine2Menu !== end.server) fails.push(`engine 2's loot menu shows ${end.engine2Menu} of the item, the server ${end.server}`);
    if (after.server !== end.server || after.player !== end.player) fails.push(`engine 2's reopen changed the server: corpse ${end.server} -> ${after.server}, engine 1's player ${end.player} -> ${after.player}`);
    ctx.assert.ok(!fails.length, fails.join("; "));
  },
};
