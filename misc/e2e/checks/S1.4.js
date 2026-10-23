const fs = require("fs");
const path = require("path");

const ORGNAR = 0x13486;
const SECONDS = 30;
const PROVOKE_AT_MS = 10000;
const RECOVERY_MS = 3000;
const NUDGE = 150;
const TOLERANCE = 64;
const WINDOW_MS = 1000;

const dist = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));

const distToPath = (p, pts) => {
  let best = Infinity;
  for (let i = 0; i < pts.length; i++) {
    best = Math.min(best, dist(p, pts[i]));
    if (i === 0) continue;
    const [a, b] = [pts[i - 1], pts[i]];
    const ab = b.map((v, k) => v - a[k]);
    const len2 = ab.reduce((s, v) => s + v * v, 0);
    if (!len2) continue;
    const t = Math.max(0, Math.min(1, p.reduce((s, v, k) => s + (v - a[k]) * ab[k], 0) / len2));
    best = Math.min(best, dist(p, a.map((v, k) => v + t * ab[k])));
  }
  return best;
};

const stateOf = (ids) => `const out = {};
  for (const id of ${JSON.stringify(ids)}) {
    const a = sp.Actor.from(sp.Game.getFormEx(id));
    if (!a || !a.is3DLoaded()) continue;
    const t = a.getDialogueTarget(); const c = a.getCombatTarget(); const s = a.getCurrentScene();
    out[id] = { pos: [a.getPositionX(), a.getPositionY(), a.getPositionZ()], target: t ? t.getFormID() : 0, combat: a.isInCombat() ? (c ? c.getFormID() : -1) : 0, scene: s ? s.getFormID() : 0, ai: a.isAIEnabled(), aggression: a.getActorValue("Aggression") };
  }
  return out;`;

const provoke = (ids) => `const out = {}; const start = {};
  const p = sp.Game.getPlayer();
  for (const id of ${JSON.stringify(ids)}) {
    const a = sp.Actor.from(sp.Game.getFormEx(id));
    if (!a || !a.is3DLoaded()) continue;
    const from = [a.getPositionX(), a.getPositionY(), a.getPositionZ()];
    let dx = p.getPositionX() - from[0], dy = p.getPositionY() - from[1];
    const d = Math.hypot(dx, dy) || 1;
    const k = (d > ${NUDGE} + 80 ? 1 : -1) * ${NUDGE} / d;
    a.setActorValue("Aggression", 3);
    a.startCombat(p);
    a.stopTranslation();
    a.setPosition(from[0] + dx * k, from[1] + dy * k, from[2]);
    start[id] = from;
    out[id] = 0;
  }
  return new Promise((resolve) => {
    let frames = 0;
    const f = () => {
      for (const id of Object.keys(start)) {
        const a = sp.Actor.from(sp.Game.getFormEx(+id));
        if (a) out[id] = Math.max(out[id], Math.hypot(a.getPositionX() - start[id][0], a.getPositionY() - start[id][1]));
      }
      if (++frames < 15) sp.once("update", f); else resolve(out);
    };
    sp.once("update", f);
  });`;

module.exports = {
  engines: 2,
  timeout: 10 * 60000,
  setup: async (ctx) => {
    await ctx.character(1);
    await ctx.character(2);
  },
  async run(ctx) {
    const actors = [await ctx.ready(1), await ctx.ready(2)];
    const loc = await ctx.probe(`return mp.get(${ORGNAR}, "locationalData");`);
    for (const actor of actors) await ctx.probe(`mp.set(${actor}, "locationalData", ${JSON.stringify(loc)}); return 0;`);
    for (const n of [1, 2]) {
      await ctx.waitFor(() => ctx.drv(`const a = sp.Actor.from(sp.Game.getFormEx(${ORGNAR})); return !sp.Ui.isMenuOpen("Loading Menu") && !!a && a.is3DLoaded();`, n).catch(() => false), 120000, `the inn is loaded on engine ${n}`);
    }
    await ctx.sleep(10000);

    const npcs = await ctx.probe(`return mp.get(${actors[0]}, "neighbors").filter((id) => id < 0xff000000 && mp.get(id, "type") === "MpActor" && ${JSON.stringify(actors)}.includes(mp.get(id, "hoster")));`);
    ctx.assert.ok(npcs.includes(ORGNAR), `Orgnar is not hosted by a player: ${npcs.map((x) => x.toString(16))}`);

    const hostersNow = async () => (await ctx.probe(`return ${JSON.stringify(npcs)}.map((id) => mp.get(id, "hoster"));`)).map((h) => actors.indexOf(h) + 1);
    const samples = [];
    const provoked = {};
    const t0 = Date.now();
    while (Date.now() - t0 < SECONDS * 1000) {
      if (!Object.keys(provoked).length && Date.now() - t0 >= PROVOKE_AT_MS) {
        const hs = await hostersNow();
        for (const n of [1, 2]) {
          const mine = npcs.filter((id, i) => hs[i] === 3 - n);
          const moved = await ctx.drv(provoke(mine), n);
          for (const id of Object.keys(moved)) provoked[id] = { t: Date.now(), engine: n, nudge: moved[id] };
        }
      }
      const [s1, s2, hosters] = await Promise.all([ctx.drv(stateOf(npcs), 1), ctx.drv(stateOf(npcs), 2), ctx.probe(`return ${JSON.stringify(npcs)}.map((id) => mp.get(id, "hoster"));`)]);
      samples.push({ t: Date.now(), engines: { 1: s1, 2: s2 }, hosters: Object.fromEntries(npcs.map((id, i) => [id, hosters[i]])) });
      await ctx.sleep(300);
    }

    const ownHosted = {};
    const hs = await hostersNow();
    for (const [i, id] of npcs.entries()) if (hs[i]) (ownHosted[hs[i]] = ownHosted[hs[i]] || []).push(id);
    const control = [];
    for (const n of Object.keys(ownHosted).map(Number)) {
      await ctx.drv(`for (const id of ${JSON.stringify(ownHosted[n])}) { const a = sp.Actor.from(sp.Game.getFormEx(id)); a.setActorValue("Aggression", 3); a.startCombat(sp.Game.getPlayer()); } return 0;`, n);
    }
    await ctx.waitFor(async () => {
      control.length = 0;
      for (const n of Object.keys(ownHosted).map(Number)) {
        const inCombat = await ctx.drv(`return ${JSON.stringify(ownHosted[n])}.filter((id) => sp.Actor.from(sp.Game.getFormEx(id)).isInCombat());`, n);
        control.push(...inCombat.map((id) => `${id.toString(16)} on hoster engine ${n}`));
      }
      return control.length > 0;
    }, 15000, "a frenzied hosted NPC enters combat").catch(() => {});
    fs.writeFileSync(path.join(ctx.dir, "samples.json"), JSON.stringify({ t0, npcs, actors, provoked, samples, control }));

    const violations = [];
    const weak = [];
    let left = 0;
    for (const id of npcs) {
      const hostPath = (h) => samples.map((s) => ({ t: s.t, st: s.engines[h][id], h: actors.indexOf(s.hosters[id]) + 1 })).filter((x) => x.st && x.h === h);
      const pv = provoked[id];
      let checked = 0;
      let frenzied = 0;
      let afterProvoke = 0;
      let worstAfterNudge = 0;
      for (const s of samples) {
        const h = actors.indexOf(s.hosters[id]) + 1;
        if (h < 1) continue;
        const p = 3 - h;
        const st = s.engines[p][id];
        if (!st) continue;
        checked++;
        const add = (what) => violations.length < 20 && violations.push(`${id.toString(16)} on puppet engine ${p} at +${s.t - t0} ms: ${what}`);
        if (st.target) add(`dialogue target ${st.target.toString(16)}`);
        if (st.combat) add(`combat with ${st.combat.toString(16)}`);
        if (st.scene) add(`scene ${st.scene.toString(16)}`);
        if (pv && s.t > pv.t && pv.engine === p) {
          afterProvoke++;
          if (st.aggression >= 3) frenzied++;
        }
        if (s.t - t0 < WINDOW_MS) continue;
        const pts = hostPath(h).filter((x) => x.t >= s.t - WINDOW_MS && x.t <= s.t).map((x) => x.st.pos);
        const d = pts.length ? distToPath(st.pos, pts) : Infinity;
        if (pv && s.t > pv.t && s.t - pv.t <= RECOVERY_MS) {
          worstAfterNudge = Math.max(worstAfterNudge, d);
          continue;
        }
        if (d > TOLERANCE) add(`position ${d.toFixed(0)} units from the hoster path${pv && s.t > pv.t ? `, ${s.t - pv.t} ms after the nudge` : ""}`);
      }
      ctx.evidence.push(`${id.toString(16)}: ${checked} puppet samples` + (pv ? `; frenzied and nudged on engine ${pv.engine} (largest move seen in the next 15 frames ${pv.nudge.toFixed(0)} units) at +${pv.t - t0} ms, Aggression 3 held in ${frenzied} of ${afterProvoke} later samples, worst distance to the hoster path in the ${RECOVERY_MS} ms after the nudge ${worstAfterNudge.toFixed(0)}` : "; not provoked"));
      if (checked < 20 && !pv && (await ctx.probe(`return mp.getActorCellOrWorld(${id}) !== mp.getActorCellOrWorld(${actors[0]});`))) {
        ctx.evidence.push(`${id.toString(16)}: left the inn on its hoster's game after ${checked} puppet samples, not counted`);
        left++;
        continue;
      }
      if (checked < 20) weak.push(`${id.toString(16)}: only ${checked} puppet samples`);
      if (!pv) weak.push(`${id.toString(16)}: no puppet to provoke`);
      else if (pv.nudge < 80) weak.push(`${id.toString(16)}: the nudge moved the puppet only ${pv.nudge.toFixed(0)} units`);
      else if (frenzied < 0.8 * afterProvoke || !afterProvoke) weak.push(`${id.toString(16)}: Aggression 3 held in ${frenzied} of ${afterProvoke} samples`);
    }
    ctx.evidence.push(`${npcs.length} hosted NPCs in the inn, ${samples.length} samples over ${SECONDS} s, ${violations.length} violations`);
    ctx.evidence.push(`positive control, Aggression 3 and startCombat(player) on the hosted NPCs: in combat after at most 15 s: ${control.join(", ") || "none"}`);
    for (const v of violations) ctx.evidence.push(`violation: ${v}`);
    ctx.shot("S1_4-engine1", 1);
    ctx.shot("S1_4-engine2", 2);
    ctx.assert.equal(violations.length, 0, violations[0]);
    ctx.assert.equal(weak.length, 0, `the check could not provoke the puppets: ${weak.join("; ")}`);
    ctx.assert.ok(npcs.length - left >= 2, `not exercised: only ${npcs.length - left} hosted NPCs stayed in the inn`);
    ctx.assert.ok(control.length > 0, "positive control failed: no frenzied hosted NPC entered combat, so the provocation proves nothing");
  },
};
