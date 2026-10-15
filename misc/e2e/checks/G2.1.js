const fs = require("fs");
const path = require("path");
const MS13 = 0x39645;
const BOT_PROFILE = 920101;
const ARVEL = 0x39655;
const CLAW = 0x39647;
const CLAW_ALIAS = 11;
const MENU = "ContainerMenu";

module.exports = {
  engines: 1,
  timeout: 12 * 60000,
  setup: (ctx) => ctx.character(1),
  async run(ctx) {
    const actor = await ctx.ready(1);
    const hex = (v) => (v >>> 0).toString(16);
    const npc = `const a = sp.Actor.from(sp.Game.getFormEx(${ARVEL}));`;
    const claw = `sp.Game.getFormEx(${CLAW})`;
    const quest = `sp.Quest.from(sp.Game.getFormEx(${MS13}))`;
    const aliasRef = () => ctx.drv(`const id = sp.getQuestAliasReference(${MS13}, ${CLAW_ALIAS}); const r = id ? sp.ObjectReference.from(sp.Game.getFormEx(id)) : null;
      return { id, quests: id ? sp.getReferenceAliasQuests(id) : [], deleted: !r || r.isDeleted(), inArvel: sp.getInventoryReferences(${ARVEL}).some((l) => l.ref === id && l.baseId === ${CLAW}), inPlayer: sp.getInventoryReferences(0x14).some((l) => l.ref === id && l.baseId === ${CLAW}) };`);
    const where = (a) => `${hex(a.id)} (alias quests ${JSON.stringify(a.quests.map(hex))}, deleted ${a.deleted}, in Arvel's inventory ${a.inArvel}, in the player's ${a.inPlayer})`;
    const serverClaws = (ref) => ctx.probe(`return ((mp.get(${ref}, "inventory") || { entries: [] }).entries).filter((e) => e.baseId === ${CLAW}).reduce((s, e) => s + e.count, 0);`);

    await ctx.waitFor(() => ctx.probe(`const l = mp.get(${actor}, "private.questLog"); return Array.isArray(l) && l.length > 0;`), 60000, "the client reports quest stages");
    const base = await ctx.probe(`return mp.get(${actor}, "locationalData");`);
    const member = await ctx.probe(`const bot = mp.createBot(); globalThis.g21bot = bot;
      bot.send({ t: 1, contentJsonDump: JSON.stringify({ customPacketType: "loginWithSkympIo", gameData: { profileId: ${BOT_PROFILE} } }) });
      await new Promise((r) => setTimeout(r, 800));
      const a = mp.getUserActor(bot.getUserId());
      mp.set(a, "locationalData", ${JSON.stringify({ ...base, pos: [base.pos[0] + 200, base.pos[1], base.pos[2]] })});
      return a;`);
    ctx.assert.ok(member, "the bot member got no actor");
    await ctx.drv(`sp.mpClientPlugin.send(JSON.stringify({ t: 1, contentJsonDump: JSON.stringify({ customPacketType: "partyInvite", target: ${member} }) }), true); return 0;`);
    await ctx.sleep(1000);
    await ctx.probe(`globalThis.g21bot.send({ t: 1, contentJsonDump: JSON.stringify({ customPacketType: "partyAccept", inviter: ${actor} }) }); return 0;`);
    const joined = await ctx.waitFor(() => fs.readFileSync(path.join(ctx.dir, "server.log"), "utf8").includes(`Coop: ${hex(member)} joined party`), 15000, "the bot joins the leader's party").then(() => true).catch(() => false);
    ctx.assert.ok(joined, "the bot member did not join the leader's party");
    const memberLog = () => ctx.probe(`return mp.get(${member}, "private.questLog") || [];`);
    const running = await ctx.drv(`return ${quest}.setCurrentStageID(10);`).then(() => ctx.waitFor(() => ctx.drv(`return ${quest}.isRunning();`), 30000, "MS13 runs on the client")).catch(() => false);
    ctx.assert.ok(running, "MS13 does not run on the client");
    const loc = await ctx.npcLocation(ARVEL);
    await ctx.probe(`mp.set(${actor}, "locationalData", ${JSON.stringify({ ...loc, pos: [loc.pos[0] + 100, loc.pos[1], loc.pos[2] + 30] })}); return 0;`);
    await ctx.probe(`mp.set(${member}, "locationalData", ${JSON.stringify({ ...loc, pos: [loc.pos[0] + 250, loc.pos[1], loc.pos[2] + 30] })}); return 0;`);
    await ctx.waitFor(() => ctx.drv(`${npc} return !sp.Ui.isMenuOpen("Loading Menu") && !!a && a.is3DLoaded();`).catch(() => false), 120000, "Arvel is loaded");
    await ctx.waitFor(() => ctx.probe(`return mp.get(${ARVEL}, "hoster") === ${actor};`), 60000, "the client hosts Arvel");
    await ctx.waitFor(() => serverClaws(ARVEL).then((n) => n > 0), 15000, "the server creates the claw in Arvel").catch(() => {});
    const start = { stage: await ctx.drv(`return ${quest}.getCurrentStageID();`), arvel: await ctx.drv(`${npc} return a.getItemCount(${claw});`), server: await serverClaws(ARVEL), alias: await aliasRef() };
    ctx.evidence.push(`MS13 stage ${start.stage}; Arvel ${hex(ARVEL)} in ${loc.cellOrWorldDesc} holds ${start.arvel} Golden Claw on the client, ${start.server} on the server; GoldenClaw alias ref ${where(start.alias)}`);
    ctx.assert.ok(start.alias.id && start.alias.quests.includes(MS13) && start.alias.inArvel, "the GoldenClaw alias does not point to a claw in Arvel's inventory before the kill");
    ctx.assert.equal(start.arvel, 1, "Arvel does not hold exactly one Golden Claw on the client after MS13 started");

    await ctx.drv(`${npc} a.kill(sp.Game.getPlayer()); return 0;`);
    await ctx.waitFor(() => ctx.probe(`return !!mp.get(${ARVEL}, "isDead");`), 15000, "the server has Arvel dead");
    await ctx.sleep(3000);
    const dead = await ctx.drv(`${npc} return a.getItemCount(${claw});`);
    const deadAlias = await aliasRef();
    const deadStage = await ctx.drv(`return ${quest}.getCurrentStageID();`);
    ctx.evidence.push(`Arvel dead: the client corpse holds ${dead} claw, the server ${await serverClaws(ARVEL)}; GoldenClaw alias ref ${where(deadAlias)}; MS13 stage ${deadStage}`);

    await ctx.drv(`${npc} const p = sp.Game.getPlayer(); p.setPosition(a.getPositionX() + 80, a.getPositionY(), a.getPositionZ() + 20); return 0;`);
    await ctx.sleep(1500);
    let open = false;
    for (let attempt = 0; attempt < 2 && !open; attempt++) {
      await ctx.drv(`${npc} a.activate(sp.Game.getPlayer(), false); return 0;`);
      open = await ctx.waitFor(() => ctx.drv(`return sp.Ui.isMenuOpen("${MENU}");`), 10000, "Arvel's corpse opens").catch(() => false);
    }
    let shown = -1;
    if (open) {
      await ctx.sleep(1500);
      shown = await ctx.drv(`${npc} return a.getItemCount(${claw});`);
      ctx.shot("G2_1-open");
      await ctx.drv(`${npc} if (a.getItemCount(${claw}) > 0) a.removeItem(${claw}, 1, true, sp.Game.getPlayer()); return 0;`);
      await ctx.sleep(2000);
      await ctx.drv(`sp.TESModPlatform.closeMenu("${MENU}"); return 0;`);
      await ctx.waitFor(() => ctx.drv(`return !sp.Ui.isMenuOpen("${MENU}");`), 10000, "the corpse closes").catch(() => {});
    }
    await ctx.sleep(3000);
    const held = await ctx.drv(`return sp.Game.getPlayer().getItemCount(${claw});`);
    const end = await aliasRef();
    const stage = await ctx.drv(`return ${quest}.getCurrentStageID();`);
    const server = { arvel: await serverClaws(ARVEL), player: await serverClaws(actor) };
    ctx.evidence.push(`after the loot: with the loot menu open the corpse held ${shown} claw (open ${open}; the claw is taken by script, removeItem to the player, while the menu is open); the player holds ${held}; GoldenClaw alias ref ${where(end)}; MS13 stage ${deadStage} -> ${stage}; server: Arvel ${server.arvel}, player ${server.player}`);
    const relayed = await ctx.waitFor(async () => (await memberLog()).some(([q, st]) => q === MS13 && st === 40), 10000, "the member's quest log has MS13 40").then(() => true).catch(() => false);
    const mlog = (await memberLog()).filter(([q]) => q === MS13).map(([, st]) => st);
    ctx.evidence.push(`party: leader ${hex(actor)} (engine 1), member ${hex(member)} (bot, in ${(await ctx.probe(`return mp.get(${member}, "locationalData").cellOrWorldDesc;`))} with the leader); the member's server quest log for MS13: ${JSON.stringify(mlog)}`);

    const fails = [];
    if (start.server < 1) fails.push("the server did not create the claw in Arvel");
    if (dead !== 1 || !deadAlias.inArvel || deadAlias.id !== start.alias.id) fails.push(`after the death, Arvel holds ${dead} claw and the alias ref ${where(deadAlias)}`);
    if (!open) fails.push("Arvel's corpse does not open");
    if (open && shown !== 1) fails.push(`with the loot menu open Arvel holds ${shown} Golden Claw`);
    if (held !== 1) fails.push(`the player holds ${held} Golden Claw`);
    if (end.id !== start.alias.id || !end.quests.includes(MS13) || !end.inPlayer || end.inArvel) fails.push(`the GoldenClaw alias ref after the loot is ${where(end)}, before ${hex(start.alias.id)}`);
    if (deadStage === 40 || stage !== 40) fails.push(`MS13 stage ${deadStage} after the kill and ${stage} after the loot (the claw script sets 40 when the player takes it)`);
    if (server.arvel !== 0 || server.player !== 1) fails.push(`the server has ${server.arvel} claw in Arvel and ${server.player} in the player`);
    if (!relayed) fails.push(`the bot member's quest log has no MS13 stage 40 (${JSON.stringify(mlog)})`);
    ctx.assert.ok(!fails.length, fails.join("; "));
  },
};
