const GERDUR = 0x13489;
const AWAY = { cellOrWorldDesc: "1a26f:Skyrim.esm", pos: [26691, 1678, -1404], rot: [0, 0, 0] };
const M = "Dialogue Menu";
const R = "_root.DialogueMenu_mc";
const HUD = "_root.HUDMovieBaseInstance.SubtitleText.text";
const LAG_MS = 1000;

module.exports = {
  engines: 2,
  timeout: 25 * 60000,
  setup: async (ctx) => {
    await ctx.character(1);
    await ctx.character(2);
  },
  async run(ctx) {
    const actors = [await ctx.ready(1), await ctx.ready(2)];
    const hex = (v) => (v >>> 0).toString(16);
    const npc = `const a = sp.Actor.from(sp.Game.getFormEx(${GERDUR}));`;
    const hoster = () => ctx.probe(`return mp.get(${GERDUR}, "hoster") || 0;`);
    const loaded = (n) => ctx.waitFor(() => ctx.drv(`${npc} return !sp.Ui.isMenuOpen("Loading Menu") && !!a && a.is3DLoaded();`, n).catch(() => false), 120000, `Gerdur is loaded on engine ${n}`);
    const place = (n, loc, dx) => ctx.probe(`mp.set(${actors[n - 1]}, "locationalData", ${JSON.stringify({ ...loc, pos: [loc.pos[0] + dx, loc.pos[1], loc.pos[2] + 30] })}); return 0;`);
    for (const n of [1, 2]) {
      await ctx.drv(`const w = globalThis.e2eT5 = { speaks: [], hud: [], lines: [] }; let hud = ""; let line = "";
        sp.on("speakSound", (e) => { if (e.actorId === ${GERDUR}) w.speaks.push({ file: e.voiceFile, t: Date.now() }); });
        sp.on("update", () => {
          try { const h = (sp.Ui.getString("HUD Menu", "${HUD}") || "").trim(); if (h !== hud) { hud = h; if (h) w.hud.push({ text: h, t: Date.now() }); } } catch (e) {}
          try { if (sp.Ui.isMenuOpen("${M}")) { const l = (sp.Ui.getString("${M}", "${R}.SubtitleText.text") || "").trim(); if (l !== line) { line = l; if (l) w.lines.push({ text: l, t: Date.now() }); } } } catch (e) {}
        });
        return 0;`, n);
    }
    const since = (n, t) => ctx.drv(`const w = globalThis.e2eT5; const f = (x) => x.filter((e) => e.t >= ${t}); return { speaks: f(w.speaks), hud: f(w.hud), lines: f(w.lines) };`, n);
    const dedupe = (list) => list.filter((s, i) => !list.slice(0, i).some((p) => p.file === s.file && s.t - p.t < 500));
    const gerdurName = await ctx.drv(`${npc} return a ? a.getDisplayName() : "";`, 1).catch(() => "");
    const talkerName = await ctx.probe(`return mp.getActorName(${actors[0]});`);
    const fails = [];

    const talk = async (label) => {
      await ctx.sleep(2000);
      const t0 = Date.now();
      let open = false;
      for (let k = 0; k < 3 && !open; k++) {
        await ctx.drv(`${npc} const p = sp.Game.getPlayer(); p.setPosition(a.getPositionX() + 110 * Math.sin(a.getAngleZ() * Math.PI / 180), a.getPositionY() + 110 * Math.cos(a.getAngleZ() * Math.PI / 180), a.getPositionZ() + 10); return 0;`, 1);
        await ctx.sleep(1000);
        await ctx.drv(`${npc} const p = sp.Game.getPlayer(); p.setAngle(0, 0, p.getAngleZ() + p.getHeadingAngle(a)); return 0;`, 1);
        await ctx.sleep(1000);
        await ctx.drv(`sp.once("update", () => sp.Actor.from(sp.Game.getFormEx(${GERDUR})).activate(sp.Game.getPlayer(), false)); return 0;`, 1);
        open = await ctx.waitFor(() => ctx.drv(`${npc} return sp.Ui.isMenuOpen("${M}") && a.isInDialogueWithPlayer();`, 1), 10000, "the dialogue opens on engine 1").then(() => true).catch(() => false);
      }
      if (!open) {
        fails.push(`${label}: engine 1 could not open a dialogue with Gerdur`);
        return;
      }
      const sub = async () => ((await ctx.drv(`try { return sp.Ui.getString("${M}", "${R}.SubtitleText.text") || ""; } catch (e) { return ""; }`, 1)) || "").trim();
      await ctx.waitFor(sub, 10000, "Gerdur greets engine 1").catch(() => "");
      await ctx.waitFor(async () => !(await sub()), 20000, "the greeting ends").catch(() => {});
      const topic = ((await ctx.drv(`sp.Ui.setInt("${M}", "${R}.TopicList.selectedIndex", 0); return sp.Ui.getString("${M}", "${R}.TopicList.selectedEntry.text") || "";`, 1)) || "").trim();
      await ctx.drv(`sp.Ui.invokeBool("${M}", "${R}.onSelectionClick", true); return 0;`, 1);
      await ctx.waitFor(sub, 10000, "Gerdur answers").catch(() => "");
      await ctx.waitFor(async () => !(await sub()), 30000, "the answer ends").catch(() => {});
      await ctx.waitFor(async () => {
        await ctx.drv(`sp.Ui.invokeBool("${M}", "${R}.onCancelPress", true); return 0;`, 1);
        await ctx.sleep(1500);
        return ctx.drv(`return !sp.Ui.isMenuOpen("${M}");`, 1);
      }, 30000, "the dialogue closes on engine 1").catch(() => false);
      await ctx.sleep(3000);
      const h = await hoster();
      const talker = await since(1, t0);
      const other = await since(2, t0);
      const spoken = dedupe(talker.speaks);
      const heard = dedupe(other.speaks);
      const shown = other.hud.map((x) => x.text);
      ctx.evidence.push(`${label}: hoster ${hex(h)}; topic "${topic}"; engine 1 heard ${spoken.length} lines ${JSON.stringify(spoken.map((s) => s.file.split("\\").pop()))} and showed ${JSON.stringify(talker.lines.map((x) => x.text))}; engine 2 played ${heard.length} ${JSON.stringify(heard.map((s) => s.file.split("\\").pop()))}, its HUD showed ${JSON.stringify(shown)}`);
      if (spoken.length < 2) fails.push(`${label}: not exercised, engine 1 heard ${spoken.length} lines of Gerdur (greeting and answer expected)`);
      for (const s of spoken) {
        const m = heard.find((x) => x.file === s.file && x.t >= s.t && x.t <= s.t + LAG_MS);
        const late = heard.find((x) => x.file === s.file);
        ctx.evidence.push(`${label}: ${s.file.split("\\").pop()} on engine 2 ${m ? `after ${m.t - s.t} ms` : late ? `after ${late.t - s.t} ms` : "never"}`);
        if (!m) fails.push(`${label}: engine 2 ${late ? `played ${s.file.split("\\").pop()} ${late.t - s.t} ms after engine 1` : `did not play ${s.file.split("\\").pop()}`}`);
      }
      for (const l of talker.lines) {
        if (!shown.includes(`${gerdurName}: ${l.text}`)) fails.push(`${label}: engine 2 did not show "${gerdurName}: ${l.text}"`);
      }
      if (!topic) fails.push(`${label}: not exercised, no topic text on engine 1`);
      else if (!shown.includes(`${talkerName}: ${topic}`)) fails.push(`${label}: engine 2 did not show "${talkerName}: ${topic}"`);
      return h;
    };

    const loc = await ctx.npcLocation(GERDUR, 2);
    await place(1, AWAY, 0);
    await place(2, loc, 200);
    await loaded(2);
    const hostA = await ctx.waitFor(() => hoster().then((h) => h === actors[1]), 60000, "engine 2 hosts Gerdur").then(() => true).catch(() => false);
    if (!hostA) fails.push(`A: engine 2 does not host Gerdur (hoster ${hex(await hoster())})`);
    else {
      await place(1, await ctx.npcLocation(GERDUR, 2), -200);
      await loaded(1);
      const h = await talk("A (engine 2 hosts)");
      if (h !== undefined && h !== actors[1]) fails.push(`A: Gerdur was hosted by ${hex(h)} at the end, not engine 2`);
    }

    await place(2, AWAY, 0);
    const hostB = await ctx.waitFor(() => hoster().then((h) => h === actors[0]), 90000, "engine 1 hosts Gerdur").then(() => true).catch(() => false);
    if (!hostB) fails.push(`B: engine 1 does not host Gerdur (hoster ${hex(await hoster())})`);
    else {
      await place(2, await ctx.npcLocation(GERDUR, 1), 200);
      await loaded(2);
      const h = await talk("B (engine 1 hosts)");
      if (h !== undefined && h !== actors[0]) fails.push(`B: Gerdur was hosted by ${hex(h)} at the end, not engine 1`);
    }
    ctx.assert.ok(!fails.length, fails.join("; "));
  },
};
