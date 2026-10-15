const fs = require("fs");
const path = require("path");
const DRAGON = 0x5a6ca;
const MQ104 = 0x2610c;
const MQ104_START = 10;
const MQ104_SOUL_STAGE = 90;
const ABSORBED = 0x1c0f2;
const FUS = 0x13e22;
const SPOT = [7572, -39162, 3807];
const FAR = { cellOrWorldDesc: "1a26f:Skyrim.esm", pos: [26691, 1678, -1404], rot: [0, 0, 0] };
const SETTLE_MS = 8000;
const WAIT_MS = 15000;
const CORPSE_MS = 10000;

module.exports = {
  engines: 2,
  timeout: 15 * 60000,
  setup: async (ctx) => {
    await ctx.character(1, { pos: SPOT, angleZ: 0, worldOrCell: 0x3c });
    await ctx.character(2, { pos: [SPOT[0] + 150, SPOT[1], SPOT[2]], angleZ: 0, worldOrCell: 0x3c });
  },
  async run(ctx) {
    const actors = [await ctx.ready(1), await ctx.ready(2)];
    const [leader, member] = actors;
    const hex = (v) => (v >>> 0).toString(16);
    const send = (n, content) => ctx.drv(`sp.mpClientPlugin.send(JSON.stringify({ t: 1, contentJsonDump: ${JSON.stringify(JSON.stringify(content))} }), true); return 0;`, n);
    const souls = (n) => ctx.drv(`return { souls: sp.Game.getPlayer().getActorValue("DragonSouls"), absorbed: sp.GlobalVariable.from(sp.Game.getFormEx(${ABSORBED})).getValue() };`, n);
    const quest = `sp.Quest.from(sp.Game.getFormEx(${MQ104}))`;
    const stage = (n) => ctx.drv(`const q = ${quest}; return q.isRunning() ? q.getCurrentStageID() : -1;`, n);
    const distance = () => ctx.probe(`const d = mp.get(${DRAGON}, "locationalData"); return ${JSON.stringify(actors)}.map((a) => { const p = mp.get(a, "locationalData"); return p.cellOrWorldDesc === d.cellOrWorldDesc ? Math.round(Math.hypot(p.pos[0] - d.pos[0], p.pos[1] - d.pos[1], p.pos[2] - d.pos[2])) : -1; });`);
    const gained = (a, b) => ({ souls: b.souls - a.souls, absorbed: b.absorbed - a.absorbed });
    const fails = [];

    await send(1, { customPacketType: "partyInvite", target: member });
    await ctx.sleep(1500);
    await send(2, { customPacketType: "partyAccept", inviter: leader });
    const joined = await ctx.waitFor(() => fs.readFileSync(path.join(ctx.dir, "server.log"), "utf8").includes(`Coop: ${hex(member)} joined party`), 15000, "engine 2 joins the party").then(() => true).catch(() => false);
    ctx.assert.ok(joined, "engine 2 did not join engine 1's party");

    const kill = async (revive) => {
      if (revive) {
        await ctx.probe(`mp.set(${DRAGON}, "isDead", false); return 0;`);
        await ctx.sleep(2000);
      }
      await ctx.probe(`mp.set(${DRAGON}, "isDead", true); return 0;`);
    };

    await ctx.probe(`mp.callPapyrusFunction("method", "ObjectReference", "Enable", { type: "form", desc: mp.getDescFromId(${DRAGON}) }, [false]); return 0;`);
    const shown = await Promise.all([1, 2].map((n) => ctx.waitFor(() => ctx.drv(`const a = sp.Actor.from(sp.Game.getFormEx(${DRAGON})); return !!a && a.is3DLoaded() && !a.isDisabled();`, n).catch(() => false), 30000, `the dragon is loaded on engine ${n}`).then(() => true).catch(() => false)));
    ctx.assert.ok(shown.every(Boolean), `the enabled dragon is not loaded on both engines (${shown.join(", ")})`);
    const before = { 1: await souls(1), 2: await souls(2) };
    const near = await distance();
    ctx.evidence.push(`A: party formed, the server enabled the dragon and it is loaded on both engines, MQ104 not running (engine 1 ${await stage(1)}, engine 2 ${await stage(2)}); dragon ${hex(DRAGON)} server dead ${!!(await ctx.probe(`return mp.get(${DRAGON}, "isDead");`))}, distance to the leader ${near[0]}, to the member ${near[1]}; before: engine 1 ${JSON.stringify(before[1])}, engine 2 ${JSON.stringify(before[2])}`);
    await kill(false);
    const killedAt = Date.now();
    await ctx.waitFor(async () => (await souls(1)).souls > before[1].souls && (await souls(2)).souls > before[2].souls, WAIT_MS, "both players gain a dragon soul").catch(() => {});
    const firstAt = Date.now() - killedAt;
    await ctx.sleep(SETTLE_MS);
    const after = { 1: await souls(1), 2: await souls(2) };
    ctx.evidence.push(`A: the server killed the dragon with both players near; ${(firstAt / 1000).toFixed(1)} s to the first gain, then ${SETTLE_MS / 1000} s more: engine 1 ${JSON.stringify(after[1])} (gained ${JSON.stringify(gained(before[1], after[1]))}), engine 2 ${JSON.stringify(after[2])} (gained ${JSON.stringify(gained(before[2], after[2]))})`);
    for (const n of [1, 2]) {
      const g = gained(before[n], after[n]);
      if (g.souls !== 1 || g.absorbed !== 1) fails.push(`A: engine ${n} gained ${g.souls} dragon souls and ${g.absorbed} DragonsAbsorbed for one dragon death near it (expected 1 and 1)`);
    }
    const localDead = await Promise.all([1, 2].map((n) => ctx.drv(`const a = sp.Actor.from(sp.Game.getFormEx(${DRAGON})); return a ? a.isDead() : null;`, n)));
    if (!localDead.every((d) => d === true)) fails.push(`A: the dragon is not dead on both clients (engine 1 ${localDead[0]}, engine 2 ${localDead[1]})`);
    const tries = { 1: [], 2: [] };
    for (const n of [1, 2]) {
      for (let k = 0; k < 4; k++) {
        const c = await ctx.drv(`const a = sp.Actor.from(sp.Game.getFormEx(${DRAGON})); return [a.getPositionX(), a.getPositionY(), a.getPositionZ()];`, n);
        await ctx.probe(`mp.set(${actors[n - 1]}, "locationalData", { cellOrWorldDesc: "3c:Skyrim.esm", pos: [${c[0] + 200}, ${c[1] + (n === 1 ? 50 : -50)}, ${c[2] + 50}], rot: [0, 0, 0] }); return 0;`);
        await ctx.sleep(2000);
        const d = await ctx.drv(`const p = sp.Game.getPlayer(); const a = sp.Actor.from(sp.Game.getFormEx(${DRAGON})); return { d: Math.round(p.getDistance(a)), corpse: [a.getPositionX(), a.getPositionY(), a.getPositionZ()].map(Math.round), player: [p.getPositionX(), p.getPositionY(), p.getPositionZ()].map(Math.round) };`, n);
        tries[n].push({ target: c.map(Math.round), ...d });
        if (d.d < 400) break;
      }
    }
    ctx.evidence.push(`A: moves next to the corpse: ${JSON.stringify(tries)}`);
    await ctx.sleep(CORPSE_MS);
    const corpse = await Promise.all([1, 2].map((n) => ctx.drv(`const p = sp.Game.getPlayer(); const a = sp.Actor.from(sp.Game.getFormEx(${DRAGON})); return Math.round(p.getDistance(a));`, n)));
    const atCorpse = { 1: await souls(1), 2: await souls(2) };
    ctx.evidence.push(`A: the dragon is dead on engine 1 ${localDead[0]}, on engine 2 ${localDead[1]}; both players then stood next to the corpse for ${CORPSE_MS / 1000} s (distance ${corpse.join(" and ")}): engine 1 ${JSON.stringify(atCorpse[1])}, engine 2 ${JSON.stringify(atCorpse[2])}`);
    for (const n of [1, 2]) {
      const g = gained(after[n], atCorpse[n]);
      if (g.souls !== 0 || g.absorbed !== 0) fails.push(`A: engine ${n} gained ${g.souls} more souls and ${g.absorbed} more DragonsAbsorbed next to the corpse (expected 0: the dragon's own death script must not absorb on a client)`);
    }
    for (const actor of actors) await ctx.probe(`mp.set(${actor}, "locationalData", { cellOrWorldDesc: "3c:Skyrim.esm", pos: ${JSON.stringify(SPOT)}, rot: [0, 0, 0] }); return 0;`);
    await ctx.sleep(3000);

    await ctx.drv(`return ${quest}.setCurrentStageID(${MQ104_START});`, 1);
    const early = (s) => s >= MQ104_START && s < MQ104_SOUL_STAGE;
    const started = await ctx.waitFor(async () => early(await stage(1)) && early(await stage(2)), WAIT_MS, `MQ104 runs before stage ${MQ104_SOUL_STAGE} on both engines`).then(() => true).catch(() => false);
    ctx.assert.ok(started, `MQ104 did not run at a stage from ${MQ104_START} to below ${MQ104_SOUL_STAGE} on both engines (engine 1 ${await stage(1)}, engine 2 ${await stage(2)})`);
    const fus = (n) => ctx.drv(`return sp.Game.isWordUnlocked(sp.WordOfPower.from(sp.Game.getFormEx(${FUS})));`, n);
    const beforeB = { 1: { ...(await souls(1)), fus: await fus(1), stage: await stage(1) }, 2: { ...(await souls(2)), fus: await fus(2), stage: await stage(2) } };
    await kill(true);
    const mq = await ctx.waitFor(async () => (await stage(1)) >= MQ104_SOUL_STAGE && (await stage(2)) >= MQ104_SOUL_STAGE, WAIT_MS, `MQ104 reaches stage ${MQ104_SOUL_STAGE} on both engines`).then(() => true).catch(() => false);
    await ctx.sleep(SETTLE_MS);
    const afterB = { 1: { ...(await souls(1)), fus: await fus(1), stage: await stage(1) }, 2: { ...(await souls(2)), fus: await fus(2), stage: await stage(2) } };
    ctx.evidence.push(`B: MQ104 running, the server revived and killed the dragon again: engine 1 ${JSON.stringify(beforeB[1])} -> ${JSON.stringify(afterB[1])}, engine 2 ${JSON.stringify(beforeB[2])} -> ${JSON.stringify(afterB[2])}`);
    if (!mq) fails.push(`B: MQ104 did not reach stage ${MQ104_SOUL_STAGE} on both engines after the dragon died (engine 1 ${afterB[1].stage}, engine 2 ${afterB[2].stage})`);
    for (const n of [1, 2]) {
      const g = gained(beforeB[n], afterB[n]);
      if (g.absorbed !== 1) fails.push(`B: engine ${n} gained ${g.absorbed} DragonsAbsorbed for one dragon death near it (expected 1)`);
      if (!afterB[n].fus) fails.push(`B: engine ${n} did not unlock Fus, so MQ104 stage ${MQ104_SOUL_STAGE} did not run there`);
      if (afterB[n].souls !== 0) fails.push(`B: engine ${n} has ${afterB[n].souls} souls after MQ104 stage ${MQ104_SOUL_STAGE} (the stage sets them to 0, so a soul added after it or twice shows here)`);
    }

    await ctx.probe(`mp.set(${member}, "locationalData", ${JSON.stringify(FAR)}); return 0;`);
    await ctx.waitFor(() => ctx.drv(`const p = sp.Game.getPlayer(); return !sp.Ui.isMenuOpen("Loading Menu") && !!p.getWorldSpace() && p.getWorldSpace().getFormID() === 0x1a26f;`, 2).catch(() => false), 120000, "engine 2 arrives in Whiterun");
    const far = await distance();
    const before2 = { 1: await souls(1), 2: await souls(2) };
    await kill(true);
    await ctx.waitFor(async () => (await souls(1)).souls > before2[1].souls, WAIT_MS, "the leader gains a second dragon soul").catch(() => {});
    await ctx.sleep(SETTLE_MS);
    const after2 = { 1: await souls(1), 2: await souls(2) };
    ctx.evidence.push(`C: the member went to Whiterun (distance to the dragon ${far[1]}, -1 for another worldspace; leader ${far[0]}); the server revived and killed the dragon again: engine 1 gained ${JSON.stringify(gained(before2[1], after2[1]))}, engine 2 gained ${JSON.stringify(gained(before2[2], after2[2]))}`);
    const g1 = gained(before2[1], after2[1]);
    const g2 = gained(before2[2], after2[2]);
    if (g1.souls !== 1 || g1.absorbed !== 1) fails.push(`C: the leader near the dragon gained ${g1.souls} souls and ${g1.absorbed} DragonsAbsorbed (expected 1 and 1)`);
    if (g2.souls !== 0 || g2.absorbed !== 0) fails.push(`C: the member in another worldspace gained ${g2.souls} souls and ${g2.absorbed} DragonsAbsorbed (expected 0)`);

    ctx.assert.ok(!fails.length, fails.join("; "));
  },
};
