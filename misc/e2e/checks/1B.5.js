const BFB01 = 0x371de;
const BFB02 = 0x371dd;
const DRAUGR = 0x9bcb9;
const BOSS = 0x9bcd6;
const NEAR_DRAUGR = [4578, 978, -577];
const NEAR_BOSS = [-7016, -613, 650];
const AWAY = [4992, -1150, -760];

module.exports = {
  engines: 2,
  timeout: 12 * 60000,
  setup: async (ctx) => {
    await ctx.character(1, { pos: NEAR_DRAUGR, angleZ: 270, worldOrCell: BFB02 });
    await ctx.character(2, { pos: AWAY, angleZ: 180, worldOrCell: BFB01 });
  },
  async run(ctx) {
    const actors = [await ctx.ready(1), await ctx.ready(2)];
    const hex = (v) => (v >>> 0).toString(16);
    const npc = (id) => `const a = sp.Actor.from(sp.Game.getFormEx(${id}));`;
    const go = async (n, cell, pos, what) => {
      await ctx.probe(`mp.set(${actors[n - 1]}, "locationalData", { cellOrWorldDesc: "${hex(cell)}:Skyrim.esm", pos: ${JSON.stringify(pos)}, rot: [0, 0, 0] }); return 0;`);
      await ctx.waitFor(() => ctx.drv(`const p = sp.Game.getPlayer(); const c = p.getParentCell(); return !sp.Ui.isMenuOpen("Loading Menu") && !!c && c.getFormID() === ${cell} && Math.hypot(p.getPositionX() - ${pos[0]}, p.getPositionY() - ${pos[1]}) < 300;`, n).catch(() => false), 120000, what);
    };
    const loaded = (id, n, what) => ctx.waitFor(() => ctx.drv(`${npc(id)} return !!a && a.is3DLoaded();`, n).catch(() => false), 60000, what);
    const hoster = (id) => ctx.probe(`return mp.get(${id}, "hoster") || 0;`);
    const hostedBy = (id, n, what) => ctx.waitFor(async () => (await hoster(id)) === actors[n - 1], 30000, what).catch(() => false);
    const ambush = (id) => ctx.probe(`const r = mp.lookupEspmRecordById(${id}).record; const v = r && r.fields.find((f) => f.type === "VMAD"); let s = ""; if (v) for (const x of v.data) s += String.fromCharCode(x); return /masterAmbushScript/i.test(s);`);
    const state = (id, n) => ctx.drv(`${npc(id)} return { v1: a.getActorValue("Variable01"), aggression: a.getActorValue("Aggression"), combat: a.isInCombat(), ai: a.isAIEnabled() };`, n);
    const provoke = async (id, n) => {
      await ctx.drv(`${npc(id)} a.startCombat(sp.Game.getPlayer()); return 0;`, n);
      return ctx.waitFor(() => ctx.drv(`${npc(id)} return a.isInCombat();`, n), 3000, "the actor enters combat").catch(() => false);
    };
    const calm = (id, n) => ctx.drv(`${npc(id)} a.stopCombat(); return 0;`, n);
    const stayed = async (id, n) => { await ctx.sleep(4000); const s = await state(id, n); return { ok: s.v1 === 0, s }; };
    const ran = async (id, n) => { let s = await state(id, n); const ok = await ctx.waitFor(async () => { s = await state(id, n); return s.v1 === 1; }, 6000, "the ambush script runs").catch(() => false); return { ok, s }; };
    const allowed = (n) => ctx.drv(`return typeof sp.getPapyrusEventsAllowedForms === "function" ? sp.getPapyrusEventsAllowedForms() : null;`, n);
    const has = (x, id) => Array.isArray(x) && x.includes(id);
    const list = (x) => Array.isArray(x) ? `[${x.map(hex)}]` : "no native";

    const scripted = [await ambush(DRAUGR), await ambush(BOSS)];

    await loaded(DRAUGR, 1, "the draugr is loaded on engine 1");
    const firstHost = await hostedBy(DRAUGR, 1, "engine 1 hosts the draugr");
    await go(2, BFB02, NEAR_DRAUGR, "engine 2 is near the draugr");
    await loaded(DRAUGR, 2, "the draugr is loaded on engine 2");
    await ctx.sleep(2000);
    const waiting = [await state(DRAUGR, 1), await state(DRAUGR, 2)];
    const puppetSet = await allowed(2);
    const hostSet = await allowed(1);
    await ctx.drv(`if (typeof sp.setPapyrusEventsAllowedForms === "function") sp.setPapyrusEventsAllowedForms([]); return 0;`, 1);
    const gatedCombat = await provoke(DRAUGR, 1);
    const gated = await stayed(DRAUGR, 1);
    await calm(DRAUGR, 1);
    await ctx.drv(`if (typeof sp.setPapyrusEventsAllowedForms === "function") sp.setPapyrusEventsAllowedForms(${JSON.stringify(hostSet || [])}); return 0;`, 1);
    await ctx.sleep(1000);
    const hostCombat = await provoke(DRAUGR, 1);
    const hostRan = await ran(DRAUGR, 1);
    await calm(DRAUGR, 1);
    ctx.evidence.push(`draugr ${hex(DRAUGR)} (masterAmbushScript on the ref: ${scripted[0]}), hoster ${hex(await hoster(DRAUGR))}, engine 1 hosts it: ${firstHost}; Variable01 before: engine 1 ${waiting[0].v1}, engine 2 ${waiting[1].v1}`);
    ctx.evidence.push(`puppet (engine 2): allowed forms ${list(puppetSet)}`);
    ctx.evidence.push(`hoster (engine 1): allowed forms ${list(hostSet)}; the driver empties the list, then startCombat, in combat ${gatedCombat}; 4 s later ${JSON.stringify(gated.s)}`);
    ctx.evidence.push(`hoster (engine 1): the driver restores the list, then startCombat, in combat ${hostCombat}; ${JSON.stringify(hostRan.s)}`);

    await go(1, BFB02, NEAR_BOSS, "engine 1 is near the boss");
    await loaded(BOSS, 1, "the boss is loaded on engine 1");
    const bossHost1 = await hostedBy(BOSS, 1, "engine 1 hosts the boss");
    await ctx.sleep(1000);
    const hosterSet = await allowed(1);
    const bossWaiting = await state(BOSS, 1);
    await go(1, BFB01, AWAY, "engine 1 left the crypt");
    const bossFree = await ctx.waitFor(async () => (await hoster(BOSS)) === 0, 20000, "the server stops engine 1's host of the boss").catch(() => false);
    await go(2, BFB02, NEAR_BOSS, "engine 2 is near the boss");
    await loaded(BOSS, 2, "the boss is loaded on engine 2");
    const bossHost2 = await hostedBy(BOSS, 2, "engine 2 hosts the boss");
    await go(1, BFB02, NEAR_BOSS, "engine 1 is back near the boss");
    await loaded(BOSS, 1, "the boss is loaded again on engine 1");
    await ctx.sleep(2000);
    const stillHost2 = (await hoster(BOSS)) === actors[1];
    const formerSet = await allowed(1);
    const newSet = await allowed(2);
    const newWaiting = await state(BOSS, 2);
    const newCombat = await provoke(BOSS, 2);
    const newRan = await ran(BOSS, 2);
    await calm(BOSS, 2);
    ctx.evidence.push(`boss ${hex(BOSS)} (masterAmbushScript on the ref: ${scripted[1]}): engine 1 hosts it ${bossHost1} (Variable01 ${bossWaiting.v1}), allowed forms on engine 1 ${list(hosterSet)}; engine 1 leaves the cell: hoster 0 ${bossFree}; engine 2 hosts it ${bossHost2}, still after engine 1 is back ${stillHost2}`);
    ctx.evidence.push(`former hoster (engine 1): allowed forms ${list(formerSet)}; new hoster (engine 2): ${list(newSet)}`);
    ctx.evidence.push(`new hoster (engine 2): Variable01 before ${newWaiting.v1}; startCombat, in combat ${newCombat}; ${JSON.stringify(newRan.s)}`);

    ctx.assert.ok(scripted[0] && scripted[1], "a test actor has no masterAmbushScript, so its script events are not tested");
    ctx.assert.ok(Array.isArray(puppetSet), "SkyrimPlatform has no allowed-forms native");
    ctx.assert.ok(firstHost && waiting[0].v1 === 0, "the draugr was not hosted by engine 1 and waiting in ambush there");
    ctx.assert.equal(waiting[1].v1, 0, "the puppet ran the ambush script of a draugr that its engine does not host");
    ctx.assert.ok(!has(puppetSet, DRAUGR), "the puppet's engine allows the script events of an actor it does not host");
    ctx.assert.ok(has(hostSet, DRAUGR), "the hoster does not allow the script events of the draugr it hosts");
    ctx.assert.ok(gatedCombat, "the hosted draugr did not enter combat with an empty list");
    ctx.assert.ok(gated.ok, "SkyrimPlatform ran the script event of an actor that is not in the allowed list");
    ctx.assert.ok(hostCombat, "the hosted draugr did not enter combat");
    ctx.assert.ok(hostRan.ok, "the hoster did not run the ambush script event of its hosted draugr");
    ctx.assert.ok(bossHost1 && bossWaiting.v1 === 0 && bossFree && bossHost2 && stillHost2, "the boss was not hosted by engine 1, then by engine 2, so the release is not tested");
    ctx.assert.ok(has(hosterSet, BOSS), "engine 1 did not allow the script events of the boss it hosts");
    ctx.assert.ok(!has(formerSet, BOSS), "the former hoster still allows the script events of an actor it no longer hosts");
    ctx.assert.ok(has(newSet, BOSS), "the new hoster does not allow the script events of the boss");
    ctx.assert.equal(newWaiting.v1, 0, "the boss was no longer waiting in ambush on the new hoster, so its script event is not tested");
    ctx.assert.ok(newCombat && newRan.ok, "the new hoster did not run the ambush script event of the boss");
  },
};
