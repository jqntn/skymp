const fs = require("fs");
const path = require("path");
const MS13 = 0x39645;
const ARVEL = 0x39655;
const CLAW = 0x39647;
const BFB02 = 0x371dd;
const RINGS = [0x4e2ba, 0x4e2bb, 0x4e2bc];
const KEYHOLE = 0x4e2b9;
const DOOR = 0x4e2b8;
const DOOR_NODE = "DoorBase";
const DOOR_DROP = 50;
const MQ103 = 0xd0800;
const STONE = 0xdf202;
const BOSS = 0x9bcd6;
const FARENGAR = 0x1a67e;
const MQ104 = 0x2610c;
const DRAGON = 0x5a6ca;
const FUS = 0x13e22;
const BALGRUUF = 0x1a677;
const LYDIA = 0xa2c94;
const FOLLOWER_FACTION = 0x5c84e;
const SPOT = [7572, -39162, 3807];
const BOT_PROFILE = 920105;
const M = "Dialogue Menu";
const R = "_root.DialogueMenu_mc";
const LOOT = "ContainerMenu";
const STAY_MS = 10000;
const BACK_MS = 90000;

module.exports = {
  engines: 1,
  timeout: 60 * 60000,
  setup: (ctx) => ctx.character(1),
  async run(ctx) {
    let leader = await ctx.ready(1);
    const hex = (v) => (v >>> 0).toString(16);
    const log = () => fs.readFileSync(path.join(ctx.dir, "server.log"), "utf8");
    const q = (id) => `sp.Quest.from(sp.Game.getFormEx(${id}))`;
    const done = (id, s) => ctx.drv(`return ${q(id)}.isStageDone(${s});`);
    const stageOf = (id) => ctx.drv(`const x = ${q(id)}; return x.isRunning() ? x.getCurrentStageID() : -1;`);
    const answerBox = () => ctx.drv(`if (!sp.Ui.isMenuOpen("MessageBoxMenu")) return false; sp.Ui.invokeInt("MessageBoxMenu", "_root.MessageMenu.ClickCallback", 0); return true;`);
    const held = (id) => ctx.drv(`return sp.Game.getPlayer().getItemCount(sp.Game.getFormEx(${id}));`);
    const serverHeld = (actor, id) => ctx.probe(`return ((mp.get(${actor}, "inventory") || { entries: [] }).entries).filter((e) => e.baseId === ${id}).reduce((s, e) => s + e.count, 0);`);
    const holderCount = async (holder, item) => ({ client: await ctx.drv(`const r = sp.ObjectReference.from(sp.Game.getFormEx(${holder})); return r ? r.getItemCount(sp.Game.getFormEx(${item})) : -1;`), server: await serverHeld(holder, item) });
    const holdersEmpty = async (label, list, unloadedOk = false) => {
      for (const [name, holder, item] of list) {
        const c = await holderCount(holder, item);
        ctx.evidence.push(`${label}: ${name} holds ${c.client === -1 ? "nothing (not loaded)" : c.client} on the client, ${c.server} on the server`);
        if ((c.client !== 0 && !(unloadedOk && c.client === -1)) || c.server !== 0) fails.push(`${label}: ${name} holds ${c.client} on the client and ${c.server} on the server (expected 0: the leader took it)`);
      }
    };
    const ARVEL_CLAW = ["Arvel (the claw)", ARVEL, CLAW];
    const BOSS_STONE = ["the boss (the Dragonstone)", BOSS, STONE];
    const memberLog = (quest) => ctx.probe(`return (mp.get(globalThis.g25member, "private.questLog") || []).filter(([x]) => x === ${quest}).map(([, s]) => s);`);
    const loaded = (id, ms = 120000) => ctx.waitFor(() => ctx.drv(`const r = sp.ObjectReference.from(sp.Game.getFormEx(${id})); return !sp.Ui.isMenuOpen("Loading Menu") && !!r && r.is3DLoaded();`).catch(() => false), ms, `${hex(id)} is loaded on the leader`);
    const moveBoth = async (loc, dx = 0, dy = 0) => {
      for (const [a, k] of [[leader, 1], ["globalThis.g25member", -1]]) {
        await ctx.probe(`mp.set(${a}, "locationalData", ${JSON.stringify({ ...loc, pos: [loc.pos[0] + dx + k * 40, loc.pos[1] + dy, loc.pos[2] + 30] })}); return 0;`);
      }
    };
    const inFront = (loc, d) => { const r = loc.rot[2] * Math.PI / 180; return [d * Math.sin(r), d * Math.cos(r)]; };
    const loot = async (npc, item) => {
      const a = `const a = sp.Actor.from(sp.Game.getFormEx(${npc}));`;
      await ctx.drv(`${a} const p = sp.Game.getPlayer(); p.setPosition(a.getPositionX() + 80, a.getPositionY(), a.getPositionZ() + 20); return 0;`);
      await ctx.sleep(1500);
      let open = false;
      for (let i = 0; i < 2 && !open; i++) {
        await ctx.drv(`${a} a.activate(sp.Game.getPlayer(), false); return 0;`);
        open = await ctx.waitFor(() => ctx.drv(`return sp.Ui.isMenuOpen("${LOOT}");`), 10000, "the corpse opens").catch(() => false);
      }
      if (open) {
        await ctx.sleep(1500);
        await ctx.drv(`${a} const f = sp.Game.getFormEx(${item}); if (a.getItemCount(f) > 0) a.removeItem(f, 1, true, sp.Game.getPlayer()); return 0;`);
        await ctx.sleep(2000);
        await ctx.drv(`sp.TESModPlatform.closeMenu("${LOOT}"); return 0;`);
        await ctx.waitFor(() => ctx.drv(`return !sp.Ui.isMenuOpen("${LOOT}");`), 10000, "the corpse closes").catch(() => {});
      }
      return open;
    };
    const talk = async (npc, until, prefer, label) => {
      const state = () => ctx.drv(`const open = sp.Ui.isMenuOpen("${M}"); const t = []; let sub = "";
        if (open) { for (let i = 0; i < 8; i++) { let s = ""; try { s = sp.Ui.getString("${M}", "${R}.TopicList.entryList." + i + ".text"); } catch (e) {} if (!s) break; t.push(s); } try { sub = (sp.Ui.getString("${M}", "${R}.SubtitleText.text") || "").trim(); } catch (e) {} }
        return { open, t, sub };`);
      const clicked = [];
      let boxes = 0;
      const ok = await ctx.waitFor(async () => {
        if (await until()) return true;
        if (await answerBox()) { boxes++; await ctx.sleep(1500); return false; }
        const s = await state();
        if (s.open && !s.sub && s.t.length) {
          const fresh = s.t.map((x, i) => [x, i]).filter(([x]) => !clicked.includes(x));
          const [x, i] = fresh.find(([t]) => prefer.test(t)) || fresh[0] || [s.t[0], 0];
          clicked.push(x);
          await ctx.drv(`sp.Ui.setInt("${M}", "${R}.TopicList.selectedIndex", ${i}); sp.Ui.invokeBool("${M}", "${R}.onSelectionClick", true); return 0;`);
          await ctx.sleep(2500);
        } else if (!s.open) {
          await ctx.sleep(2000);
          if (!(await state()).open) await ctx.drv(`sp.Actor.from(sp.Game.getFormEx(${npc})).activate(sp.Game.getPlayer(), false); return 0;`);
          await ctx.sleep(3000);
        }
        return false;
      }, 8 * 60000, label).then(() => true).catch(() => false);
      if ((await state()).open) await ctx.drv(`sp.TESModPlatform.closeMenu("${M}"); return 0;`).catch(() => {});
      return { ok, picks: clicked.length, boxes };
    };
    const follower = () => ctx.drv(`const a = sp.Actor.from(sp.Game.getFormEx(${LYDIA})); if (!a) return null; const f = sp.Faction.from(sp.Game.getFormEx(${FOLLOWER_FACTION})); return { teammate: a.isPlayerTeammate(), rank: a.getFactionRank(f) };`);
    const botLogin = `const bot = mp.createBot(); globalThis.g25bot = bot;
      bot.send({ t: 1, contentJsonDump: JSON.stringify({ customPacketType: "loginWithSkympIo", gameData: { profileId: ${BOT_PROFILE} } }) });
      await new Promise((r) => setTimeout(r, 800));
      const a = mp.getUserActor(bot.getUserId()); globalThis.g25member = a; return a;`;
    const fails = [];
    const relogs = [];
    const relog = async (label, back) => {
      const memberBefore = await ctx.probe(`return globalThis.g25member;`);
      const memberLogBefore = await ctx.probe(`return mp.get(globalThis.g25member, "private.questLog") || [];`);
      leader = await ctx.relog(1);
      await ctx.probe(`globalThis.g25bot.destroy(); return 0;`);
      await ctx.waitFor(() => ctx.probe(`return !mp.get(${memberBefore}, "isOnline");`), 15000, "the server sees the bot offline");
      await ctx.sleep(2000);
      const memberNow = await ctx.probe(botLogin).catch(() => 0);
      const at = Date.now();
      let boxes = 0;
      const ok = await ctx.waitFor(async () => { if (await answerBox()) boxes++; return back(); }, BACK_MS, `${label}: the state is back after the login`).then(() => true).catch(() => false);
      const secs = ((Date.now() - at) / 1000).toFixed(1);
      await ctx.sleep(5000);
      const memberLogAfter = await ctx.probe(`return mp.get(${memberNow || memberBefore}, "private.questLog") || [];`);
      const lost = memberLogBefore.filter(([qq, st]) => !memberLogAfter.some(([q2, s2]) => q2 === qq && s2 === st));
      const added = memberLogAfter.filter(([qq, st]) => !memberLogBefore.some(([q2, s2]) => q2 === qq && s2 === st));
      relogs.push(`${label}: the leader and the bot logged in again; ${boxes} message boxes answered; state back ${ok ? `${secs} s` : `not within ${BACK_MS / 1000} s`} after the login; the bot came back as ${hex(memberNow)} (was ${hex(memberBefore)}), its quest log lost ${JSON.stringify(lost.map(([qq, st]) => [hex(qq), st]))} and gained ${JSON.stringify(added.map(([qq, st]) => [hex(qq), st]))} (relayed from the leader)`);
      if (memberNow !== memberBefore || lost.length) fails.push(`${label}: the bot came back as ${hex(memberNow)} (was ${hex(memberBefore)}) or its quest log lost ${JSON.stringify(lost)} across its relog`);
      return ok;
    };

    await ctx.waitFor(() => ctx.probe(`const l = mp.get(${leader}, "private.questLog"); return Array.isArray(l) && l.length > 0;`), 60000, "the client reports quest stages");
    const base = await ctx.probe(`return mp.get(${leader}, "locationalData");`);
    const member = await ctx.probe(botLogin);
    ctx.assert.ok(member, "the bot member got no actor");
    await ctx.probe(`mp.set(${member}, "locationalData", ${JSON.stringify({ ...base, pos: [base.pos[0] + 150, base.pos[1], base.pos[2]] })}); return 0;`);
    await ctx.drv(`sp.mpClientPlugin.send(JSON.stringify({ t: 1, contentJsonDump: JSON.stringify({ customPacketType: "partyInvite", target: ${member} }) }), true); return 0;`);
    await ctx.sleep(1000);
    await ctx.probe(`globalThis.g25bot.send({ t: 1, contentJsonDump: JSON.stringify({ customPacketType: "partyAccept", inviter: ${leader} }) }); return 0;`);
    const joined = await ctx.waitFor(() => log().includes(`Coop: ${hex(member)} joined party`), 15000, "the bot joins the leader's party").then(() => true).catch(() => false);
    ctx.assert.ok(joined, "the bot member did not join the leader's party");

    await ctx.drv(`return ${q(MS13)}.setCurrentStageID(10);`);
    await ctx.waitFor(() => ctx.probe(`return (mp.get(${leader}, "private.questLog") || []).some(([x, st]) => x === ${MS13} && st === 10);`), 15000, "the server logs MS13 10").catch(() => {});
    const b0 = await relog("S1 start", () => done(MS13, 10));
    if (!b0) fails.push("S1 start: MS13 10 is not back after the relog");
    const arvel = await ctx.npcLocation(ARVEL);
    await moveBoth(arvel, 150, 0);
    await loaded(ARVEL);
    await ctx.waitFor(() => ctx.probe(`return mp.get(${ARVEL}, "hoster") === ${leader};`), 60000, "the leader hosts Arvel").catch(() => {});
    await ctx.waitFor(() => serverHeld(ARVEL, CLAW).then((n) => n > 0), 15000, "the server creates the claw in Arvel").catch(() => {});
    const arvel0 = await holderCount(ARVEL, CLAW);
    ctx.evidence.push(`S1 start after the relog, at Arvel: Arvel holds ${arvel0.client} claw on the client, ${arvel0.server} on the server`);
    if (arvel0.client !== 1 || arvel0.server !== 1) fails.push(`S1 start after the relog: Arvel holds ${arvel0.client} claw on the client and ${arvel0.server} on the server (expected 1, 1: nobody took it yet)`);
    ctx.assert.ok(!fails.length, fails.join("; "));
    await ctx.drv(`sp.Actor.from(sp.Game.getFormEx(${ARVEL})).kill(sp.Game.getPlayer()); return 0;`);
    await ctx.waitFor(() => ctx.probe(`return !!mp.get(${ARVEL}, "isDead");`), 15000, "the server has Arvel dead").catch(() => {});
    await ctx.sleep(3000);
    await loot(ARVEL, CLAW);
    const s1 = { stage: await stageOf(MS13), held: await held(CLAW), server: await serverHeld(leader, CLAW) };
    await ctx.sleep(STAY_MS);
    const s1later = { held: await held(CLAW), server: await serverHeld(leader, CLAW), member: await memberLog(MS13) };
    ctx.evidence.push(`S1 (G2.1's step): MS13 ${s1.stage}; the claw ${hex(CLAW)}: client ${s1.held}, server ${s1.server}; ${STAY_MS / 1000} s later client ${s1later.held}, server ${s1later.server}; the member's MS13 log ${JSON.stringify(s1later.member)}`);
    if (s1.stage !== 40 || s1later.held !== 1 || s1later.server !== 1) fails.push(`S1: after the loot MS13 is ${s1.stage} and ${STAY_MS / 1000} s later the leader holds ${s1later.held} claw on the client, ${s1later.server} on the server (expected 40, 1, 1)`);
    const b1 = await relog("S1", async () => (await done(MS13, 40)) && (await held(CLAW)) === 1);
    const r1 = { stage: await stageOf(MS13), held: await held(CLAW), server: await serverHeld(leader, CLAW) };
    ctx.evidence.push(`S1 after the relog: MS13 ${r1.stage}, the claw client ${r1.held}, server ${r1.server}`);
    if (!b1 || r1.held !== 1 || r1.server !== 1) fails.push(`S1 after the relog: MS13 ${r1.stage}, the claw client ${r1.held}, server ${r1.server} (expected 40 done, 1, 1)`);
    ctx.assert.ok(!fails.length, fails.join("; "));
    await holdersEmpty("S1 after the relog", [ARVEL_CLAW]);

    await moveBoth({ cellOrWorldDesc: `${hex(BFB02)}:Skyrim.esm`, pos: [128, -470, -280], rot: [0, 0, 0] });
    await loaded(DOOR);
    const doorZ = () => ctx.drv(`const r = sp.ObjectReference.from(sp.Game.getFormEx(${DOOR})); return r && r.is3DLoaded() ? Math.round(sp.NetImmerse.getNodeWorldPositionZ(r, "${DOOR_NODE}", false)) : null;`);
    const closed = await doorZ();
    for (let wave = 0; wave < 2; wave++) {
      for (const r of RINGS) await ctx.drv(`sp.ObjectReference.from(sp.Game.getFormEx(${r})).activate(sp.Game.getPlayer(), false); return 0;`);
      await ctx.sleep(6000);
    }
    await ctx.drv(`sp.ObjectReference.from(sp.Game.getFormEx(${KEYHOLE})).activate(sp.Game.getPlayer(), false); return 0;`);
    const sank = await ctx.waitFor(async () => ((await doorZ()) ?? Infinity) <= closed - DOOR_DROP && (await done(MS13, 50)), 40000, "the claw door sinks and MS13 reaches 50").then(() => true).catch(() => false);
    ctx.evidence.push(`S2 (G2.2's step): the claw door ${DOOR_NODE} ${closed} -> ${await doorZ()}, MS13 ${await stageOf(MS13)}, the keyhole's server state ${await ctx.probe(`return mp.callPapyrusFunction("method", "ObjectReference", "GetState", { type: "form", desc: mp.getDescFromId(${KEYHOLE}) }, []);`)}, the member's MS13 log ${JSON.stringify(await memberLog(MS13))}`);
    if (!sank) fails.push("S2: the claw door did not sink, or MS13 did not reach 50");
    if (!(await memberLog(MS13)).includes(50)) fails.push("S2: the member's log has no MS13 50 (the party did not survive the S1 relog)");
    const b2 = await relog("S2", async () => (await done(MS13, 50)) && ((await doorZ()) ?? Infinity) <= closed - DOOR_DROP);
    const r2 = { stage: await stageOf(MS13), z: await doorZ(), claw: await held(CLAW) };
    ctx.evidence.push(`S2 after the relog: MS13 ${r2.stage}, the claw door ${DOOR_NODE} ${r2.z} (closed ${closed}), the claw held ${r2.claw}`);
    if (!b2) fails.push(`S2 after the relog: MS13 ${r2.stage} or the claw door at ${r2.z} (closed ${closed}) is not back`);
    ctx.assert.ok(!fails.length, fails.join("; "));
    await holdersEmpty("S2 after the relog", [ARVEL_CLAW]);

    await ctx.drv(`return ${q(MQ103)}.setCurrentStageID(10);`);
    const bossLoc = await ctx.npcLocation(BOSS);
    await moveBoth(bossLoc, 0, -150);
    await loaded(BOSS);
    await ctx.waitFor(() => ctx.probe(`return mp.get(${BOSS}, "hoster") === ${leader};`), 60000, "the leader hosts the boss").catch(() => {});
    await ctx.waitFor(() => serverHeld(BOSS, STONE).then((n) => n > 0), 20000, "the server creates the Dragonstone in the boss").catch(() => {});
    await ctx.drv(`sp.Actor.from(sp.Game.getFormEx(${BOSS})).kill(sp.Game.getPlayer()); return 0;`);
    await ctx.waitFor(() => ctx.probe(`return !!mp.get(${BOSS}, "isDead");`), 15000, "the server has the boss dead").catch(() => {});
    await ctx.sleep(3000);
    await loot(BOSS, STONE);
    await ctx.waitFor(() => done(MQ103, 180), 15000, "MQ103 180").catch(() => {});
    await ctx.sleep(STAY_MS);
    const s3 = { stage: await stageOf(MQ103), done180: await done(MQ103, 180), held: await held(STONE), server: await serverHeld(leader, STONE), member: await memberLog(MQ103) };
    ctx.evidence.push(`S3 (G2.3's loot): MQ103 ${s3.stage} (180 done ${s3.done180}); ${STAY_MS / 1000} s after the loot the Dragonstone: client ${s3.held}, server ${s3.server}; the member's MQ103 log ${JSON.stringify(s3.member)}`);
    if (!s3.done180 || s3.held !== 1 || s3.server !== 1) fails.push(`S3: MQ103 180 done ${s3.done180}, the Dragonstone ${STAY_MS / 1000} s after the loot client ${s3.held}, server ${s3.server}`);
    if (!s3.member.includes(180)) fails.push("S3: the member's log has no MQ103 180 (the party did not survive the S2 relog)");
    const b3 = await relog("S3", async () => (await done(MQ103, 180)) && (await held(STONE)) === 1);
    const r3 = { done180: await done(MQ103, 180), held: await held(STONE), server: await serverHeld(leader, STONE) };
    ctx.evidence.push(`S3 after the relog: MQ103 180 done ${r3.done180}, the Dragonstone client ${r3.held}, server ${r3.server}`);
    await holdersEmpty("S3 after the relog", [ARVEL_CLAW, BOSS_STONE]);
    if (!b3 || r3.held !== 1 || r3.server !== 1) fails.push(`S3 after the relog: MQ103 180 done ${r3.done180}, the Dragonstone client ${r3.held}, server ${r3.server}`);
    ctx.assert.ok(!fails.length, fails.join("; "));

    const fLoc = await ctx.npcLocation(FARENGAR);
    const [fx, fy] = inFront(fLoc, 150);
    await moveBoth(fLoc, fx, fy);
    await loaded(FARENGAR);
    const given = await talk(FARENGAR, () => done(MQ103, 190), /stone|pierre/i, "Farengar takes the Dragonstone");
    await ctx.sleep(3000);
    const s4 = { done190: await done(MQ103, 190), held: await held(STONE), server: await serverHeld(leader, STONE) };
    ctx.evidence.push(`S4 (G2.3's turn-in): ${given.picks} topic picks; MQ103 190 done ${s4.done190}; the Dragonstone client ${s4.held}, server ${s4.server}; the member's MQ103 log ${JSON.stringify(await memberLog(MQ103))}`);
    if (!s4.done190 || s4.held !== 0 || s4.server !== 0) fails.push(`S4: MQ103 190 done ${s4.done190}, the Dragonstone client ${s4.held}, server ${s4.server} (expected done, 0, 0)`);
    if (!(await memberLog(MQ103)).includes(190)) fails.push("S4: the member's log has no MQ103 190 (the party did not survive the S3 relog)");
    const b4 = await relog("S4", async () => (await done(MQ103, 190)) && (await held(STONE)) === 0);
    const r4 = { done190: await done(MQ103, 190), held: await held(STONE), server: await serverHeld(leader, STONE) };
    ctx.evidence.push(`S4 after the relog: MQ103 190 done ${r4.done190}, the Dragonstone client ${r4.held}, server ${r4.server}`);
    await holdersEmpty("S4 after the relog", [ARVEL_CLAW, BOSS_STONE]);
    if (!b4 || r4.held !== 0 || r4.server !== 0) fails.push(`S4 after the relog: MQ103 190 done ${r4.done190}, the Dragonstone client ${r4.held}, server ${r4.server}`);
    ctx.assert.ok(!fails.length, fails.join("; "));

    await moveBoth({ cellOrWorldDesc: "3c:Skyrim.esm", pos: SPOT, rot: [0, 0, 0] });
    await ctx.waitFor(() => ctx.drv(`const p = sp.Game.getPlayer(); return !sp.Ui.isMenuOpen("Loading Menu") && !!p.getWorldSpace() && p.getWorldSpace().getFormID() === 0x3c;`).catch(() => false), 120000, "the leader is at the Western Watchtower");
    await ctx.drv(`return ${q(MQ104)}.setCurrentStageID(60);`);
    await ctx.waitFor(() => ctx.probe(`return !mp.get(${DRAGON}, "isDisabled") && mp.get(${DRAGON}, "hoster") === ${leader};`), 60000, "Mirmulnir is enabled on the server and hosted by the leader").catch(() => {});
    await ctx.sleep(4000);
    await ctx.probe(`mp.set(${DRAGON}, "isDead", true); return 0;`);
    await ctx.waitFor(() => done(MQ104, 90), 20000, "MQ104 90").catch(() => {});
    await ctx.sleep(2000);
    await answerBox();
    const bLoc = await ctx.npcLocation(BALGRUUF);
    const [bx, by] = inFront(bLoc, 200);
    await moveBoth(bLoc, bx, by);
    await loaded(BALGRUUF);
    const invOf = () => ctx.drv(`const p = sp.Game.getPlayer(); const out = {}; for (let i = 0; i < p.getNumItems(); i++) { const f = p.getNthForm(i); if (f) out[f.getFormID()] = p.getItemCount(f); } return out;`);
    const invBefore = await invOf();
    const reward = await talk(BALGRUUF, () => done(MQ104, 160), /récompense|reward|thane/i, "MQ104 160");
    await ctx.sleep(3000);
    const invAfter = await invOf();
    const gained = Object.keys(invAfter).map(Number).filter((id) => (invAfter[id] || 0) > (invBefore[id] || 0));
    const axe = (await ctx.drv(`return ${JSON.stringify(gained)}.filter((id) => !!sp.Weapon.from(sp.Game.getFormEx(id)));`))[0] || 0;
    await ctx.sleep(STAY_MS);
    const fus = () => ctx.drv(`return sp.Game.isWordUnlocked(sp.WordOfPower.from(sp.Game.getFormEx(${FUS})));`);
    const s5 = { done90: await done(MQ104, 90), done160: await done(MQ104, 160), fus: await fus(), axe: axe ? await held(axe) : 0, serverAxe: axe ? await serverHeld(leader, axe) : 0 };
    ctx.evidence.push(`S5 (G2.4's step): MQ104 90 done ${s5.done90}, 160 done ${s5.done160} (${reward.picks} topic picks, ${reward.boxes} boxes); Fus ${s5.fus}; the leader gained ${JSON.stringify(gained.map(hex))}, the reward weapon ${hex(axe)} ${STAY_MS / 1000} s later: client ${s5.axe}, server ${s5.serverAxe}`);
    if (!s5.done160 || !axe || s5.axe !== 1 || s5.serverAxe !== 1) fails.push(`S5: MQ104 160 done ${s5.done160}, the reward weapon ${hex(axe)} ${STAY_MS / 1000} s later client ${s5.axe}, server ${s5.serverAxe}`);
    const equippedRight = () => ctx.drv(`const w = sp.Game.getPlayer().getEquippedWeapon(false); return w ? w.getFormID() : 0;`);
    const serverWorn = () => ctx.probe(`const eq = mp.get(${leader}, "equipment"); return eq && eq.inv ? eq.inv.entries.filter((x) => x.worn || x.wornLeft).map((x) => x.baseId) : [];`);
    if (axe) await ctx.drv(`sp.Game.getPlayer().equipItem(sp.Game.getFormEx(${axe}), false, true); return 0;`);
    const worn = !!axe && await ctx.waitFor(async () => (await equippedRight()) === axe && (await serverWorn()).includes(axe), 15000, "the reward weapon is equipped").then(() => true).catch(() => false);
    ctx.evidence.push(`S5: the leader equipped ${hex(axe)}: client right hand ${hex(await equippedRight())}, server worn ${JSON.stringify((await serverWorn()).map(hex))}`);
    if (!worn) fails.push("S5: the reward weapon is not equipped on the client and the server");
    const lLoc = await ctx.drv(`const a = sp.Actor.from(sp.Game.getFormEx(${LYDIA})); return a && a.is3DLoaded() ? [a.getPositionX(), a.getPositionY(), a.getPositionZ(), a.getAngleZ()] : null;`);
    if (lLoc) {
      const r = lLoc[3] * Math.PI / 180;
      await ctx.drv(`sp.Game.getPlayer().setPosition(${lLoc[0] + 120 * Math.sin(r)}, ${lLoc[1] + 120 * Math.cos(r)}, ${lLoc[2] + 10}); return 0;`);
      await ctx.sleep(2000);
    }
    const follows = async () => { const f = await follower(); return !!f && f.teammate && f.rank >= 0; };
    const followed = lLoc ? (await talk(LYDIA, follows, /suis|suiv|follow/i, "Lydia follows")).ok : false;
    await ctx.sleep(2000);
    ctx.evidence.push(`S5: Lydia follows the leader ${followed} (${JSON.stringify(await follower())}); the server's stored followers ${JSON.stringify(await ctx.probe(`return mp.get(${leader}, "private.coopFollowers") || null;`))}; the member's MQ104 log ${JSON.stringify(await memberLog(MQ104))}`);
    if (!followed) fails.push("S5: Lydia did not become the leader's follower");
    const memberMq104 = await memberLog(MQ104);
    if (!memberMq104.includes(90) || !memberMq104.includes(160)) fails.push(`S5: the member's MQ104 log ${JSON.stringify(memberMq104)} lacks 90 or 160 (the party did not survive the S4 relog)`);
    const soulsBefore = await ctx.drv(`return sp.Game.getPlayer().getActorValue("DragonSouls");`);
    const b5 = await relog("S5", async () => (await done(MQ104, 160)) && (await follows()) && (await equippedRight()) === axe);
    const r5 = { souls: await ctx.drv(`return sp.Game.getPlayer().getActorValue("DragonSouls");`), soulsBefore, done160: await done(MQ104, 160), fus: await fus(), axe: axe ? await held(axe) : 0, serverAxe: axe ? await serverHeld(leader, axe) : 0, equipped: hex(await equippedRight()), worn: (await serverWorn()).map(hex), lydia: await follower() };
    ctx.evidence.push(`S5 after the relog: ${JSON.stringify(r5)}`);
    await holdersEmpty("S5 after the relog", [ARVEL_CLAW, BOSS_STONE], true);
    ctx.shot("G2_5-relog");
    if (r5.souls !== soulsBefore) fails.push(`S5 after the relog: the leader's DragonSouls went ${soulsBefore} -> ${r5.souls} (the replay must not grant or take souls)`);
    if (!b5 || !r5.fus || r5.axe !== 1 || r5.serverAxe !== 1 || !r5.worn.includes(hex(axe))) fails.push(`S5 after the relog: ${JSON.stringify(r5)} (expected 160 done, Fus, one reward weapon on the client and the server, equipped, Lydia following)`);

    relogs.forEach((line) => ctx.evidence.push(`relog ${line}`));
    const touched = ctx.clientLog(1).filter((l) => /Stray quest item removed|relink failed/.test(l)).map((l) => l.replace(/^.*CoopService: /, "").trim());
    ctx.evidence.push(`the leader client's stray removals and failed relinks: ${JSON.stringify(touched)}`);
    const wrong = touched.filter((l) => l !== `Stray quest item removed ${hex(MQ103)} 18 ${hex(BOSS)}`);
    if (wrong.length) fails.push(`the leader client removed or failed to relink other quest items: ${JSON.stringify(wrong)} (only the boss's restarted Dragonstone may go)`);
    ctx.assert.ok(!fails.length, fails.join("; "));
  },
};
