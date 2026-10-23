const NPCS = [["Gerdur", 0x13489], ["Alvor", 0x13482]];
const M = "Dialogue Menu";
const R = "_root.DialogueMenu_mc";
const ALVOR_FORGE = { cellOrWorldDesc: "3c:Skyrim.esm", pos: [20587, -45137, -82], rot: [0, 0, 0] };

module.exports = {
  engines: 2,
  timeout: 15 * 60000,
  setup: async (ctx) => {
    await ctx.character(1);
    await ctx.character(2);
  },
  async run(ctx) {
    const actors = [await ctx.ready(1), await ctx.ready(2)];
    const npc = (id) => `const a = sp.Actor.from(sp.Game.getFormEx(${id}));`;
    const ui = (t) => `sp.Ui.getString("${M}", "${R}.${t}")`;

    const talk = async (name, id, n, role) => {
      let seen = false;
      for (let k = 0; k < 24 && !seen; k++) {
        const d = [90, 150, 60][Math.floor(k / 8)];
        await ctx.drv(`${npc(id)} const p = sp.Game.getPlayer(); const r = (a.getAngleZ() + ${(k % 8) * 45}) * Math.PI / 180;
          p.setPosition(a.getPositionX() + ${d} * Math.sin(r), a.getPositionY() + ${d} * Math.cos(r), a.getPositionZ()); return 0;`, n);
        await ctx.sleep(700);
        seen = await ctx.drv(`${npc(id)} return sp.Game.getPlayer().hasLOS(a);`, n);
      }
      if (!seen) ctx.evidence.push(`${name}: no spot near the NPC with line of sight on engine ${n}, talking from the last spot`);
      let open = false;
      for (let attempt = 0; attempt < 2 && !open; attempt++) {
        await ctx.drv(`${npc(id)} a.activate(sp.Game.getPlayer(), false); return 0;`, n);
        open = await ctx.waitFor(() => ctx.drv(`${npc(id)} return sp.Ui.isMenuOpen("${M}") && a.isInDialogueWithPlayer();`, n), 10000, `${name} dialogue on engine ${n}`).catch(() => false);
      }
      ctx.assert.ok(open, `${name}: no dialogue on engine ${n} (${role})`);
      const topic = await ctx.waitFor(() => ctx.drv(`return ${ui("TopicList.entryList.0.text")};`, n), 15000, `${name}: the topic list is shown on engine ${n}`);
      const subtitle = async () => (await ctx.drv(`return ${ui("SubtitleText.text")};`, n)).trim();
      const greeting = await ctx.waitFor(subtitle, 10000, `${name} greets the player on engine ${n}`);
      await ctx.waitFor(async () => !(await subtitle()), 20000, `${name}: the greeting ends on engine ${n}`).catch(() => {});
      let answer = "";
      for (let click = 0; click < 3 && !answer; click++) {
        await ctx.drv(`sp.Ui.setInt("${M}", "${R}.TopicList.selectedIndex", 0); sp.Ui.invokeBool("${M}", "${R}.onSelectionClick", true); return 0;`, n);
        answer = await ctx.waitFor(async () => { const s = await subtitle(); return s && s !== greeting ? s : ""; }, 8000, `${name} answers on engine ${n}`).catch(() => "");
      }
      ctx.evidence.push(`${name} (${id.toString(16)}) on engine ${n} (${role}): greeting "${greeting}", topic "${topic}", answer "${answer}"`);
      ctx.shot(`G1_3-${name}-engine${n}-${role}`, n);
      ctx.assert.ok(answer, `${name} did not answer the topic "${topic}" on engine ${n} (${role})`);
      const closed = await ctx.waitFor(async () => {
        await ctx.drv(`sp.Ui.invokeBool("${M}", "${R}.onCancelPress", true); return 0;`, n);
        await ctx.sleep(1500);
        return ctx.drv(`${npc(id)} return !sp.Ui.isMenuOpen("${M}") && !a.isInDialogueWithPlayer();`, n);
      }, 30000, `${name}: the dialogue closes on engine ${n}`).catch(() => false);
      ctx.evidence.push(`${name} on engine ${n} (${role}): the dialogue closed: ${!!closed}`);
      ctx.assert.ok(closed, `${name}: the dialogue did not close on engine ${n} (${role})`);
    };

    for (const [name, id] of NPCS) {
      if (id === 0x13482) await ctx.probe(`mp.set(${id}, "locationalData", ${JSON.stringify(ALVOR_FORGE)}); return 0;`);
      const loc = await ctx.npcLocation(id);
      for (const actor of actors) await ctx.probe(`mp.set(${actor}, "locationalData", ${JSON.stringify(loc)}); return 0;`);
      for (const n of [1, 2]) {
        await ctx.waitFor(() => ctx.drv(`${npc(id)} return !sp.Ui.isMenuOpen("Loading Menu") && !!a && a.is3DLoaded();`, n).catch(() => false), 120000, `${name} is loaded on engine ${n}`);
      }
      const hoster = await ctx.waitFor(() => ctx.probe(`return mp.get(${id}, "hoster");`), 30000, `${name} gets a hoster`);
      const h = actors.indexOf(hoster) + 1;
      ctx.assert.ok(h > 0, `${name} hoster ${hoster.toString(16)} is not a player engine`);
      await ctx.sleep(3000);
      for (const n of [3 - h, h]) await talk(name, id, n, n === h ? "hoster" : "puppet");
      const after = await ctx.probe(`return mp.get(${id}, "hoster");`);
      ctx.evidence.push(`${name}: hoster ${hoster.toString(16)} (engine ${h}) before the talks, ${after.toString(16)} after`);
      ctx.assert.equal(after, hoster, `${name} changed hoster during the talks`);
    }
  },
};
