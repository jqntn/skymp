const sp = skyrimPlatform;
const cfg = sp.settings["e2e-driver"] || {};
const http = new sp.HttpClient(`http://127.0.0.1:${cfg.port}`);
const opts = { headers: {} };
const queue = [];
const lines = [];
let polling = false;
let lastFlush = 0;

const post = (path, body) => http.post(path, { body: JSON.stringify(body), contentType: "application/json", headers: {} }, () => {});

const poll = () => {
  if (polling) return;
  polling = true;
  http.get(`/cmd?engine=${cfg.engine}`, opts, (res) => {
    polling = false;
    if (res.status !== 200 || !res.body) return;
    for (const cmd of JSON.parse(res.body)) queue.push(cmd);
  });
};

const reply = (id, ok, value) => post("/result", ok ? { engine: cfg.engine, id, ok, value } : { engine: cfg.engine, id, ok, error: `${value && value.stack || value}` });

const run = ({ id, code }) => {
  try {
    const value = new Function("sp", "log", code)(sp, (...a) => lines.push(a.join(" ")));
    if (value && typeof value.then === "function") value.then((v) => reply(id, true, v), (e) => reply(id, false, e));
    else reply(id, true, value);
  } catch (e) {
    reply(id, false, e);
  }
};

sp.on("tick", () => {
  poll();
  if (lines.length && Date.now() - lastFlush > 1000) {
    lastFlush = Date.now();
    post("/log", { engine: cfg.engine, lines: lines.splice(0) });
  }
});
sp.on("update", () => {
  while (queue.length) run(queue.shift());
});
sp.on("consoleMessage", (e) => lines.push(e.message));
