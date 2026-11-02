const fs = require("fs");
const path = require("path");
const B1 = 0x1ebf6;
const B2 = 0x1ebf0;
const B3 = 0x1eba1;
const W = "3c:Skyrim.esm";
const AWAY = { cellOrWorldDesc: "1a26f:Skyrim.esm", pos: [26691, 1678, -1404], rot: [0, 0, 0] };
const NEAR = [[7808, -42681, 3612], [7572, -39162, 3807]];
const FAR = [[7572, -46500, 9000], [7572, -36000, 9000]];
const SPOT = [7526, -40850, 3900];
const CELLS = [-10, -9];
const APART = 1000;
const CELL = 4096;
const SWITCH_MS = 2000;
const FIGHT_MIN_S = 20;
const FIGHT_MAX_S = 60;
const START_HEALTH = [1, 0.5];
const LAG_MS = 1000;
const HEALTH_LAG_MS = 2000;
const SETTLE_MS = 3000;
const HEALTH_PP = 5;
const POS = 150;

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
    const ids = [B1, B2];
    const engineOf = { [actors[0]]: 1, [actors[1]]: 2 };
    const put = (n, pos) => ctx.probe(`mp.set(${actors[n - 1]}, "locationalData", ${JSON.stringify(pos.cellOrWorldDesc ? pos : { cellOrWorldDesc: W, pos, rot: [0, 0, 90] })}); return 0;`);
    const server = (id) => ctx.probe(`const l = mp.get(${id}, "locationalData"); return { hoster: mp.get(${id}, "hoster") || 0, dead: !!mp.get(${id}, "isDead"), pos: l.pos.map(Math.round), cell: [Math.trunc(l.pos[0] / ${CELL}), Math.trunc(l.pos[1] / ${CELL})], health: mp.get(${id}, "percentages").health };`);
    const npc = (id) => `const a = sp.Actor.from(sp.Game.getFormEx(${id}));`;
    const local = (id, n) => ctx.drv(`${npc(id)} if (!a || !a.is3DLoaded()) return null; const t = a.isInCombat() ? a.getCombatTarget() : null; return { pos: [a.getPositionX(), a.getPositionY(), a.getPositionZ()].map(Math.round), health: a.getActorValuePercentage("health"), dead: a.isDead(), ai: a.isAIEnabled(), target: t ? t.getFormID() : 0 };`, n).catch(() => null);
    const loaded = (id, n) => ctx.waitFor(async () => !!(await local(id, n)), 120000, `${hex(id)} is loaded on engine ${n}`);
    const hosts = (id, n, what) => ctx.waitFor(async () => (await server(id)).hoster === actors[n - 1], 30000, what).then(() => true).catch(() => false);
    const calm = (n, enemies) => ctx.drv(`for (const id of [${B1}, ${B2}]) { const a = sp.Actor.from(sp.Game.getFormEx(id)); if (a) { ${enemies ? "a.removeFromAllFactions(); " : ""}a.setActorValue("Aggression", 0); a.setActorValue("Confidence", 4); a.stopCombat(); } } return 0;`, n);
    const hold = (id, n, on) => ctx.drv(`${npc(id)} if (a) a.setDontMove(${on}); return 0;`, n);
    const dist = (a, b) => Math.round(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
    const fails = [];

    for (const n of [1, 2]) await ctx.drv(`sp.Debug.setGodMode(true); sp.Game.getPlayer().setActorValue("Invisibility", 1); return 0;`, n);
    await put(2, FAR[1]);
    await ctx.sleep(3000);
    await put(1, FAR[0]);
    for (const id of ids) await loaded(id, 1);
    ctx.assert.ok(await hosts(B1, 1, "engine 1 hosts bandit 1") && await hosts(B2, 1, "engine 1 hosts bandit 2"), "not exercised: engine 1 does not host both bandits at their camp");
    await ctx.probe(`mp.set(${B3}, "isDisabled", true); return 0;`);
    await ctx.sleep(2000);
    await calm(1);
    const place = (n) => ctx.waitFor(async () => {
        await ctx.drv(`${npc(B2)} if (a.getSitState() !== 0) sp.Debug.sendAnimationEvent(a, "IdleForceDefaultState"); a.setPosition(${SPOT.join(", ")}); a.setDontMove(true); return 0;`, n);
        await ctx.sleep(500);
        return dist((await server(B2)).pos, SPOT) < 60;
      }, 10000, `the server has bandit 2 at its spot from engine ${n}`).then(() => "placed").catch(() => "not placed");
    const firstPlaced = await place(1);
    const split = await hosts(B2, 2, "engine 2 hosts bandit 2 once it is in a cell that only engine 2 sees");
    await loaded(B2, 2);
    await calm(2);
    await put(1, NEAR[0]);
    await put(2, NEAR[1]);
    for (const id of ids) for (const n of [1, 2]) await loaded(id, n);
    await ctx.sleep(4000);
    const placed = await place(2);
    await ctx.sleep(1000);
    const start = await Promise.all(ids.map(server));
    ctx.evidence.push(`setup: engine 1 ${hex(actors[0])} at ${NEAR[0]} (cell y ${CELLS[0]}), engine 2 ${hex(actors[1])} at ${NEAR[1]} (cell y ${CELLS[1]}); bandit 2 placed from engine 1 at the camp: ${firstPlaced}, then engine 2 took it: ${split}, placed again from engine 2: ${placed}; on the server bandit ${hex(B1)} ${JSON.stringify(start[0])}, bandit ${hex(B2)} ${JSON.stringify(start[1])}; apart ${dist(start[0].pos, start[1].pos)}`);
    ctx.assert.ok(start[0].hoster === actors[0] && start[1].hoster === actors[1] && start[0].cell[1] === CELLS[0] && start[1].cell[1] === CELLS[1], `not exercised: the bandits are not each hosted by the player of their own cell before the fight (${hex(start[0].hoster)} in cell ${start[0].cell}, ${hex(start[1].hoster)} in cell ${start[1].cell})`);
    ctx.assert.ok(dist(start[0].pos, start[1].pos) <= APART, `not exercised: the bandits are ${dist(start[0].pos, start[1].pos)} units apart before the fight`);

    for (const [i, id] of ids.entries()) await ctx.probe(`mp.set(${id}, "percentages", { health: ${START_HEALTH[i]}, magicka: 1, stamina: 1 }); return 0;`);
    for (const n of [1, 2]) await ctx.drv(`globalThis.e2eH5 = { s: [] };
      if (!globalThis.e2eH5Update) { globalThis.e2eH5Update = true; let last = 0; sp.on("update", () => { const g = globalThis.e2eH5; const now = Date.now(); if (!g || now - last < 100 || g.s.length > 4000) return; last = now;
        g.s.push([now, ...[${B1}, ${B2}].map((id) => { const a = sp.Actor.from(sp.Game.getFormEx(id)); return a && a.is3DLoaded() ? [Math.round(a.getPositionX()), Math.round(a.getPositionY()), Math.round(a.getPositionZ()), Math.round(a.getActorValuePercentage("health") * 1000) / 10, a.isDead() ? 1 : 0] : null; })]); }); }
      return 0;`, n);
    const begin = Date.now();
    for (const n of [1, 2]) {
      await calm(n, true);
      for (const id of ids) await hold(id, n, false);
    }
    await ctx.drv(`${npc(B1)} a.startCombat(sp.Actor.from(sp.Game.getFormEx(${B2}))); return 0;`, 1);
    await ctx.drv(`${npc(B2)} a.startCombat(sp.Actor.from(sp.Game.getFormEx(${B1}))); return 0;`, 2);
    const rows = [];
    for (let died = 0; Date.now() - begin < FIGHT_MAX_S * 1000 && (Date.now() - begin < (FIGHT_MIN_S + 1) * 1000 || !died || Date.now() - died < 3000); await ctx.sleep(1000)) {
      const srv = await Promise.all(ids.map(server));
      rows.push({ at: Date.now(), t: Math.round((Date.now() - begin) / 100) / 10, hosters: srv.map((x) => hex(x.hoster)), health: srv.map((x) => Math.round(x.health * 100)), dead: srv.map((x) => x.dead) });
      if (!died && srv.some((x) => x.dead)) died = Date.now();
    }
    await ctx.sleep(3000);
    const rec = {};
    for (const n of [1, 2]) rec[n] = await ctx.drv(`const g = globalThis.e2eH5; globalThis.e2eH5 = null; return g.s;`, n);
    const ends = await Promise.all(ids.map(async (id) => [(await local(id, 1)) || {}, (await local(id, 2)) || {}].map((x) => !!x.dead)));

    const lines = fs.readFileSync(path.join(ctx.dir, "server.log"), "utf8").split(/\r?\n/);
    const at = (l) => Date.parse(l.slice(1, 24).replace(" ", "T"));
    const either = `(${hex(B1)}|${hex(B2)})`;
    const relay = lines.find((l) => new RegExp(`Combat of ${either} against ${either} started`).test(l));
    const changes = lines.filter((l) => new RegExp(`Hoster changed from \\w+ to \\w+ on ${either} `).test(l) && relay && at(l) >= at(relay));
    const shared = changes.find((l) => l.includes("(shared fight)"));
    const sharedHost = shared ? parseInt(shared.match(/ to (\w+) on /)[1], 16) : 0;
    const t0 = relay ? at(relay) : 0;
    const tShared = shared ? at(shared) : 0;
    ctx.evidence.push(`fight (server log): ${relay ? relay.replace(/^.*\] /, "") : "no relayed combat target between the bandits"}${shared ? `; ${at(shared) - t0} ms later: ${shared.replace(/^.*\] /, "")}` : ""}; hoster changes of the bandits from the first relay: ${changes.length} (${changes.map((l) => l.replace(/^.*Hoster changed /, "")).join(", ")})`);
    ctx.evidence.push(`fight, every 1 s on the server (s from the faction removal, hosters, health %, dead): ${rows.map((r) => `${r.t}s ${r.hosters.join("/")} ${r.health.join("/")}${r.dead.some(Boolean) ? ` dead ${r.dead.join("/")}` : ""}`).join(" | ")}`);
    ctx.assert.ok(relay, "not exercised: the server got no combat target between the bandits");
    if (!shared || tShared - t0 > SWITCH_MS) fails.push(`the bandits ${shared ? `got one hoster only ${tShared - t0} ms` : "never got one hoster"} after the first relayed combat target`);
    const after = changes.filter((l) => l !== shared && at(l) > tShared);
    if (shared && after.length) fails.push(`a bandit's hoster changed again during the fight: ${after.map((l) => l.replace(/^.*Hoster changed /, "")).join(", ")}`);
    const off = rows.filter((r) => r.at > tShared + 500 && r.hosters.some((h, i) => !r.dead[i] && h !== hex(sharedHost)));
    if (shared && off.length) fails.push(`a living bandit was not on the shared hoster ${hex(sharedHost)} in the server samples at ${off.map((r) => `${r.t}s`).join(", ")}`);
    const deathRow = rows.find((r) => r.dead.some(Boolean));
    if (!deathRow) fails.push(`not exercised: no bandit died within ${FIGHT_MAX_S} s`);
    else if (deathRow.t < FIGHT_MIN_S && rows[rows.length - 1].t < FIGHT_MIN_S) fails.push(`not exercised: the hosters were watched only ${rows[rows.length - 1].t} s`);

    const h = engineOf[sharedHost];
    if (h) {
      const c = h === 1 ? 2 : 1;
      const worst = ids.map(() => ({ pos: [0, 0], health: [0, 0], health1: 0, n: 0 }));
      const deathAt = ids.map(() => ({}));
      for (const [i] of ids.entries()) {
        for (const n of [1, 2]) { const d = rec[n].find((r) => r[i + 1] && r[i + 1][4]); deathAt[i][n] = d ? d[0] : 0; }
        const near = (n, t) => rec[n].reduce((b, r) => (Math.abs(r[0] - t) < Math.abs(b[0] - t) ? r : b), rec[n][0]);
        const trace = [];
        for (let t = tShared - 400; t <= tShared + 3000; t += 200) { const a = near(h, t)[i + 1]; const b = near(c, t)[i + 1]; trace.push(`${((t - tShared) / 1000).toFixed(1)}: ${a ? `${a.slice(0, 3).join(",")} ${a[3]}%` : "-"} / ${b ? `${b.slice(0, 3).join(",")} ${b[3]}%` : "-"}`); }
        ctx.evidence.push(`${hex(ids[i])} around the shared hoster (s, engine ${h} position health / engine ${c}): ${trace.join(" | ")}`);
        let next = tShared + SETTLE_MS;
        for (const row of rec[c]) {
          const copy = row[i + 1];
          if (row[0] < next || !copy) continue;
          next = row[0] + 1000;
          const window = (ms) => rec[h].filter((r) => r[0] >= row[0] - ms && r[0] <= row[0] && r[i + 1]).map((r) => r[i + 1]);
          const path = window(LAG_MS);
          const healths = window(HEALTH_LAG_MS);
          if (!path.length || copy[4] || healths.some((p) => p[4])) continue;
          const pos = Math.round(Math.min(...path.map((p) => dist(p, copy))));
          const lo = Math.min(...healths.map((p) => p[3]));
          const hi = Math.max(...healths.map((p) => p[3]));
          const health = Math.round(Math.max(0, lo - copy[3], copy[3] - hi) * 10) / 10;
          const last = path.map((p) => p[3]);
          worst[i].health1 = Math.max(worst[i].health1, Math.round(Math.max(0, Math.min(...last) - copy[3], copy[3] - Math.max(...last)) * 10) / 10);
          worst[i].n++;
          if (pos > worst[i].pos[0]) worst[i].pos = [pos, Math.round((row[0] - tShared) / 100) / 10];
          if (health > worst[i].health[0]) worst[i].health = [health, Math.round((row[0] - tShared) / 100) / 10];
          if (pos > POS) fails.push(`${hex(ids[i])} at ${worst[i].pos[1]} s: engine ${c}'s copy is ${pos} units from engine ${h}'s path of the last ${LAG_MS} ms`);
          if (health > HEALTH_PP) fails.push(`${hex(ids[i])} at ${Math.round((row[0] - tShared) / 100) / 10} s: engine ${c}'s health is ${health} points outside engine ${h}'s range of the last ${HEALTH_LAG_MS} ms`);
        }
        ctx.evidence.push(`${hex(ids[i])}: ${worst[i].n} samples of engine ${c}'s copy, once a second from ${SETTLE_MS} ms after the shared hoster, against engine ${h}'s path of the last ${LAG_MS} ms and the range of its health in the last ${HEALTH_LAG_MS} ms (the client closes a quarter of a health gap per movement update): worst position ${worst[i].pos[0]} units at ${worst[i].pos[1]} s, worst health ${worst[i].health[0]} points at ${worst[i].health[1]} s (${worst[i].health1} against the last ${LAG_MS} ms); dead on engine 1 ${deathAt[i][1] ? `at ${Math.round((deathAt[i][1] - tShared) / 100) / 10} s` : "no"}, engine 2 ${deathAt[i][2] ? `at ${Math.round((deathAt[i][2] - tShared) / 100) / 10} s` : "no"}; 3 s after the window dead on engine 1 ${ends[i][0]}, engine 2 ${ends[i][1]}`);
        if (worst[i].n < 5) fails.push(`not exercised: only ${worst[i].n} samples of ${hex(ids[i])}'s copy on engine ${c}`);
        if (ends[i][0] !== ends[i][1]) fails.push(`${hex(ids[i])}: dead ${ends[i][0]} on engine 1 and ${ends[i][1]} on engine 2 3 s after the window`);
      }
    }
    ctx.assert.ok(!fails.length, fails.join("; "));
  },
};
