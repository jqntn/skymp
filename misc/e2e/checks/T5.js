const GERDUR = 0x13489;
const AWAY = { cellOrWorldDesc: "1a26f:Skyrim.esm", pos: [26691, 1678, -1404], rot: [0, 0, 0] };
const M = "Dialogue Menu";
const R = "_root.DialogueMenu_mc";
const HUD = "_root.HUDMovieBaseInstance.SubtitleText.text";
const LAG_MS = 1000;
const TOPIC_MS = 1000;
const BLINK_MS = 50;

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
      await ctx.drv(`const w = globalThis.e2eT5 = { speaks: [], hud: [], lines: [], closed: [] }; let hud = ""; let subs = []; let open = false;
        sp.on("speakSound", (e) => { if (e.actorId === ${GERDUR}) w.speaks.push({ file: e.voiceFile, t: Date.now() }); });
        sp.on("update", () => {
          try { const h = (sp.Ui.getString("HUD Menu", "${HUD}") || "").trim(); if (h !== hud) { hud = h; w.hud.push({ text: h, t: Date.now() }); } } catch (e) {}
          const o = sp.Ui.isMenuOpen("${M}"); if (open && !o) w.closed.push({ t: Date.now() }); open = o;
          try { const now = sp.getSubtitles().filter((s) => s.speakerId === ${GERDUR}).map((s) => s.text.trim()).filter((x) => x); for (const x of new Set(now)) { if (!subs.includes(x)) w.lines.push({ text: x, t: Date.now() }); } subs = now; } catch (e) {}
        });
        return 0;`, n);
    }
    const since = (n, t) => ctx.drv(`const w = globalThis.e2eT5; const f = (x) => x.filter((e) => e.t >= ${t}); return { speaks: f(w.speaks), hud: f(w.hud), lines: f(w.lines), closed: f(w.closed) };`, n);
    const dedupe = (list) => list.filter((s, i) => !list.slice(0, i).some((p) => p.file === s.file && s.t - p.t < 500));
    const gerdurName = await ctx.drv(`${npc} return a ? a.getDisplayName() : "";`, 1).catch(() => "");
    const talkerName = await ctx.probe(`return mp.getActorName(${actors[0]});`);
    const fails = [];
    const cells = () => ctx.probe(`return [mp.get(${actors[0]}, "locationalData").cellOrWorldDesc, mp.get(${actors[1]}, "locationalData").cellOrWorldDesc];`);

    const talk = async (label, far) => {
      await ctx.sleep(2000);
      let t0 = Date.now();
      let open = false;
      for (let k = 0; k < 3 && !open; k++) {
        await ctx.drv(`${npc} const p = sp.Game.getPlayer(); p.setPosition(a.getPositionX() + 110 * Math.sin(a.getAngleZ() * Math.PI / 180), a.getPositionY() + 110 * Math.cos(a.getAngleZ() * Math.PI / 180), a.getPositionZ() + 10); return 0;`, 1);
        await ctx.sleep(1000);
        await ctx.drv(`${npc} const p = sp.Game.getPlayer(); p.setAngle(0, 0, p.getAngleZ() + p.getHeadingAngle(a)); return 0;`, 1);
        await ctx.sleep(1000);
        t0 = Date.now();
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
      const all = await since(1, t0);
      const end = (all.closed.length ? all.closed[0].t : Date.now()) + 1000;
      const talker = { ...all, speaks: all.speaks.filter((s) => s.t <= end), lines: all.lines.filter((l) => l.t <= end) };
      const other = await since(2, t0);
      other.speaks = other.speaks.filter((s) => s.t <= end + LAG_MS);
      const spoken = dedupe(talker.speaks);
      const heard = dedupe(other.speaks);
      const shown = other.hud.flatMap((x) => x.text.split(/[\r\n]+/)).filter((x) => x);
      const blinks = [];
      const visible = (line) => {
        const has = (x) => x.text.split(/[\r\n]+/).includes(line);
        const i = other.hud.findIndex(has);
        if (i < 0) return 0;
        let j = i;
        for (;;) {
          if (j + 1 < other.hud.length && has(other.hud[j + 1])) j++;
          else if (j + 2 < other.hud.length && !other.hud[j + 1].text && has(other.hud[j + 2]) && other.hud[j + 2].t - other.hud[j + 1].t < BLINK_MS) { blinks.push(other.hud[j + 2].t - other.hud[j + 1].t); j += 2; }
          else break;
        }
        return (j + 1 < other.hud.length ? other.hud[j + 1].t : Date.now()) - other.hud[i].t;
      };
      ctx.evidence.push(`${label}: hoster ${hex(h)}; topic "${topic}"; engine 1 heard ${spoken.length} lines ${JSON.stringify(spoken.map((s) => s.file.split("\\").pop()))} and subtitled ${JSON.stringify(talker.lines.map((x) => x.text))}; engine 2 played ${heard.length} ${JSON.stringify(heard.map((s) => s.file.split("\\").pop()))}, its HUD showed ${JSON.stringify(shown)}`);
      if (spoken.length < 2) fails.push(`${label}: not exercised, engine 1 heard ${spoken.length} lines of Gerdur (greeting and answer expected)`);
      if (talker.lines.length < 2) fails.push(`${label}: not exercised, engine 1 subtitled ${talker.lines.length} lines of Gerdur`);
      if (far) {
        const c = await cells();
        ctx.evidence.push(`${label}: engine 1 in ${c[0]}, engine 2 in ${c[1]} on the server after the talk`);
        if (c[0] === c[1]) fails.push(`${label}: not exercised, engine 2 is in engine 1's cell ${c[0]}`);
        const leaked = shown.filter((t) => t.startsWith(`${gerdurName}: `) || t.startsWith(`${talkerName}: `));
        const played = heard.filter((x) => spoken.some((s) => s.file === x.file));
        if (leaked.length || played.length) fails.push(`${label}: engine 2 showed ${JSON.stringify(leaked)} and played ${played.length} lines of the talk`);
        return h;
      }
      const unused = [...heard];
      for (const s of spoken) {
        const i = unused.findIndex((x) => x.file === s.file && Math.abs(x.t - s.t) <= LAG_MS);
        const m = i >= 0 ? unused.splice(i, 1)[0] : null;
        const late = heard.find((x) => x.file === s.file);
        ctx.evidence.push(`${label}: ${s.file.split("\\").pop()} on engine 2 ${m ? `after ${m.t - s.t} ms` : late ? `after ${late.t - s.t} ms` : "never"}`);
        if (!m) fails.push(`${label}: engine 2 ${late ? `played ${s.file.split("\\").pop()} ${late.t - s.t} ms after engine 1` : `did not play ${s.file.split("\\").pop()}`}`);
      }
      const count = (list) => list.reduce((m, s) => m.set(s.file, (m.get(s.file) || 0) + 1), new Map());
      const [c1, c2] = [count(talker.speaks), count(other.speaks)];
      for (const [file, n] of c1) {
        if (c2.has(file) && c2.get(file) !== n) fails.push(`${label}: ${file.split("\\").pop()} reported ${n} times on engine 1 and ${c2.get(file)} times on engine 2`);
      }
      for (const l of talker.lines) {
        if (!shown.includes(`${gerdurName}: ${l.text}`)) fails.push(`${label}: engine 2 did not show "${gerdurName}: ${l.text}"`);
      }
      if (!topic) fails.push(`${label}: not exercised, no topic text on engine 1`);
      else if (!shown.includes(`${talkerName}: ${topic}`)) fails.push(`${label}: engine 2 did not show "${talkerName}: ${topic}"`);
      else {
        const stayed = visible(`${talkerName}: ${topic}`);
        ctx.evidence.push(`${label}: the topic stayed on engine 2's HUD for ${stayed} ms${blinks.length ? `, across ${blinks.length} blank HUD readings of ${blinks.join(", ")} ms (the game cleared the subtitle and the client showed it again)` : ""}`);
        ctx.evidence.push(`${label}: timeline (ms from the activation): engine 2 HUD ${JSON.stringify(other.hud.map((x) => [x.t - t0, x.text.replace(/[\r\n]+/g, " | ").slice(0, 60)]))}; engine 1 speaks ${JSON.stringify(talker.speaks.map((s) => [s.t - t0, s.file.split("\\").pop()]))}; engine 2 speaks ${JSON.stringify(other.speaks.map((s) => [s.t - t0, s.file.split("\\").pop()]))}`);
        if (stayed < TOPIC_MS) fails.push(`${label}: engine 2 showed "${talkerName}: ${topic}" for ${stayed} ms, under ${TOPIC_MS} ms`);
      }
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
    if (hostB) {
      await place(2, AWAY, 0);
      await ctx.sleep(3000);
      await ctx.waitFor(() => ctx.drv(`return !sp.Ui.isMenuOpen("Loading Menu");`, 2), 120000, "engine 2 arrives in another cell").catch(() => false);
      if (await ctx.waitFor(async () => { const c = await cells(); return c[0] !== c[1]; }, 60000, "engine 2 leaves engine 1's cell").then(() => true).catch(() => false)) await talk("C (engine 2 in another cell)", true);
      else fails.push(`C: not exercised, engine 2 stays in engine 1's cell ${(await cells())[0]}`);
    }
    ctx.assert.ok(!fails.length, fails.join("; "));
  },
};
