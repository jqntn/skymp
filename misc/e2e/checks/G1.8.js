const GERDUR = 0x13489;
const SCENE = [["Hilde", 0x35534], ["Sven", 0x13491]];
const M = "Dialogue Menu";
const R = "_root.DialogueMenu_mc";
const LAG_MS = 1000;

module.exports = {
  engines: 2,
  timeout: 20 * 60000,
  setup: async (ctx) => {
    await ctx.character(1);
    await ctx.character(2);
  },
  async run(ctx) {
    const actors = [await ctx.ready(1), await ctx.ready(2)];
    const hex = (v) => (v >>> 0).toString(16);
    const npc = (id) => `const a = sp.Actor.from(sp.Game.getFormEx(${id}));`;
    const ui = (t) => `sp.Ui.getString("${M}", "${R}.${t}")`;
    const hoster = (id) => ctx.probe(`return mp.get(${id}, "hoster") || 0;`);
    const ids = [GERDUR, ...SCENE.map(([, id]) => id)];
    for (const n of [1, 2]) {
      await ctx.drv(`globalThis.speaks = []; globalThis.subs = [];
        sp.on("speakSound", (e) => { globalThis.speaks.push({ id: e.actorId, file: e.voiceFile, t: Date.now() }); });
        sp.on("update", () => { for (const s of sp.getSubtitles()) { if (!globalThis.subs.some((x) => x.id === s.speakerId && x.text === s.text)) globalThis.subs.push({ id: s.speakerId, text: s.text, t: Date.now() }); } });
        return 0;`, n);
    }
    const ini = (n) => ctx.drv(`return ["bDialogueSubtitles:Interface", "bGeneralSubtitles:Interface"].map((k) => sp.Utility.getINIBool(k));`, n);
    const subtitleIni = [await ini(1), await ini(2)];
    ctx.evidence.push(`subtitle settings (dialogue, general): engine 1 ${subtitleIni[0]}, engine 2 ${subtitleIni[1]}`);
    ctx.assert.deepStrictEqual(subtitleIni[0], subtitleIni[1], "the engines have different subtitle settings");
    const speaks = (n, list, since) => ctx.drv(`return globalThis.speaks.filter((s) => ${JSON.stringify(list)}.includes(s.id) && s.t >= ${since});`, n);
    const subs = (n, since) => ctx.drv(`return globalThis.subs.filter((s) => s.t >= ${since});`, n);
    const fails = [];

    const bring = async (list) => {
      const loc = await ctx.npcLocation(list[0][1], 2);
      await ctx.probe(`mp.set(${actors[1]}, "locationalData", ${JSON.stringify({ ...loc, pos: [loc.pos[0] + 200, loc.pos[1], loc.pos[2] + 30] })}); return 0;`);
      for (const [name, id] of list) {
        await ctx.waitFor(() => ctx.drv(`${npc(id)} return !sp.Ui.isMenuOpen("Loading Menu") && !!a && a.is3DLoaded();`, 2).catch(() => false), 120000, `${name} is loaded on engine 2`);
        if (!await ctx.waitFor(() => hoster(id).then((h) => h === actors[1]), 60000, `engine 2 hosts ${name}`).catch(() => false)) {
          fails.push(`${name}: engine 2 does not host the NPC (hoster ${hex(await hoster(id))})`);
          return false;
        }
      }
      const at = await ctx.npcLocation(list[0][1], 2);
      await ctx.probe(`mp.set(${actors[0]}, "locationalData", ${JSON.stringify({ ...at, pos: [at.pos[0] - 200, at.pos[1], at.pos[2] + 30] })}); return 0;`);
      for (const [name, id] of list) {
        await ctx.waitFor(() => ctx.drv(`${npc(id)} return !sp.Ui.isMenuOpen("Loading Menu") && !!a && a.is3DLoaded();`, 1).catch(() => false), 120000, `${name} is loaded on engine 1`);
      }
      return true;
    };

    const compare = async (label, list, since) => {
      const listIds = list.map(([, id]) => id);
      const name = (id) => (list.find(([, x]) => x === id) || [hex(id)])[0];
      const file = (s) => s.file.split("\\").pop();
      let count = -1;
      let spoken = [];
      await ctx.waitFor(async () => {
        await ctx.sleep(3000);
        spoken = await speaks(2, listIds, since);
        const quiet = spoken.length === count;
        count = spoken.length;
        return quiet;
      }, 60000, `engine 2 says no new ${label} line for 3 s`).catch(() => {});
      for (const [n, id] of list) {
        const h = await hoster(id);
        if (h !== actors[1]) fails.push(`${label}: ${n} is hosted by ${hex(h)} at the end, not by engine 2`);
      }
      const heard = await speaks(1, listIds, since);
      const control = (await subs(2, since)).filter((s) => listIds.includes(s.id));
      const shown = (await subs(1, since)).filter((s) => listIds.includes(s.id) || control.some((c) => c.text === s.text));
      ctx.evidence.push(`${label}: engine 2 said ${spoken.length} lines, engine 1 played ${heard.length}; engine 1 subtitles ${JSON.stringify(shown.map((s) => `${name(s.id)}: ${s.text}`))}; engine 2 subtitles ${control.length}`);
      if (!spoken.length) {
        fails.push(`${label}: the NPCs said no line on engine 2`);
        return;
      }
      const unused = [...heard];
      for (const s of spoken) {
        const i = unused.findIndex((h) => h.id === s.id && h.file === s.file && h.t >= s.t && h.t <= s.t + LAG_MS);
        const m = i >= 0 ? unused.splice(i, 1)[0] : null;
        const late = heard.find((h) => h.id === s.id && h.file === s.file);
        ctx.evidence.push(`${label}: ${name(s.id)} ${file(s)} on engine 1 ${m ? `after ${m.t - s.t} ms` : late ? `after ${late.t - s.t} ms (no match in the window)` : "never"}`);
        if (!m) fails.push(`${label}: ${name(s.id)} line ${file(s)} ${late ? `played ${late.t - s.t} ms from engine 2, outside 0 to ${LAG_MS} ms` : "not played"} on engine 1`);
      }
      for (const h of unused) ctx.evidence.push(`${label}: engine 1 also played ${name(h.id)} ${file(h)}, ${h.t - since} ms into the part, with no line of engine 2 to match`);
      return spoken;
    };

    if (await bring([["Gerdur", GERDUR]])) {
      let seen = false;
      for (let k = 0; k < 24 && !seen; k++) {
        const d = [90, 150, 60][Math.floor(k / 8)];
        await ctx.drv(`${npc(GERDUR)} const p = sp.Game.getPlayer(); const r = (a.getAngleZ() + ${(k % 8) * 45}) * Math.PI / 180;
          p.setPosition(a.getPositionX() + ${d} * Math.sin(r), a.getPositionY() + ${d} * Math.cos(r), a.getPositionZ()); return 0;`, 2);
        await ctx.sleep(700);
        seen = await ctx.drv(`${npc(GERDUR)} return sp.Game.getPlayer().hasLOS(a);`, 2);
      }
      await ctx.sleep(2000);
      const since = Date.now();
      let open = false;
      for (let attempt = 0; attempt < 2 && !open; attempt++) {
        await ctx.drv(`${npc(GERDUR)} a.activate(sp.Game.getPlayer(), false); return 0;`, 2);
        open = await ctx.waitFor(() => ctx.drv(`${npc(GERDUR)} return sp.Ui.isMenuOpen("${M}") && a.isInDialogueWithPlayer();`, 2), 10000, "Gerdur dialogue on engine 2").catch(() => false);
      }
      if (!open) {
        fails.push("Gerdur: no dialogue on engine 2");
      } else {
        const subtitle = async () => (await ctx.drv(`return ${ui("SubtitleText.text")};`, 2)).trim();
        const greeting = await ctx.waitFor(subtitle, 10000, "Gerdur greets engine 2").catch(() => "");
        await ctx.waitFor(async () => !(await subtitle()), 20000, "the greeting ends").catch(() => {});
        let answer = "";
        for (let click = 0; click < 3 && !answer; click++) {
          await ctx.drv(`sp.Ui.setInt("${M}", "${R}.TopicList.selectedIndex", 0); sp.Ui.invokeBool("${M}", "${R}.onSelectionClick", true); return 0;`, 2);
          answer = await ctx.waitFor(async () => { const s = await subtitle(); return s && s !== greeting ? s : ""; }, 8000, "Gerdur answers").catch(() => "");
        }
        await ctx.waitFor(async () => !(await subtitle()), 30000, "the answer ends").catch(() => {});
        ctx.evidence.push(`Gerdur hosted by engine 2 talks to engine 2's player: greeting "${greeting}", answer "${answer}"`);
        if (!answer) fails.push("Gerdur: no answer to the topic on engine 2");
        await ctx.waitFor(async () => {
          await ctx.drv(`sp.Ui.invokeBool("${M}", "${R}.onCancelPress", true); return 0;`, 2);
          await ctx.sleep(1500);
          return ctx.drv(`return !sp.Ui.isMenuOpen("${M}");`, 2);
        }, 30000, "the dialogue closes on engine 2").catch(() => false);
        await ctx.sleep(2000);
        const spoken = await compare("topic", [["Gerdur", GERDUR]], since);
        if (spoken && new Set(spoken.map((s) => s.file)).size < 2) fails.push("topic: engine 2 reported fewer than 2 voice files (greeting and answer)");
      }
    }

    if (await bring(SCENE)) {
      const since = Date.now();
      await ctx.drv(`${npc(SCENE[1][1])} const p = sp.Game.getPlayer(); p.setPosition(a.getPositionX() + 150, a.getPositionY(), a.getPositionZ() + 20); return 0;`, 2);
      await ctx.drv(`${npc(SCENE[1][1])} const p = sp.Game.getPlayer(); p.setPosition(a.getPositionX() - 250, a.getPositionY(), a.getPositionZ() + 20); return 0;`, 1);
      const lines = await ctx.waitFor(async () => { const l = await speaks(2, SCENE.map(([, id]) => id), since); return l.length >= 4 ? l : null; }, 150000, "the Sven and Hilde scene plays on engine 2").catch(() => null);
      await ctx.sleep(3000);
      const stage = await ctx.drv(`const q = sp.Quest.from(sp.Game.getFormEx(0x954d9)); return q ? q.getCurrentStageID() : -1;`, 2);
      ctx.evidence.push(`scene: DialogueRiverwoodIntroScene stage ${stage} on engine 2${lines ? "" : ", fewer than 4 lines in 150 s"}`);
      if (!lines) fails.push("scene: engine 2 said fewer than 4 lines of the scene in 150 s");
      const spoken = await compare("scene", SCENE, since);
      for (const [name, id] of SCENE) {
        if (spoken && !spoken.some((s) => s.id === id)) fails.push(`scene: ${name} said no line on engine 2`);
      }
    }

    ctx.assert.ok(!fails.length, fails.join("; "));
  },
};
