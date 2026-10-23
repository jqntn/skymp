const fs = require("fs");
const path = require("path");

const WORLD = 0x3c;
const LEADER_AT = [20228, -46108, -142];
const MEMBER_AT = [20300, -45829, -143];
const STAND_MS = Number(process.env.FLAP_STAND_MS || 150000);
const QUESTS = [0x74a83, 0x2610a, 0x4e50d];
const WATCH = [0x13482, 0x13483, 0x13484, 0x13489, 0x1348a, 0x1348b, 0x1348c, 0x35534, 0x2bfa2, 0x2bf9e];

module.exports = {
  engines: 2,
  timeout: 30 * 60000,
  setup: async (ctx) => {
    await ctx.character(1);
    await ctx.character(2);
  },
  async run(ctx) {
    const actors = [await ctx.ready(1), await ctx.ready(2)];
    const [leader, member] = actors;
    const hex = (v) => (v >>> 0).toString(16);
    const log = () => fs.readFileSync(path.join(ctx.dir, "server.log"), "utf8");
    const send = (n, content) => ctx.drv(`sp.mpClientPlugin.send(JSON.stringify({ t: 1, contentJsonDump: ${JSON.stringify(JSON.stringify(content))} }), true); return 0;`, n);
    const look = (name) => ({ isFemale: false, raceId: 0x13746, weight: 50, skinColor: -1, hairColor: -1, headpartIds: [], headTextureSetId: 0, options: new Array(19).fill(0), presets: new Array(4).fill(0), tints: [], name });
    await ctx.probe(`mp.set(${leader}, "appearance", ${JSON.stringify(look("E2eLeader"))}); mp.set(${member}, "appearance", ${JSON.stringify(look("E2eMember"))}); return 0;`);
    const ids = await ctx.probe(`return ${JSON.stringify(QUESTS)}.map((id) => { try { const r = mp.lookupEspmRecordById(id).record; return r ? r.editorId : null; } catch (e) { return String(e); } });`);
    ctx.evidence.push(`quests ${QUESTS.map((q, i) => `${hex(q)}=${ids[i]}`).join(", ")}`);
    const inWorld = `const p = sp.Game.getPlayer(); return !sp.Ui.isMenuOpen("Loading Menu") && !!p && p.is3DLoaded() && !!p.getWorldSpace() && p.getWorldSpace().getFormID() === ${WORLD};`;
    for (const [n, at] of [[1, LEADER_AT], [2, MEMBER_AT]]) {
      await ctx.probe(`mp.set(${actors[n - 1]}, "locationalData", ${JSON.stringify({ cellOrWorldDesc: "3c:Skyrim.esm", pos: [at[0], at[1], at[2] + 200], rot: [0, 0, 60] })}); return 0;`);
    }
    for (const n of [1, 2]) await ctx.waitFor(() => ctx.drv(inWorld, n).catch(() => false), 120000, `engine ${n} arrives in Riverwood`);
    await send(1, { customPacketType: "partyInvite", target: member });
    await ctx.sleep(1500);
    await send(2, { customPacketType: "partyAccept", inviter: leader });
    const joined = await ctx.waitFor(() => log().includes("joined party"), 15000, "engine 2 joins the party").then(() => true).catch(() => false);
    ctx.assert.ok(joined, "not exercised: engine 2 did not join engine 1's party");
    await ctx.sleep(20000);

    const parse = (from) => {
      const per = {};
      for (const line of log().split(/\r?\n/)) {
        const ts = (line.match(/^\[([^\]]+)\]/) || [])[1];
        if (!ts || Date.parse(ts.replace(" ", "T")) < from) continue;
        let m = line.match(/Hoster changed from (\w+) to (\w+) on (\w+)/);
        if (m) (per[m[3]] ||= []).push(`${ts.slice(11, 23)} ${m[1]}->${m[2]}`);
        m = line.match(/Hoster cleared on (\w+): was (\w+) \(([^)]*)\)/);
        if (m) (per[m[1]] ||= []).push(`${ts.slice(11, 23)} clear ${m[2]} (${m[3]})`);
      }
      return per;
    };
    const localTime = () => Date.now();
    const local = (n) => ctx.drv(`return ${JSON.stringify(WATCH)}.map((id) => { const a = sp.Actor.from(sp.Game.getFormEx(id)); if (!a) return [id, null]; const p = sp.Game.getPlayer();
      return [id, { loaded: a.is3DLoaded(), disabled: a.isDisabled(), ai: a.isAIEnabled(), d: Math.round(a.getDistance(p)), sit: a.getSitState(), cell: (a.getWorldSpace() || a.getParentCell() || { getFormID: () => 0 }).getFormID().toString(16) }]; });`, n).catch((e) => String(e));
    const stand = async (label) => {
      const from = localTime();
      const timeline = [];
      const t0 = Date.now();
      while (Date.now() - t0 < STAND_MS) {
        const h = await ctx.probe(`return ${JSON.stringify(WATCH)}.map((id) => { try { return mp.get(id, "hoster") || 0; } catch (e) { return -1; } });`);
        timeline.push(h);
        await ctx.sleep(1000);
      }
      const per = parse(from);
      const flips = WATCH.map((id, i) => [hex(id), timeline.reduce((c, h, k) => c + (k && h[i] !== timeline[k - 1][i] ? 1 : 0), 0)]);
      ctx.evidence.push(`${label}: hoster samples per second, changes per NPC ${JSON.stringify(flips)}`);
      for (const [id, events] of Object.entries(per)) ctx.evidence.push(`${label} ${id}: ${events.length} events: ${events.slice(0, 40).join("; ")}`);
      for (const n of [1, 2]) ctx.evidence.push(`${label} engine ${n} local: ${JSON.stringify(await local(n))}`);
      return { per, flips };
    };

    const a = await stand("phase A (party, no quest)");
    const questBefore = await ctx.drv(`return ${JSON.stringify(QUESTS)}.map((id) => { const q = sp.Quest.from(sp.Game.getFormEx(id)); return q ? [q.getCurrentStageID(), q.isRunning()] : null; });`, 1);
    ctx.evidence.push(`leader quests before phase B: ${JSON.stringify(questBefore)}`);
    await ctx.drv(`const q = sp.Quest.from(sp.Game.getFormEx(${QUESTS[0]})); if (!q.isRunning()) q.start(); q.setCurrentStageID(105); return 0;`, 1);
    await ctx.waitFor(() => /quest 74a83 stage 105 from \w+, logged for \w+,\w+/.test(log()), 30000, "the stage reaches both logs").catch(() => {});
    await ctx.sleep(5000);
    const aliases = [];
    for (const n of [1, 2]) aliases.push(await ctx.drv(`return ${JSON.stringify(WATCH)}.map((id) => [id.toString(16), sp.getReferenceAliasQuests(id).map((q) => q.toString(16))]);`, n).catch((e) => String(e)));
    ctx.evidence.push(`alias quests per engine: ${JSON.stringify(aliases)}`);
    const b = await stand("phase B (party, 74a83 at 105)");
    const worst = Math.max(...a.flips.map(([, c]) => c), ...b.flips.map(([, c]) => c));
    ctx.assert.ok(worst <= 2, `an NPC changed hoster ${worst} times while both players stood still`);
  },
};
