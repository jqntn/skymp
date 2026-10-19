const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { spawn, spawnSync } = require("child_process");
const dgram = require("dgram");

const REPO = path.resolve(__dirname, "../..");
const OUT = path.join(__dirname, "out");
const CHECKS = path.join(__dirname, "checks");
const BACKUP = path.join(OUT, "backup");
const MANIFEST = path.join(BACKUP, "manifest.json");
const PIDS = path.join(OUT, "pids.json");
const RESULTS = path.join(OUT, "results.json");
const BUILD = path.join(REPO, "build");
let DIST = path.join(BUILD, "dist", "server");
let ALT_CLIENT = null;
let TAG = null;
const SERVER = path.join(BUILD, "dist", "e2e-server");
const GAME = fs.readFileSync(path.join(BUILD, "CMakeCache.txt"), "utf8").match(/^SKYRIM_DIR:\w+=(.*)$/m)[1].trim();
const MYGAMES = path.join(os.homedir(), "Documents", "My Games", "Skyrim Special Edition");
const PORT = { server: 7790, probe: 7792, runner: 7793, proxy: 7794 };
const SLOW_ENGINE_MS = 1000;
const STEAMWEBHELPER_MAX_GB = 10;
const SKYRIM_VERSION = "1.6.1170.0";
const desktopOf = (n) => (process.argv.includes("--visible") ? "Default" : `skymp-e2e-${n}`);
const HELGEN_EXIT = { pos: [12155.9, -71991.3, 6015.5], angleZ: 286.1, worldOrCell: 0x3c };

const range = (prefix, n) => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);
const ORDER = [
  "L1", "S0", "S0b", "S0c", "S1.1", "S1.2", "S1.4", "S1.3", "S1.5", "S1.6", "S2", "S3.1", "S3.2", "S3.3", "S3.4",
  ...range("1A.", 5), ...range("1B.", 5), ...range("G1.", 8),
  ...range("2A.", 5), "G1.9", ...range("2B.", 5), "G2.1", "G2.2", "G2.3", "F1", "G2.4", "G2.5", "F4", "F5", "F7", "G2.6", "F6", "F2", "F3", ...range("P", 8),
];

class Env extends Error {}
class Blocked extends Error {}
class Accepted extends Error {}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const read = (p) => fs.readFileSync(p, "utf8");
const readJson = (p, d) => (fs.existsSync(p) ? JSON.parse(read(p)) : d);
const writeJson = (p, v) => fs.writeFileSync(p, JSON.stringify(v, null, 2));
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);

const backup = (p) => {
  const m = readJson(MANIFEST, []);
  if (m.some((e) => e.path === p)) return;
  fs.mkdirSync(BACKUP, { recursive: true });
  const bak = fs.existsSync(p) ? path.join(BACKUP, String(m.length)) : null;
  if (bak) fs.cpSync(p, bak, { recursive: true });
  m.push({ path: p, bak });
  writeJson(MANIFEST, m);
};

const restore = () => {
  for (const { path: p, bak } of readJson(MANIFEST, []).reverse()) {
    fs.rmSync(p, { recursive: true, force: true });
    if (bak) fs.cpSync(bak, p, { recursive: true });
  }
  fs.rmSync(BACKUP, { recursive: true, force: true });
};

const iniEntries = (text) => {
  const out = [];
  let sec = null;
  for (const l of text.split(/\r?\n/)) {
    const s = l.match(/^\s*\[(.+)\]/);
    const kv = l.match(/^\s*([^=;#\s][^=]*?)\s*=\s*(.*?)\s*$/);
    if (s) sec = s[1];
    else if (kv && sec) out.push([sec, kv[1], kv[2]]);
  }
  return out;
};

const iniSet = (text, section, key, value) => {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const i = lines.findIndex((l) => l.trim().toLowerCase() === `[${section.toLowerCase()}]`);
  if (i < 0) return [...lines, `[${section}]`, `${key}=${value}`].join(eol);
  for (let j = i + 1; j < lines.length && !/^\s*\[/.test(lines[j]); j++) {
    const m = lines[j].match(/^\s*([^=;#]+?)\s*=/);
    if (m && m[1].toLowerCase() === key.toLowerCase()) {
      lines[j] = `${key}=${value}`;
      return lines.join(eol);
    }
  }
  lines.splice(i + 1, 0, `${key}=${value}`);
  return lines.join(eol);
};

const editIni = (file, entries) => {
  backup(file);
  fs.writeFileSync(file, entries.reduce((t, [s, k, v]) => iniSet(t, s, k, v), read(file)));
};

const procs = (image) => {
  const r = spawnSync("tasklist", ["/FO", "CSV", "/NH", "/FI", `IMAGENAME eq ${image}`], { encoding: "latin1" });
  return r.stdout.split(/\r?\n/).filter((l) => l.toLowerCase().startsWith(`"${image.toLowerCase()}"`)).map((l) => Number(l.split('","')[1]));
};

const ownPids = () => readJson(PIDS, []);
const own = (pid, image) => writeJson(PIDS, [...ownPids(), { pid, image }]);
const killOwned = () => {
  for (const { pid, image } of ownPids()) {
    if (procs(image).includes(pid)) spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"]);
  }
  fs.rmSync(PIDS, { force: true });
};

const foreignSkyrim = () => procs("SkyrimSE.exe").filter((p) => !ownPids().some((o) => o.pid === p));

const waitNoForeignSkyrim = async () => {
  for (let t = 0; foreignSkyrim().length; t++) {
    if (t === 0) log("another Skyrim process runs, waiting for it to exit");
    if (t > 240) throw new Env("another Skyrim process ran for more than 2 h");
    await sleep(30000);
  }
};

const memGB = (image) => {
  const r = spawnSync("tasklist", ["/FO", "CSV", "/NH", "/FI", `IMAGENAME eq ${image}`], { encoding: "latin1" });
  return r.stdout.split(/\r?\n/).filter((l) => l.toLowerCase().startsWith(`"${image.toLowerCase()}"`)).reduce((s, l) => s + Number(l.split('","')[4].replace(/\D/g, "")), 0) / 2 ** 20;
};

const hostProblem = (engines) => {
  if (!procs("steam.exe").length) return Object.assign(new Env("Steam is not running: each game launch would hang on steam://run"), { stop: true });
  if (memGB("steamwebhelper.exe") > STEAMWEBHELPER_MAX_GB) {
    log(`steamwebhelper uses ${memGB("steamwebhelper.exe").toFixed(1)} GB, killing it`);
    spawnSync("taskkill", ["/F", "/IM", "steamwebhelper.exe"]);
    spawnSync("powershell", ["-NoProfile", "-Command", "Start-Sleep -Seconds 5"]);
  }
  const free = os.freemem() / 2 ** 30;
  if (free < 3 * engines + 2) return new Env(`only ${free.toFixed(1)} GB of RAM free for ${engines} engines (steamwebhelper uses ${memGB("steamwebhelper.exe").toFixed(1)} GB)`);
  return null;
};

const gameVersion = () =>
  spawnSync("powershell", ["-NoProfile", "-Command", `(Get-Item '${path.join(GAME, "SkyrimSE.exe")}').VersionInfo.FileVersion`], { encoding: "utf8" }).stdout.trim();

const sh = (name, cmd, args, cwd) => {
  const file = path.join(OUT, `l1-${name}.log`);
  const t = Date.now();
  const r = spawnSync([cmd, ...args].join(" "), { cwd, encoding: "utf8", shell: true, maxBuffer: 1 << 28 });
  fs.writeFileSync(file, `${r.stdout || ""}\n${r.stderr || ""}`);
  return { name, ok: r.status === 0, secs: Math.round((Date.now() - t) / 1000), file: path.relative(OUT, file) };
};

const CTEST_STAMP = path.join(OUT, "ctest-stamp.json");
const dirFiles = (d) => { try { return fs.readdirSync(d).map((f) => path.join(d, f)); } catch { return []; } };
const ctestStamp = () => JSON.stringify([path.join(BUILD, "unit", "Release", "unit.exe"), path.join(DIST, "scam_native.node"), path.join(BUILD, "server-settings-base.json"), ...dirFiles(path.join(DIST, "dist_back")), ...dirFiles(path.join(REPO, "misc", "tests"))]
  .map((f) => { try { return [f, require("crypto").createHash("sha1").update(fs.readFileSync(f)).digest("hex")]; } catch { return [f]; } }));

const level1 = async () => {
  await waitNoForeignSkyrim();
  const steps = [sh("build", "cmake", ["--build", ".", "--config", "Release"], BUILD)];
  if (steps[0].ok) {
    steps.push(sh("ts", "yarn", ["test"], path.join(REPO, "skymp5-server")));
    const stamp = ctestStamp();
    if (readJson(CTEST_STAMP, null) === stamp) {
      steps.push({ name: "ctest", ok: true, secs: 0, file: "skipped: the unit and server binaries and the integration tests are those of the last green ctest" });
    } else {
      for (const p of ["world", "server-settings.json", "gamemode.js"]) backup(path.join(DIST, p));
      try {
        const r = sh("ctest", "ctest", ["-C", "Release", "--output-on-failure"], BUILD);
        steps.push(r);
        if (r.ok) writeJson(CTEST_STAMP, stamp);
      } finally {
        restore();
      }
    }
  }
  const failed = steps.filter((s) => !s.ok);
  return {
    result: failed.length ? "FAIL" : "PASS",
    reason: failed.map((s) => `${s.name} failed, see ${s.file}`).join("; "),
    evidence: steps.map((s) => `${s.name}: ${s.ok ? "ok" : "FAIL"} in ${s.secs} s (${s.file})`),
  };
};

const drivers = { queue: {}, waiter: {}, seen: {}, pending: new Map(), lines: {}, logFile: null, nextId: 1 };

const flush = (engine) => {
  const res = drivers.waiter[engine];
  if (!res) return;
  drivers.waiter[engine] = null;
  res.end(JSON.stringify((drivers.queue[engine] || []).splice(0)));
};

const runnerServer = () =>
  http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (url.pathname === "/cmd") {
        const engine = Number(url.searchParams.get("engine"));
        drivers.seen[engine] = Date.now();
        flush(engine);
        drivers.waiter[engine] = res;
        if ((drivers.queue[engine] || []).length) flush(engine);
        else setTimeout(() => drivers.waiter[engine] === res && flush(engine), 500);
        return;
      }
      const msg = body ? JSON.parse(body) : {};
      if (url.pathname === "/result") {
        const p = drivers.pending.get(msg.id);
        drivers.pending.delete(msg.id);
        if (p) msg.ok ? p.resolve(msg.value) : p.reject(new Error(`driver: ${msg.error}`));
      } else if (url.pathname === "/log") {
        (drivers.lines[msg.engine] ||= []).push(...msg.lines);
        if (drivers.logFile) fs.appendFileSync(drivers.logFile(msg.engine), msg.lines.map((l) => `${new Date().toISOString()} ${l}\n`).join(""));
      }
      res.end("{}");
    });
  }).listen(PORT.runner, "127.0.0.1");

const engineDir = (n) => (n === 1 ? GAME : path.join(BUILD, `e2e-game${n}`));
const profileId = (n) => 990000 + n;
const RELINKED = [...fs.readdirSync(path.join(BUILD, "dist", "client", "Data")).map((d) => path.join("Data", d)), path.join("Data", "Platform"), path.join("Data", "SKSE")];

const mirror = (src, dst, copy) => {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) mirror(s, d, copy);
    else copy(s, d);
  }
};

const prepareEngineDir = (n) => {
  const dir = engineDir(n);
  const copied = (rel) => RELINKED.some((c) => rel === c || rel.startsWith(c + path.sep));
  if (!fs.existsSync(path.join(dir, "steam_appid.txt"))) {
    mirror(GAME, dir, (s, d) => !copied(path.relative(GAME, s)) && !fs.existsSync(d) && fs.linkSync(s, d));
    fs.writeFileSync(path.join(dir, "steam_appid.txt"), "489830");
  }
  const skip = new Set([path.join("Data", "Platform", "PluginsDev"), path.join("Data", "Platform", "Plugins", "skymp5-client-settings.txt")]);
  for (const c of RELINKED) {
    if (!fs.existsSync(path.join(GAME, c))) continue;
    mirror(path.join(GAME, c), path.join(dir, c), (s, d) => {
      const rel = path.relative(GAME, s);
      if ([...skip].some((k) => rel === k || rel.startsWith(k + path.sep))) return;
      const a = fs.statSync(s, { bigint: true });
      const b = fs.existsSync(d) && fs.statSync(d, { bigint: true });
      if (b && b.ino === a.ino && b.dev === a.dev) return;
      fs.rmSync(d, { force: true });
      fs.linkSync(s, d);
    });
  }
};

const prepareServer = () => {
  fs.rmSync(SERVER, { recursive: true, force: true });
  const skip = new Set(["world", "data/client", "gamemode.js", "server-settings-dump.json", "server-settings-merged.json"]);
  fs.cpSync(DIST, SERVER, { recursive: true, filter: (src) => !skip.has(path.relative(DIST, src).replace(/\\/g, "/").toLowerCase()) });
};

const startServer = async (check, ctx, keepWorld = false) => {
  if (!keepWorld) fs.rmSync(path.join(SERVER, "world"), { recursive: true, force: true });
  if (check.world && !keepWorld) fs.cpSync(path.join(__dirname, "worlds", check.world), path.join(SERVER, "world", "changeForms"), { recursive: true });
  const settings = { ...readJson(path.join(BUILD, "server-settings-base.json")), port: PORT.server, name: "e2e", ...(check.settings || {}) };
  writeJson(path.join(SERVER, "server-settings.json"), settings);
  fs.copyFileSync(path.join(__dirname, "probe.js"), path.join(SERVER, "gamemode.js"));
  const fd = fs.openSync(path.join(ctx.dir, "server.log"), "a");
  const child = spawn("node", ["dist_back/skymp5-server.js"], { cwd: SERVER, stdio: ["ignore", fd, fd], env: { ...process.env, E2E_PROBE_PORT: String(PORT.probe) } });
  fs.closeSync(fd);
  child.on("exit", (code) => fs.appendFileSync(path.join(ctx.dir, "server.log"), `
[e2e] server exited with code ${code}
`));
  own(child.pid, "node.exe");
  ctx.serverPid = child.pid;
  const startedAt = Date.now();
  await ctx.waitFor(() => ctx.probe("return 1").catch(() => 0), 90000, "the server probe", Env, 100);
  ctx.serverLoadMs = Date.now() - startedAt;
};

const installClient = (dir) => {
  const files = [];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : files.push(path.relative(dir, path.join(d, e.name)))));
  walk(dir);
  for (const rel of files.filter((f) => f !== path.join("Data", "Platform", "Plugins", "skymp5-client-settings.txt"))) {
    const dst = path.join(GAME, rel);
    backup(dst);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.rmSync(dst, { force: true });
    fs.copyFileSync(path.join(dir, rel), dst);
  }
  return files.length;
};

const startProxy = async (ctx, { delayMs = 0, loss = 0 } = {}) => {
  const front = dgram.createSocket("udp4");
  const clients = new Map();
  const stats = {};
  let closed = false;
  const later = (fn) => (delayMs ? setTimeout(() => !closed && fn(), delayMs) : fn());
  front.on("message", (msg, from) => {
    const key = `${from.address}:${from.port}`;
    const st = (stats[key] = stats[key] || { up: 0, down: 0, upPackets: 0, downPackets: 0 });
    st.up += msg.length;
    st.upPackets++;
    let back = clients.get(key);
    if (!back) {
      back = dgram.createSocket("udp4");
      back.on("message", (m, rinfo) => {
        if (rinfo.port !== PORT.server) return;
        st.down += m.length;
        st.downPackets++;
        if (Math.random() >= loss) later(() => front.send(m, from.port, from.address));
      });
      back.on("error", () => {});
      clients.set(key, back);
    }
    if (Math.random() >= loss) later(() => back.send(msg, PORT.server, "127.0.0.1"));
  });
  await new Promise((resolve, reject) => {
    front.once("error", (e) => reject(new Env(`the proxy cannot listen on ${PORT.proxy}: ${e.message}`)));
    front.bind(PORT.proxy, "127.0.0.1", resolve);
  });
  front.on("error", () => {});
  ctx.proxyStats = () => JSON.parse(JSON.stringify(stats));
  return () => {
    closed = true;
    for (const c of clients.values()) c.close();
    front.close();
  };
};

const launchGame = (dir, n = 1) => {
  const r = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(__dirname, "desktop.ps1"), "-desktop", desktopOf(n), "-exe", path.join(dir, "skse64_loader.exe"), "-cwd", dir], { encoding: "utf8" });
  if (r.status !== 0) throw new Env(`launch failed: ${r.stderr}`);
};

const startGame = async (n, ctx) => {
  const dir = engineDir(n);
  if (n > 1) prepareEngineDir(n);
  const plugins = path.join(dir, "Data", "Platform", "Plugins");
  const dev = path.join(dir, "Data", "Platform", "PluginsDev");
  const settingsFile = path.join(plugins, "skymp5-client-settings.txt");
  backup(settingsFile);
  const now = new Date();
  const hoursOffset = ((((ctx.gameHour - now.getUTCHours() - now.getUTCMinutes() / 60) % 24) + 24) % 24);
  writeJson(settingsFile, { gameData: { profileId: profileId(n) }, master: "", "server-ip": "127.0.0.1", "server-master-key": null, "server-port": ctx.proxyStats ? PORT.proxy : PORT.server, hoursOffset });
  backup(dev);
  fs.mkdirSync(dev, { recursive: true });
  fs.copyFileSync(path.join(__dirname, "driver.js"), path.join(dev, "e2e-driver.js"));
  writeJson(path.join(dev, "e2e-driver-settings.txt"), { port: PORT.runner, engine: n });

  const before = new Set(procs("SkyrimSE.exe"));
  launchGame(dir, n);
  ctx.launchedAt[n] = Date.now();
  let pid;
  await ctx.waitFor(() => (pid = procs("SkyrimSE.exe").find((p) => !before.has(p))), 60000, `SkyrimSE.exe of engine ${n}`, Env, 100);
  own(pid, "SkyrimSE.exe");
  ctx.gamePids[n] = pid;
  const exitFile = path.join(ctx.dir, `exit-${n}.txt`);
  spawn("powershell", ["-NoProfile", "-Command", `try { $p = Get-Process -Id ${pid} -ErrorAction Stop; $p.WaitForExit(); Add-Content '${exitFile}' "$(Get-Date -Format HH:mm:ss.fff) pid ${pid} exit code $($p.ExitCode)" } catch {}`], { detached: true, stdio: "ignore" }).unref();
};

const lowCostMode = () => {
  const skyrimIni = path.join(MYGAMES, "Skyrim.ini");
  editIni(skyrimIni, [["General", "bAlwaysActive", "1"], ["Controls", "bBackgroundMouse", "1"]]);
  editIni(path.join(MYGAMES, "SkyrimPrefs.ini"), [
    ...iniEntries(read(path.join(GAME, "Low.ini"))),
    ["Display", "iSize W", "640"], ["Display", "iSize H", "400"], ["Display", "bBorderless", "0"], ["Display", "bFull Screen", "0"],
    ["AudioMenu", "fAudioMasterVolume", "0.0000"],
  ]);
  editIni(path.join(GAME, "Data", "SKSE", "Plugins", "SSEDisplayTweaks.ini"), [["Render", "FramerateLimit", "30"], ["Render", "UIFramerateLimit", "30"], ["Window", "LockCursor", "false"]]);
};

const makeCtx = (id, dir) => {
  const ctx = {
    id, dir, gamePids: {}, launchedAt: {}, tag: TAG, evidence: [], shots: [], rtt: {}, Env, Blocked, Accepted,
    driverRtt: (engine = 1) => { const a = [...(ctx.rtt[engine] || [])].sort((x, y) => x - y); return a.length ? a[a.length >> 1] : 0; },
    assert: require("assert"),
    sleep,
    profileId,
    log: (...a) => { log(`${id}:`, ...a); fs.appendFileSync(path.join(dir, "check.log"), `${a.join(" ")}\n`); },
    alive: (engine) => {
      for (const [n, pid] of Object.entries(ctx.gamePids)) if ((!engine || Number(n) === engine) && !procs("SkyrimSE.exe").includes(pid)) throw new Env(`engine ${n} exited`);
      if (ctx.serverPid && !procs("node.exe").includes(ctx.serverPid)) throw new Env("the server exited");
    },
    running: (engine) => procs("SkyrimSE.exe").includes(ctx.gamePids[engine]),
    skyrimPids: () => procs("SkyrimSE.exe"),
    engineDir,
    launchGame,
    unit: (spec) => {
      const r = spawnSync(path.join(BUILD, "unit", "Release", "unit.exe"), [spec], { cwd: BUILD, encoding: "utf8", maxBuffer: 1 << 28 });
      const out = `${r.stdout || ""}${r.stderr || ""}`;
      fs.writeFileSync(path.join(dir, "unit.log"), out);
      const summary = out.split("\n").filter((l) => /test cases|All tests passed|No test cases matched/.test(l)).join(" ").trim();
      ctx.evidence.push(`unit ${spec}: exit ${r.status}; ${summary}`);
      ctx.assert.ok(r.status === 0 && /All tests passed/.test(out), `unit ${spec} failed: ${summary || "no summary"}`);
    },
    own: (pid) => own(pid, "SkyrimSE.exe"),
    talk: async (npc, until, prefer, label, { engine = 1, quest = 0 } = {}) => {
      const M = "Dialogue Menu";
      const R = "_root.DialogueMenu_mc";
      const state = () => ctx.drv(`const open = sp.Ui.isMenuOpen("${M}"); const t = []; let sub = "";
        if (open) { for (let i = 0; i < 8; i++) { let s = ""; try { s = sp.Ui.getString("${M}", "${R}.TopicList.entryList." + i + ".text"); } catch (e) {} if (!s) break; t.push(s); } try { sub = (sp.Ui.getString("${M}", "${R}.SubtitleText.text") || "").trim(); } catch (e) {} }
        const q = ${quest} ? sp.Quest.from(sp.Game.getFormEx(${quest})) : null;
        return { open, t, sub, msg: sp.Ui.isMenuOpen("MessageBoxMenu"), stage: q ? q.getCurrentStageID() : -1 };`, engine);
      const clicked = [];
      const dismissed = [];
      const stages = [];
      let stalls = 0;
      let idleSince = Date.now();
      let s = await state();
      const ok = await ctx.waitFor(async () => {
        s = await state();
        if (stages[stages.length - 1] !== s.stage) stages.push(s.stage);
        if (await until()) return true;
        if (s.msg) {
          dismissed.push(s.stage);
          await ctx.drv(`sp.Ui.invokeInt("MessageBoxMenu", "_root.MessageMenu.ClickCallback", 0); return 0;`, engine);
          await sleep(1500);
          idleSince = Date.now();
        } else if (s.open && !s.sub && s.t.length) {
          const fresh = s.t.map((x, i) => [x, i]).filter(([x]) => !clicked.includes(x));
          const [x, i] = fresh.find(([t]) => prefer.test(t)) || fresh[0] || [s.t[0], 0];
          clicked.push(x);
          await ctx.drv(`sp.Ui.setInt("${M}", "${R}.TopicList.selectedIndex", ${i}); sp.Ui.invokeBool("${M}", "${R}.onSelectionClick", true); return 0;`, engine);
          await sleep(2500);
          idleSince = Date.now();
        } else if (!s.open) {
          await sleep(2000);
          if (!(await state()).open) await ctx.drv(`sp.Actor.from(sp.Game.getFormEx(${npc})).activate(sp.Game.getPlayer(), false); return 0;`, engine);
          await sleep(3000);
          idleSince = Date.now();
        } else if (Date.now() - idleSince > 15000) {
          stalls++;
          await ctx.drv(`sp.TESModPlatform.closeMenu("${M}"); return 0;`, engine).catch(() => {});
          await sleep(2000);
          idleSince = Date.now();
        }
        return false;
      }, 8 * 60000, label).then(() => true).catch(() => false);
      if ((await state()).open) await ctx.drv(`sp.TESModPlatform.closeMenu("${M}"); return 0;`, engine).catch(() => {});
      return { ok, picks: clicked.length, topics: [...new Set(clicked)], stages, last: s.sub, dismissed, stalls };
    },
    waitFor: async (fn, ms, what, Err = Error, every = 500) => {
      const end = Date.now() + ms;
      for (;;) {
        const v = await fn();
        if (v) return v;
        if (Date.now() > end) throw new Err(`timeout after ${ms / 1000} s: ${what}`);
        await sleep(every);
      }
    },
    probe: async (code) => {
      const r = await fetch(`http://127.0.0.1:${PORT.probe}/eval`, { method: "POST", body: code, signal: AbortSignal.timeout(15000) });
      const j = await r.json();
      if (!j.ok) throw new Error(`probe: ${j.error}`);
      return j.value;
    },
    drv: (code, engine = 1, ms = 15000) =>
      new Promise((resolve, reject) => {
        const cmdId = drivers.nextId++;
        const site = (new Error().stack.split("\n").slice(1).find((l) => l.includes(".js") && !l.includes("run.js") && !l.includes("node:")) || "").trim();
        const timer = setTimeout(() => {
          drivers.pending.delete(cmdId);
          reject(new Env(`engine ${engine} driver did not answer in ${ms / 1000} s (${site})`));
        }, ms);
        const sent = Date.now();
        drivers.pending.set(cmdId, { resolve: (v) => (clearTimeout(timer), (ctx.rtt[engine] ||= []).push(Date.now() - sent), resolve(v)), reject: (e) => (clearTimeout(timer), reject(e)) });
        (drivers.queue[engine] ||= []).push({ id: cmdId, code });
        flush(engine);
      }),
    clientLog: (engine = 1) => drivers.lines[engine] || [],
    character: (engine = 1, at = HELGEN_EXIT) => ctx.probe(`return mp.createActor(0, ${JSON.stringify(at.pos)}, ${at.angleZ}, ${at.worldOrCell}, ${profileId(engine)});`),
    npcLocation: async (id, engine = 1) => {
      const l = await ctx.drv(`const a = sp.Actor.from(sp.Game.getFormEx(${id})); const f = a && (a.getWorldSpace() || a.getParentCell()); if (!f) return null;
        const fid = f.getFormID(); return { cellOrWorldDesc: (fid & 0xffffff).toString(16) + ":" + sp.Game.getModName(fid >>> 24), pos: [a.getPositionX(), a.getPositionY(), a.getPositionZ()], rot: [0, 0, a.getAngleZ()] };`, engine);
      return l || ctx.probe(`return mp.get(${id}, "locationalData");`);
    },
    shot: (name, engine = 1) => {
      const file = path.join(dir, `${name}.png`);
      const r = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(__dirname, "desktop.ps1"), "-desktop", desktopOf(engine), "-procId", String(ctx.gamePids[engine]), "-out", file], { encoding: "utf8" });
      if (r.status !== 0) ctx.log(`screenshot failed: ${r.stderr}`);
      else ctx.shots.push(path.relative(OUT, file).replace(/\\/g, "/"));
    },
    ready: async (engine = 1) => {
      const started = Date.now();
      for (let launch = 0; ; launch++) {
        const connected = await ctx.waitFor(() => !ctx.running(engine) ? "exited" : (drivers.seen[engine] || 0) > started, 120000, `engine ${engine} driver connects`, Env);
        if (connected === true) break;
        if (launch >= 2) throw new Env(`engine ${engine} exited before its driver connected, 3 launches`);
        ctx.log(`engine ${engine} exited before its driver connected, relaunch ${launch + 1}`);
        for (const f of ["skse64.log", "skse64_loader.log", "skyrim-platform.log"]) {
          const src = path.join(MYGAMES, "SKSE", f);
          if (fs.existsSync(src)) fs.copyFileSync(src, path.join(ctx.dir, `early-exit-${engine}-${launch + 1}-${f}`));
        }
        ctx.evidence.push(`engine ${engine} relaunched after an early exit`);
        await sleep(15000);
        await startGame(engine, ctx);
      }
      await ctx.waitFor(async () => (ctx.alive(engine), ctx.drv(`const p = sp.Game.getPlayer(); return !!p && p.is3DLoaded() && !sp.Ui.isMenuOpen("Main Menu") && !sp.Ui.isMenuOpen("Loading Menu");`, engine).catch(() => false)), 240000, `engine ${engine} loads into the world`, Env);
      const pid = profileId(engine);
      return ctx.waitFor(async () => (ctx.alive(engine), ctx.probe(`const a = mp.getActorsByProfileId(${pid}).find((a) => mp.get(a, "isOnline")); return a || 0;`)), 60000, `the server sees profile ${pid} online`);
    },
  };
  return ctx;
};

const runOnce = async (id, check, n, attempt) => {
  const dir = path.join(OUT, "runs", id.replace(/\./g, "_"), attempt ? `${n}-retry${attempt}` : String(n));
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const ctx = makeCtx(id, dir);
  ctx.gameHour = check.gameHour ?? 12;
  drivers.lines = {};
  drivers.logFile = (engine) => path.join(dir, `client${engine}.log`);
  const t = Date.now();
  let result = "PASS";
  let reason = "";
  let stopProxy = null;
  try {
    const engines = check.engines || 0;
    if (engines) {
      await waitNoForeignSkyrim();
      if (gameVersion() !== SKYRIM_VERSION) throw Object.assign(new Env(`SkyrimSE.exe is not ${SKYRIM_VERSION}: Steam updated the game`), { stop: true });
      const problem = hostProblem(engines);
      if (problem) throw problem;
      lowCostMode();
    }
    ctx.restartServer = async () => {
      spawnSync("taskkill", ["/PID", String(ctx.serverPid), "/T", "/F"]);
      await ctx.waitFor(() => !procs("node.exe").includes(ctx.serverPid), 15000, "the server exits", Env);
      await startServer(check, ctx, true);
    };
    ctx.relog = async (engine = 1) => {
      const pid = ctx.gamePids[engine];
      const quitAt = Date.now();
      ctx.drv("sp.Debug.quitGame(); return 0;", engine).catch(() => {});
      const quit = await ctx.waitFor(() => !procs("SkyrimSE.exe").includes(pid), 30000, `engine ${engine} quits`).then(() => true).catch(() => false);
      if (!quit) spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"]);
      await ctx.waitFor(() => !procs("SkyrimSE.exe").includes(pid), 30000, `engine ${engine} exits`, Env);
      const profile = profileId(engine);
      await ctx.waitFor(() => ctx.probe(`return !mp.getActorsByProfileId(${profile}).some((a) => mp.get(a, "isOnline"));`), 120000, `the server sees profile ${profile} offline`, Env);
      ctx.log(`engine ${engine} relog: ${quit ? "quit" : "killed after 30 s"}, the server saw the profile offline ${((Date.now() - quitAt) / 1000).toFixed(1)} s after the quit`);
      await sleep(5000);
      await startGame(engine, ctx);
      return ctx.ready(engine);
    };
    if (check.server !== false) await startServer(check, ctx);
    if (check.proxy) stopProxy = await startProxy(ctx, check.proxy === true ? {} : check.proxy);
    if (ALT_CLIENT && engines) ctx.evidence.push(`client from ${ALT_CLIENT}: ${installClient(ALT_CLIENT)} files installed for this run`);
    if (check.setup) await check.setup(ctx);
    for (let e = 1; e <= engines; e++) await startGame(e, ctx);
    let timer;
    await Promise.race([
      check.run(ctx),
      new Promise((_, rej) => (timer = setTimeout(() => rej(new Env(`check timeout after ${(check.timeout || 300000) / 1000} s`)), check.timeout || 300000))),
    ]).finally(() => clearTimeout(timer));
  } catch (e) {
    result = e instanceof Env ? "ENV" : e instanceof Blocked ? "BLOCKED" : e instanceof Accepted ? "ACCEPTED" : "FAIL";
    reason = `${e.message}`.split("\n").slice(0, 6).join(" ");
    ctx.log(`${result}: ${e.stack || e}`);
    if (e.stop) throw e;
  } finally {
    if (stopProxy) stopProxy();
    killOwned();
    await sleep(2000);
    restore();
  }
  const rtt = Object.fromEntries(Object.keys(ctx.rtt).map((e) => [e, { median: ctx.driverRtt(Number(e)), calls: ctx.rtt[e].length }]));
  const slow = Object.entries(rtt).find(([, r]) => r.calls >= 10 && r.median > SLOW_ENGINE_MS);
  if (result === "FAIL" && slow) {
    result = "ENV";
    reason = `slow engine ${slow[0]} (median driver round trip ${slow[1].median} ms): ${reason}`;
  }
  return { result, reason, secs: Math.round((Date.now() - t) / 1000), evidence: ctx.evidence, shots: ctx.shots, rtt };
};

const buildStamp = (checkFile) => {
  const git = (...a) => (spawnSync("git", a, { cwd: REPO, encoding: "utf8" }).stdout || "").trim();
  const mtime = (f) => { try { return fs.statSync(f).mtime.toISOString(); } catch { return null; } };
  const sha = (f) => { try { return require("crypto").createHash("sha1").update(fs.readFileSync(f)).digest("hex").slice(0, 12); } catch { return null; } };
  return { head: git("rev-parse", "--short", "HEAD"), dirty: git("status", "--porcelain", "--untracked-files=no") !== "", client: mtime(path.join(GAME, "Data", "Platform", "Plugins", "skymp5-client.js")), server: mtime(path.join(DIST, "scam_native.node")), serverJs: sha(path.join(DIST, "dist_back", "skymp5-server.js")), check: sha(checkFile) };
};

const runCheck = async (id, opts, envStreak) => {
  const file = opts.adhoc && id === "adhoc" ? path.resolve(opts.adhoc) : path.join(CHECKS, `${id}.js`);
  if (!fs.existsSync(file)) return { result: "FAIL", reason: "no check script", secs: 0, evidence: [], shots: [] };
  delete require.cache[require.resolve(file)];
  const check = require(file);
  const runs = opts.runs || (opts.final && check.engines ? 3 : 1);
  const results = [];
  const build = buildStamp(file);
  const checkName = id === "adhoc" ? `adhoc:${path.basename(file)}` : id;
  for (let n = 1; n <= runs; n++) {
    let r;
    let prevReason;
    for (let attempt = 0; attempt < 3; attempt++) {
      log(`${id} run ${n}/${runs}${attempt ? ` retry ${attempt}` : ""}`);
      r = await runOnce(id, check, n, attempt);
      log(`${id} run ${n}: ${r.result} ${r.reason}`);
      fs.appendFileSync(path.join(OUT, "attempts.jsonl"), `${JSON.stringify({ id: checkName, run: n, attempt, result: r.result, reason: r.reason, secs: r.secs, evidence: r.evidence, rtt: r.rtt, freeGB: +(os.freemem() / 2 ** 30).toFixed(1), build, at: new Date().toISOString() })}\n`);
      envStreak.n = r.result === "ENV" ? envStreak.n + 1 : 0;
      const shape = r.reason.replace(/\d+/g, "#");
      if (r.result !== "ENV" || envStreak.n >= 3 || (attempt > 0 && shape === prevReason)) break;
      prevReason = shape;
    }
    results.push(r);
    if (r.result !== "PASS" && r.result !== "ACCEPTED" && !opts.keepGoing) break;
  }
  const counted = results.filter((r) => !notExercised(r));
  const failed = counted.filter((r) => r.result !== "PASS" && r.result !== "ACCEPTED");
  const shown = failed[0] || counted[counted.length - 1] || results[results.length - 1];
  const skipped = results.length - counted.length ? `, ${results.length - counted.length} not exercised` : "";
  return {
    ...shown,
    secs: results.reduce((s, r) => s + r.secs, 0),
    reason: failed.length ? `${failed.length} of ${results.length} runs not PASS${skipped}; run ${results.indexOf(shown) + 1}/${runs}: ${shown.reason}` : counted.length ? `${counted.length}/${runs} runs PASS${skipped}` : `run ${results.length}/${runs}: ${shown.reason}`,
    result: failed.length ? shown.result : !counted.length ? shown.result : counted.some((r) => r.result === "ACCEPTED") ? "ACCEPTED" : "PASS",
    evidence: results.flatMap((r, i) => r.evidence.map((e) => `run ${i + 1}: ${e}`)),
    shots: results.flatMap((r) => r.shots),
  };
};

const notExercised = (r) => r.result === "FAIL" && /^not exercised:[^;]*$/.test(r.reason || "");

const writeScoreboard = (results, stopped) => {
  const rows = ORDER.map((id) => {
    const r = results[id];
    return r ? `| ${id} | ${r.result} | ${r.secs} | ${r.at.slice(0, 16).replace("T", " ")} | ${(r.reason || "").replace(/\|/g, "/")} |` : `| ${id} | FAIL | 0 | - | not run |`;
  });
  const details = ORDER.filter((id) => results[id] && (results[id].evidence.length || results[id].shots.length)).map((id) =>
    [`### ${id}`, ...results[id].evidence.map((e) => `- ${e}`), ...results[id].shots.map((s) => `- ![${id}](${s})`)].join("\n"));
  const done = (r) => r && (r.result === "PASS" || r.result === "ACCEPTED");
  const firstFail = ORDER.find((id) => !done(results[id]));
  fs.writeFileSync(path.join(OUT, "scoreboard.md"), [
    "# Scoreboard",
    "",
    stopped ? `**STOPPED: ${stopped}**\n` : "",
    `First non-PASS in plan order: ${firstFail || "none"}`,
    "",
    "| id | result | secs | at | detail |",
    "|---|---|---|---|---|",
    ...rows,
    "",
    "## Evidence",
    "",
    ...details,
    "",
  ].join("\n"));
};

const main = async () => {
  const args = process.argv.slice(2);
  const arg = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const only = arg("--only")?.split(",");
  const opts = { runs: Number(arg("--runs")) || 0, adhoc: arg("--check"), final: args.includes("--final"), keepGoing: args.includes("--keep-going") };
  if ((arg("--dist") || arg("--client") || arg("--tag")) && (!opts.adhoc || !args.includes("--no-l1"))) {
    log("--dist, --client and --tag need --check and --no-l1");
    process.exit(2);
  }
  if (arg("--dist")) DIST = path.resolve(arg("--dist"));
  if (arg("--client")) ALT_CLIENT = path.resolve(arg("--client"));
  TAG = arg("--tag") || null;
  fs.mkdirSync(OUT, { recursive: true });

  await waitNoForeignSkyrim();
  killOwned();
  restore();

  const results = readJson(RESULTS, {});
  const save = (id, r) => {
    results[id] = { ...r, at: new Date().toISOString() };
    writeJson(RESULTS, results);
    fs.appendFileSync(path.join(OUT, "history.jsonl"), `${JSON.stringify({ id, ...results[id] })}\n`);
  };

  const server = runnerServer();
  let stopped = "";
  const t = Date.now();
  try {
    if (!args.includes("--no-l1") && (!only || only.includes("L1"))) {
      log("level 1");
      save("L1", { ...(await level1()), secs: Math.round((Date.now() - t) / 1000), shots: [] });
      log(`L1: ${results.L1.result} ${results.L1.reason}`);
      if (results.L1.result !== "PASS") stopped = "level 1 FAIL";
    }
    if (opts.adhoc && !stopped) {
      prepareServer();
      const r = await runCheck("adhoc", opts, { n: 0 });
      log(`adhoc: ${r.result} ${r.reason}`);
      for (const e of r.evidence) log(e);
      return;
    }
    if (!stopped) {
      prepareServer();
      const envStreak = { n: 0 };
      for (const id of ORDER.filter((id) => id !== "L1" && (!only || only.includes(id)))) {
        save(id, await runCheck(id, opts, envStreak));
        if (envStreak.n >= 3) { stopped = `3 ENV results in a row (${id}: ${results[id].reason})`; break; }
      }
    }
  } catch (e) {
    stopped = e.message;
  } finally {
    killOwned();
    restore();
    server.close();
  }
  writeScoreboard(results, stopped);
  log(`done in ${Math.round((Date.now() - t) / 1000)} s${stopped ? `, STOPPED: ${stopped}` : ""}`);
  process.exit(stopped ? 3 : ORDER.every((id) => ["PASS", "ACCEPTED"].includes(results[id]?.result)) ? 0 : 1);
};

main();
