const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const SCENARIOS = [
  ["alias fill creates the claw in Arvel", /Coop: quest 39645 alias 11 created 39647 in 39655/],
  ["running quest grant creates the necklace in the satchel", /Coop: quest d9b64 alias 3 created 663da in d9b78/],
  ["script items gain accepted", /Coop: script items of ff000001: losses -, gains fx400, refused -/],
  ["script items gain over the cap refused", /Coop: script items of ff000001: losses -, gains -, refused fx5000/],
  ["script items loss applied", /Coop: script items of ff000001: losses fx100, gains -, refused -/],
  ["member take of a quest item refused", /Coop: ff000001 cannot take quest item 663da from d9b78, only the leader can/],
];

module.exports = {
  engines: 0,
  server: false,
  timeout: 10 * 60000,
  async run(ctx) {
    const build = path.join(__dirname, "..", "..", "..", "build");
    const r = spawnSync("ctest", ["-C", "Release", "-R", "^integration_test_coop$", "-FA", "unit_passed", "-V"], { cwd: build, encoding: "utf8", maxBuffer: 1 << 28 });
    const out = `${r.stdout || ""}${r.stderr || ""}`;
    fs.writeFileSync(path.join(ctx.dir, "ctest.log"), out);
    const passed = r.status === 0 && /Test passed!/.test(out);
    const seen = SCENARIOS.map(([name, re]) => [name, re.test(out)]);
    ctx.evidence.push(`integration_test_coop: exit ${r.status}, ${passed ? "Test passed!" : (out.match(/AssertionError[^\n]*/) || ["no pass line"])[0]}`);
    ctx.evidence.push(`scenarios in the server log: ${seen.map(([name, ok]) => `${name}: ${ok}`).join("; ")}`);
    ctx.evidence.push(`coop lines: ${out.split(/\r?\n/).filter((l) => /Coop: (quest 39645 alias|quest d9b64 alias|script items|\w+ cannot take)/.test(l)).map((l) => l.replace(/^\[[^\]]*\] \[console\] \[info\] /, "")).join(" | ")}`);
    ctx.assert.ok(passed, "integration_test_coop failed");
    const missing = seen.filter(([, ok]) => !ok).map(([name]) => name);
    ctx.assert.ok(!missing.length, `scenarios missing from the run: ${missing.join(", ")}`);
  },
};
