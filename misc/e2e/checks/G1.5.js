const fs = require("fs");
const path = require("path");

const SETTINGS = path.join(__dirname, "..", "..", "..", "skymp5-server", "ts", "settings.ts");
const MQ102 = 0x4e50d;
const MQ103 = 0xd0800;
const NPCS = [["Balgruuf", 0x1a677], ["Farengar", 0x1a67e]];
const WHITERUN_PORCH = { cellOrWorldDesc: "1a26f:Skyrim.esm", pos: [26691, 1678, -1404], rot: [0, 0, 0] };
const MIN_GUARDS = 2;
const M = "Dialogue Menu";
const R = "_root.DialogueMenu_mc";
const APPEARANCE = { isFemale: false, raceId: 0x13746, weight: 50, skinColor: -1, hairColor: -1, headpartIds: [], headTextureSetId: 0, options: new Array(19).fill(0), presets: new Array(4).fill(0), tints: [], name: "E2eWhiterun" };

module.exports = {
  engines: 1,
  timeout: 15 * 60000,
  setup: async (ctx) => {
    const startLog = JSON.parse(fs.readFileSync(SETTINGS, "utf8").match(/questStages: (\[\[[^\n]*\]\]),/)[1].replace(/0x[0-9a-f]+/g, (h) => String(parseInt(h, 16))));
    const log = [...startLog, [MQ102, 30]];
    const actor = await ctx.character(1);
    await ctx.probe(`mp.set(${actor}, "appearance", ${JSON.stringify(APPEARANCE)}); mp.set(${actor}, "private.questLog", ${JSON.stringify(log)}); return 0;`);
    ctx.evidence.push(`start log: settings.ts and MQ102 stage 30: ${JSON.stringify(log)}`);
  },
  async run(ctx) {
    const actor = await ctx.ready(1);
    const hex = (v) => (v >>> 0).toString(16);
    const server = (ids) => ctx.probe(`return ${JSON.stringify(ids)}.map((id) => { try { return { id, cell: mp.get(id, "locationalData").cellOrWorldDesc, dead: !!mp.get(id, "isDead"), disabled: !!mp.get(id, "isDisabled"), hoster: mp.get(id, "hoster") || 0 }; } catch (e) { return { id, missing: true }; } });`);
    const shared = (s) => !s.missing && !s.dead && !s.disabled && s.hoster === actor;
    const local = (ids) => ctx.drv(`return ${JSON.stringify(ids)}.map((id) => { const a = sp.Actor.from(sp.Game.getFormEx(id)); return a ? { id, loaded: a.is3DLoaded(), disabled: a.isDisabled(), dead: a.isDead() } : { id, missing: true }; });`);
    const there = (l) => !l.missing && l.loaded && !l.disabled && !l.dead;
    const inWorld = (cond) => `const p = sp.Game.getPlayer(); return !sp.Ui.isMenuOpen("Loading Menu") && !!p && p.is3DLoaded() && ${cond};`;
    const quests = `const q2 = sp.Quest.from(sp.Game.getFormEx(${MQ102})); const q3 = sp.Quest.from(sp.Game.getFormEx(${MQ103}));`;

    await ctx.probe(`mp.set(${actor}, "locationalData", ${JSON.stringify(WHITERUN_PORCH)}); return 0;`);
    await ctx.waitFor(() => ctx.drv(inWorld(`p.getWorldSpace() && p.getWorldSpace().getFormID() === 0x1a26f`)).catch(() => false), 120000, "the player is in Whiterun");
    const findGuards = () => ctx.drv(`const p = sp.Game.getPlayer(); const ids = []; for (let i = 0; i < 400; i++) { const r = sp.Game.findRandomActor(p.getPositionX(), p.getPositionY(), p.getPositionZ(), 4096); const id = r ? r.getFormID() : 0; if (id && id < 0xff000000 && r.isGuard() && !ids.includes(id)) ids.push(id); } return ids;`);
    const fails = [];
    let guards = [];
    await ctx.waitFor(async () => {
      guards = await findGuards();
      const [l, s] = await Promise.all([local(guards), server(guards)]);
      return guards.filter((_, i) => there(l[i]) && shared(s[i])).length >= MIN_GUARDS;
    }, 90000, `${MIN_GUARDS} Whiterun guards are loaded and hosted by the player`).catch(() => false);
    const gl = await local(guards);
    const gs = await server(guards);
    ctx.evidence.push(`Whiterun guards near the porch: ${guards.map((id, i) => `${hex(id)} (client loaded ${gl[i].loaded}, disabled ${gl[i].disabled}, dead ${gl[i].dead}; server ${gs[i].missing ? "missing" : `${gs[i].cell}, dead ${gs[i].dead}, disabled ${gs[i].disabled}, hoster ${hex(gs[i].hoster)}`})`).join("; ") || "none"}`);
    await ctx.sleep(3000);
    ctx.shot("G1_5-guards");
    if (guards.filter((_, i) => there(gl[i]) && shared(gs[i])).length < MIN_GUARDS) fails.push(`fewer than ${MIN_GUARDS} Whiterun guards are there and hosted by the player`);

    const ids = NPCS.map(([, id]) => id);
    const loc = await ctx.npcLocation(NPCS[0][1]);
    const r = loc.rot[2] * Math.PI / 180;
    await ctx.probe(`mp.set(${actor}, "locationalData", ${JSON.stringify({ ...loc, pos: [loc.pos[0] + 250 * Math.sin(r), loc.pos[1] + 250 * Math.cos(r), loc.pos[2] + 50] })}); return 0;`);
    await ctx.waitFor(() => ctx.drv(inWorld("true")).then((ok) => ok && local(ids).then((l) => l.every(there))).catch(() => false), 120000, "Balgruuf and Farengar are loaded").catch(() => false);
    const npcsShared = await ctx.waitFor(() => server(ids).then((s) => s.every(shared)), 30000, "the client hosts Balgruuf and Farengar").catch(() => false);
    const nl = await local(ids);
    const ns = await server(ids);
    NPCS.forEach(([name, id], i) => ctx.evidence.push(`${name} ${hex(id)}: client loaded ${nl[i].loaded}, disabled ${nl[i].disabled}, dead ${nl[i].dead}; server ${ns[i].missing ? "missing" : `${ns[i].cell}, dead ${ns[i].dead}, disabled ${ns[i].disabled}, hoster ${hex(ns[i].hoster)}`}`));
    await ctx.sleep(3000);
    ctx.shot("G1_5-dragonsreach");
    if (!nl.every(there) || !npcsShared) fails.push("Balgruuf and Farengar are not there and hosted by the player in Dragonsreach");

    const state = () => ctx.drv(`${quests} const open = sp.Ui.isMenuOpen("${M}"); const t = []; let sub = "";
      if (open) { for (let i = 0; i < 6; i++) { let s = ""; try { s = sp.Ui.getString("${M}", "${R}.TopicList.entryList." + i + ".text"); } catch (e) {} if (!s) break; t.push(s); } try { sub = (sp.Ui.getString("${M}", "${R}.SubtitleText.text") || "").trim(); } catch (e) {} }
      return { open, t, sub, mq102: q2.getCurrentStageID(), mq103: q3.getCurrentStageID() };`);
    const clicked = [];
    const stages = [];
    let s = await state();
    const first = s;
    const started = await ctx.waitFor(async () => {
      s = await state();
      const k = `${s.mq102}/${s.mq103}`;
      if (stages[stages.length - 1] !== k) stages.push(k);
      if (s.mq103 >= 10) return true;
      if (s.open && !s.sub && s.t.length) {
        const i = Math.max(0, s.t.findIndex((x) => !clicked.includes(x)));
        clicked.push(s.t[i]);
        await ctx.drv(`sp.Ui.setInt("${M}", "${R}.TopicList.selectedIndex", ${i}); sp.Ui.invokeBool("${M}", "${R}.onSelectionClick", true); return 0;`);
        await ctx.sleep(2500);
      } else if (!s.open) {
        await ctx.sleep(3000);
        if (!(await state()).open) await ctx.drv(`sp.Actor.from(sp.Game.getFormEx(${NPCS[0][1]})).activate(sp.Game.getPlayer(), false); return 0;`);
        await ctx.sleep(3000);
      }
      return false;
    }, 8 * 60000, "MQ103 starts on the client").catch(() => false);
    const logged = await ctx.waitFor(() => ctx.probe(`return (mp.get(${actor}, "private.questLog") || []).some(([q, st]) => q === ${MQ103} && st >= 10);`), 15000, "the server logs MQ103").catch(() => false);
    const log = await ctx.probe(`return (mp.get(${actor}, "private.questLog") || []).filter(([q]) => q === ${MQ102} || q === ${MQ103});`);
    ctx.evidence.push(`dialogue: ${clicked.length} topics picked (${clicked.map((x) => `"${x}"`).join(", ")}); client MQ102/MQ103 stages ${first.mq102}/${first.mq103} at the start, then ${stages.join(" -> ")}; Balgruuf says "${s.sub}"`);
    ctx.evidence.push(`server log of MQ102 (${hex(MQ102)}) and MQ103 (${hex(MQ103)}): ${JSON.stringify(log.map(([q, st]) => [hex(q), st]))}`);
    ctx.shot("G1_5-mq103");
    if (first.mq103 >= 10) fails.push(`MQ103 was at stage ${first.mq103} before the dialogue`);
    if (!started) fails.push(`MQ103 did not start on the client: MQ102 stage ${s.mq102}, MQ103 stage ${s.mq103}`);
    if (!logged) fails.push("the server did not log MQ103 stage 10 or more");
    ctx.assert.ok(!fails.length, fails.join("; "));
  },
};
