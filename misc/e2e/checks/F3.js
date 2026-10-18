const fs = require("fs");
const path = require("path");
const MS13 = 0x39645;
const ARVEL = 0x39655;
const CLAW = 0x39647;
const CLAW_STAGE = 40;
const MENU = "ContainerMenu";
const LIST = "_root.Menu_mc.InventoryLists_mc._ItemsList";

module.exports = {
  engines: 2,
  timeout: 15 * 60000,
  setup: async (ctx) => {
    await ctx.character(1);
    await ctx.character(2);
  },
  async run(ctx) {
    const actors = [await ctx.ready(1), await ctx.ready(2)];
    const [leader, member] = actors;
    const hex = (v) => (v >>> 0).toString(16);
    const ms13 = (n) => ctx.drv(`return sp.Quest.from(sp.Game.getFormEx(${MS13})).getCurrentStageID();`, n);
    const ref = (id) => `const c = sp.ObjectReference.from(sp.Game.getFormEx(${id}));`;
    const serverCount = (holder, item) => ctx.probe(`return ((mp.get(${holder}, "inventory") || { entries: [] }).entries).filter((e) => e.baseId === ${item}).reduce((s, e) => s + e.count, 0);`);
    const logged = (a) => ctx.probe(`const l = mp.get(${a}, "private.questLog"); return Array.isArray(l) && l.some((e) => e[0] === ${MS13} && e[1] === ${CLAW_STAGE});`);
    const send = (n, content) => ctx.drv(`sp.mpClientPlugin.send(JSON.stringify({ t: 1, contentJsonDump: ${JSON.stringify(JSON.stringify(content))} }), true); return 0;`, n);
    const open = async (id, n) => {
      await ctx.drv(`${ref(id)} const p = sp.Game.getPlayer(); p.setPosition(c.getPositionX() + ${n === 1 ? 60 : -60}, c.getPositionY(), c.getPositionZ() + 40); return 0;`, n);
      await ctx.sleep(1500);
      for (let attempt = 0; attempt < 2; attempt++) {
        await ctx.drv(`${ref(id)} c.activate(sp.Game.getPlayer(), false); return 0;`, n);
        if (await ctx.waitFor(() => ctx.drv(`return sp.Ui.isMenuOpen("${MENU}");`, n), 10000, `${hex(id)} opens on engine ${n}`).catch(() => false)) return true;
      }
      return false;
    };
    const menuTake = async (item, n) => {
      const name = await ctx.drv(`return sp.Game.getFormEx(${item}).getName();`, n);
      const idx = await ctx.drv(`const len = sp.Ui.getInt("${MENU}", "${LIST}.EntriesA.length"); for (let i = 0; i < len; i++) if (sp.Ui.getString("${MENU}", "${LIST}.EntriesA." + i + ".text") === ${JSON.stringify(name)}) return i; return -1;`, n);
      if (idx < 0) return false;
      const held = () => ctx.drv(`return sp.Game.getPlayer().getItemCount(sp.Game.getFormEx(${item}));`, n);
      const before = await held();
      await ctx.drv(`sp.Ui.setInt("${MENU}", "${LIST}.selectedIndex", ${idx}); return 0;`, n);
      await ctx.sleep(500);
      await ctx.drv(`sp.Ui.invokeInt("${MENU}", "${LIST}.onItemPress", 1); return 0;`, n);
      const taken = await ctx.waitFor(async () => (await held()) > before, 5000, `the menu take on engine ${n}`, Error, 100).then(() => true).catch(() => false);
      await ctx.sleep(2000);
      await ctx.drv(`sp.TESModPlatform.closeMenu("${MENU}"); return 0;`, n).catch(() => 0);
      await ctx.waitFor(() => ctx.drv(`return !sp.Ui.isMenuOpen("${MENU}");`, n), 10000, `the menu closes on engine ${n}`).catch(() => {});
      return taken;
    };
    const fails = [];

    await ctx.waitFor(() => ctx.probe(`const l = mp.get(${leader}, "private.questLog"); return Array.isArray(l) && l.length > 0;`), 60000, "engine 1 reports quest stages");
    const loc = await ctx.npcLocation(ARVEL);
    for (const [n, dx] of [[1, 100], [2, -100]]) {
      await ctx.probe(`mp.set(${actors[n - 1]}, "locationalData", ${JSON.stringify({ ...loc, pos: [loc.pos[0] + dx, loc.pos[1], loc.pos[2] + 30] })}); return 0;`);
    }
    for (const n of [1, 2]) {
      await ctx.waitFor(() => ctx.drv(`${ref(ARVEL)} return !sp.Ui.isMenuOpen("Loading Menu") && !!c && c.is3DLoaded();`, n).catch(() => false), 120000, `Arvel is loaded on engine ${n}`);
    }
    await send(1, { customPacketType: "partyInvite", target: member });
    await ctx.sleep(1500);
    await send(2, { customPacketType: "partyAccept", inviter: leader });
    const joined = await ctx.waitFor(() => fs.readFileSync(path.join(ctx.dir, "server.log"), "utf8").includes(`Coop: ${hex(member)} joined party`), 15000, "engine 2 joins the party").then(() => true).catch(() => false);
    ctx.assert.ok(joined, "engine 2 did not join engine 1's party");
    await ctx.drv(`return sp.Quest.from(sp.Game.getFormEx(${MS13})).setCurrentStageID(10);`);
    await ctx.waitFor(() => serverCount(ARVEL, CLAW).then((x) => x > 0), 20000, "the server creates the claw in Arvel").catch(() => {});
    const hoster = await ctx.probe(`return mp.get(${ARVEL}, "hoster") || 0;`);
    const killer = actors.includes(hoster) ? actors.indexOf(hoster) + 1 : 1;
    await ctx.drv(`const a = sp.Actor.from(sp.Game.getFormEx(${ARVEL})); a.kill(sp.Game.getPlayer()); return 0;`, killer);
    await ctx.waitFor(() => ctx.probe(`return !!mp.get(${ARVEL}, "isDead");`), 15000, "the server has Arvel dead");
    await ctx.waitFor(() => ctx.drv(`return sp.Actor.from(sp.Game.getFormEx(${ARVEL})).isDead();`, 2), 15000, "engine 2 shows Arvel dead");
    await ctx.sleep(3000);
    const start = { leader: await ms13(1), member: await ms13(2), corpse: await serverCount(ARVEL, CLAW), corpse2: await ctx.drv(`${ref(ARVEL)} return c.getItemCount(sp.Game.getFormEx(${CLAW}));`, 2), alias: await ctx.drv(`const r = sp.getQuestAliasReference(${MS13}, 11); return !!r && sp.getInventoryReferences(${ARVEL}).some((l) => l.ref === r);`, 2) };
    ctx.evidence.push(`A: party joined; the leader set MS13 10; Arvel hosted by ${hex(hoster)}, killed on engine ${killer}; MS13 on the leader ${start.leader}, on the member ${start.member}; the server corpse holds ${start.corpse} claw, the member's corpse ${start.corpse2}, the member's claw alias in its corpse ${start.alias}`);
    const sync = (fs.readFileSync(path.join(ctx.dir, "server.log"), "utf8").match(new RegExp(`${hex(member)} joined party.*`)) || [""])[0];
    ctx.evidence.push(`A: server: ${sync}`);
    ctx.assert.ok(start.member < CLAW_STAGE && start.corpse === 1 && start.corpse2 === 1, `the setup did not reach a claw in Arvel with MS13 below ${CLAW_STAGE} on the member (MS13 ${start.member}, server corpse ${start.corpse}, member corpse ${start.corpse2})`);
    ctx.assert.ok(start.alias, "not exercised: the member's MS13 claw alias does not point at the claw in its corpse, so no alias script can fire on the take");

    let memberTook = false;
    const memberOpened = await open(ARVEL, 2);
    if (memberOpened) {
      await ctx.sleep(1500);
      memberTook = await menuTake(CLAW, 2);
    }
    await ctx.sleep(8000);
    const refused = { member: await ms13(2), leader: await ms13(1), memberLog: await logged(member), leaderLog: await logged(leader), server: await serverCount(ARVEL, CLAW), memberServer: await serverCount(member, CLAW), memberLocal: await ctx.drv(`return sp.Game.getPlayer().getItemCount(sp.Game.getFormEx(${CLAW}));`, 2) };
    ctx.evidence.push(`B: the member opens the corpse ${memberOpened}, takes the claw in the container menu ${memberTook}; 8 s later MS13 on the member ${refused.member}, on the leader ${refused.leader}; stage ${CLAW_STAGE} in the server log of the member ${refused.memberLog}, of the leader ${refused.leaderLog}; claw: server corpse ${refused.server}, the member on the server ${refused.memberServer}, locally ${refused.memberLocal}`);
    ctx.assert.ok(memberOpened && memberTook, `not exercised: the member could not try the take (opened ${memberOpened}, took ${memberTook})`);
    ctx.assert.ok(refused.server === 1 && refused.memberServer === 0 && refused.memberLocal === 0, `the server did not refuse the member's take (server corpse ${refused.server}, member on the server ${refused.memberServer}, locally ${refused.memberLocal})`);
    if (refused.member >= CLAW_STAGE) fails.push(`B: after the refused take MS13 is at stage ${refused.member} on the member's client`);
    if (refused.memberLog || refused.leaderLog) fails.push(`B: after the refused take the server logged MS13 ${CLAW_STAGE} for the member ${refused.memberLog}, the leader ${refused.leaderLog}`);

    let leaderTook = false;
    const leaderOpened = await open(ARVEL, 1);
    if (leaderOpened) {
      await ctx.sleep(1500);
      leaderTook = await menuTake(CLAW, 1);
    }
    await ctx.waitFor(async () => (await ms13(1)) >= CLAW_STAGE, 20000, "MS13 reaches the claw stage on the leader").catch(() => {});
    const taken = { leader: await ms13(1), member: await ms13(2), leaderServer: await serverCount(leader, CLAW) };
    ctx.evidence.push(`C: the leader opens the corpse ${leaderOpened}, takes ${leaderTook}; MS13 on the leader ${taken.leader}, on the member ${taken.member}; the leader holds ${taken.leaderServer} claw on the server`);
    if (!leaderOpened || !leaderTook || taken.leaderServer !== 1 || taken.leader < CLAW_STAGE) fails.push(`C: the leader's take did not work (opened ${leaderOpened}, took ${leaderTook}, server ${taken.leaderServer}, MS13 ${taken.leader})`);

    ctx.assert.ok(!fails.length, fails.join("; "));
  },
};
