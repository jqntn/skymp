const NPCS = [["Orgnar", 0x13486, true], ["Delphine", 0x13485, false]];
const M = "Dialogue Menu";
const R = "_root.DialogueMenu_mc";

module.exports = {
  engines: 2,
  timeout: 12 * 60000,
  setup: async (ctx) => {
    await ctx.character(1);
    await ctx.character(2);
  },
  async run(ctx) {
    const actors = [await ctx.ready(1), await ctx.ready(2)];
    const npc = (id) => `const a = sp.Actor.from(sp.Game.getFormEx(${id}));`;
    const ui = (t) => `sp.Ui.getString("${M}", "${R}.${t}")`;
    const talk = async (n, name) => {
      const topic = await ctx.waitFor(() => ctx.drv(`return ${ui("TopicList.entryList.0.text")};`, n), 15000, `the topic list is shown on engine ${n}`).catch(() => "");
      const subtitle = async () => (await ctx.drv(`return ${ui("SubtitleText.text")};`, n)).trim();
      const greeting = await ctx.waitFor(subtitle, 10000, `${name} greets the player on engine ${n}`).catch(() => "");
      await ctx.waitFor(async () => !(await subtitle()), 20000, `the greeting ends on engine ${n}`).catch(() => {});
      let answer = "";
      for (let click = 0; click < 3 && !answer && topic; click++) {
        await ctx.drv(`sp.Ui.setInt("${M}", "${R}.TopicList.selectedIndex", 0); sp.Ui.invokeBool("${M}", "${R}.onSelectionClick", true); return 0;`, n);
        answer = await ctx.waitFor(async () => { const s = await subtitle(); return s && s !== greeting ? s : ""; }, 8000, `${name} answers on engine ${n}`).catch(() => "");
      }
      await ctx.waitFor(async () => { await ctx.drv(`sp.Ui.invokeBool("${M}", "${R}.onCancelPress", true); return 0;`, n); await ctx.sleep(1500); return ctx.drv(`return !sp.Ui.isMenuOpen("${M}");`, n); }, 20000, `the dialogue closes on engine ${n}`).catch(() => {});
      return { topic, greeting, answer };
    };

    for (const [k, [name, id, sit]] of NPCS.entries()) {
      const loc = await ctx.probe(`return mp.get(${id}, "locationalData");`);
      for (const actor of actors) await ctx.probe(`mp.set(${actor}, "locationalData", ${JSON.stringify(loc)}); return 0;`);
      for (const n of [1, 2]) {
        await ctx.waitFor(() => ctx.drv(`${npc(id)} return !sp.Ui.isMenuOpen("Loading Menu") && !!a && a.is3DLoaded();`, n).catch(() => false), 120000, `${name} is loaded on engine ${n}`);
      }
      const hoster = await ctx.waitFor(() => ctx.probe(`return mp.get(${id}, "hoster");`), 30000, `${name} gets a hoster`);
      const h = actors.indexOf(hoster) + 1;
      ctx.assert.ok(h > 0, `${name} hoster ${hoster.toString(16)} is not a player engine`);
      await ctx.sleep(3000);
      if (sit) {
        const seat = await ctx.drv(`${npc(id)} const c = a.getParentCell(); let best = null; for (let i = 0, n = c.getNumRefs(40); i < n; i++) { const r = c.getNthRef(i, 40); if (r && (!best || a.getDistance(r) < a.getDistance(best))) best = r; } if (!best || a.getDistance(best) > 400) return 0; best.activate(a, true); return best.getFormID();`, h);
        const seated = !!seat && await ctx.waitFor(() => Promise.all([1, 2].map((n) => ctx.drv(`${npc(id)} return a.getSitState();`, n))).then((s) => s.every((x) => x === 3)), 20000, `${name} sits on both engines`).catch(() => false);
        const states = await Promise.all([1, 2].map((n) => ctx.drv(`${npc(id)} return a.getSitState();`, n)));
        ctx.evidence.push(`${name}: the hoster engine ${h} makes him use furniture ${seat.toString(16)}; sit state engine 1 ${states[0]}, engine 2 ${states[1]}`);
        ctx.assert.ok(seated, `${name} does not sit on both engines, so the seated case is not tested (sit states ${states})`);
      }

      for (const n of k % 2 ? [h, 3 - h] : [3 - h, h]) {
        const role = n === h ? "hoster" : "puppet";
        let seen = false;
        let spot = -1;
        for (let k = 0; k < 24 && !seen; k++) {
          spot = (k + (n === 1 ? 0 : 4)) % 8;
          const d = [90, 150, 60][Math.floor(k / 8)];
          await ctx.drv(`${npc(id)} const p = sp.Game.getPlayer(); const r = (a.getAngleZ() + ${spot * 45}) * Math.PI / 180;
            p.setPosition(a.getPositionX() + ${d} * Math.sin(r), a.getPositionY() + ${d} * Math.cos(r), a.getPositionZ()); return 0;`, n);
          await ctx.sleep(700);
          seen = await ctx.drv(`${npc(id)} return sp.Game.getPlayer().hasLOS(a);`, n);
        }
        ctx.assert.ok(seen, `${name}: no spot near the NPC with line of sight on engine ${n}`);
        let ok = false;
        let attempts = 0;
        while (!ok && attempts < 2) {
          attempts++;
          await ctx.drv(`${npc(id)} a.activate(sp.Game.getPlayer(), false); return 0;`, n);
          ok = await ctx.waitFor(() => ctx.drv(`${npc(id)} return sp.Ui.isMenuOpen("Dialogue Menu") && a.isInDialogueWithPlayer();`, n), 10000, `${name} dialogue on engine ${n} (${role})`).catch(() => false);
        }
        ctx.shot(`S1_2-${name}-engine${n}-${role}`, n);
        if (!ok) {
          const state = await ctx.drv(`${npc(id)} const t = a.getDialogueTarget(); const k = a.getCurrentPackage(); const p = sp.Game.getPlayer();
            return { menu: sp.Ui.isMenuOpen("Dialogue Menu"), inDialogue: a.isInDialogueWithPlayer(), target: t ? t.getFormID() : 0, ai: a.isAIEnabled(), dead: a.isDead(), combat: a.isInCombat(), pkg: k ? k.getFormID() : 0, sit: a.getSitState(), dist: a.getDistance(p), los: p.hasLOS(a), los2: a.hasLOS(p), combatTarget: a.getCombatTarget() ? a.getCombatTarget().getFormID() : 0, player: p.getFormID() };`, n);
          ctx.evidence.push(`${name} on engine ${n} (${role}) state: ${JSON.stringify(state)}`);
        }
        ctx.evidence.push(`${name} (${id.toString(16)}) on engine ${n} (${role}), approach spot ${spot * 45} deg from its facing, ${attempts} activation(s): Dialogue Menu open and in dialogue with the player: ${!!ok}`);
        ctx.assert.ok(ok, `${name}: no dialogue on engine ${n} (${role})`);
        const t = await talk(n, name);
        ctx.evidence.push(`${name} on engine ${n} (${role}): greeting "${t.greeting}", topic "${t.topic}", answer "${t.answer}"`);
        ctx.assert.ok(t.answer, `${name} did not answer the topic "${t.topic}" on engine ${n} (${role})`);
      }
    }
  },
};
