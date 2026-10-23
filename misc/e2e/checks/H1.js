const fs = require("fs");
const path = require("path");

module.exports = {
  server: false,
  timeout: 5 * 60000,
  async run(ctx) {
    ctx.unit("[H1]");
    const net = fs.readFileSync(path.join(__dirname, "..", "..", "..", "skymp5-server", "cpp", "mp_common", "Networking.cpp"), "utf8");
    const timeout = Number((net.match(/timeoutTimeMs = (\d+)/) || [])[1]);
    ctx.evidence.push(`server timeout ${timeout} ms`);
    ctx.assert.ok(timeout === 10000, `the server timeout is ${timeout} ms, not 10000`);
  },
};
