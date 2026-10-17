const fs = require("fs");
const path = require("path");
const DRAGON = 0x5a6ca;
const MQ104 = 0x2610c;
const MQ104_DRAGON_STAGE = 60;
const SOUL_STAGE = 90;
const REWARD_STAGE = 160;
const ABSORBED = 0x1c0f2;
const FUS = 0x13e22;
const BALGRUUF = 0x1a677;
const LYDIA = 0xa2c94;
const FOLLOWER_FACTION = 0x5c84e;
const SPOT = [7572, -39162, 3807];
const BOT_PROFILE = 920104;
const M = "Dialogue Menu";
const R = "_root.DialogueMenu_mc";

module.exports = {
  engines: 1,
  timeout: 25 * 60000,
  setup: (ctx) => ctx.character(1, { pos: SPOT, angleZ: 0, worldOrCell: 0x3c }),
  async run(ctx) {
    const leader = await ctx.ready(1);
    const hex = (v) => (v >>> 0).toString(16);
    const log = () => fs.readFileSync(path.join(ctx.dir, "server.log"), "utf8");
    const quest = `sp.Quest.from(sp.Game.getFormEx(${MQ104}))`;
    const done = (s) => ctx.drv(`return ${quest}.isStageDone(${s});`);
    const stage = () => ctx.drv(`const q = ${quest}; return q.isRunning() ? q.getCurrentStageID() : -1;`);
    const souls = () => ctx.drv(`return { souls: sp.Game.getPlayer().getActorValue("DragonSouls"), absorbed: sp.GlobalVariable.from(sp.Game.getFormEx(${ABSORBED})).getValue(), fus: sp.Game.isWordUnlocked(sp.WordOfPower.from(sp.Game.getFormEx(${FUS}))) };`);
    const memberLog = () => ctx.probe(`return (mp.get(globalThis.g24member, "private.questLog") || []).filter(([q]) => q === ${MQ104}).map(([, s]) => s);`);
    const serverRef = (id) => ctx.probe(`return { cell: mp.get(${id}, "locationalData").cellOrWorldDesc, pos: mp.get(${id}, "locationalData").pos.map(Math.round), disabled: !!mp.get(${id}, "isDisabled"), dead: !!mp.get(${id}, "isDead"), hoster: mp.get(${id}, "hoster") || 0 };`);
    const moveBoth = async (loc, dx, dy) => {
      for (const [a, k] of [[leader, 1], ["globalThis.g24member", -1]]) {
        await ctx.probe(`mp.set(${a}, "locationalData", ${JSON.stringify({ ...loc, pos: [loc.pos[0] + dx + k * 40, loc.pos[1] + dy, loc.pos[2] + 30] })}); return 0;`);
      }
    };
    const fails = [];

    await ctx.waitFor(() => ctx.probe(`const l = mp.get(${leader}, "private.questLog"); return Array.isArray(l) && l.length > 0;`), 60000, "the client reports quest stages");
    const base = await ctx.probe(`return mp.get(${leader}, "locationalData");`);
    const member = await ctx.probe(`const bot = mp.createBot(); globalThis.g24bot = bot;
      bot.send({ t: 1, contentJsonDump: JSON.stringify({ customPacketType: "loginWithSkympIo", gameData: { profileId: ${BOT_PROFILE} } }) });
      await new Promise((r) => setTimeout(r, 800));
      const a = mp.getUserActor(bot.getUserId()); globalThis.g24member = a;
      mp.set(a, "locationalData", ${JSON.stringify({ ...base, pos: [base.pos[0] + 150, base.pos[1], base.pos[2]] })});
      return a;`);
    ctx.assert.ok(member, "the bot member got no actor");
    await ctx.drv(`sp.mpClientPlugin.send(JSON.stringify({ t: 1, contentJsonDump: JSON.stringify({ customPacketType: "partyInvite", target: ${member} }) }), true); return 0;`);
    await ctx.sleep(1000);
    await ctx.probe(`globalThis.g24bot.send({ t: 1, contentJsonDump: JSON.stringify({ customPacketType: "partyAccept", inviter: ${leader} }) }); return 0;`);
    const joined = await ctx.waitFor(() => log().includes(`Coop: ${hex(member)} joined party`), 15000, "the bot joins the leader's party").then(() => true).catch(() => false);
    ctx.assert.ok(joined, "the bot member did not join the leader's party");

    const before = await souls();
    await ctx.drv(`return ${quest}.setCurrentStageID(${MQ104_DRAGON_STAGE});`);
    const enabled = await ctx.waitFor(async () => {
      const l = await ctx.drv(`const a = sp.Actor.from(sp.Game.getFormEx(${DRAGON})); return !!a && a.is3DLoaded() && !a.isDisabled();`).catch(() => false);
      const s = await serverRef(DRAGON);
      return l && !s.disabled && s.hoster === leader;
    }, 60000, "Mirmulnir is enabled on the leader and on the server, hosted by the leader").then(() => true).catch(() => false);
    const alive = { stage: await stage(), server: await serverRef(DRAGON), member: await memberLog() };
    ctx.evidence.push(`A: leader ${hex(leader)}, bot member ${hex(member)} in the party at the Western Watchtower; the leader set MQ104 to ${MQ104_DRAGON_STAGE} by script (its fragment enables Mirmulnir): MQ104 stage ${alive.stage}; Mirmulnir ${hex(DRAGON)} on the server ${JSON.stringify(alive.server)} (hoster ${hex(alive.server.hoster)}); the member's MQ104 log ${JSON.stringify(alive.member)}; the leader before: ${JSON.stringify(before)}`);
    if (!enabled) fails.push("A: Mirmulnir is not enabled on the leader and on the server with the leader as hoster within 60 s of MQ104 stage 60");
    if (alive.member.includes(SOUL_STAGE)) fails.push("A: the member's log has MQ104 90 before the kill");

    await ctx.sleep(4000);
    const killedAt = Date.now();
    await ctx.probe(`mp.set(${DRAGON}, "isDead", true); return 0;`);
    const soulStage = await ctx.waitFor(() => done(SOUL_STAGE), 20000, `MQ104 stage ${SOUL_STAGE} is done on the leader`).then(() => true).catch(() => false);
    await ctx.sleep(3000);
    const after = await souls();
    const soulLines = log().split(/\r?\n/).filter((l) => l.includes(`Coop: dragon ${hex(DRAGON)} gives its soul to`)).map((l) => l.replace(/^.*Coop: /, ""));
    const relay90 = await ctx.waitFor(async () => (await memberLog()).includes(SOUL_STAGE), 10000, "the member's log has MQ104 90").then(() => true).catch(() => false);
    ctx.evidence.push(`B: the server killed Mirmulnir; ${((Date.now() - killedAt) / 1000).toFixed(1)} s later: MQ104 stage ${await stage()} (90 done ${soulStage}); the leader ${JSON.stringify(before)} -> ${JSON.stringify(after)}; server soul lines ${JSON.stringify(soulLines)}; the member's MQ104 log ${JSON.stringify(await memberLog())}`);
    if (!soulStage) fails.push("B: MQ104 stage 90 is not done on the leader after Mirmulnir died");
    if (after.absorbed - before.absorbed !== 1) fails.push(`B: the leader's DragonsAbsorbed went ${before.absorbed} -> ${after.absorbed} (expected +1)`);
    if (!after.fus || before.fus) fails.push(`B: the leader's Fus unlocked ${before.fus} -> ${after.fus} (stage 90 teaches it)`);
    for (const a of [leader, member]) if (!soulLines.includes(`dragon ${hex(DRAGON)} gives its soul to ${hex(a)}`)) fails.push(`B: the server gave no soul to ${hex(a)}`);
    if (!relay90) fails.push("B: the member's log has no MQ104 90");

    const bLoc = await ctx.npcLocation(BALGRUUF);
    const br = bLoc.rot[2] * Math.PI / 180;
    await moveBoth(bLoc, 200 * Math.sin(br), 200 * Math.cos(br));
    await ctx.waitFor(() => ctx.drv(`const a = sp.Actor.from(sp.Game.getFormEx(${BALGRUUF})); return !sp.Ui.isMenuOpen("Loading Menu") && !!a && a.is3DLoaded();`).catch(() => false), 120000, "Balgruuf is loaded");
    const reward = await ctx.talk(BALGRUUF, () => done(REWARD_STAGE), /thane|récompense|reward/i, `MQ104 stage ${REWARD_STAGE} is done`, { quest: MQ104 });
    ctx.evidence.push(`C: Balgruuf: message boxes answered (first button) at MQ104 stages ${JSON.stringify(reward.dismissed)}; ${reward.picks} topic picks, ${reward.stalls} stalled menus closed (${reward.topics.map((x) => `"${x}"`).join(", ")}), MQ104 stages ${reward.stages.join(" -> ")}, last line "${reward.last}"; 160 done ${reward.ok}`);
    if (!reward.ok) fails.push(`C: MQ104 stage ${REWARD_STAGE} (Balgruuf's reward, Lydia enabled) is not done`);
    if (reward.dismissed.some((st) => st !== SOUL_STAGE)) fails.push(`C: message boxes answered during Balgruuf's talk at MQ104 stages ${JSON.stringify(reward.dismissed)} (expected only the stage ${SOUL_STAGE} box)`);

    const lydiaHere = await ctx.waitFor(() => ctx.drv(`const a = sp.Actor.from(sp.Game.getFormEx(${LYDIA})); return !!a && a.is3DLoaded() && !a.isDisabled();`).catch(() => false), 60000, "Lydia is enabled and loaded on the leader").then(() => true).catch(() => false);
    if (lydiaHere) {
      await ctx.drv(`const a = sp.Actor.from(sp.Game.getFormEx(${LYDIA})); const p = sp.Game.getPlayer(); p.setPosition(a.getPositionX() + 120 * Math.sin(a.getAngleZ() * Math.PI / 180), a.getPositionY() + 120 * Math.cos(a.getAngleZ() * Math.PI / 180), a.getPositionZ() + 10); return 0;`);
      await ctx.sleep(2000);
    }
    const follower = () => ctx.drv(`const a = sp.Actor.from(sp.Game.getFormEx(${LYDIA})); const f = sp.Faction.from(sp.Game.getFormEx(${FOLLOWER_FACTION})); return { teammate: a.isPlayerTeammate(), rank: a.getFactionRank(f) };`);
    const lydiaBefore = lydiaHere ? await follower() : null;
    const follow = lydiaHere ? await ctx.talk(LYDIA, async () => { const f = await follower(); return f.teammate && f.rank >= 0; }, /suis|suiv|follow|accompagn/i, "Lydia follows the leader", { quest: MQ104 }) : { ok: false, picks: 0, topics: [], stages: [], last: "" };
    const lydiaAfter = lydiaHere ? await follower() : null;
    const lydiaServer = await serverRef(LYDIA);
    ctx.evidence.push(`C: Lydia ${hex(LYDIA)} enabled and loaded on the leader ${lydiaHere}; before the talk ${JSON.stringify(lydiaBefore)}; message boxes answered ${JSON.stringify(follow.dismissed || [])}; ${follow.picks} topic picks (${follow.topics.map((x) => `"${x}"`).join(", ")}), last line "${follow.last}"; after: ${JSON.stringify(lydiaAfter)} (CurrentFollowerFaction rank, player teammate); server ${JSON.stringify(lydiaServer)} (hoster ${hex(lydiaServer.hoster)})`);
    ctx.shot("G2_4-lydia");
    if (!lydiaHere) fails.push("C: Lydia is not enabled and loaded on the leader after stage 160");
    else if (!follow.ok) fails.push(`C: Lydia is not the leader's follower after the talk (${JSON.stringify(lydiaAfter)})`);
    if (lydiaHere && lydiaBefore && lydiaBefore.teammate) fails.push("C: Lydia was already the leader's teammate before the talk");
    if ((follow.dismissed || []).length) fails.push(`C: message boxes answered during Lydia's talk at MQ104 stages ${JSON.stringify(follow.dismissed)}`);
    if (lydiaServer.disabled || lydiaServer.hoster !== leader) fails.push(`C: on the server Lydia is disabled ${lydiaServer.disabled}, hoster ${hex(lydiaServer.hoster)} (expected enabled, hosted by the leader)`);
    ctx.assert.ok(!fails.length, fails.join("; "));
  },
};
