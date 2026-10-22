const STAGE = [1280, 720];
const PLACE = 0.015;
const TURN_MS = 4000;
const TURN_DEG_PER_S = 60;
const WALK_PER_S = 300;

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
    const log = () => require("fs").readFileSync(require("path").join(ctx.dir, "server.log"), "utf8");
    const send = (n, content) => ctx.drv(`sp.mpClientPlugin.send(JSON.stringify({ t: 1, contentJsonDump: ${JSON.stringify(JSON.stringify(content))} }), true); return 0;`, n);
    const appearance = { isFemale: false, raceId: 0x13746, weight: 50, skinColor: -1, hairColor: -1, headpartIds: [], headTextureSetId: 0, options: new Array(19).fill(0), presets: new Array(4).fill(0), tints: [], name: "E2eMember" };
    await ctx.probe(`mp.set(${member}, "appearance", ${JSON.stringify(appearance)}); return 0;`);
    const base = await ctx.probe(`return mp.get(${leader}, "locationalData");`);
    await ctx.probe(`mp.set(${member}, "locationalData", ${JSON.stringify({ ...base, pos: [base.pos[0] - 600, base.pos[1] + 500, base.pos[2]] })}); return 0;`);
    await send(1, { customPacketType: "partyInvite", target: member });
    await ctx.sleep(1500);
    await send(2, { customPacketType: "partyAccept", inviter: leader });
    const joined = await ctx.waitFor(() => log().includes("joined party"), 15000, "engine 2 joins the party").then(() => true).catch(() => false);
    ctx.assert.ok(joined, "not exercised: engine 2 did not join engine 1's party");
    await ctx.sleep(3000);

    const ask = (js) => ctx.drv(`const s = globalThis.__t3 || (globalThis.__t3 = { seq: 0 }); if (!s.l) { s.l = true; sp.on("browserMessage", (e) => { if (e.arguments && e.arguments[0] === "e2e-t3") { s.data = e.arguments[1]; s.seq++; } }); } s.asked = s.seq; sp.browser.executeJavaScript(${JSON.stringify(`window.skyrimPlatform.sendMessage("e2e-t3", JSON.stringify((() => { ${js} })()))`)}); return 0;`, 1)
      .then(() => ctx.waitFor(() => ctx.drv(`return globalThis.__t3.seq > globalThis.__t3.asked;`, 1), 5000, "engine 1's web UI answers"))
      .then(() => ctx.drv(`return JSON.parse(globalThis.__t3.data);`, 1));

    const hud = await ctx.drv(`const g = (p) => sp.Ui.getFloat("HUD Menu", "_root.HUDMovieBaseInstance" + p);
      return { baseX: g("._x"), baseY: g("._y"), holderX: g(".CompassShoutMeterHolder._x"), holderY: g(".CompassShoutMeterHolder._y"), frameX: g(".CompassShoutMeterHolder.Compass.CompassFrame._x"), frameY: g(".CompassShoutMeterHolder.Compass.CompassFrame._y"), frameW: g(".CompassShoutMeterHolder.Compass.CompassFrame._width"), frameH: g(".CompassShoutMeterHolder.Compass.CompassFrame._height") };`, 1);
    const nativeLeft = (hud.baseX + hud.holderX + hud.frameX - hud.frameW / 2) / STAGE[0];
    const native = { left: nativeLeft, top: (hud.baseY + hud.holderY + hud.frameY - hud.frameH / 2) / STAGE[1], width: hud.frameW / STAGE[0], height: hud.frameH / STAGE[1] };
    const ui = await ask(`const b = document.getElementById("skymp-party-compass"); if (!b) return null; const r = b.getBoundingClientRect(); const texts = Array.from(b.querySelectorAll("*")).filter((e) => !e.children.length).map((e) => e.textContent.trim());
      return { w: innerWidth, h: innerHeight, rect: [r.left / innerWidth, r.top / innerHeight, r.width / innerWidth, r.height / innerHeight], cardinals: b.querySelectorAll("[data-cardinal]").length, letters: texts.filter((t) => /^[NESWO]$/.test(t)), markers: b.querySelectorAll("[data-actor]").length };`);
    const pct = (v) => `${(v * 100).toFixed(1)}%`;
    const fails = [];
    ctx.evidence.push(`native compass (HUD ${JSON.stringify(hud)} on a ${STAGE.join("x")} stage): left ${pct(native.left)}, top ${pct(native.top)}, width ${pct(native.width)}, height ${pct(native.height)} of the window`);
    if (!ui) fails.push("engine 1 draws no party compass");
    else {
      const [l, t, w, h] = ui.rect;
      ctx.evidence.push(`party compass on engine 1 (${ui.w}x${ui.h}): left ${pct(l)}, top ${pct(t)}, width ${pct(w)}, height ${pct(h)}; ${ui.markers} markers, ${ui.cardinals} cardinal elements, single letters ${JSON.stringify(ui.letters)}`);
      if (Math.abs(l - native.left) > PLACE || Math.abs(w - native.width) > PLACE) fails.push(`the bar spans ${pct(l)} to ${pct(l + w)} of the width, the native compass ${pct(native.left)} to ${pct(native.left + native.width)}`);
      if (Math.abs(t - native.top) > PLACE || Math.abs(h - native.height) > PLACE) fails.push(`the bar spans ${pct(t)} to ${pct(t + h)} of the height, the native compass ${pct(native.top)} to ${pct(native.top + native.height)}`);
      if (ui.cardinals || ui.letters.length) fails.push(`the bar draws its own cardinal letters (${ui.cardinals} elements, ${JSON.stringify(ui.letters)})`);
      if (ui.markers !== 1) fails.push(`the bar shows ${ui.markers} markers for one other member`);
    }

    const watch = () => ask(`const b = document.getElementById("skymp-party-compass"); const s = window.__e2eT3 = { changes: 0, last: "" }; s.obs = new MutationObserver(() => { const m = b && b.querySelector("[data-actor]"); const left = m ? m.style.left : ""; if (left !== s.last) { s.last = left; s.changes++; } }); if (b) s.obs.observe(b, { subtree: true, childList: true, attributes: true, attributeFilter: ["style"] }); return 0;`);
    const stop = () => ask(`const s = window.__e2eT3; s.obs.disconnect(); return s.changes;`);
    const smooth = async (label, n, step) => {
      await watch();
      await ctx.drv(`let other = 0; for (let id = 0xff000000; id < 0xff004000 && !other; id++) { const a = sp.Actor.from(sp.Game.getFormEx(id)); if (a && a.getDisplayName() === "E2eMember") other = id; }
        const f = globalThis.__t3frames = { n: 0, moved: 0, other, last: null, until: Date.now() + ${TURN_MS} };
        if (!globalThis.__t3framesOn) { globalThis.__t3framesOn = true; sp.on("update", () => { const g = globalThis.__t3frames; if (!g || Date.now() > g.until) return; g.n++; const a = g.other ? sp.ObjectReference.from(sp.Game.getFormEx(g.other)) : null; if (!a) return; const pos = [a.getPositionX(), a.getPositionY()]; if (g.last && Math.hypot(pos[0] - g.last[0], pos[1] - g.last[1]) > 2) g.moved++; g.last = pos; }); }
        return 0;`, 1);
      await ctx.drv(`const s = globalThis.__t3move = { frames: 0, moves: 0, until: Date.now() + ${TURN_MS}, last: Date.now() };
        if (!globalThis.__t3moveOn) { globalThis.__t3moveOn = true; sp.on("update", () => { const m = globalThis.__t3move; if (!m || Date.now() > m.until) return; m.frames++; if (m.frames % 3) return; const now = Date.now(); const dt = (now - m.last) / 1000; m.last = now; const p = sp.Game.getPlayer(); ${step}; m.moves++; }); }
        return 0;`, n);
      await ctx.sleep(TURN_MS + 500);
      const seen = await ctx.drv(`return globalThis.__t3move;`, n);
      const changes = await stop();
      const viewer = await ctx.drv(`return globalThis.__t3frames;`, 1);
      ctx.evidence.push(`${label}: engine ${n} moved ${seen.moves} times in ${seen.frames} frames (${((seen.frames * 1000) / TURN_MS).toFixed(1)} per s); the member's marker on engine 1 moved ${changes} times (${((changes * 1000) / TURN_MS).toFixed(1)} per s) in ${viewer.n} engine 1 frames, ${viewer.moved} of them with the member's actor ${(viewer.other >>> 0).toString(16)} moved on engine 1`);
      if (n === 2 && !viewer.other) fails.push(`${label}: not exercised, engine 1 has no actor for the member`);
      if (n === 2 && changes < viewer.moved * 0.9) fails.push(`${label}: the marker moved ${changes} times while the member's actor moved on ${viewer.moved} engine 1 frames`);
      if (changes < seen.moves * 0.9) fails.push(`${label}: the marker moved ${changes} times for ${seen.moves} moves (the native compass redraws on each one)`);
    };
    await smooth("engine 1 turns", 1, `p.setAngle(0, 0, p.getAngleZ() + ${TURN_DEG_PER_S} * dt)`);
    await smooth("the member walks past", 2, `p.setPosition(p.getPositionX() + ${WALK_PER_S} * dt, p.getPositionY(), p.getPositionZ())`);
    ctx.assert.ok(!fails.length, fails.join("; "));
  },
};
