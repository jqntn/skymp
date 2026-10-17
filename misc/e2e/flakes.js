const fs = require("fs");
const path = require("path");

const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const since = arg("--since") || "";
const only = arg("--id");
const shape = (reason) => reason.replace(/\d+(\.\d+)?/g, "#").replace(/\[[^\]]*\]/g, "[…]").slice(0, 160);

const ledger = new Map();
for (const line of fs.readFileSync(path.join(__dirname, "out", "attempts.jsonl"), "utf8").split(/\r?\n/)) {
  if (!line.trim()) continue;
  const a = JSON.parse(line);
  if (a.at < since || a.id.startsWith("adhoc:") || (only && a.id !== only)) continue;
  const row = ledger.get(a.id) || { runs: 0, shapes: new Map() };
  row.runs++;
  if (a.result !== "PASS" && a.result !== "ACCEPTED") {
    const key = `${a.result} ${shape(a.reason || "")}`;
    const s = row.shapes.get(key) || { n: 0, last: "" };
    s.n++;
    s.last = a.at.slice(0, 16);
    row.shapes.set(key, s);
  }
  ledger.set(a.id, row);
}
for (const [id, row] of [...ledger].sort()) {
  const fails = [...row.shapes.values()].reduce((n, s) => n + s.n, 0);
  if (!fails) continue;
  console.log(`${id}: ${fails} of ${row.runs} runs not PASS`);
  for (const [key, s] of [...row.shapes].sort((a, b) => b[1].n - a[1].n)) console.log(`  ${s.n}x (last ${s.last}) ${key}`);
}
