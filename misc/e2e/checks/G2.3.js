const fs = require("fs");
const path = require("path");
const MQ103 = 0xd0800;
const MQ104 = 0x2610c;
const STONE = 0xdf202;
const STONE_ALIAS = 18;
const BOSS = 0x9bcd6;
const FARENGAR = 0x1a67e;
const BOT_PROFILE = 920103;
const LOOT = "ContainerMenu";
const M = "Dialogue Menu";
const R = "_root.DialogueMenu_mc";

module.exports = {
  engines: 1,
  timeout: 20 * 60000,
  setup: (ctx) => ctx.character(1),
  async run(ctx) {
    const leader = await ctx.ready(1);
    const hex = (v) => (v >>> 0).toString(16);
    const log = () => fs.readFileSync(path.join(ctx.dir, "server.log"), "utf8");
    const quest = (id) => `sp.Quest.from(sp.Game.getFormEx(${id}))`;
    const boss = `const a = sp.Actor.from(sp.Game.getFormEx(${BOSS}));`;
    const stone = `sp.Game.getFormEx(${STONE})`;
    const done = (id, s) => ctx.drv(`return ${quest(id)}.isStageDone(${s});`);
    const stageOf = (id) => ctx.drv(`return ${quest(id)}.getCurrentStageID();`);
    const held = () => ctx.drv(`return sp.Game.getPlayer().getItemCount(${stone});`);
    const serverStones = (ref) => ctx.probe(`return ((mp.get(${ref}, "inventory") || { entries: [] }).entries).filter((e) => e.baseId === ${STONE}).reduce((s, e) => s + e.count, 0);`);
    const aliasRef = () => ctx.drv(`return sp.getQuestAliasReference(${MQ103}, ${STONE_ALIAS});`);
    const memberLog = () => ctx.probe(`return (mp.get(globalThis.g23member, "private.questLog") || []).filter(([q]) => q === ${MQ103}).map(([, s]) => s);`);
    const moveBoth = async (loc, dx, dy) => {
      for (const [a, k] of [["leader", 1], ["globalThis.g23member", -1]]) {
        await ctx.probe(`mp.set(${a === "leader" ? leader : a}, "locationalData", ${JSON.stringify({ ...loc, pos: [loc.pos[0] + dx + k * 40, loc.pos[1] + dy, loc.pos[2] + 30] })}); return 0;`);
      }
    };
    const fails = [];

    await ctx.waitFor(() => ctx.probe(`const l = mp.get(${leader}, "private.questLog"); return Array.isArray(l) && l.length > 0;`), 60000, "the client reports quest stages");
    const base = await ctx.probe(`return mp.get(${leader}, "locationalData");`);
    const member = await ctx.probe(`const bot = mp.createBot(); globalThis.g23bot = bot;
      bot.send({ t: 1, contentJsonDump: JSON.stringify({ customPacketType: "loginWithSkympIo", gameData: { profileId: ${BOT_PROFILE} } }) });
      await new Promise((r) => setTimeout(r, 800));
      const a = mp.getUserActor(bot.getUserId()); globalThis.g23member = a;
      mp.set(a, "locationalData", ${JSON.stringify({ ...base, pos: [base.pos[0] + 200, base.pos[1], base.pos[2]] })});
      return a;`);
    ctx.assert.ok(member, "the bot member got no actor");
    await ctx.drv(`sp.mpClientPlugin.send(JSON.stringify({ t: 1, contentJsonDump: JSON.stringify({ customPacketType: "partyInvite", target: ${member} }) }), true); return 0;`);
    await ctx.sleep(1000);
    await ctx.probe(`globalThis.g23bot.send({ t: 1, contentJsonDump: JSON.stringify({ customPacketType: "partyAccept", inviter: ${leader} }) }); return 0;`);
    const joined = await ctx.waitFor(() => log().includes(`Coop: ${hex(member)} joined party`), 15000, "the bot joins the leader's party").then(() => true).catch(() => false);
    ctx.assert.ok(joined, "the bot member did not join the leader's party");

    const running = await ctx.drv(`return ${quest(MQ103)}.setCurrentStageID(10);`).then(() => ctx.waitFor(() => ctx.drv(`return ${quest(MQ103)}.isRunning();`), 30000, "MQ103 runs on the leader")).catch(() => false);
    ctx.assert.ok(running, "MQ103 does not run on the leader");
    const bossLoc = await ctx.npcLocation(BOSS);
    await moveBoth(bossLoc, 0, -150);
    await ctx.waitFor(() => ctx.drv(`${boss} return !sp.Ui.isMenuOpen("Loading Menu") && !!a && a.is3DLoaded();`).catch(() => false), 120000, "the boss is loaded");
    await ctx.waitFor(() => ctx.probe(`return mp.get(${BOSS}, "hoster") === ${leader};`), 60000, "the leader hosts the boss");
    const created = await ctx.waitFor(() => serverStones(BOSS).then((n) => n > 0), 20000, "the server creates the Dragonstone in the boss").then(() => true).catch(() => false);
    const start = { stage: await stageOf(MQ103), member: await memberLog(), alias: await aliasRef(), boss: await ctx.drv(`${boss} return a.getItemCount(${stone});`), server: await serverStones(BOSS), line: (log().match(new RegExp(`Coop: quest ${hex(MQ103)} alias ${STONE_ALIAS} created ${hex(STONE)} in [0-9a-f]+`)) || ["no line"])[0] };
    ctx.evidence.push(`A: leader ${hex(leader)}, bot member ${hex(member)} in the party; MQ103 stage ${start.stage} on the leader, the member's server quest log for MQ103 ${JSON.stringify(start.member)}; boss ${hex(BOSS)} in ${bossLoc.cellOrWorldDesc}: Dragonstone count on the leader's client ${start.boss}, on the server ${start.server}; dragonStone alias ref ${hex(start.alias)}; server: "${start.line}"`);
    if (!created) fails.push("A: the server did not create the Dragonstone in the boss");
    if (start.member.includes(180) || start.member.includes(190)) fails.push(`A: the member's log has MQ103 180 or 190 before the loot (${JSON.stringify(start.member)})`);
    ctx.assert.equal(start.boss, 1, "the boss does not hold exactly one Dragonstone on the leader's client after MQ103 started");

    await ctx.drv(`${boss} a.kill(sp.Game.getPlayer()); return 0;`);
    await ctx.waitFor(() => ctx.probe(`return !!mp.get(${BOSS}, "isDead");`), 15000, "the server has the boss dead");
    await ctx.sleep(3000);
    const dead = { stage: await stageOf(MQ103), done: await done(MQ103, 180), boss: await ctx.drv(`${boss} return a.getItemCount(${stone});`), held: await held() };
    await ctx.drv(`${boss} const p = sp.Game.getPlayer(); p.setPosition(a.getPositionX() + 80, a.getPositionY(), a.getPositionZ() + 20); return 0;`);
    await ctx.sleep(1500);
    let open = false;
    for (let attempt = 0; attempt < 2 && !open; attempt++) {
      await ctx.drv(`${boss} a.activate(sp.Game.getPlayer(), false); return 0;`);
      open = await ctx.waitFor(() => ctx.drv(`return sp.Ui.isMenuOpen("${LOOT}");`), 10000, "the boss's corpse opens").catch(() => false);
    }
    let shown = -1;
    if (open) {
      await ctx.sleep(1500);
      shown = await ctx.drv(`${boss} return a.getItemCount(${stone});`);
      ctx.shot("G2_3-loot");
      await ctx.drv(`${boss} if (a.getItemCount(${stone}) > 0) a.removeItem(${stone}, 1, true, sp.Game.getPlayer()); return 0;`);
      await ctx.sleep(2000);
      await ctx.drv(`sp.TESModPlatform.closeMenu("${LOOT}"); return 0;`);
      await ctx.waitFor(() => ctx.drv(`return !sp.Ui.isMenuOpen("${LOOT}");`), 10000, "the corpse closes").catch(() => {});
    }
    const looted = await ctx.waitFor(() => done(MQ103, 180), 15000, "MQ103 stage 180 is done on the leader").then(() => true).catch(() => false);
    await ctx.sleep(2000);
    const after = { stage: await stageOf(MQ103), held: await held(), alias: await aliasRef(), server: { boss: await serverStones(BOSS), leader: await serverStones(leader) } };
    const relay180 = await ctx.waitFor(async () => (await memberLog()).includes(180), 10000, "the member's log has MQ103 180").then(() => true).catch(() => false);
    ctx.evidence.push(`B: boss dead: MQ103 stage ${dead.stage} (180 done ${dead.done}), boss holds ${dead.boss} Dragonstone, the leader ${dead.held}; loot menu open ${open}, it showed ${shown} Dragonstone (taken by script, removeItem to the player, while the menu is open); after the loot: MQ103 stage ${after.stage} (180 done ${looted}), the leader holds ${after.held}, dragonStone alias ref ${hex(after.alias)}; server: boss ${after.server.boss}, leader ${after.server.leader}; the member's server quest log for MQ103 ${JSON.stringify(await memberLog())}`);
    if (!open) fails.push("B: the boss's corpse does not open");
    if (open && shown !== 1) fails.push(`B: with the loot menu open the boss holds ${shown} Dragonstone`);
    if (dead.stage >= 180 || dead.done || !looted) fails.push(`B: MQ103 stage ${dead.stage} after the kill and ${after.stage} after the loot (the dragonStone alias script sets 180 when the player takes the stone)`);
    if (after.held !== 1 || after.alias !== start.alias) fails.push(`B: the leader holds ${after.held} Dragonstone, alias ref ${hex(after.alias)} (before ${hex(start.alias)})`);
    if (after.server.boss !== 0 || after.server.leader !== 1) fails.push(`B: the server has ${after.server.boss} Dragonstone in the boss and ${after.server.leader} in the leader`);
    if (!relay180) fails.push("B: the member's server quest log has no MQ103 180");

    const farengarLoc = await ctx.npcLocation(FARENGAR);
    const fr = farengarLoc.rot[2] * Math.PI / 180;
    await moveBoth(farengarLoc, 150 * Math.sin(fr), 150 * Math.cos(fr));
    await ctx.waitFor(() => ctx.drv(`const f = sp.Actor.from(sp.Game.getFormEx(${FARENGAR})); return !sp.Ui.isMenuOpen("Loading Menu") && !!f && f.is3DLoaded();`).catch(() => false), 120000, "Farengar is loaded");
    const state = () => ctx.drv(`const open = sp.Ui.isMenuOpen("${M}"); const t = []; let sub = "";
      if (open) { for (let i = 0; i < 8; i++) { let s = ""; try { s = sp.Ui.getString("${M}", "${R}.TopicList.entryList." + i + ".text"); } catch (e) {} if (!s) break; t.push(s); } try { sub = (sp.Ui.getString("${M}", "${R}.SubtitleText.text") || "").trim(); } catch (e) {} }
      return { open, t, sub, stage: ${quest(MQ103)}.getCurrentStageID(), given: ${quest(MQ103)}.isStageDone(190) };`);
    const clicked = [];
    const stages = [];
    let s = await state();
    const before = { given: s.given, held: await held() };
    const given = await ctx.waitFor(async () => {
      s = await state();
      if (stages[stages.length - 1] !== s.stage) stages.push(s.stage);
      if (s.given) return true;
      if (s.open && !s.sub && s.t.length) {
        const fresh = s.t.map((x, i) => [x, i]).filter(([x]) => !clicked.includes(x));
        const [x, i] = fresh.find(([t]) => /stone/i.test(t)) || fresh[0] || [s.t[0], 0];
        clicked.push(x);
        await ctx.drv(`sp.Ui.setInt("${M}", "${R}.TopicList.selectedIndex", ${i}); sp.Ui.invokeBool("${M}", "${R}.onSelectionClick", true); return 0;`);
        await ctx.sleep(2500);
      } else if (!s.open) {
        await ctx.sleep(3000);
        if (!(await state()).open) await ctx.drv(`sp.Actor.from(sp.Game.getFormEx(${FARENGAR})).activate(sp.Game.getPlayer(), false); return 0;`);
        await ctx.sleep(3000);
      }
      return false;
    }, 8 * 60000, "Farengar takes the Dragonstone (MQ103 stage 190 done)").catch(() => false);
    await ctx.sleep(3000);
    ctx.shot("G2_3-farengar");
    const turnedIn = { held: await held(), mq104: await stageOf(MQ104), server: await serverStones(leader) };
    const relay190 = await ctx.waitFor(async () => (await memberLog()).includes(190), 10000, "the member's log has MQ103 190").then(() => true).catch(() => false);
    ctx.evidence.push(`C: Farengar ${hex(FARENGAR)} in ${farengarLoc.cellOrWorldDesc}; before the talk MQ103 190 done ${before.given}, the leader held ${before.held} Dragonstone; dialogue: ${clicked.length} topic picks (${[...new Set(clicked)].map((x) => `"${x}"`).join(", ")}), MQ103 stages ${stages.join(" -> ")}, last line "${s.sub}"; after: 190 done ${given}, the leader holds ${turnedIn.held} Dragonstone, MQ104 stage ${turnedIn.mq104}; server: leader ${turnedIn.server} Dragonstone; the member's server quest log for MQ103 ${JSON.stringify(await memberLog())}`);
    if (before.given) fails.push("C: MQ103 stage 190 was done before the talk");
    if (!given) fails.push(`C: MQ103 stage 190 is not done on the leader after the dialogue (stage ${s.stage})`);
    if (turnedIn.held !== 0) fails.push(`C: the leader still holds ${turnedIn.held} Dragonstone`);
    if (turnedIn.server !== 0) fails.push(`C: the server has ${turnedIn.server} Dragonstone in the leader`);
    if (!relay190) fails.push("C: the member's server quest log has no MQ103 190");
    ctx.assert.ok(!fails.length, fails.join("; "));
  },
};
