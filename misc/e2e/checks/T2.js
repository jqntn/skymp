const fs = require("fs");
const path = require("path");

const STONES = [["Warrior", 0xe7bdd, [2454, -59142, 1431], 0xe5f4c], ["Mage", 0xe7bd6, [2480, -59477, 1428], 0xe5f47], ["Thief", 0xe7bdc, [2854, -59492, 1435], 0xe5f45]];
const CHANGE_FORMS = path.join(__dirname, "..", "..", "..", "build", "dist", "e2e-server", "world", "changeForms");

module.exports = {
  engines: 1,
  timeout: 15 * 60000,
  setup: (ctx) => ctx.character(1),
  async run(ctx) {
    let actor = await ctx.ready(1);
    const hex = (v) => (v >>> 0).toString(16);
    const spells = () => ctx.drv(`const p = sp.Game.getPlayer(); const out = []; for (let i = 0; i < p.getSpellCount(); i++) { const s = p.getNthSpell(i); if (s) out.push(s.getFormID()); } return out;`, 1);
    const serverSpells = () => { try { return JSON.parse(fs.readFileSync(path.join(CHANGE_FORMS, `${(actor >>> 0) - 0xff000000}.json`), "utf8")).learnedSpells || []; } catch { return null; } };
    const answerBoxes = async () => {
      const texts = [];
      for (const t0 = Date.now(); Date.now() - t0 < 8000;) {
        const text = await ctx.drv(`if (!sp.Ui.isMenuOpen("MessageBoxMenu")) return null; const t = sp.Ui.getString("MessageBoxMenu", "_root.MessageMenu.MessageText.text") || "?"; sp.Ui.invokeInt("MessageBoxMenu", "_root.MessageMenu.ClickCallback", 0); return t;`, 1);
        if (text !== null && await ctx.waitFor(() => ctx.drv(`return !sp.Ui.isMenuOpen("MessageBoxMenu");`, 1), 2000, "the box closes").then(() => true).catch(() => false)) texts.push(text);
        await ctx.sleep(200);
      }
      return texts;
    };
    const fails = [];
    const granted = [];
    for (const [name, stone, pos, ability] of STONES) {
      await ctx.probe(`mp.set(${actor}, "locationalData", ${JSON.stringify({ cellOrWorldDesc: "3c:Skyrim.esm", pos: [pos[0] + 150, pos[1], pos[2] + 30], rot: [0, 0, 0] })}); return 0;`);
      await ctx.waitFor(() => ctx.drv(`const s = sp.ObjectReference.from(sp.Game.getFormEx(${stone})); return !sp.Ui.isMenuOpen("Loading Menu") && sp.Game.getPlayer().is3DLoaded() && !!s && s.is3DLoaded();`, 1).catch(() => false), 60000, `the ${name} Stone is loaded`);
      await ctx.sleep(1500);
      const before = await spells();
      await ctx.drv(`const s = sp.ObjectReference.from(sp.Game.getFormEx(${stone})); const p = sp.Game.getPlayer(); p.setAngle(0, 0, p.getAngleZ() + p.getHeadingAngle(s)); sp.once("update", () => sp.ObjectReference.from(sp.Game.getFormEx(${stone})).activate(sp.Game.getPlayer(), false)); return 0;`, 1);
      const boxes = await answerBoxes();
      const after = await spells();
      const added = after.filter((s) => !before.includes(s));
      const removed = before.filter((s) => !after.includes(s));
      let server = null;
      await ctx.waitFor(() => { server = serverSpells(); return !!server && added.length === 1 && server.includes(added[0]) && granted.every((g) => !server.includes(g)); }, 10000, "the server has the blessing").catch(() => 0);
      ctx.evidence.push(`${name} Stone ${hex(stone)}: ${boxes.length} message box(es) answered ${JSON.stringify(boxes.map((t) => t.slice(0, 40)))}; client added ${JSON.stringify(added.map(hex))}, removed ${JSON.stringify(removed.map(hex))}; server learned ${JSON.stringify((server || []).map(hex))}`);
      if (boxes.length !== 1) fails.push(`the ${name} Stone showed ${boxes.length} message boxes (one expected, as in the game)`);
      if (added.length !== 1 || added[0] !== ability) fails.push(`the ${name} Stone gave ${JSON.stringify(added.map(hex))} on the client (its blessing ${hex(ability)} expected)`);
      else {
        if (!server || !server.includes(added[0])) fails.push(`the server does not have the ${name} Stone's blessing ${hex(added[0])}`);
        const kept = granted.filter((g) => after.includes(g) || (server || []).includes(g));
        if (kept.length) fails.push(`the ${name} Stone left the earlier blessing(s) ${JSON.stringify(kept.map(hex))} (one at a time)`);
        granted.push(added[0]);
      }
    }
    ctx.assert.ok(granted.length, fails.join("; "));
    const last = granted[granted.length - 1];
    actor = await ctx.relog(1);
    await ctx.ready(1);
    await ctx.sleep(4000);
    const relogged = await spells();
    const serverAfter = serverSpells() || [];
    ctx.evidence.push(`after the relog: client spells ${JSON.stringify(relogged.map(hex))}, server ${JSON.stringify(serverAfter.map(hex))}`);
    if (!relogged.includes(last)) fails.push(`after the relog the client lost the last blessing ${hex(last)}`);
    if (!serverAfter.includes(last)) fails.push(`after the relog the server lost the last blessing ${hex(last)}`);
    const back = STONES.map((x) => x[3]).filter((a) => a !== last && (relogged.includes(a) || serverAfter.includes(a)));
    if (back.length) fails.push(`after the relog earlier blessings ${JSON.stringify(back.map(hex))} are back`);
    ctx.assert.ok(!fails.length, fails.join("; "));
  },
};
