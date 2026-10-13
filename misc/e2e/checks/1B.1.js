const fs = require("fs");
const path = require("path");

const ALVOR = 0x13482;
const CLIENT = path.join(__dirname, "..", "..", "..", "skymp5-client", "src", "view");

module.exports = {
  engines: 2,
  timeout: 8 * 60000,
  setup: async (ctx) => {
    await ctx.character(1);
    await ctx.character(2);
  },
  async run(ctx) {
    const actor = await ctx.ready(1);
    const other = await ctx.ready(2);
    const actors = [actor, other];
    const loc = await ctx.npcLocation(ALVOR);
    const away = await ctx.probe(`return mp.get(${actor}, "locationalData");`);
    const goTo = async (l) => {
      await ctx.probe(`mp.set(${actor}, "locationalData", ${JSON.stringify(l)}); return 0;`);
      const target = parseInt(l.cellOrWorldDesc.split(":")[0], 16);
      await ctx.waitFor(() => ctx.drv(`const p = sp.Game.getPlayer(); const w = p.getWorldSpace(); const c = p.getParentCell(); return !sp.Ui.isMenuOpen("Loading Menu") && p.is3DLoaded() && (w ? w.getFormID() : c ? c.getFormID() : 0) === ${target};`).catch(() => false), 120000, "the player is in the target cell");
    };
    const state = () => ctx.probe(`return mp.getActorPos(${other});`).then((op) => ctx.drv(`const OTHER_POS = ${JSON.stringify(op)}; const a = sp.Actor.from(sp.Game.getFormEx(${ALVOR}));
      if (!a) return null;
      const base = a.getBaseObject();
      const clones = [];
      for (let id = 0xff000000; id < 0xff004000; id++) { const r = sp.Actor.from(sp.Game.getFormEx(id)); if (!r) continue; const b = r.getBaseObject(); if ((b && b.getFormID() === base.getFormID()) || r.getDisplayName() === a.getDisplayName()) clones.push(id.toString(16)); }
      return { loaded: a.is3DLoaded(), disabled: a.isDisabled(), deleted: a.isDeleted(), health: a.getActorValue("health"), magicka: a.getActorValue("magicka"), name: a.getDisplayName(), baseName: base.getName(), clones };`));

    await ctx.probe(`mp.set(${other}, "locationalData", ${JSON.stringify(loc)}); return 0;`);
    await goTo(loc);
    await ctx.waitFor(() => ctx.drv(`const a = sp.Actor.from(sp.Game.getFormEx(${ALVOR})); return !!a && a.is3DLoaded();`).catch(() => false), 60000, "Alvor is loaded");
    await ctx.sleep(5000);
    const first = { ...(await state()), hoster: await ctx.probe(`return mp.get(${ALVOR}, "hoster");`) };
    ctx.evidence.push(`with a FormView: ${JSON.stringify(first)} (clones: dynamic actors 0xff000000-0xff004000 with Alvor's base or name)`);

    await goTo(away);
    await ctx.sleep(3000);
    const awayLoaded = await ctx.drv(`const a = sp.Actor.from(sp.Game.getFormEx(${ALVOR})); return !!a && a.is3DLoaded();`);
    ctx.evidence.push(`while the player was away (another cell), Alvor 3D loaded on the client: ${awayLoaded}`);
    await goTo(loc);
    await ctx.waitFor(() => ctx.drv(`const a = sp.Actor.from(sp.Game.getFormEx(${ALVOR})); return !!a && a.is3DLoaded();`).catch(() => false), 60000, "Alvor is loaded again");
    await ctx.sleep(5000);
    const again = { ...(await state()), hoster: await ctx.probe(`return mp.get(${ALVOR}, "hoster");`) };
    ctx.evidence.push(`after the player left the cell and came back: ${JSON.stringify(again)}`);

    const formView = fs.readFileSync(path.join(CLIENT, "formView.ts"), "utf8");
    const formViewArray = fs.readFileSync(path.join(CLIENT, "formViewArray.ts"), "utf8");
    const bridge = ["hidesOriginal", "getEspRefrId"].filter((s) => formView.includes(s));
    const cloneFilter = formViewArray.includes("form.refrId < 0x100000000");
    ctx.evidence.push(`source: alias bridge names left in formView.ts ${JSON.stringify(bridge)}, clone view skips ids >= 0x100000000 ${cloneFilter}`);
    ctx.shot("1B_1");

    for (const [label, s] of [["first", first], ["again", again]]) {
      ctx.assert.ok(s && s.loaded && !s.disabled && !s.deleted, `${label}: Alvor is not a loaded, enabled real actor`);
      ctx.assert.ok(s.health < 100000 && s.magicka < 100000, `${label}: Alvor got the clone immortality (health ${s.health})`);
      ctx.assert.equal(s.name, s.baseName, `${label}: Alvor's name was overridden`);
      ctx.assert.deepEqual(s.clones, [], `${label}: a clone of Alvor exists`);
      ctx.assert.ok(actors.includes(s.hoster), `${label}: no player hosts Alvor, so no FormView is bound to him`);
    }
    ctx.assert.deepEqual(bridge, [], "the alias bridge is back in formView.ts");
    ctx.assert.ok(cloneFilter, "the clone view no longer skips real ESP actors");
  },
};
