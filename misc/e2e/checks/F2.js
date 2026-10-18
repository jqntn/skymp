const fs = require("fs");
const path = require("path");
const MQ102B = 0x2610a;
const MQ102 = 0x4e50d;
const MQ104 = 0x2610c;
const LOG = [[MQ102B, 0], [MQ102B, 5], [MQ102, 15], [MQ102B, 30], [MQ104, 10]];
const NEW_QUEST = 0x85d40;
const NEW_STAGE = 10;
const SETTLE_MS = 3000;
const SLACK_MS = 500;
const ARRIVE_MS = 10000;

module.exports = {
  engines: 1,
  timeout: 10 * 60000,
  setup: async (ctx) => {
    const actor = await ctx.character(1);
    await ctx.probe(`mp.set(${actor}, "private.questLog", ${JSON.stringify(LOG)}); return 0;`);
  },
  async run(ctx) {
    const actor = await ctx.ready(1);
    const hex = (v) => (v >>> 0).toString(16);
    const lines = () => fs.readFileSync(path.join(ctx.dir, "server.log"), "utf8").split(/\r?\n/);
    const stage = (q) => ctx.drv(`return sp.Quest.from(sp.Game.getFormEx(${q})).getCurrentStageID();`);
    const logged = () => ctx.probe(`const l = mp.get(${actor}, "private.questLog"); return Array.isArray(l) && l.some((e) => e[0] === ${NEW_QUEST} && e[1] === ${NEW_STAGE});`);

    const replay = await ctx.waitFor(() => lines().find((l) => l.includes(`replay of ${LOG.length} quest log entries to ${hex(actor)}`)), 120000, "the server replays the quest log").catch(() => undefined);
    ctx.assert.ok(replay, `the server did not replay ${LOG.length} entries to ${hex(actor)}`);
    const applied = await ctx.waitFor(() => stage(MQ104).then((s) => s >= LOG[LOG.length - 1][1]).catch(() => false), 15000, "the client applies the last replayed entry", Error, 100).then(() => Date.now()).catch(() => 0);
    ctx.assert.ok(applied, "the client did not apply the last replayed entry within 15 s");
    const before = await stage(NEW_QUEST);
    ctx.assert.ok(before < NEW_STAGE && !(await logged()), `FreeformRiften20 (${hex(NEW_QUEST)}) is already at stage ${before} before the test sets it`);
    await ctx.drv(`return sp.Quest.from(sp.Game.getFormEx(${NEW_QUEST})).setCurrentStageID(${NEW_STAGE});`);
    const setAt = Date.now();
    const settleEnd = applied + SETTLE_MS;
    const seen = await ctx.waitFor(() => logged(), settleEnd + ARRIVE_MS - Date.now(), "the server logs the stage", Error, 250).then(() => Date.now()).catch(() => 0);
    const after = await stage(NEW_QUEST);
    const stamp = (l) => Date.parse(l.slice(1, 24).replace(" ", "T"));
    if (seen) await ctx.waitFor(() => lines().some((l) => l.includes(`quest ${hex(NEW_QUEST)} stage ${NEW_STAGE} from ${hex(actor)}`)), 10000, "the server log shows the stage").catch(() => {});
    const reports = lines().filter((l) => stamp(l) >= applied && l.includes(`from ${hex(actor)}`)).map((l) => l.replace(/^\[[^\]]*\] \[console\] \[info\] /, ""));
    ctx.evidence.push(`the client applied the last replayed entry (MQ104 ${LOG[LOG.length - 1][1]}) and ${((setAt - applied) / 1000).toFixed(1)} s later, inside the ${SETTLE_MS / 1000} s settle, FreeformRiften20 (${hex(NEW_QUEST)}) went from stage ${before} to ${after}; the server's quest log of ${hex(actor)} has it ${seen ? `${((seen - settleEnd) / 1000).toFixed(1)} s after the earliest settle end` : `not ${ARRIVE_MS / 1000} s after the earliest settle end`}; server lines from this client since the last entry: ${reports.join(" | ") || "none"}`);
    ctx.assert.ok(after >= NEW_STAGE, `the client did not reach FreeformRiften20 stage ${NEW_STAGE} (at ${after})`);
    ctx.assert.ok(setAt - applied < SETTLE_MS - SLACK_MS, `not exercised: the stage was set ${((setAt - applied) / 1000).toFixed(1)} s after the last replayed entry, too late for the settle`);
    ctx.assert.ok(seen, `a quest stage the game set during the replay settle did not reach the server ${ARRIVE_MS / 1000} s after the settle`);
    const replayed = new Set(LOG.map(([q]) => hex(q)));
    const echoed = reports.filter((l) => replayed.has(l.match(/quest (\w+) stage/)?.[1]));
    ctx.assert.ok(!echoed.length, `the replay's own quests were reported back after the settle: ${echoed.join(" | ")}`);
  },
};
