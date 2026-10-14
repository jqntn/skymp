const fs = require("fs");
const path = require("path");
const FFI02 = 0xd9b64;
const SATCHEL = 0xd9b78;
const NECKLACE = 0x663da;
const NECKLACE_ALIAS = 3;
const SATCHEL_SPOT = { cellOrWorldDesc: "3c:Skyrim.esm", pos: [79686, -66915, 10584], rot: [0, 0, 0] };
const MS13 = 0x39645;
const ARVEL = 0x39655;
const CLAW = 0x39647;
const CLAW_ALIAS = 11;
const FFR20 = 0x85d40;
const SOURCE_NOTE = 0x65bda;
const SARTHIS_SATCHEL = 0x85d54;
const MENU = "ContainerMenu";

module.exports = {
  engines: 2,
  timeout: 20 * 60000,
  setup: async (ctx) => {
    await ctx.character(1);
    await ctx.character(2);
  },
  async run(ctx) {
    const actors = [await ctx.ready(1), await ctx.ready(2)];
    const [leader, member] = actors;
    const hex = (v) => (v >>> 0).toString(16);
    const quest = (q) => `sp.Quest.from(sp.Game.getFormEx(${q}))`;
    const ref = (id) => `const c = sp.ObjectReference.from(sp.Game.getFormEx(${id}));`;
    const serverCount = (holder, item) => ctx.probe(`return ((mp.get(${holder}, "inventory") || { entries: [] }).entries).filter((e) => e.baseId === ${item}).reduce((s, e) => s + e.count, 0);`);
    const aliasRef = (q, alias, holder, item, n = 1) => ctx.drv(`const id = sp.getQuestAliasReference(${q}, ${alias});
      return { id, quests: id ? sp.getReferenceAliasQuests(id) : [], inHolder: sp.getInventoryReferences(${holder}).some((l) => l.ref === id && l.baseId === ${item}), inPlayer: sp.getInventoryReferences(0x14).some((l) => l.ref === id && l.baseId === ${item}) };`, n);
    const where = (a) => `${hex(a.id)} (alias quests ${JSON.stringify(a.quests.map(hex))}, in the holder ${a.inHolder}, in the player ${a.inPlayer})`;
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
    const takeAndClose = async (id, item, n) => {
      const taken = await ctx.drv(`${ref(id)} if (!sp.Ui.isMenuOpen("${MENU}") || c.getItemCount(sp.Game.getFormEx(${item})) < 1) return false; const p = sp.Game.getPlayer(); const before = p.getItemCount(sp.Game.getFormEx(${item})); c.removeItem(sp.Game.getFormEx(${item}), 1, true, p); return p.getItemCount(sp.Game.getFormEx(${item})) === before + 1;`, n);
      await ctx.sleep(2000);
      await ctx.drv(`sp.TESModPlatform.closeMenu("${MENU}"); return 0;`, n).catch(() => 0);
      await ctx.waitFor(() => ctx.drv(`return !sp.Ui.isMenuOpen("${MENU}");`, n), 10000, `the menu closes on engine ${n}`).catch(() => {});
      return taken;
    };
    const fails = [];

    await ctx.waitFor(() => ctx.probe(`const l = mp.get(${leader}, "private.questLog"); return Array.isArray(l) && l.length > 0;`), 60000, "engine 1 reports quest stages");
    const ffi02 = await ctx.drv(`const q = ${quest(FFI02)}; return { running: q.isRunning(), stage: q.getCurrentStageID() };`);
    const granted = await ctx.waitFor(() => serverCount(SATCHEL, NECKLACE).then((n) => n > 0), 30000, "the server creates Reyda's necklace in the satchel").then(() => true).catch(() => false);
    ctx.evidence.push(`A: FreeformIvarstead02 on engine 1 at login ${JSON.stringify(ffi02)}; the server has ${await serverCount(SATCHEL, NECKLACE)} necklace in the satchel ${hex(SATCHEL)} (created ${granted})`);
    if (!granted) fails.push("A: the server did not create the necklace of a quest that started with the game");
    const login = { ffr20: await ctx.drv(`return ${quest(FFR20)}.isRunning();`), note: await serverCount(SARTHIS_SATCHEL, SOURCE_NOTE), ms13: await ctx.drv(`return ${quest(MS13)}.isRunning();`), claw: await serverCount(ARVEL, CLAW) };
    ctx.evidence.push(`A: at login FreeformRiften20 runs on engine 1 ${login.ffr20}, its note in Sarthis's satchel on the server ${login.note}; MS13 runs ${login.ms13}, its claw in Arvel on the server ${login.claw}`);
    if ((!login.ffr20 && login.note !== 0) || (!login.ms13 && login.claw !== 0)) fails.push(`A: the server created items of a quest that does not run at login (FreeformRiften20 runs ${login.ffr20}, note ${login.note}; MS13 runs ${login.ms13}, claw ${login.claw})`);
    if (login.ffr20) fails.push("A: FreeformRiften20 runs at login, so the check cannot tell a grant of a quest that does not run");

    await ctx.probe(`mp.set(${leader}, "locationalData", ${JSON.stringify(SATCHEL_SPOT)}); return 0;`);
    await ctx.waitFor(() => ctx.drv(`${ref(SATCHEL)} return !sp.Ui.isMenuOpen("Loading Menu") && !!c && c.is3DLoaded();`).catch(() => false), 120000, "the satchel is loaded on engine 1");
    await ctx.drv(`return ${quest(FFI02)}.setCurrentStageID(30);`);
    const necklaceStart = { stage: await ctx.drv(`return ${quest(FFI02)}.getCurrentStageID();`), alias: await aliasRef(FFI02, NECKLACE_ALIAS, SATCHEL, NECKLACE) };
    let necklaceOpen = null;
    let necklaceTaken = false;
    if (await open(SATCHEL, 1)) {
      await ctx.sleep(2000);
      necklaceOpen = await aliasRef(FFI02, NECKLACE_ALIAS, SATCHEL, NECKLACE);
      necklaceTaken = await takeAndClose(SATCHEL, NECKLACE, 1);
    }
    await ctx.sleep(3000);
    const necklaceEnd = { stage: await ctx.drv(`return ${quest(FFI02)}.getCurrentStageID();`), alias: await aliasRef(FFI02, NECKLACE_ALIAS, SATCHEL, NECKLACE), server: { satchel: await serverCount(SATCHEL, NECKLACE), player: await serverCount(leader, NECKLACE) }, local: { satchel: await ctx.drv(`${ref(SATCHEL)} return c.getItemCount(sp.Game.getFormEx(${NECKLACE}));`), player: await ctx.drv(`return sp.Game.getPlayer().getItemCount(sp.Game.getFormEx(${NECKLACE}));`) } };
    ctx.evidence.push(`A: stage ${necklaceStart.stage}, alias ref ${where(necklaceStart.alias)}; with the menu open ${necklaceOpen ? where(necklaceOpen) : "- (no menu)"}; taken ${necklaceTaken}; after: alias ref ${where(necklaceEnd.alias)}, stage ${necklaceEnd.stage}, server satchel ${necklaceEnd.server.satchel}, player ${necklaceEnd.server.player}; engine 1 satchel ${necklaceEnd.local.satchel}, player ${necklaceEnd.local.player}`);
    if (!necklaceOpen) fails.push("A: the satchel does not open");
    else if (necklaceOpen.id !== necklaceStart.alias.id || !necklaceOpen.inHolder) fails.push(`A: with the menu open the necklace alias ref is ${where(necklaceOpen)}, before ${hex(necklaceStart.alias.id)}`);
    if (necklaceEnd.alias.id !== necklaceStart.alias.id || !necklaceEnd.alias.inPlayer) fails.push(`A: after the take the necklace alias ref is ${where(necklaceEnd.alias)}`);
    if (necklaceStart.stage !== 30 || necklaceEnd.stage !== 40) fails.push(`A: FreeformIvarstead02 stage ${necklaceStart.stage} -> ${necklaceEnd.stage} (the necklace script sets 40 from 30 when the player takes it)`);
    if (necklaceEnd.server.satchel !== 0 || necklaceEnd.server.player !== 1) fails.push(`A: the server has ${necklaceEnd.server.satchel} necklace in the satchel and ${necklaceEnd.server.player} in engine 1's player`);
    if (necklaceEnd.local.satchel !== 0 || necklaceEnd.local.player !== 1) fails.push(`A: engine 1 has ${necklaceEnd.local.satchel} necklace in the satchel and ${necklaceEnd.local.player} in its player`);

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
    ctx.assert.ok(joined, "B: engine 2 did not join engine 1's party");
    await ctx.drv(`return ${quest(MS13)}.setCurrentStageID(10);`);
    await ctx.waitFor(() => ctx.drv(`return ${quest(MS13)}.isRunning();`), 30000, "MS13 runs on engine 1");
    await ctx.waitFor(() => serverCount(ARVEL, CLAW).then((x) => x > 0), 20000, "the server creates the claw in Arvel").catch(() => {});
    const hoster = await ctx.probe(`return mp.get(${ARVEL}, "hoster") || 0;`);
    const killer = actors.includes(hoster) ? actors.indexOf(hoster) + 1 : 1;
    await ctx.drv(`const a = sp.Actor.from(sp.Game.getFormEx(${ARVEL})); a.kill(sp.Game.getPlayer()); return 0;`, killer);
    await ctx.waitFor(() => ctx.probe(`return !!mp.get(${ARVEL}, "isDead");`), 15000, "the server has Arvel dead");
    await ctx.waitFor(() => ctx.drv(`return sp.Actor.from(sp.Game.getFormEx(${ARVEL})).isDead();`, 2), 15000, "engine 2 shows Arvel dead");
    await ctx.sleep(3000);
    const clawStart = { server: await serverCount(ARVEL, CLAW), memberServer: await serverCount(member, CLAW), corpse2: await ctx.drv(`${ref(ARVEL)} return c.getItemCount(sp.Game.getFormEx(${CLAW}));`, 2) };
    ctx.evidence.push(`B: party joined; Arvel hosted by ${hex(hoster)}, killed on engine ${killer}; the server corpse holds ${clawStart.server} claw, engine 2's corpse ${clawStart.corpse2}, engine 2's player on the server ${clawStart.memberServer}`);
    if (clawStart.server !== 1) fails.push(`B: the server corpse holds ${clawStart.server} claw before the takes`);

    let memberTook = false;
    const memberOpened = await open(ARVEL, 2);
    if (memberOpened) {
      await ctx.sleep(1500);
      memberTook = await takeAndClose(ARVEL, CLAW, 2);
    }
    await ctx.sleep(5000);
    const afterMember = { server: await serverCount(ARVEL, CLAW), memberServer: await serverCount(member, CLAW), memberLocal: await ctx.drv(`return sp.Game.getPlayer().getItemCount(sp.Game.getFormEx(${CLAW}));`, 2), corpse2: await ctx.drv(`${ref(ARVEL)} return c.getItemCount(sp.Game.getFormEx(${CLAW}));`, 2) };
    ctx.evidence.push(`B: engine 2 (member) opens the corpse ${memberOpened}, takes the claw locally ${memberTook}; then the server corpse ${afterMember.server}, engine 2's player on the server ${afterMember.memberServer}, locally ${afterMember.memberLocal}, engine 2's corpse ${afterMember.corpse2}`);
    if (!memberOpened || !memberTook) fails.push(`B: engine 2 could not try the take (opened ${memberOpened}, took ${memberTook})`);
    if (afterMember.server !== 1 || afterMember.memberServer !== 0) fails.push(`B: after the member's take the server has ${afterMember.server} claw in the corpse and ${afterMember.memberServer} in engine 2's player`);
    if (afterMember.memberLocal !== 0 || afterMember.corpse2 !== 1) fails.push(`B: after the blocked take engine 2's player holds ${afterMember.memberLocal} claw and its corpse ${afterMember.corpse2}`);

    let leaderTook = false;
    const leaderOpened = await open(ARVEL, 1);
    if (leaderOpened) {
      await ctx.sleep(1500);
      leaderTook = await takeAndClose(ARVEL, CLAW, 1);
    }
    await ctx.sleep(4000);
    const afterLeader = { server: await serverCount(ARVEL, CLAW), leaderServer: await serverCount(leader, CLAW), leaderLocal: await ctx.drv(`return sp.Game.getPlayer().getItemCount(sp.Game.getFormEx(${CLAW}));`, 1), stage: await ctx.drv(`return ${quest(MS13)}.getCurrentStageID();`, 1), alias: await aliasRef(MS13, CLAW_ALIAS, ARVEL, CLAW, 1) };
    ctx.evidence.push(`B: engine 1 (leader) opens the corpse ${leaderOpened}, takes ${leaderTook}; then the server corpse ${afterLeader.server}, engine 1's player on the server ${afterLeader.leaderServer}, locally ${afterLeader.leaderLocal}; MS13 stage on engine 1 ${afterLeader.stage}; claw alias ref ${where(afterLeader.alias)}`);
    if (!leaderOpened || !leaderTook) fails.push(`B: engine 1 could not take the claw (opened ${leaderOpened}, took ${leaderTook})`);
    if (afterLeader.server !== 0 || afterLeader.leaderServer !== 1 || afterLeader.leaderLocal !== 1) fails.push(`B: after the leader's take the server has ${afterLeader.server} claw in the corpse and ${afterLeader.leaderServer} in engine 1's player (locally ${afterLeader.leaderLocal})`);
    if (afterLeader.stage !== 40 || !afterLeader.alias.inPlayer) fails.push(`B: MS13 is at stage ${afterLeader.stage} on engine 1 and the claw alias ref is ${where(afterLeader.alias)}`);

    ctx.assert.ok(!fails.length, fails.join("; "));
  },
};
