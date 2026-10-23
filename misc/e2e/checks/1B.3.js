const fs = require("fs");
const path = require("path");

const ORGNAR = 0x13486;
const SERVICES = path.join(__dirname, "..", "..", "..", "skymp5-client", "src", "services", "services");

module.exports = {
  engines: 2,
  timeout: 9 * 60000,
  setup: async (ctx) => {
    await ctx.character(1);
    await ctx.character(2);
  },
  async run(ctx) {
    ctx.unit("[1B.3]");
    const actors = [await ctx.ready(1), await ctx.ready(2)];
    const appearance = { isFemale: false, raceId: 0x13746, weight: 50, skinColor: -1, hairColor: -1, headpartIds: [], headTextureSetId: 0, options: new Array(19).fill(0), presets: new Array(4).fill(0), tints: [], name: "E2eOther" };
    await ctx.probe(`mp.set(${actors[1]}, "appearance", ${JSON.stringify(appearance)}); return 0;`);
    const npc = (id) => `sp.Actor.from(sp.Game.getFormEx(${id}))`;
    const inn = (n) => ctx.waitFor(() => ctx.drv(`const a = ${npc(ORGNAR)}; return !sp.Ui.isMenuOpen("Loading Menu") && !!a && a.is3DLoaded();`, n).catch(() => false), 120000, `the inn is loaded on engine ${n}`);
    const loc = await ctx.probe(`return mp.get(${ORGNAR}, "locationalData");`);
    await ctx.probe(`mp.set(${actors[0]}, "locationalData", ${JSON.stringify(loc)}); return 0;`);
    await inn(1);
    await ctx.waitFor(async () => (await ctx.probe(`return mp.get(${ORGNAR}, "hoster");`)) === actors[0], 30000, "engine 1 hosts Orgnar");
    await ctx.probe(`mp.set(${actors[1]}, "locationalData", ${JSON.stringify(loc)}); return 0;`);
    await inn(2);
    await ctx.sleep(4000);
    const hex = (v) => v.toString(16);

    await ctx.drv(`const p = sp.Game.getPlayer(); p.damageActorValue("magicka", p.getActorValue("magicka") * 0.7); return 0;`, 1);
    await ctx.sleep(4000);
    const percentages = await ctx.probe(`return { player: mp.get(${actors[0]}, "percentages"), orgnar: mp.get(${ORGNAR}, "percentages") };`);
    ctx.evidence.push(`actor values after engine 1's player lost 70% magicka: ${JSON.stringify(percentages)}`);

    const otherPos = await ctx.probe(`return mp.getActorPos(${actors[1]});`);
    const clone = await ctx.drv(`for (let i = 0; i < 200; i++) { const c = sp.Game.findRandomActor(${otherPos[0]}, ${otherPos[1]}, ${otherPos[2]}, 400); if (c && c.getFormID() >= 0xff000000 && c.getDisplayName() === "E2eOther") return c.getFormID(); } return 0;`, 1);
    const before = await ctx.probe(`return mp.get(${actors[1]}, "percentages").health;`);
    const attack = `const a = ${npc(ORGNAR)}; const c = ${npc(clone)}; a.setActorValue("Aggression", 3); if (a.getDistance(c) > 150) a.moveTo(c, 60, 0, 0, true); a.startCombat(c); return 0;`;
    await ctx.drv(`globalThis.e2eHits = []; globalThis.e2eHitsHandle = sp.on("hit", (e) => { if (e.aggressor && e.aggressor.getFormID() === ${ORGNAR}) globalThis.e2eHits.push(e.target ? e.target.getFormID() : 0); }); return 0;`, 1);
    let tries = 0;
    const hit = !clone ? false : await ctx.waitFor(async () => {
      if (tries++ % 8 === 0) await ctx.drv(attack, 1);
      return (await ctx.probe(`return mp.get(${actors[1]}, "percentages").health;`)) < before - 0.01;
    }, 45000, "the server applies Orgnar's hit to engine 2's player").catch(() => false);
    const after = await ctx.probe(`return mp.get(${actors[1]}, "percentages").health;`);
    const localHits = await ctx.drv(`const h = globalThis.e2eHits; sp.unsubscribe(globalThis.e2eHitsHandle); return h;`, 1);
    await ctx.drv(`const a = ${npc(ORGNAR)}; a.setActorValue("Aggression", 0); a.stopCombat(); return 0;`, 1);
    ctx.evidence.push(`the hosted Orgnar on engine 1 fights engine 2's player (clone ${hex(clone)} on engine 1); engine 2's server health ${before} -> ${after}; local hits by Orgnar on engine 1: ${JSON.stringify(localHits.map(hex))}`);

    const doors = await ctx.drv(`const c = sp.Game.getPlayer().getParentCell(); const out = []; for (let i = 0, n = c.getNumRefs(29); i < n; i++) { const r = c.getNthRef(i, 29); if (r && r.getFormID() < 0xff000000) out.push(r.getFormID()); } return out;`, 1);
    const door = (await ctx.probe(`return ${JSON.stringify(doors)}.filter((id) => { const r = mp.lookupEspmRecordById(id).record; return r && !r.fields.some((f) => f.type === "XTEL"); });`))[0];
    let openBefore = null;
    let toggled = false;
    for (let attempt = 0; door && attempt < 3 && !toggled; attempt++) {
      await ctx.waitFor(() => ctx.drv(`const s = sp.ObjectReference.from(sp.Game.getFormEx(${door})).getOpenState(); return s === 1 || s === 3;`, 1), 10000, "the door is not moving").catch(() => 0);
      openBefore = await ctx.probe(`return mp.get(${door}, "isOpen");`);
      await ctx.drv(`sp.ObjectReference.from(sp.Game.getFormEx(${door})).activate(${npc(ORGNAR)}, false); return 0;`, 1);
      toggled = await ctx.waitFor(async () => (await ctx.probe(`return mp.get(${door}, "isOpen");`)) !== openBefore, 5000, "the server toggles the door").then(() => true).catch(() => false);
    }
    ctx.evidence.push(`the hosted Orgnar activates the inn door ${door ? hex(door) : "none"} on engine 1: server isOpen ${openBefore} -> toggled ${toggled}`);

    await ctx.probe(`mp.set(${ORGNAR}, "isDead", true); return 0;`);
    const died = await ctx.waitFor(() => ctx.drv(`return ${npc(ORGNAR)}.isDead();`, 1), 15000, "Orgnar dies on engine 1").then(() => true).catch(() => false);
    await ctx.probe(`mp.set(${ORGNAR}, "isDead", false); return 0;`);
    await ctx.sleep(5000);
    const revived = await ctx.drv(`const a = ${npc(ORGNAR)}; return a ? { dead: a.isDead(), disabled: a.isDisabled(), deleted: a.isDeleted(), loaded: a.is3DLoaded() } : null;`, 1);
    ctx.evidence.push(`the server killed Orgnar: dead on engine 1 ${died}; after the server revived him: ${JSON.stringify(revived)}`);
    ctx.assert.ok(died, "not exercised: the server's kill of Orgnar did not reach engine 1");

    const death = fs.readFileSync(path.join(SERVICES, "deathService.ts"), "utf8");
    const killMoveForAll = /[\s(]0,\s*0xffffffff,\s*"KillMove\*"/.test(death);
    const inputs = fs.readFileSync(path.join(SERVICES, "sendInputsService.ts"), "utf8");
    const noNpcValues = /sendActorValuePercentage\(_refrId\?: number, form\?: FormModel\) \{\s*if \(_refrId\) \{\s*return;/.test(inputs);
    ctx.evidence.push(`source: KillMove blocked for all ids ${killMoveForAll}; actor values not sent for hosted NPCs ${noNpcValues}`);
    ctx.shot("1B_3", 1);

    ctx.assert.ok(clone, "engine 1 has no clone of engine 2's player near its position");
    if (!hit && !localHits.includes(clone)) throw new ctx.Env("the frenzied Orgnar landed no hit on the other player's clone, so the hit path was not exercised");
    ctx.assert.ok(hit, `the server did not apply the hosted Orgnar's hit (engine 2's health ${before} -> ${after})`);
    ctx.assert.ok(door, "no interior door in the inn");
    ctx.assert.ok(toggled, "the server did not take the hosted Orgnar's activation of a door");
    ctx.assert.ok(revived && !revived.dead && !revived.disabled && !revived.deleted, "the real actor was not resurrected in place");
    ctx.assert.ok(percentages.player.magicka < 0.5 && percentages.orgnar.magicka > 0.9, "the hosted Orgnar has the player's actor values");
    ctx.assert.ok(killMoveForAll, "KillMove is not blocked for real actors");
    ctx.assert.ok(noNpcValues, "the client sends the player's actor values for hosted NPCs");
  },
};
