const fs = require("fs");
const path = require("path");
const NPCS = [["Alvor", 0x13482], ["Gerdur", 0x13489], ["Hadvar", 0x2bfa2]];
const TOLERANCE = 64;
const WINDOW_MS = 1000;

const dist = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));

const distToPath = (p, path) => {
  let best = Infinity;
  for (let i = 0; i < path.length; i++) {
    best = Math.min(best, dist(p, path[i].pos));
    if (i === 0) continue;
    const [a, b] = [path[i - 1].pos, path[i].pos];
    const ab = b.map((v, k) => v - a[k]);
    const len2 = ab.reduce((s, v) => s + v * v, 0);
    if (!len2) continue;
    const t = Math.max(0, Math.min(1, p.reduce((s, v, k) => s + (v - a[k]) * ab[k], 0) / len2));
    best = Math.min(best, dist(p, a.map((v, k) => v + t * ab[k])));
  }
  return best;
};

module.exports = {
  engines: 2,
  timeout: 15 * 60000,
  setup: async (ctx) => {
    await ctx.character(1);
    await ctx.character(2);
  },
  async run(ctx) {
    const actors = [await ctx.ready(1), await ctx.ready(2)];
    const npcLoaded = (id) => `const a = sp.Actor.from(sp.Game.getFormEx(${id})); return !sp.Ui.isMenuOpen("Loading Menu") && !!a && a.is3DLoaded();`;
    const npcPos = (id) => `const a = sp.Actor.from(sp.Game.getFormEx(${id})); return a && a.is3DLoaded() ? [a.getPositionX(), a.getPositionY(), a.getPositionZ()] : null;`;

    for (const [name, id] of ctx.npcs || NPCS) {
      const loc = await ctx.probe(`return mp.get(${id}, "locationalData");`);
      for (const actor of actors) await ctx.probe(`mp.set(${actor}, "locationalData", ${JSON.stringify(loc)}); return 0;`);
      for (const n of [1, 2]) {
        await ctx.waitFor(() => ctx.drv(npcLoaded(id), n).catch(() => false), 120000, `${name} is loaded on engine ${n}`);
      }

      const hoster = await ctx.waitFor(() => ctx.probe(`return mp.get(${id}, "hoster");`), 30000, `${name} gets a hoster`);
      const h = actors.indexOf(hoster) + 1;
      ctx.assert.ok(h > 0, `${name} hoster ${hoster.toString(16)} is not a player engine`);
      const p = 3 - h;

      const before = await ctx.drv(npcPos(id), h);
      const target = await ctx.drv(`const a = sp.Actor.from(sp.Game.getFormEx(${id})); const c = a.getParentCell(); let door = null;
        for (let i = 0, n = c.getNumRefs(29); i < n; i++) { const r = c.getNthRef(i, 29); if (r && (!door || a.getDistance(r) < a.getDistance(door))) door = r; }
        let dx = 1, dy = 0;
        if (door) { dx = a.getPositionX() - door.getPositionX(); dy = a.getPositionY() - door.getPositionY(); const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l; }
        const t = [a.getPositionX() + dx * 200, a.getPositionY() + dy * 200, a.getPositionZ()];
        a.translateTo(t[0], t[1], t[2], 0, 0, a.getAngleZ(), 100, 0);
        return t;`, h);
      const t0 = Date.now();
      const hostPath = [];
      const puppet = [];
      const server = [];
      while (Date.now() - t0 < 12000) {
        const [hp, pp, sv] = await Promise.all([ctx.drv(npcPos(id), h), ctx.drv(npcPos(id), p), ctx.probe(`return [mp.get(${id}, "hoster"), mp.getActorPos(${id})];`)]);
        const t = Date.now();
        if (hp) hostPath.push({ t, pos: hp });
        if (pp) puppet.push({ t, pos: pp });
        server.push({ t, hoster: sv[0], pos: sv[1] });
        await ctx.sleep(150);
      }

      fs.writeFileSync(path.join(ctx.dir, `${name}-samples.json`), JSON.stringify({ t0, hostPath, puppet, server }));
      const moved = hostPath.reduce((s, x, i) => s + (i ? dist(x.pos, hostPath[i - 1].pos) : dist(x.pos, before)), 0);
      const late = puppet.filter((x) => x.t - t0 >= WINDOW_MS).map((x) => ({ t: x.t, d: distToPath(x.pos, hostPath.filter((y) => y.t >= x.t - WINDOW_MS && y.t <= x.t)) }));
      const worst = late.reduce((m, x) => Math.max(m, x.d), 0);
      ctx.evidence.push(`${name} (${id.toString(16)}): hoster engine ${h} translates it 200 units to ${target.map(Math.round)}, NPC path on the hoster ${moved.toFixed(0)} units, ${late.length} puppet samples on engine ${p}, worst distance to the hoster path of the last ${WINDOW_MS} ms: ${worst.toFixed(1)}`);
      ctx.shot(`S1_1-${name}-engine${h}`, h);
      ctx.shot(`S1_1-${name}-engine${p}`, p);
      const net = hostPath.reduce((m, x) => Math.max(m, dist(x.pos, before)), 0);
      ctx.assert.ok(net > 100, `${name} did not move on the hoster (at most ${net.toFixed(0)} units from its start)`);
      const hosters = [...new Set(server.map((x) => x.hoster))];
      ctx.assert.ok(hosters.length === 1 && hosters[0] === hoster, `${name} changed hoster during the samples: ${hosters.map((x) => x.toString(16))}`);
      ctx.assert.ok(late.length >= 20, `${name}: only ${late.length} puppet samples`);
      ctx.assert.ok(worst <= TOLERANCE, `${name}: the puppet was ${worst.toFixed(1)} units from the hoster path of the last ${WINDOW_MS} ms`);
    }
  },
};
