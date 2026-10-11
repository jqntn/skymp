const http = require("http");

if (globalThis.e2eProbe) globalThis.e2eProbe.close();

globalThis.e2eProbe = http.createServer((req, res) => {
  let code = "";
  req.on("data", (c) => (code += c));
  req.on("end", async () => {
    let out;
    try {
      out = { ok: true, value: await new Function("mp", `return (async () => { ${code} })()`)(mp) };
    } catch (e) {
      out = { ok: false, error: `${e && e.stack || e}` };
    }
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(out));
  });
}).listen(Number(process.env.E2E_PROBE_PORT), "127.0.0.1");

console.log(`e2e probe on ${process.env.E2E_PROBE_PORT}`);
