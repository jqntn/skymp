const QUEST = 0x85d40;
const SATCHEL = 0x85d54;
const NOTE = 0x65bda;
const NOTE_ALIAS = 9;
const SPOT = { cellOrWorldDesc: "16bda:Skyrim.esm", pos: [-493, -728, -69], rot: [0, 0, 0] };
const MENU = "ContainerMenu";

module.exports = {
  engines: 1,
  timeout: 12 * 60000,
  setup: (ctx) => ctx.character(1),
  async run(ctx) {
    const actor = await ctx.ready(1);
    const hex = (v) => (v >>> 0).toString(16);
    const satchel = `const c = sp.ObjectReference.from(sp.Game.getFormEx(${SATCHEL}));`;
    const note = `sp.Game.getFormEx(${NOTE})`;
    const quest = `sp.Quest.from(sp.Game.getFormEx(${QUEST}))`;
    const aliasRef = () => ctx.drv(`const id = sp.getQuestAliasReference(${QUEST}, ${NOTE_ALIAS});
      return { id, quests: id ? sp.getReferenceAliasQuests(id) : [], inSatchel: sp.getInventoryReferences(${SATCHEL}).some((l) => l.ref === id && l.baseId === ${NOTE}), inPlayer: sp.getInventoryReferences(0x14).some((l) => l.ref === id && l.baseId === ${NOTE}) };`);
    const where = (a) => `${hex(a.id)} (alias quests ${JSON.stringify(a.quests.map(hex))}, in the satchel's inventory ${a.inSatchel}, in the player's ${a.inPlayer})`;
    const serverCount = (ref) => ctx.probe(`return ((mp.get(${ref}, "inventory") || { entries: [] }).entries).filter((e) => e.baseId === ${NOTE}).reduce((s, e) => s + e.count, 0);`);

    await ctx.waitFor(() => ctx.probe(`const l = mp.get(${actor}, "private.questLog"); return Array.isArray(l) && l.length > 0;`), 60000, "the client reports quest stages");
    await ctx.probe(`mp.set(${actor}, "locationalData", ${JSON.stringify(SPOT)}); return 0;`);
    await ctx.waitFor(() => ctx.drv(`${satchel} return !sp.Ui.isMenuOpen("Loading Menu") && !!c && c.is3DLoaded();`).catch(() => false), 120000, "the satchel is loaded");
    ctx.assert.ok(!(await ctx.drv(`return ${quest}.isRunning();`)), "FreeformRiften20 already runs before the check starts it");
    const running = await ctx.drv(`return ${quest}.setCurrentStageID(10);`).then(() => ctx.waitFor(() => ctx.drv(`return ${quest}.isRunning();`), 30000, "FreeformRiften20 runs on the client")).catch(() => false);
    ctx.assert.ok(running, "FreeformRiften20 does not run on the client");
    await ctx.waitFor(() => serverCount(SATCHEL).then((n) => n > 0), 15000, "the server creates the note in the satchel").catch(() => {});
    const start = { stage: await ctx.drv(`return ${quest}.getCurrentStageID();`), local: await ctx.drv(`${satchel} return c.getItemCount(${note});`), server: await serverCount(SATCHEL), alias: await aliasRef() };
    ctx.evidence.push(`FreeformRiften20 stage ${start.stage}; satchel ${hex(SATCHEL)} holds ${start.local} note on the client, ${start.server} on the server; note alias ref ${where(start.alias)}`);
    ctx.assert.ok(start.alias.id && start.alias.quests.includes(QUEST) && start.alias.inSatchel, "the note alias does not point to a note in the satchel before the open");
    ctx.assert.equal(start.local, 1, "the satchel does not hold exactly one note on the client after the quest started");

    await ctx.drv(`const p = sp.Game.getPlayer(); for (let i = 0; i < 200; i++) { const r = sp.Game.findRandomActor(p.getPositionX(), p.getPositionY(), p.getPositionZ(), 3000); if (r && r.getFormID() !== 0x14) { r.setActorValue("Aggression", 0); r.stopCombat(); } } return 0;`).catch(() => 0);
    await ctx.drv(`${satchel} const p = sp.Game.getPlayer(); p.setPosition(c.getPositionX() + 60, c.getPositionY(), c.getPositionZ() + 40); return 0;`);
    await ctx.sleep(1500);
    let open = false;
    for (let attempt = 0; attempt < 2 && !open; attempt++) {
      await ctx.drv(`${satchel} c.activate(sp.Game.getPlayer(), false); return 0;`);
      open = await ctx.waitFor(() => ctx.drv(`return sp.Ui.isMenuOpen("${MENU}");`), 10000, "the satchel opens").catch(() => false);
    }
    let shown = -1;
    let opened = null;
    if (open) {
      await ctx.sleep(2000);
      shown = await ctx.drv(`${satchel} return c.getItemCount(${note});`);
      opened = await aliasRef();
      ctx.shot("2A_3-open");
      await ctx.drv(`${satchel} if (c.getItemCount(${note}) > 0) c.removeItem(${note}, 1, true, sp.Game.getPlayer()); return 0;`);
      await ctx.sleep(2000);
      await ctx.drv(`sp.TESModPlatform.closeMenu("${MENU}"); return 0;`);
      await ctx.waitFor(() => ctx.drv(`return !sp.Ui.isMenuOpen("${MENU}");`), 10000, "the satchel closes").catch(() => {});
    }
    await ctx.sleep(3000);
    const held = await ctx.drv(`return sp.Game.getPlayer().getItemCount(${note});`);
    const end = await aliasRef();
    const server = { satchel: await serverCount(SATCHEL), player: await serverCount(actor) };
    ctx.evidence.push(`satchel open ${open}: the loot menu showed ${shown} note, alias ref with the menu open ${opened ? where(opened) : "-"}; after the take the player holds ${held}; alias ref ${where(end)}; server: satchel ${server.satchel}, player ${server.player}`);

    const fails = [];
    if (start.server < 1) fails.push("the server did not create the note in the satchel");
    if (!open) fails.push("the satchel does not open");
    if (open && shown !== 1) fails.push(`the loot menu shows ${shown} note in the satchel`);
    if (open && (opened.id !== start.alias.id || !opened.quests.includes(QUEST) || !opened.inSatchel)) fails.push(`with the menu open (the server's satchel inventory applied), the alias ref is ${where(opened)}, before ${hex(start.alias.id)}`);
    if (held !== 1) fails.push(`the player holds ${held} note`);
    if (end.id !== start.alias.id || !end.quests.includes(QUEST) || !end.inPlayer || end.inSatchel) fails.push(`the note alias ref after the take is ${where(end)}, before ${hex(start.alias.id)}`);
    if (server.satchel !== 0 || server.player !== 1) fails.push(`the server has ${server.satchel} note in the satchel and ${server.player} in the player`);
    ctx.assert.ok(!fails.length, fails.join("; "));
  },
};
