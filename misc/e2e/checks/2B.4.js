const fs = require("fs");
const path = require("path");
const MQ102B = 0x2610a;
const MQ102 = 0x4e50d;
const MQ104 = 0x2610c;
const LOG = [[MQ102B, 0], [MQ102B, 5], [MQ102, 15], [MQ102B, 30], [MQ104, 10]];
const FOLLOW_UP = 12;
const NEW_QUEST = 0x85d40;
const NEW_STAGE = 10;
const WINDOW_MS = 15000;
const SETTLE_MS = 3000;
const SLACK_MS = 500;

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
    const stamp = (l) => Date.parse(l.slice(1, 24).replace(" ", "T"));
    const stage = (q) => ctx.drv(`return sp.Quest.from(sp.Game.getFormEx(${q})).getCurrentStageID();`);
    const fails = [];

    const replay = await ctx.waitFor(() => lines().find((l) => l.includes(`replay of ${LOG.length} quest log entries to ${hex(actor)}`)), 120000, "the server replays the quest log").catch(() => undefined);
    ctx.assert.ok(replay, `the server did not replay ${LOG.length} entries to ${hex(actor)}`);
    const start = stamp(replay);
    const progress = [];
    while (Date.now() < start + WINDOW_MS) {
      const st = await ctx.drv(`const q = (id) => sp.Quest.from(sp.Game.getFormEx(id)).getCurrentStageID(); return [q(${MQ102B}), q(${MQ102}), q(${MQ104})];`).catch(() => null);
      const last = progress[progress.length - 1];
      if (st && (!last || last[1].join() !== st.join())) progress.push([((Date.now() - start) / 1000).toFixed(1), st]);
      await ctx.sleep(300);
    }
    ctx.evidence.push(`A: client stages [MQ102B, MQ102, MQ104] by seconds after the replay line: ${progress.map((p) => `${p[0]}:${p[1].join("/")}`).join(" ")}`);
    const applied = progress.find((p) => p[1][2] >= LOG[LOG.length - 1][1]);
    ctx.assert.ok(applied, `the client did not apply the last replayed entry within ${WINDOW_MS / 1000} s`);
    const quietUntil = start + Number(applied[0]) * 1000 + SETTLE_MS - SLACK_MS;
    const refs = await ctx.drv(`const p = sp.Game.getPlayer(); const out = []; const c = p.getParentCell(); const n = c ? c.getNumRefs(0) : 0;
      for (let i = 0; i < n; i++) { const r = c.getNthRef(i, 0); if (!r) continue; const id = r.getFormID(); if (id >= 0xff000000) continue; out.push([id, r.isDisabled() ? 1 : 0, r.getOpenState()]); }
      return out;`);
    const server = new Map((await ctx.probe(`return ${JSON.stringify(refs.map((r) => r[0]))}.map((id) => { try { return [id, mp.get(id, "isDisabled") ? 1 : 0, mp.get(id, "isOpen") ? 1 : 0]; } catch (e) { return [id, null, null]; } });`)).map((x) => [x[0], x]));
    const known = refs.filter((r) => server.get(r[0])[1] !== null);
    const disabled = known.filter((r) => r[1] !== server.get(r[0])[1]);
    const open = known.filter((r) => r[2] !== 0 && (r[2] === 1 || r[2] === 2 ? 1 : 0) !== server.get(r[0])[2]);
    ctx.evidence.push(`B: after the replay, ${known.length} of ${refs.length} ESP refs in the player's cell are known to the server; disabled state differs on ${disabled.map((r) => hex(r[0])).join(", ") || "none"}, open state differs on ${open.map((r) => hex(r[0])).join(", ") || "none"}`);
    if (known.length < 10) fails.push(`B: only ${known.length} refs known to the server, too few to compare`);
    if (disabled.length || open.length) fails.push(`B: after the replay the client differs from the server on ${[...disabled, ...open].map((r) => hex(r[0])).join(", ")}`);

    const setAt = Date.now();
    await ctx.drv(`return sp.Quest.from(sp.Game.getFormEx(${NEW_QUEST})).setCurrentStageID(${NEW_STAGE});`);
    const resumed = await ctx.waitFor(() => lines().some((l) => stamp(l) >= setAt - 1000 && l.includes(`quest ${hex(NEW_QUEST)} stage ${NEW_STAGE} from ${hex(actor)}`)), 15000, "the server logs a new stage").then(() => true).catch(() => false);
    ctx.evidence.push(`C: ${((setAt - start) / 1000).toFixed(1)} s after the replay line the client started FreeformRiften20 (${hex(NEW_QUEST)}) at stage ${NEW_STAGE}: server logged it ${resumed}`);
    if (!resumed) fails.push(`C: a new stage after the replay did not reach the server (reporting did not resume)`);

    const reports = lines().filter((l) => stamp(l) >= start && stamp(l) < quietUntil && (l.includes(`from ${hex(actor)}`) || l.includes(`script items of ${hex(actor)}`)));
    const local = { mq102b: await stage(MQ102B), mq102: await stage(MQ102), mq104: await stage(MQ104) };
    ctx.evidence.push(`A: replay of ${LOG.length} entries at ${replay.slice(12, 24)}; client stages after it: MQ102B ${local.mq102b}, MQ102 ${local.mq102}, MQ104 ${local.mq104} (the MQ104 stage 10 fragment moves on to ${FOLLOW_UP}); server lines from this client from the replay line until the last entry plus the settle time (${((quietUntil - start) / 1000).toFixed(1)} s): ${reports.map((l) => l.replace(/^\[[^\]]*\] \[console\] \[info\] /, "")).join(" | ") || "none"}`);
    ctx.assert.ok(local.mq104 >= FOLLOW_UP, `the replay did not run on the client (MQ104 at ${local.mq104})`);
    if (reports.length) fails.push(`A: the client sent ${reports.length} report(s) during the replay window: ${reports.map((l) => l.replace(/^\[[^\]]*\] \[console\] \[info\] /, "")).join(" | ")}`);

    ctx.assert.ok(!fails.length, fails.join("; "));
  },
};
