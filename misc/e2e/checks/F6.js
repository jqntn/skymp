const fs = require("fs");
const path = require("path");
const MQ104 = 0x2610c;
const REWARD_STAGE = 160;
const LYDIA = 0xa2c94;
const FOLLOWER_FACTION = 0x5c84e;
const SPOT = [7572, -39162, 3807];
const FOLLOW = /suis|suiv|follow|accompagn/i;

module.exports = {
  engines: 2,
  timeout: 20 * 60000,
  setup: async (ctx) => {
    await ctx.character(1, { pos: SPOT, angleZ: 0, worldOrCell: 0x3c });
    await ctx.character(2, { pos: [SPOT[0] + 150, SPOT[1], SPOT[2]], angleZ: 0, worldOrCell: 0x3c });
  },
  async run(ctx) {
    let [leader, member] = [await ctx.ready(1), await ctx.ready(2)];
    const hex = (v) => (v >>> 0).toString(16);
    const send = (n, content) => ctx.drv(`sp.mpClientPlugin.send(JSON.stringify({ t: 1, contentJsonDump: ${JSON.stringify(JSON.stringify(content))} }), true); return 0;`, n);
    const follower = (n) => ctx.drv(`const a = sp.Actor.from(sp.Game.getFormEx(${LYDIA})); const f = sp.Faction.from(sp.Game.getFormEx(${FOLLOWER_FACTION})); return a ? { teammate: a.isPlayerTeammate(), rank: a.getFactionRank(f) } : null;`, n);
    const follows = async (n) => { const f = await follower(n); return !!f && f.teammate && f.rank >= 0; };
    const free = async (n) => { const f = await follower(n); return !f || (!f.teammate && f.rank < 0); };
    const stored = (a) => ctx.probe(`const s = mp.get(${a}, "private.coopFollowers"); return Array.isArray(s) ? s : [];`);
    const hoster = () => ctx.probe(`return mp.get(${LYDIA}, "hoster") || 0;`);
    const seen = (n) => ctx.drv(`const a = sp.Actor.from(sp.Game.getFormEx(${LYDIA})); const p = sp.Game.getPlayer(); const cell = (r) => r.getParentCell() ? r.getParentCell().getFormID().toString(16) : null; const h = sp.storage["hosted"]; return a ? { loaded: a.is3DLoaded(), disabled: a.isDisabled(), cell: cell(a), playerCell: cell(p), dist: Math.round(a.getDistance(p)), hosted: Array.isArray(h) && h.includes(${LYDIA}) } : null;`, n).catch((e) => e.message);
    const where = (a) => ctx.probe(`const l = mp.get(${a}, "locationalData"); return l ? [l.cellOrWorldDesc, ...l.pos.map(Math.round)].join(" ") : null;`);
    const state = async () => ({ leader: await follower(1), member: await follower(2), storedLeader: (await stored(leader)).map(hex), storedMember: (await stored(member)).map(hex), hoster: hex(await hoster()), seenLeader: await seen(1), seenMember: await seen(2), server: { lydia: await where(LYDIA), leader: await where(leader), member: await where(member) } });
    const owned = async (owner, other, n, m) => (await follows(n)) && (await free(m)) && (await stored(owner)).includes(LYDIA) && !(await stored(other)).includes(LYDIA) && (await hoster()) === owner;
    const fails = [];

    await send(1, { customPacketType: "partyInvite", target: member });
    await ctx.sleep(1500);
    await send(2, { customPacketType: "partyAccept", inviter: leader });
    const joined = await ctx.waitFor(() => fs.readFileSync(path.join(ctx.dir, "server.log"), "utf8").includes(`Coop: ${hex(member)} joined party`), 15000, "engine 2 joins the party").then(() => true).catch(() => false);
    ctx.assert.ok(joined, "engine 2 did not join engine 1's party");

    await ctx.drv(`return sp.Quest.from(sp.Game.getFormEx(${MQ104})).setCurrentStageID(10);`, 1);
    await ctx.sleep(3000);
    await ctx.drv(`return sp.Quest.from(sp.Game.getFormEx(${MQ104})).setCurrentStageID(${REWARD_STAGE});`, 1);
    await ctx.sleep(3000);
    const enable = () => ctx.probe(`mp.callPapyrusFunction("method", "ObjectReference", "Enable", { type: "form", desc: mp.getDescFromId(${LYDIA}) }, [false]); return 0;`);
    const loadedOn = (ms) => Promise.all([1, 2].map((n) => ctx.waitFor(() => ctx.drv(`const a = sp.Actor.from(sp.Game.getFormEx(${LYDIA})); return !!a && a.is3DLoaded() && !a.isDisabled();`, n).catch(() => false), ms, `Lydia is loaded on engine ${n}`).then(() => true).catch(() => false)));
    await enable();
    await ctx.sleep(3000);
    const loc = await ctx.npcLocation(LYDIA);
    for (const [a, k] of [[leader, 1], [member, -1]]) {
      await ctx.probe(`mp.set(${a}, "locationalData", ${JSON.stringify({ ...loc, pos: [loc.pos[0] + 120 * k, loc.pos[1] + 80, loc.pos[2] + 30] })}); return 0;`);
    }
    for (const n of [1, 2]) await ctx.waitFor(() => ctx.drv(`const p = sp.Game.getPlayer(); return !sp.Ui.isMenuOpen("Loading Menu") && p.is3DLoaded();`, n).catch(() => false), 120000, `engine ${n} arrives at Lydia`);
    await ctx.sleep(3000);
    let shown = await loadedOn(20000);
    const serverLydia = await ctx.probe(`return { disabled: !!mp.get(${LYDIA}, "isDisabled"), pos: mp.get(${LYDIA}, "locationalData").pos.map(Math.round) };`);
    if (!shown.every(Boolean)) {
      await enable();
      shown = await loadedOn(40000);
    }
    ctx.evidence.push(`A: party formed; the leader set MQ104 to 10, then ${REWARD_STAGE}, the server enabled Lydia ${hex(LYDIA)}, and both moved next to her (${JSON.stringify(loc.pos.map(Math.round))} in ${loc.cellOrWorldDesc}, server ${JSON.stringify(serverLydia)} 20 s later): Lydia enabled and loaded on the leader ${shown[0]}, on the member ${shown[1]}; ${JSON.stringify(await state())}`);
    ctx.assert.ok(shown.every(Boolean), "Lydia is not enabled and loaded on both clients after MQ104 160");

    const b = await ctx.talk(LYDIA, () => follows(1), FOLLOW, "Lydia follows the leader", { engine: 1, quest: MQ104 });
    const bOwned = await ctx.waitFor(() => owned(leader, member, 1, 2), 30000, "the leader owns and hosts Lydia").then(() => true).catch(() => false);
    ctx.evidence.push(`B: the leader asked Lydia to follow (${b.picks} topic picks: ${b.topics.map((x) => `"${x}"`).join(", ")}): ${JSON.stringify(await state())}`);
    if (!b.ok || !bOwned) fails.push(`B: Lydia is not the leader's follower, stored and hosted for the leader only (${JSON.stringify(await state())})`);
    else if (b.picks > 1) fails.push(`B: Lydia followed the leader only after ${b.picks} asks`);

    const c = await ctx.talk(LYDIA, () => follows(2), FOLLOW, "Lydia follows the member", { engine: 2, quest: MQ104 });
    const cOwned = await ctx.waitFor(() => owned(member, leader, 2, 1), 30000, "the member owns and hosts Lydia").then(() => true).catch(() => false);
    ctx.evidence.push(`C: the member asked Lydia to follow (${c.picks} topic picks: ${c.topics.map((x) => `"${x}"`).join(", ")}): ${JSON.stringify(await state())}`);
    if (!c.ok) fails.push("C: the member could not make Lydia follow him");
    else if (!cOwned) fails.push(`C: after the member asked, Lydia is not his follower only, stored and hosted for him (${JSON.stringify(await state())})`);
    else if (c.picks > 1) fails.push(`C: Lydia followed the member only after ${c.picks} asks`);

    leader = await ctx.relog(1);
    member = await ctx.relog(2);
    const dOwned = await ctx.waitFor(() => owned(member, leader, 2, 1), 60000, "the member still owns and hosts Lydia after both relogs").then(() => true).catch(() => false);
    ctx.evidence.push(`D: both players logged in again: ${JSON.stringify(await state())}`);
    if (!dOwned) fails.push(`D: after both relogs Lydia is not the member's follower only, stored and hosted for him (${JSON.stringify(await state())})`);

    ctx.assert.ok(!fails.length, fails.join("; "));
  },
};
