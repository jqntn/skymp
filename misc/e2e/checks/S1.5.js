const fs = require("fs");
const path = require("path");

const NPC = ["Delphine", 0x13485];
const M = "Dialogue Menu";
const R = "_root.DialogueMenu_mc";
const TOLERANCE = 64;
const WINDOW_MS = 1000;

const dist = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));

const distToPath = (p, pts) => {
  let best = Infinity;
  for (let i = 0; i < pts.length; i++) {
    best = Math.min(best, dist(p, pts[i].pos));
    if (i === 0) continue;
    const [a, b] = [pts[i - 1].pos, pts[i].pos];
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
  timeout: 12 * 60000,
  setup: async (ctx) => {
    await ctx.character(1);
    await ctx.character(2);
  },
  async run(ctx) {
    const [name, id] = NPC;
    const actors = [await ctx.ready(1), await ctx.ready(2)];
    const npc = `const a = sp.Actor.from(sp.Game.getFormEx(${id}));`;
    const loaded = `${npc} return !sp.Ui.isMenuOpen("Loading Menu") && !!a && a.is3DLoaded();`;
    const npcPos = `${npc} return a && a.is3DLoaded() ? [a.getPositionX(), a.getPositionY(), a.getPositionZ()] : null;`;
    const ui = (t) => `sp.Ui.getString("${M}", "${R}.${t}")`;

    const loc = await ctx.probe(`return mp.get(${id}, "locationalData");`);
    await ctx.probe(`mp.set(${actors[1]}, "locationalData", ${JSON.stringify(loc)}); return 0;`);
    await ctx.waitFor(() => ctx.drv(loaded, 2).catch(() => false), 120000, `${name} is loaded on engine 2`);
    await ctx.waitFor(async () => (await ctx.probe(`return mp.get(${id}, "hoster");`)) === actors[1], 30000, `engine 2 hosts ${name}`);
    await ctx.probe(`mp.set(${actors[0]}, "locationalData", ${JSON.stringify(loc)}); return 0;`);
    await ctx.waitFor(() => ctx.drv(loaded, 1).catch(() => false), 120000, `${name} is loaded on engine 1`);
    await ctx.sleep(3000);
    ctx.assert.equal(await ctx.probe(`return mp.get(${id}, "hoster");`), actors[1], `${name} is not hosted by engine 2 after engine 1 arrived`);

    let seen = false;
    for (let k = 0; k < 24 && !seen; k++) {
      const spot = k % 8;
      const d = [90, 150, 60][Math.floor(k / 8)];
      await ctx.drv(`${npc} const p = sp.Game.getPlayer(); const r = (a.getAngleZ() + ${spot * 45}) * Math.PI / 180;
        p.setPosition(a.getPositionX() + ${d} * Math.sin(r), a.getPositionY() + ${d} * Math.cos(r), a.getPositionZ()); return 0;`, 1);
      await ctx.sleep(700);
      seen = await ctx.drv(`${npc} return sp.Game.getPlayer().hasLOS(a);`, 1);
    }
    ctx.assert.ok(seen, `no spot near ${name} with line of sight on engine 1`);
    let open = false;
    for (let attempt = 0; attempt < 2 && !open; attempt++) {
      await ctx.drv(`${npc} a.activate(sp.Game.getPlayer(), false); return 0;`, 1);
      open = await ctx.waitFor(() => ctx.drv(`${npc} return sp.Ui.isMenuOpen("${M}") && a.isInDialogueWithPlayer();`, 1), 10000, `dialogue with the puppet on engine 1`).catch(() => false);
    }
    ctx.assert.ok(open, `no dialogue with the puppet ${name} on engine 1`);

    const topic = await ctx.waitFor(() => ctx.drv(`return ${ui("TopicList.entryList.0.text")};`, 1), 15000, "the topic list is shown");
    const subtitle = async () => (await ctx.drv(`return ${ui("SubtitleText.text")};`, 1)).trim();
    const greeting = await ctx.waitFor(subtitle, 10000, `${name} greets the player on engine 1`);
    await ctx.waitFor(async () => !(await subtitle()), 20000, "the greeting ends").catch(() => {});
    const seenSubs = [];
    let answer = "";
    for (let click = 0; click < 3 && !answer; click++) {
      await ctx.drv(`sp.Ui.setInt("${M}", "${R}.TopicList.selectedIndex", 0); sp.Ui.invokeBool("${M}", "${R}.onSelectionClick", true); return 0;`, 1);
      answer = await ctx.waitFor(async () => {
        const s = await subtitle();
        if (s && !seenSubs.includes(s)) seenSubs.push(s);
        return s && s !== greeting ? s : "";
      }, 8000, `${name} answers the topic`).catch(() => "");
    }
    if (!answer) ctx.evidence.push(`no answer; greeting "${greeting}", subtitles seen ${JSON.stringify(seenSubs)}, menu open ${await ctx.drv(`return sp.Ui.isMenuOpen("${M}");`, 1)}`);
    ctx.assert.ok(answer, `${name} did not answer the topic "${topic}" on engine 1`);
    ctx.evidence.push(`engine 1 talks to the puppet ${name} (${id.toString(16)}) hosted by engine 2; topic "${topic}", answer "${answer}"`);
    ctx.shot("S1_5-topic", 1);

    await ctx.waitFor(async () => {
      await ctx.drv(`sp.Ui.invokeBool("${M}", "${R}.onCancelPress", true); return 0;`, 1);
      await ctx.sleep(1500);
      return ctx.drv(`${npc} return !sp.Ui.isMenuOpen("${M}") && !a.isInDialogueWithPlayer();`, 1);
    }, 20000, "the dialogue closes on engine 1");
    ctx.evidence.push("dialogue closed on engine 1");

    const before2 = await ctx.drv(npcPos, 2);
    const target = await ctx.drv(`${npc} const c = a.getParentCell(); let door = null;
      for (let i = 0, n = c.getNumRefs(29); i < n; i++) { const r = c.getNthRef(i, 29); if (r && (!door || a.getDistance(r) < a.getDistance(door))) door = r; }
      let dx = 1, dy = 0;
      if (door) { dx = a.getPositionX() - door.getPositionX(); dy = a.getPositionY() - door.getPositionY(); const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l; }
      const t = [a.getPositionX() + dx * 200, a.getPositionY() + dy * 200, a.getPositionZ()];
      a.translateTo(t[0], t[1], t[2], 0, 0, a.getAngleZ(), 100, 0);
      return t;`, 2);
    const t0 = Date.now();
    const hostPath = [];
    const puppet = [];
    const server = [];
    while (Date.now() - t0 < 12000) {
      const [hp, pp, sv] = await Promise.all([ctx.drv(npcPos, 2), ctx.drv(npcPos, 1), ctx.probe(`return mp.get(${id}, "hoster");`)]);
      const t = Date.now();
      if (hp) hostPath.push({ t, pos: hp });
      if (pp) puppet.push({ t, pos: pp });
      server.push({ t, hoster: sv });
      await ctx.sleep(150);
    }
    fs.writeFileSync(path.join(ctx.dir, `${name}-samples.json`), JSON.stringify({ t0, hostPath, puppet, server }));

    const net = hostPath.reduce((m, x) => Math.max(m, dist(x.pos, before2)), 0);
    const late = puppet.filter((x) => x.t - t0 >= WINDOW_MS).map((x) => ({ t: x.t, d: distToPath(x.pos, hostPath.filter((y) => y.t >= x.t - WINDOW_MS && y.t <= x.t)) }));
    const worst = late.reduce((m, x) => Math.max(m, x.d), 0);
    const hosters = [...new Set(server.map((x) => x.hoster))];
    ctx.evidence.push(`then engine 2 translates ${name} 200 units to ${target.map(Math.round)}: up to ${net.toFixed(0)} units from its start on the hoster, ${late.length} puppet samples on engine 1, worst distance to the hoster path of the last ${WINDOW_MS} ms: ${worst.toFixed(1)}, hosters ${hosters.map((x) => x.toString(16))}`);
    ctx.shot("S1_5-follow", 1);
    ctx.assert.ok(net > 100, `${name} did not move on the hoster (${net.toFixed(0)} units)`);
    ctx.assert.ok(hosters.length === 1 && hosters[0] === actors[1], `${name} changed hoster: ${hosters.map((x) => x.toString(16))}`);
    const rtt = Math.max(ctx.driverRtt(1), ctx.driverRtt(2));
    if (late.length < 20 && rtt > 200) throw new ctx.Env(`only ${late.length} puppet samples with a median driver round trip of ${rtt} ms`);
    ctx.assert.ok(late.length >= 20, `only ${late.length} puppet samples`);
    ctx.assert.ok(worst <= TOLERANCE, `the puppet was ${worst.toFixed(1)} units from the hoster path of the last ${WINDOW_MS} ms`);
  },
};
