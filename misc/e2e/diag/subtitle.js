const GERDUR = 0x13489;
const HELLO = 0x453e9;
const HUD = "_root.HUDMovieBaseInstance.SubtitleText.text";
const TEXT = "un sujet assez long pour rester affiche plusieurs secondes sur le HUD pendant le test des sous-titres";

module.exports = {
  gameHour: 8,
  timeout: 10 * 60000,
  setup: async (ctx) => {
    await ctx.character(1);
  },
  async run(ctx) {
    const actor = await ctx.ready(1);
    const npc = `const a = sp.Actor.from(sp.Game.getFormEx(${GERDUR}));`;
    const loc = await ctx.npcLocation(GERDUR);
    await ctx.probe(`mp.set(${actor}, "locationalData", ${JSON.stringify({ ...loc, pos: [loc.pos[0] + 150, loc.pos[1], loc.pos[2] + 30] })}); return 0;`);
    await ctx.waitFor(() => ctx.drv(`${npc} return !sp.Ui.isMenuOpen("Loading Menu") && !!a && a.is3DLoaded();`).catch(() => false), 120000, "Gerdur is loaded");
    await ctx.waitFor(() => ctx.probe(`return mp.get(${GERDUR}, "hoster") === ${actor};`), 30000, "engine 1 runs Gerdur").catch(() => {});
    await ctx.drv(`const w = globalThis.e2eSub = { hud: [], speaks: [], subs: [] }; let hud = null; let subs = "";
      sp.on("speakSound", (e) => { if (e.actorId === ${GERDUR}) w.speaks.push([Date.now(), e.voiceFile.split("\\\\").pop()]); });
      sp.on("update", () => {
        try { const h = (sp.Ui.getString("HUD Menu", "${HUD}") || "").trim(); if (h !== hud) { hud = h; w.hud.push([Date.now(), h.replace(/[\\r\\n]+/g, " | ").slice(0, 50)]); } } catch (e) {}
        try { const s = JSON.stringify(sp.getSubtitles().map((x) => x.text.slice(0, 30))); if (s !== subs) { subs = s; w.subs.push([Date.now(), s]); } } catch (e) {}
      });
      return 0;`);
    for (let k = 0; k < 3; k++) {
      await ctx.drv(`globalThis.e2eSub.hud = []; globalThis.e2eSub.speaks = []; globalThis.e2eSub.subs = []; return 0;`);
      const t0 = Date.now();
      await ctx.probe(`mp.sendCustomPacket(mp.getUserByActor(${actor}), JSON.stringify({ customPacketType: "talkTopic", name: "E2e", text: ${JSON.stringify(TEXT)} })); return 0;`);
      await ctx.sleep(500);
      const said = await ctx.drv(`${npc} const t = sp.Topic.from(sp.Game.getFormEx(${HELLO})); a.say(t, null, false); return !!t;`).catch((e) => String(e));
      await ctx.sleep(11000);
      const w = await ctx.drv(`return globalThis.e2eSub;`);
      const rel = (xs) => xs.map(([t, ...r]) => [t - t0, ...r]);
      ctx.evidence.push(`try ${k + 1}: said ${said}; HUD ${JSON.stringify(rel(w.hud))}; Gerdur speaks ${JSON.stringify(rel(w.speaks))}; subtitle list ${JSON.stringify(rel(w.subs))}`);
      await ctx.sleep(3000);
    }
  },
};
