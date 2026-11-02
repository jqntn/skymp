const fs = require("fs");
const path = require("path");

const BANDIT = 0x1ebf6;
const INTERIOR = { cellOrWorldDesc: "165a8:Skyrim.esm", pos: [-803, 386, 320], rot: [0, 0, 0] };
const WORLD = { cellOrWorldDesc: "1a26f:Skyrim.esm", pos: [26691, 1678, -1404], rot: [0, 0, 0] };
const AWAY = 700;
const RETURN_AFTER_MS = 500;
const QUIT_AFTER_MS = 300;
const SILENCE_MS = 3000;
const SEND_MS = 130;
const RELAY_MS = 100;
const STALE = 200;
const POS = 150;
const FRAME_MS = 500;
const WATCH_MS = 3000;

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
    const npc = `const a = sp.Actor.from(sp.Game.getFormEx(${BANDIT}));`;
    const server = () => ctx.probe(`const l = mp.get(${BANDIT}, "locationalData"); return { hoster: mp.get(${BANDIT}, "hoster") || 0, cell: l.cellOrWorldDesc, pos: l.pos.map(Math.round) };`);
    const heal = () => ctx.probe(`for (const a of ${JSON.stringify(actors)}) mp.set(a, "percentages", { health: 1, magicka: 1, stamina: 1 }); return 0;`).catch(() => 0);
    const view = (n) => ctx.drv(`${npc} return a && a.is3DLoaded() && !a.isDisabled() ? [a.getPositionX(), a.getPositionY(), a.getPositionZ()].map(Math.round) : null;`, n).catch(() => null);
    const dist = (a, b) => Math.round(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
    const loc = await ctx.npcLocation(BANDIT);
    const spot = (dx) => ({ ...loc, pos: [loc.pos[0] + dx, loc.pos[1], loc.pos[2] + 50] });
    const go = async (n, to) => {
      await ctx.probe(`mp.set(${actors[n - 1]}, "locationalData", ${JSON.stringify(to)}); return 0;`);
      const [x, y] = to.pos;
      let last = null;
      let sentAt = Date.now();
      await ctx.waitFor(async () => { await heal(); if (Date.now() - sentAt > 10000) { sentAt = Date.now(); await ctx.probe(`mp.set(${actors[n - 1]}, "locationalData", ${JSON.stringify(to)}); return 0;`); } last = await ctx.drv(`${npc} const p = sp.Game.getPlayer(); return { loading: sp.Ui.isMenuOpen("Loading Menu"), p: [p.getPositionX(), p.getPositionY(), p.getPositionZ()].map(Math.round), a: a ? { loaded: a.is3DLoaded(), disabled: a.isDisabled(), dead: a.isDead(), pos: [a.getPositionX(), a.getPositionY(), a.getPositionZ()].map(Math.round) } : null };`, n).catch((e) => ({ error: e.message.slice(0, 80) })); return !last.error && !last.loading && Math.hypot(last.p[0] - x, last.p[1] - y) < 400 && !!last.a && last.a.loaded; }, 120000, `engine ${n}'s player is at ${to.pos} and the bandit is loaded`).catch((e) => { throw new Error(`${e.message}; last seen ${JSON.stringify(last)}`); });
    };
    const logTime = (l) => Date.parse(l.slice(1, 24).replace(" ", "T"));
    const t = (ms) => `${(ms / 1000).toFixed(2)} s`;
    const fails = [];
    const skip = (cond, why) => ctx.assert.ok(cond, [...fails, `not exercised: ${why}`].join("; "));

    const round = async (mode) => {
      const label = mode === "loading" ? "return first, quit during the load" : "quit first, return 0.5 s later";
      for (const n of [1, 2]) await ctx.waitFor(() => ctx.drv(`const p = sp.Game.getPlayer(); if (!p || !p.is3DLoaded() || sp.Ui.isMenuOpen("Main Menu") || sp.Ui.isMenuOpen("Loading Menu")) return false; sp.Debug.setGodMode(true); return true;`, n).catch(() => false), 180000, `engine ${n} is in the world`);
      await go(1, spot(300));
      await go(2, spot(-300));
      const hosted = await ctx.waitFor(async () => (await heal(), actors.includes((await server()).hoster)), 30000, "a client hosts the bandit").then(() => true).catch(() => false);
      skip(hosted, `${label}: no client hosts the bandit`);
      const h = (await server()).hoster === actors[0] ? 1 : 2;
      const v = 3 - h;
      const synced = await ctx.waitFor(async () => { const [seen, s] = await Promise.all([view(v), server()]); return !!seen && dist(seen, s.pos) < 100; }, 15000, `engine ${v} shows the bandit at the server's position`).then(() => true).catch(() => false);
      const lastSeen = await view(v);
      skip(synced && lastSeen, `${label}: engine ${v} does not show the bandit at the server's position before it leaves`);

      const leave = mode === "loading" ? WORLD : INTERIOR;
      const id = parseInt(leave.cellOrWorldDesc, 16);
      await ctx.probe(`mp.set(${actors[v - 1]}, "locationalData", ${JSON.stringify(leave)}); return 0;`);
      await ctx.waitFor(() => ctx.drv(`const p = sp.Game.getPlayer(); const c = p.getParentCell(); const w = p.getWorldSpace(); return !sp.Ui.isMenuOpen("Loading Menu") && ((!!c && c.getFormID() === ${id}) || (!!w && w.getFormID() === ${id}));`, v).catch(() => false), 120000, `engine ${v} is in ${leave.cellOrWorldDesc}`);
      await go(h, spot(AWAY));
      await ctx.drv(`${npc} a.startCombat(sp.Game.getPlayer()); return 0;`, h).catch(() => 0);
      const moved = await ctx.waitFor(async () => (await heal(), dist((await server()).pos, lastSeen) >= AWAY / 2), 30000, "the bandit runs to the hoster's player").then(() => true).catch(() => false);
      await ctx.sleep(3000);
      const before = await server();
      ctx.evidence.push(`${label}: hoster engine ${h} ${hex(actors[h - 1])}, viewer engine ${v} ${hex(actors[v - 1])}; engine ${v} last showed the bandit at ${lastSeen} before it went to ${leave.cellOrWorldDesc}; then the bandit ran to engine ${h}'s player (moved ${moved}) and the server had it at ${before.pos}, ${dist(before.pos, lastSeen)} units from there`);
      skip(before.hoster === actors[h - 1] && dist(before.pos, lastSeen) >= STALE, `${label}: before the return the bandit is ${JSON.stringify(before)}, not hosted by engine ${h} at least ${STALE} units from where engine ${v} last showed it`);

      const back = spot(-300);
      await ctx.drv(`globalThis.e2eF8 = { s: [] };
        if (!globalThis.e2eF8Update) { globalThis.e2eF8Update = true; let last = 0; sp.on("update", () => { const g = globalThis.e2eF8; const now = Date.now(); if (!g || now - last < 50 || g.s.length > 4000) return; last = now;
          const p = sp.Game.getPlayer(); const c = p.getParentCell(); const a = sp.Actor.from(sp.Game.getFormEx(${BANDIT})); const loading = sp.Ui.isMenuOpen("Loading Menu");
          g.s.push([now, !loading && !!c && !c.isInterior() && Math.hypot(p.getPositionX() - ${back.pos[0]}, p.getPositionY() - ${back.pos[1]}) < 400, a && a.is3DLoaded() && !a.isDisabled() ? [Math.round(a.getPositionX()), Math.round(a.getPositionY()), Math.round(a.getPositionZ())] : null, loading ? 1 : 0]); }); }
        return 0;`, v);
      const sendBack = () => ctx.probe(`mp.set(${actors[v - 1]}, "locationalData", ${JSON.stringify(back)}); return 0;`);
      const quit = () => void ctx.drv("sp.Debug.quitGame(); return 0;", h).catch(() => 0);
      let at;
      let quitAt;
      if (mode === "loading") {
        at = Date.now();
        await sendBack();
        await ctx.sleep(QUIT_AFTER_MS);
        quitAt = Date.now();
        quit();
      } else {
        quitAt = Date.now();
        quit();
        await ctx.sleep(RETURN_AFTER_MS);
        at = Date.now();
        await sendBack();
      }
      const servers = [];
      let takenAt = null;
      while (Date.now() - at < 60000 && (takenAt === null || Date.now() - takenAt < 1000)) {
        const s = await server();
        servers.push([Date.now(), s]);
        if (takenAt === null && s.hoster === actors[v - 1]) takenAt = Date.now();
        await ctx.sleep(250);
      }
      const rec = await ctx.drv(`const g = globalThis.e2eF8; globalThis.e2eF8 = null; return g.s;`, v);
      const lines = fs.readFileSync(path.join(ctx.dir, "server.log"), "utf8").split(/\r?\n/).filter((l) => logTime(l) >= quitAt);
      const silentLine = lines.find((l) => l.includes(`Player ${hex(actors[h - 1])} sent no movement for 3 s`));
      const takeLine = lines.find((l) => l.includes(`Hoster changed from ${hex(actors[h - 1])} to `) && l.includes(` on ${hex(BANDIT)} `));
      const lastMoveBy = silentLine ? logTime(silentLine) - SILENCE_MS + SEND_MS + RELAY_MS : null;
      const landed = rec.find((s) => s[0] >= at && s[1] && s[2] && (takenAt === null || s[0] <= takenAt));
      const loadingSeen = rec.filter((s) => s[0] >= at && s[3]);
      const afterAt = rec.filter((s) => s[0] >= at);
      const gap = afterAt.slice(1).map((s, i) => [s[0] - afterAt[i][0], afterAt[i][0]]).reduce((m, x) => (x[0] > m[0] ? x : m), [0, 0]);
      const frozen = servers.filter(([ms, s]) => ms >= quitAt && s.hoster === actors[h - 1]).map(([, s]) => s.pos);
      const last = frozen.length ? frozen[frozen.length - 1] : before.pos;
      ctx.evidence.push(`${label}: at 0 s engine ${v} was sent back; engine ${h} quit at ${t(quitAt - at)}; engine ${v}'s first sample after that at ${afterAt.length ? t(afterAt[0][0] - at) : "none"}, longest gap between samples ${gap[0]} ms from ${t(gap[1] - at)}; its Loading Menu ${loadingSeen.length ? `open from ${t(loadingSeen[0][0] - at)} to ${t(loadingSeen[loadingSeen.length - 1][0] - at)}` : "not seen"}; engine ${v} outside with the bandit shown at ${landed ? t(landed[0] - at) : "never before its take"}; server log: ${silentLine ? `${silentLine.replace(/^.*\] /, "")} at ${t(logTime(silentLine) - at)}, so the hoster's last bandit movement reached engine ${v} by ${t(lastMoveBy - at)}` : `no "sent no movement" line for ${hex(actors[h - 1])}`}; ${takeLine ? `${takeLine.replace(/^.*\] /, "")} at ${t(logTime(takeLine) - at)}` : "no hoster change line"}; engine ${v} took the bandit at ${takenAt === null ? "never" : t(takenAt - at)} (polled); the server's position after the quit ${frozen.length ? `${frozen[0]} to ${last}` : "not sampled"}`);
      skip(silentLine && lastMoveBy !== null, `${label}: the server log has no "sent no movement for 3 s" line for engine ${h}'s player, so the hoster's last movement is unknown`);
      skip(landed, `${label}: engine ${v} did not show the bandit outside before ${takenAt === null ? "60 s after the return" : "its take"}`);
      skip(landed[0] >= lastMoveBy, `${label}: engine ${v} showed the bandit outside at ${t(landed[0] - at)}, before the hoster's last movement could have reached it (${t(lastMoveBy - at)})`);
      const end = Math.min(landed[0] + WATCH_MS, takenAt === null ? Infinity : takenAt);
      const span = rec.filter((s) => s[0] >= landed[0] && s[0] <= end);
      const window = span.filter((s) => s[2]);
      const gaps = span.filter((s) => !(s[1] && s[2]));
      const late = window.filter((s) => s[0] >= landed[0] + FRAME_MS);
      const off = late.filter((s) => dist(s[2], last) > POS);
      const steps = window.slice(1).map((s, i) => [s[0] - landed[0], dist(s[2], window[i][2])]).reduce((m, x) => (x[1] > m[1] ? x : m), [0, 0]);
      const settled = window.find((s) => dist(s[2], last) <= POS);
      ctx.evidence.push(`${label}: engine ${v} first showed the bandit outside at ${landed[2]}, ${dist(landed[2], last)} units from the server's last position (${dist(landed[2], lastSeen)} from where it last showed it); within ${POS} units ${settled ? `after ${t(settled[0] - landed[0])}` : "never"}; ${off.length} of ${late.length} samples from ${FRAME_MS} ms after that to ${t(end - landed[0])} more than ${POS} units off${off.length ? ` (first at ${t(off[0][0] - landed[0])} ${dist(off[0][2], last)} units, last at ${t(off[off.length - 1][0] - landed[0])})` : ""}; ${gaps.length} samples in that span with the bandit not shown or the player not at its spot; largest step between samples ${steps[1]} at ${t(steps[0])}`);
      ctx.evidence.push(`${label}: engine ${v} samples from that moment (ms:units off, - not shown): ${span.slice(0, 50).map((s) => `${s[0] - landed[0]}:${s[2] ? dist(s[2], last) : "-"}`).join(" ")}`);
      skip(late.length, `${label}: no sample of engine ${v} between ${FRAME_MS} ms after it showed the bandit and its take`);
      if (off.length) fails.push(`${label}: engine ${v} first showed the bandit outside ${dist(landed[2], last)} units from the server's last position and ${off.length} samples from ${FRAME_MS} ms later were more than ${POS} units off (the last at ${t(off[off.length - 1][0] - landed[0])})`);
      return h;
    };

    const quitter = await round("loading");
    await ctx.relog(quitter);
    const [rx, ry] = await ctx.probe(`return mp.get(${actors[quitter - 1]}, "locationalData").pos;`);
    await ctx.waitFor(() => ctx.drv(`const p = sp.Game.getPlayer(); return !!p && p.is3DLoaded() && !sp.Ui.isMenuOpen("Main Menu") && !sp.Ui.isMenuOpen("Loading Menu") && Math.hypot(p.getPositionX() - ${rx}, p.getPositionY() - ${ry}) < 400;`, quitter).catch(() => false), 180000, `engine ${quitter}'s player is in the world at its server position after the relog`);
    await ctx.sleep(3000);
    await round("buffered");
    ctx.assert.ok(!fails.length, fails.join("; "));
  },
};
