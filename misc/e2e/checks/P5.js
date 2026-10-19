const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

const MINUTES = Number(process.env.E2E_P5_MINUTES) || 60;
const WARMUP_MS = 2 * 60000;
const BOTS = 10;
const BOT_PROFILE = 920501;
const WORLD = 0x1a26f;
const CENTER = [21272, -7816, -3608];
const LIMIT = { tick: 2.5, memory: 1.4, bandwidth: 1.25 };
const LOAD_LIMIT = 2;
const OUT = path.join(__dirname, "..", "out", "p5");
const APPEARANCE = { isFemale: false, raceId: 0x13746, weight: 50, skinColor: -1, hairColor: -1, headpartIds: [], headTextureSetId: 0, options: new Array(19).fill(0), presets: new Array(4).fill(0), tints: [], name: "E2eLoad" };

const processSample = (pid) => new Promise((resolve) => execFile("powershell", ["-NoProfile", "-Command", `$p = Get-Process -Id ${pid}; "$($p.PrivateMemorySize64) $($p.WorkingSet64) $($p.TotalProcessorTime.TotalMilliseconds)"`], { encoding: "utf8" }, (err, stdout) => {
  const [priv, ws, cpu] = `${stdout || ""}`.trim().split(" ").map(Number);
  resolve({ at: Date.now(), privateMB: priv / 2 ** 20, workingSetMB: ws / 2 ** 20, cpuMs: cpu });
}));

module.exports = {
  engines: 2,
  timeout: (MINUTES + 25) * 60000,
  proxy: true,
  setup: async (ctx) => {
    for (const n of [1, 2]) {
      const actor = await ctx.character(n, { pos: [CENTER[0] + (n === 1 ? 150 : -150), CENTER[1], CENTER[2]], angleZ: 0, worldOrCell: WORLD });
      await ctx.probe(`mp.set(${actor}, "appearance", ${JSON.stringify({ ...APPEARANCE, name: `E2eLoad${n}` })}); return 0;`);
    }
  },
  async run(ctx) {
    const loads = await Promise.all([1, 2].map(async (n) => (await ctx.ready(n), Date.now() - ctx.launchedAt[n])));
    const bots = await ctx.probe(`const bots = []; for (let i = 0; i < ${BOTS}; i++) { const b = mp.createBot(); b.send({ t: 1, contentJsonDump: JSON.stringify({ customPacketType: "loginWithSkympIo", gameData: { profileId: ${BOT_PROFILE} + i } }) }); bots.push(b); }
      const actorOf = (b) => { try { return mp.getUserActor(b.getUserId()); } catch (e) { return 0; } };
      for (let i = 0; i < 100 && !bots.every(actorOf); i++) await new Promise((r) => setTimeout(r, 100));
      const actors = bots.map(actorOf);
      if (!actors.every(Boolean)) return { actors };
      const centers = actors.map((a, i) => [${CENTER[0]} + 500 * Math.cos(i * 0.63), ${CENTER[1]} + 500 * Math.sin(i * 0.63), ${CENTER[2]}]);
      actors.forEach((a, i) => { mp.set(a, "appearance", ${JSON.stringify({ ...APPEARANCE, name: "E2eBot" })}); mp.set(a, "locationalData", { cellOrWorldDesc: "${WORLD.toString(16)}:Skyrim.esm", pos: [centers[i][0] + 200 * Math.cos(i), centers[i][1] + 200 * Math.sin(i), centers[i][2]], rot: [0, 0, 0] }); });
      await new Promise((r) => setTimeout(r, 1000));
      const idx = actors.map((a) => mp.get(a, "idx"));
      const t0 = Date.now();
      globalThis.p5 = { bots, actors, timer: setInterval(() => {
        const t = (Date.now() - t0) / 1000;
        bots.forEach((b, i) => {
          const angle = t * 0.5 + i;
          const pos = [centers[i][0] + 200 * Math.cos(angle), centers[i][1] + 200 * Math.sin(angle), centers[i][2]];
          b.send({ t: 2, idx: idx[i], data: { worldOrCell: ${WORLD}, pos, rot: [0, 0, ((angle * 180) / Math.PI + 90) % 360], direction: 0, healthPercentage: 1, speed: 100, runMode: "Walking", isInJumpState: false, isSneaking: false, isBlocking: false, isWeapDrawn: false, isDead: false } });
        });
      }, 100) };
      const orig = mp.tick;
      const st = (globalThis.p5tick = { n: 0, sum: 0, max: 0, hist: new Array(1001).fill(0) });
      Object.defineProperty(mp, "tick", { configurable: true, writable: true, value: function (...a) { const s = process.hrtime.bigint(); try { return orig.apply(this, a); } finally { const d = Number(process.hrtime.bigint() - s) / 1e6; st.n++; st.sum += d; if (d > st.max) st.max = d; st.hist[Math.min(1000, Math.floor(d / 0.05))]++; } } });
      await new Promise((r) => setTimeout(r, 500));
      return { actors, idx, ticks: st.n };`);
    ctx.assert.ok(bots.actors && bots.actors.every(Boolean), `not exercised: the bots got no actors (${JSON.stringify(bots)})`);
    ctx.assert.ok(bots.ticks > 0, `not exercised: the tick timer saw no tick (${JSON.stringify(bots)})`);
    const botPos = () => ctx.probe(`return globalThis.p5.actors.map((a) => mp.get(a, "locationalData").pos.map(Math.round));`);
    await ctx.sleep(2000);
    const p0 = await botPos();
    await ctx.sleep(3000);
    const p1 = await botPos();
    const moved = p0.filter((p, i) => Math.hypot(p[0] - p1[i][0], p[1] - p1[i][1]) > 50).length;
    ctx.evidence.push(`load: server ${(ctx.serverLoadMs / 1000).toFixed(1)} s, clients ${loads.map((l) => (l / 1000).toFixed(1))} s; ${BOTS} bots (idx ${bots.idx}), ${moved} moved more than 50 units in 3 s on the server`);
    ctx.assert.ok(moved === BOTS, `not exercised: only ${moved} of ${BOTS} bots move on the server (${JSON.stringify(p0)} -> ${JSON.stringify(p1)})`);
    const seen = await Promise.all([1, 2].map((n) => ctx.drv(`const p = sp.Game.getPlayer(); let c = 0; const seen = new Set(); for (let i = 0; i < 300; i++) { const r = sp.Game.findRandomActor(p.getPositionX(), p.getPositionY(), p.getPositionZ(), 3000); if (r && r.getFormID() !== 0x14 && !seen.has(r.getFormID()) && r.getDisplayName() === "E2eBot") { seen.add(r.getFormID()); c++; } } return c;`, n).catch((e) => e.message.slice(0, 60))));
    ctx.evidence.push(`bots shown on the clients: ${seen}`);
    ctx.assert.ok(seen.every((c) => c === BOTS), `not exercised: the clients show ${seen} of ${BOTS} bots`);

    await ctx.sleep(WARMUP_MS);
    await ctx.probe(`const st = globalThis.p5tick; st.n = 0; st.sum = 0; st.max = 0; st.hist.fill(0); return 0;`);
    const proxy0 = ctx.proxyStats();
    const samples = [await processSample(ctx.serverPid)];
    const end = Date.now() + MINUTES * 60000;
    while (Date.now() < end) {
      await ctx.sleep(Math.min(60000, end - Date.now()));
      ctx.alive();
      samples.push(await processSample(ctx.serverPid));
    }
    const proxy1 = ctx.proxyStats();
    const tick = await ctx.probe(`const st = globalThis.p5tick; let acc = 0, p99 = 0; for (let i = 0; i < st.hist.length; i++) { acc += st.hist[i]; if (acc >= st.n * 0.99) { p99 = (i + 1) * 0.05; break; } } return { n: st.n, meanMs: st.sum / st.n, p99Ms: p99, maxMs: st.max };`);
    await ctx.probe(`clearInterval(globalThis.p5.timer); return 0;`);

    const secs = (samples[samples.length - 1].at - samples[0].at) / 1000;
    const mean = (k) => samples.reduce((s, x) => s + x[k], 0) / samples.length;
    const clients = Object.keys(proxy1).filter((k) => proxy1[k].down > 1e6);
    const rate = (k, f) => (proxy1[k][f] - (proxy0[k]?.[f] || 0)) / secs;
    const perClient = clients.map((k) => ({ client: k, downBps: rate(k, "down"), upBps: rate(k, "up"), downPps: rate(k, "downPackets"), upPps: rate(k, "upPackets") }));
    const result = {
      tag: ctx.tag || "branch", at: new Date().toISOString(), minutes: MINUTES, bots: BOTS,
      tick: { ...tick, ticksPerSec: tick.n / secs },
      cpuPct: ((samples[samples.length - 1].cpuMs - samples[0].cpuMs) / 1000 / secs) * 100,
      privateMB: { mean: mean("privateMB"), max: Math.max(...samples.map((x) => x.privateMB)) },
      workingSetMB: { mean: mean("workingSetMB"), max: Math.max(...samples.map((x) => x.workingSetMB)) },
      perClient, clientBps: perClient.reduce((s, c) => s + c.downBps + c.upBps, 0) / Math.max(1, perClient.length),
      maxClientBps: Math.max(...perClient.map((c) => c.downBps + c.upBps)),
      load: { serverMs: ctx.serverLoadMs, clientMs: loads },
    };
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, `${result.tag}.json`), JSON.stringify(result, null, 2));
    const r1 = (v) => Math.round(v * 10) / 10;
    ctx.evidence.push(`${result.tag}: tick mean ${tick.meanMs.toFixed(3)} ms, p99 ${tick.p99Ms.toFixed(2)} ms, max ${r1(tick.maxMs)} ms over ${tick.n} ticks; server CPU ${r1(result.cpuPct)}%; private ${r1(result.privateMB.mean)} MB mean, ${r1(result.privateMB.max)} max; per client ${perClient.map((c) => `${r1(c.downBps / 1024)} KB/s down, ${r1(c.upBps / 1024)} KB/s up`).join("; ")}; load server ${r1(ctx.serverLoadMs / 1000)} s, clients ${loads.map((l) => r1(l / 1000))} s`);
    ctx.assert.ok(perClient.length === 2, `not exercised: ${perClient.length} clients went through the proxy (${JSON.stringify(proxy1)})`);
    if (ctx.tag === "main") throw new ctx.Accepted(`baseline written to out/p5/main.json`);

    const base = JSON.parse(fs.readFileSync(path.join(OUT, "main.json"), "utf8"));
    ctx.assert.ok(base.minutes === MINUTES && base.bots === BOTS, `the main baseline ran ${base.minutes} min with ${base.bots} bots, this run ${MINUTES} min with ${BOTS}`);
    const baseMaxClientBps = base.maxClientBps ?? Math.max(...base.perClient.map((c) => c.downBps + c.upBps));
    const ratios = {
      tick: [result.tick.meanMs, base.tick.meanMs, LIMIT.tick],
      memory: [result.privateMB.mean, base.privateMB.mean, LIMIT.memory],
      bandwidth: [result.maxClientBps, baseMaxClientBps, LIMIT.bandwidth],
      serverLoad: [result.load.serverMs, base.load.serverMs, LOAD_LIMIT],
      clientLoad: [Math.max(...result.load.clientMs), Math.max(...base.load.clientMs), LOAD_LIMIT],
    };
    const bad = Object.entries(ratios).filter(([, [v, b]]) => !Number.isFinite(v) || !Number.isFinite(b) || b <= 0);
    ctx.assert.ok(!bad.length, `not measured: ${bad.map(([k, [v, b]]) => `${k} ${v} vs ${b}`).join(", ")}`);
    const over = Object.entries(ratios).filter(([, [v, b, l]]) => v > b * l);
    ctx.evidence.push(`against main (${base.at}): ${Object.entries(ratios).map(([k, [v, b, l]]) => `${k} ${(v / b).toFixed(2)}x (limit ${l}x)`).join(", ")}; server CPU ${r1(result.cpuPct)}% vs ${r1(base.cpuPct)}%`);
    ctx.assert.ok(!over.length, over.map(([k, [v, b, l]]) => `${k} ${(v / b).toFixed(2)} times main (${v.toFixed(3)} vs ${b.toFixed(3)}), limit ${l}`).join("; "));
  },
};
