const fs = require("fs");
const path = require("path");
const MS13 = 0x39645;
const CLAW = 0x39647;
const GOLD = 0xf;
const STAGE = 100;

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
    const quest = `sp.Quest.from(sp.Game.getFormEx(${MS13}))`;
    const serverCount = (actor, item) => ctx.probe(`return ((mp.get(${actor}, "inventory") || { entries: [] }).entries).filter((e) => e.baseId === ${item}).reduce((s, e) => s + e.count, 0);`);
    const localCount = (n, item) => ctx.drv(`return sp.Game.getPlayer().getItemCount(sp.Game.getFormEx(${item}));`, n);
    const send = (n, content) => ctx.drv(`sp.mpClientPlugin.send(JSON.stringify({ t: 1, contentJsonDump: ${JSON.stringify(JSON.stringify(content))} }), true); return 0;`, n);
    const state = async (n) => ({ claw: { server: await serverCount(actors[n - 1], CLAW), local: await localCount(n, CLAW) }, gold: { server: await serverCount(actors[n - 1], GOLD), local: await localCount(n, GOLD) } });
    const fmt = (s) => `claw server ${s.claw.server} local ${s.claw.local}, gold server ${s.gold.server} local ${s.gold.local}`;
    const fails = [];

    for (const actor of actors) {
      await ctx.waitFor(() => ctx.probe(`const l = mp.get(${actor}, "private.questLog"); return Array.isArray(l) && l.length > 0;`), 60000, `${hex(actor)} reports quest stages`);
    }
    await send(1, { customPacketType: "partyInvite", target: member });
    await ctx.sleep(1500);
    await send(2, { customPacketType: "partyAccept", inviter: leader });
    const joined = await ctx.waitFor(() => fs.readFileSync(path.join(ctx.dir, "server.log"), "utf8").includes(`Coop: ${hex(member)} joined party`), 15000, "engine 2 joins the party").then(() => true).catch(() => false);
    ctx.assert.ok(joined, "engine 2 did not join engine 1's party");
    await ctx.sleep(11000);

    await ctx.probe(`mp.callPapyrusFunction("method", "ObjectReference", "AddItem", { type: "form", desc: mp.getDescFromId(${leader}) }, [mp.callPapyrusFunction("global", "Game", "GetFormEx", null, [${CLAW}]), 1, true]); return 0;`);
    await ctx.waitFor(() => localCount(1, CLAW).then((c) => c === 1), 15000, "engine 1 has the claw from the server");
    const ms13 = { 1: await ctx.drv(`const q = ${quest}; return { running: q.isRunning(), stage: q.getCurrentStageID() };`, 1), 2: await ctx.drv(`const q = ${quest}; return { running: q.isRunning(), stage: q.getCurrentStageID() };`, 2) };
    const before = { 1: await state(1), 2: await state(2) };
    ctx.evidence.push(`party joined; MS13 on engine 1 ${JSON.stringify(ms13[1])}, on engine 2 ${JSON.stringify(ms13[2])}; before stage ${STAGE}: engine 1 ${fmt(before[1])}; engine 2 ${fmt(before[2])}`);

    const early = fs.readFileSync(path.join(ctx.dir, "server.log"), "utf8").split("\n").filter((l) => l.includes("Coop: script items of"));
    ctx.evidence.push(`script item reports before the stage: ${early.length ? early.map((l) => l.slice(l.indexOf("Coop:"))).join(" | ") : "none"}`);
    if (early.length) fails.push(`the clients reported script items before any script ran (login and party join): ${early.length}`);
    const set = await ctx.drv(`return ${quest}.setCurrentStageID(${STAGE});`, 1);
    const stageAt = Date.now();
    const seen = { claw1: before[1].claw.local, gold1: before[1].gold.local, gold2: before[2].gold.local };
    while (Date.now() - stageAt < 6000) {
      seen.claw1 = Math.min(seen.claw1, await localCount(1, CLAW));
      seen.gold1 = Math.max(seen.gold1, await localCount(1, GOLD));
      seen.gold2 = Math.max(seen.gold2, await localCount(2, GOLD));
      await ctx.sleep(150);
    }
    const leaderDone = await ctx.waitFor(async () => { const s = await state(1); return s.claw.server === 0 && s.gold.server !== before[1].gold.server; }, 8000, "the server has engine 1's script loss and gain").then(() => true).catch(() => false);
    const memberStage = await ctx.waitFor(() => ctx.drv(`return ${quest}.getCurrentStageID();`, 2).then((s) => s === STAGE), 10000, `engine 2 applies MS13 stage ${STAGE}`).then(() => true).catch(() => false);
    const memberDone = await ctx.waitFor(async () => { const s = await state(2); return s.gold.server !== before[2].gold.server; }, 8000, "the server has engine 2's script gain").then(() => true).catch(() => false);
    const after = { 1: await state(1), 2: await state(2) };
    ctx.evidence.push(`setStage ${STAGE} on engine 1 returned ${set}; local values seen in the first 6 s: engine 1 claw ${seen.claw1}, gold ${seen.gold1}; engine 2 gold ${seen.gold2}; within 8 s the server has engine 1's changes ${leaderDone}, engine 2 at stage ${STAGE} ${memberStage}, the server has engine 2's gain ${memberDone}; after: engine 1 ${fmt(after[1])}; engine 2 ${fmt(after[2])}`);

    await ctx.sleep(12000);
    const later = { 1: await state(1), 2: await state(2) };
    ctx.evidence.push(`12 s later (past two client re-applies of the server inventory): engine 1 ${fmt(later[1])}; engine 2 ${fmt(later[2])}`);
    const gain1 = seen.gold1 - before[1].gold.local;
    const gain2 = seen.gold2 - before[2].gold.local;
    if (!set) fails.push(`engine 1 could not set MS13 stage ${STAGE}`);
    if (before[1].claw.local !== 1 || seen.claw1 !== 0) fails.push(`engine 1's script did not remove the claw locally (${before[1].claw.local} -> ${seen.claw1})`);
    if (gain1 <= 0) fails.push(`engine 1's script gave no gold locally (${before[1].gold.local} -> ${seen.gold1})`);
    if (later[1].claw.server !== 0 || later[1].claw.local !== 0) fails.push(`engine 1's claw: server ${later[1].claw.server}, local ${later[1].claw.local} (the script loss must reach the server and stay)`);
    if (later[1].gold.server - before[1].gold.server !== gain1 || later[1].gold.local - before[1].gold.local !== gain1) fails.push(`engine 1's gold: script gain ${gain1}, server ${before[1].gold.server} -> ${later[1].gold.server}, local ${before[1].gold.local} -> ${later[1].gold.local} (the gain must reach the server and stay)`);
    if (!memberStage || gain2 <= 0 || gain2 !== gain1) fails.push(`engine 2 (member): stage ${STAGE} applied ${memberStage}, local gold gain ${gain2} (engine 1: ${gain1})`);
    else if (later[2].gold.server - before[2].gold.server !== gain2 || later[2].gold.local - before[2].gold.local !== gain2) fails.push(`engine 2's gold: script gain ${gain2}, server ${before[2].gold.server} -> ${later[2].gold.server}, local ${before[2].gold.local} -> ${later[2].gold.local} (the member's gain must reach the server and stay)`);

    await ctx.sleep(Math.max(0, stageAt + 17000 - Date.now()));
    const quiet = await state(1);
    const added = await ctx.drv(`const p = sp.Game.getPlayer(); const g = sp.Game.getFormEx(${GOLD}); p.addItem(g, 50, true); return p.getItemCount(g);`, 1);
    await ctx.sleep(12000);
    const end = await state(1);
    ctx.evidence.push(`no stage for 17 s, then a script adds 50 gold on engine 1: before ${fmt(quiet)}; local gold right after the add ${added}; 13 s after: ${fmt(end)}`);
    if (added !== quiet.gold.local + 50) fails.push(`the 50 gold add did not run on engine 1 (${quiet.gold.local} -> ${added})`);
    if (end.gold.server !== quiet.gold.server || end.gold.local !== quiet.gold.server) fails.push(`a script gain outside a stage window: server gold ${quiet.gold.server} -> ${end.gold.server}, local ${end.gold.local} (the server must refuse it, the client must drop it, and nothing else may change)`);

    const reports = fs.readFileSync(path.join(ctx.dir, "server.log"), "utf8").split("\n").filter((l) => l.includes("Coop: script items of")).map((l) => l.slice(l.indexOf("Coop:")).trim());
    const expected = [
      `Coop: script items of ${hex(leader)}: losses ${hex(CLAW)}x1, gains ${hex(GOLD)}x${gain1}, refused -`,
      `Coop: script items of ${hex(member)}: losses -, gains ${hex(GOLD)}x${gain1}, refused -`,
      `Coop: script items of ${hex(leader)}: losses -, gains -, refused ${hex(GOLD)}x50`,
    ];
    ctx.evidence.push(`all script item reports on the server: ${reports.join(" | ") || "none"}`);
    if (reports.length !== expected.length || !expected.every((e) => reports.includes(e))) fails.push(`the server's script item reports are not exactly the stage ${STAGE} loss and gains and the refused 50 gold`);

    ctx.assert.ok(!fails.length, fails.join("; "));
  },
};
