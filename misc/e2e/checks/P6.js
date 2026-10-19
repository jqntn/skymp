const fs = require("fs");
const path = require("path");
const MQ104 = 0x2610c;
const LYDIA = 0xa2c94;
const FOLLOWER_FACTION = 0x5c84e;
const FOLLOW = /suis|suiv|follow|accompagn/i;
const SPOT = [7572, -39162, 3807];
const MS13 = 0x39645;
const ARVEL = 0x39655;
const CLAW = 0x39647;
const MENU = "ContainerMenu";
const LIST = "_root.Menu_mc.InventoryLists_mc._ItemsList";
const STALE_LEADER = 0xff0000aa;
const APPEARANCE = { isFemale: false, raceId: 0x13746, weight: 50, skinColor: 0, hairColor: 0, headpartIds: [], headTextureSetId: 0, options: [], presets: [], tints: [], name: "e2e" };

module.exports = {
  engines: 1,
  timeout: 30 * 60000,
  setup: async (ctx) => {
    const a = await ctx.character(1, { pos: SPOT, angleZ: 0, worldOrCell: 0x3c });
    await ctx.probe(`mp.set(${a}, "appearance", ${JSON.stringify(APPEARANCE)}); mp.set(${a}, "private.coopParty", [${STALE_LEADER}, ${a}]); return 0;`);
  },
  async run(ctx) {
    let player = await ctx.ready(1);
    const hex = (v) => (v >>> 0).toString(16);
    const lines = () => fs.readFileSync(path.join(ctx.dir, "server.log"), "utf8");
    const stage = (q) => ctx.drv(`return sp.Quest.from(sp.Game.getFormEx(${q})).getCurrentStageID();`);
    const logOf = () => ctx.probe(`const l = mp.get(${player}, "private.questLog"); return Array.isArray(l) ? l : [];`);
    const follows = () => ctx.drv(`const a = sp.Actor.from(sp.Game.getFormEx(${LYDIA})); const f = sp.Faction.from(sp.Game.getFormEx(${FOLLOWER_FACTION})); return !!a && a.isPlayerTeammate() && a.getFactionRank(f) >= 0;`).catch(() => false);
    const snapshot = () => ctx.probe(`const l = mp.get(${player}, "locationalData"); const inv = (mp.get(${player}, "inventory") || { entries: [] }).entries.map((e) => e.baseId + "x" + e.count).sort();
      return { party: mp.get(${player}, "private.coopParty") || [], questLog: mp.get(${player}, "private.questLog") || [], followers: mp.get(${player}, "private.coopFollowers") || [], inventory: inv, cell: l.cellOrWorldDesc };`);
    const grants = (text) => [...text.matchAll(/Coop: quest (\w+) alias (\d+) created \w+ in (\w+)/g)].map((m) => `${m[1]}:${m[2]}:${m[3]}`);
    const fails = [];
    const relog = async (label) => {
      const before = await snapshot();
      await ctx.sleep(5000);
      const mark = lines().length;
      const granted = new Set(grants(lines()));
      player = await ctx.relog(1);
      const replayed = await ctx.waitFor(() => new RegExp(`replay of \\d+ quest log entries to ${hex(player)}`).test(lines().slice(mark)), 60000, `the quest log replay after the relog at ${label}`).then(() => true).catch(() => false);
      await ctx.sleep(15000);
      const after = await snapshot();
      const changed = [];
      const lost = before.questLog.filter((e) => !after.questLog.some((f) => f[0] === e[0] && f[1] === e[1]));
      if (lost.length) changed.push(`quest log lost ${JSON.stringify(lost)}`);
      for (const k of ["party", "followers", "inventory", "cell"]) if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) changed.push(`${k}: ${JSON.stringify(before[k])} -> ${JSON.stringify(after[k])}`);
      const again = grants(lines().slice(mark)).filter((g) => granted.has(g));
      if (again.length) changed.push(`quest items created again: ${again.join(", ")}`);
      ctx.evidence.push(`${label}: relogged, replay ${replayed}; changed: ${changed.join("; ") || "nothing"}`);
      if (!replayed) fails.push(`${label}: no quest log replay after the relog`);
      if (changed.length) fails.push(`${label}: the state changed across the relog: ${changed.join("; ")}`);
    };

    const first = await ctx.waitFor(() => new RegExp(`replay of \\d+ quest log entries to ${hex(player)}`).test(lines()), 60000, "the quest log replay at the first login").then(() => true).catch(() => false);
    const party = (await snapshot()).party;
    ctx.evidence.push(`S1: solo player ${hex(player)} with a stale party record of leader ${hex(STALE_LEADER)}, quest log replay at login ${first}, party record after the login ${JSON.stringify(party)}`);
    if (!first) fails.push("S1: the solo player got no quest log replay at login");
    if (party.length) fails.push(`S1: the server kept the stale party record ${JSON.stringify(party)}`);

    await ctx.drv(`sp.Quest.from(sp.Game.getFormEx(${MQ104})).setCurrentStageID(10); return 0;`);
    const logged = await ctx.waitFor(() => logOf().then((l) => l.some((e) => e[0] === MQ104 && e[1] >= 10)), 20000, "MQ104 10 in the server quest log").then(() => true).catch(() => false);
    ctx.evidence.push(`S2: MQ104 10 set on the client, in the server quest log ${logged}, client stage ${await stage(MQ104)}`);
    ctx.assert.ok(logged, [...fails, "S2: a quest stage of the solo player did not reach the server quest log"].join("; "));
    await relog("S2 quest stage");
    const mq104 = await stage(MQ104);
    if (mq104 < 10) fails.push(`S2: after the relog MQ104 is at ${mq104} on the client`);

    await ctx.probe(`mp.callPapyrusFunction("method", "ObjectReference", "Enable", { type: "form", desc: mp.getDescFromId(${LYDIA}) }, [false]); return 0;`);
    await ctx.sleep(3000);
    const loc = await ctx.npcLocation(LYDIA);
    await ctx.probe(`mp.set(${player}, "locationalData", ${JSON.stringify({ ...loc, pos: [loc.pos[0] + 120, loc.pos[1] + 80, loc.pos[2] + 30] })}); return 0;`);
    await ctx.waitFor(() => ctx.drv(`const a = sp.Actor.from(sp.Game.getFormEx(${LYDIA})); const p = sp.Game.getPlayer(); return !sp.Ui.isMenuOpen("Loading Menu") && p.is3DLoaded() && !!a && a.is3DLoaded() && !a.isDisabled();`).catch(() => false), 120000, "Lydia is loaded");
    const talk = await ctx.talk(LYDIA, () => follows(), FOLLOW, "Lydia follows the solo player", { engine: 1, quest: MQ104 });
    const stored = await ctx.waitFor(() => ctx.probe(`const s = mp.get(${player}, "private.coopFollowers"); return Array.isArray(s) && s.includes(${LYDIA});`), 20000, "the server stores Lydia for the player").then(() => true).catch(() => false);
    const hosted = await ctx.probe(`return mp.get(${LYDIA}, "hoster") || 0;`);
    ctx.evidence.push(`S3: Lydia follows ${talk.ok}, stored on the server ${stored}, hoster ${hex(hosted)}`);
    ctx.assert.ok(talk.ok && stored && hosted === player, [...fails, `S3: Lydia did not become the solo player's hosted follower (talk ${talk.ok}, stored ${stored}, hoster ${hex(hosted)})`].join("; "));
    await relog("S3 follower");
    const kept = await ctx.waitFor(() => follows(), 30000, "Lydia follows after the relog").then(() => true).catch(() => false);
    const rehosted = await ctx.waitFor(() => ctx.probe(`return mp.get(${LYDIA}, "hoster") === ${player};`), 30000, "the player hosts Lydia again").then(() => true).catch(() => false);
    ctx.evidence.push(`S3: after the relog Lydia follows ${kept}, hosted by the player ${rehosted}`);
    if (!kept) fails.push("S3: after the relog Lydia no longer follows the solo player");
    if (!rehosted) fails.push("S3: after the relog the solo player does not host Lydia");

    const ref = (id) => `const c = sp.ObjectReference.from(sp.Game.getFormEx(${id}));`;
    const serverCount = (holder, item) => ctx.probe(`return ((mp.get(${holder}, "inventory") || { entries: [] }).entries).filter((e) => e.baseId === ${item}).reduce((s, e) => s + e.count, 0);`);
    const arvel = await ctx.npcLocation(ARVEL);
    await ctx.probe(`mp.set(${player}, "locationalData", ${JSON.stringify({ ...arvel, pos: [arvel.pos[0] + 100, arvel.pos[1], arvel.pos[2] + 30] })}); return 0;`);
    await ctx.waitFor(() => ctx.drv(`${ref(ARVEL)} return !sp.Ui.isMenuOpen("Loading Menu") && !!c && c.is3DLoaded();`).catch(() => false), 120000, "Arvel is loaded");
    await ctx.drv(`sp.Quest.from(sp.Game.getFormEx(${MS13})).setCurrentStageID(10); return 0;`);
    const created = await ctx.waitFor(() => serverCount(ARVEL, CLAW).then((x) => x > 0), 20000, "the server creates the claw in Arvel").then(() => true).catch(() => false);
    const arvelHosted = await ctx.waitFor(() => ctx.probe(`return mp.get(${ARVEL}, "hoster") === ${player};`), 10000, "the player hosts Arvel").then(() => true).catch(() => false);
    await ctx.drv(`sp.Actor.from(sp.Game.getFormEx(${ARVEL})).kill(sp.Game.getPlayer()); return 0;`);
    const dead = await ctx.waitFor(() => ctx.probe(`return !!mp.get(${ARVEL}, "isDead");`), 15000, "the server has Arvel dead").then(() => true).catch(() => false);
    await ctx.sleep(3000);
    let opened = false;
    await ctx.drv(`${ref(ARVEL)} const p = sp.Game.getPlayer(); p.setPosition(c.getPositionX() + 60, c.getPositionY(), c.getPositionZ() + 40); return 0;`);
    await ctx.sleep(1500);
    for (let attempt = 0; attempt < 2 && !opened; attempt++) {
      await ctx.drv(`${ref(ARVEL)} c.activate(sp.Game.getPlayer(), false); return 0;`);
      opened = await ctx.waitFor(() => ctx.drv(`return sp.Ui.isMenuOpen("${MENU}");`), 10000, "Arvel opens").then(() => true).catch(() => false);
    }
    let took = false;
    if (opened) {
      const name = await ctx.drv(`return sp.Game.getFormEx(${CLAW}).getName();`);
      const idx = await ctx.drv(`const len = sp.Ui.getInt("${MENU}", "${LIST}.EntriesA.length"); for (let i = 0; i < len; i++) if (sp.Ui.getString("${MENU}", "${LIST}.EntriesA." + i + ".text") === ${JSON.stringify(name)}) return i; return -1;`);
      if (idx >= 0) {
        await ctx.drv(`sp.Ui.setInt("${MENU}", "${LIST}.selectedIndex", ${idx}); return 0;`);
        await ctx.sleep(500);
        await ctx.drv(`sp.Ui.invokeInt("${MENU}", "${LIST}.onItemPress", 1); return 0;`);
        took = await ctx.waitFor(() => ctx.drv(`return sp.Game.getPlayer().getItemCount(sp.Game.getFormEx(${CLAW})) > 0;`), 5000, "the menu take", Error, 100).then(() => true).catch(() => false);
      }
      await ctx.sleep(2000);
      await ctx.drv(`sp.TESModPlatform.closeMenu("${MENU}"); return 0;`).catch(() => 0);
    }
    const held = await ctx.waitFor(() => serverCount(player, CLAW).then((x) => x === 1), 15000, "the server gives the claw to the player").then(() => true).catch(() => false);
    const ms13 = await stage(MS13);
    ctx.evidence.push(`S4: the server created the claw in Arvel ${created}; the player hosts Arvel ${arvelHosted}; Arvel dead on the server ${dead}; Arvel opened ${opened}; menu take ${took}; the server has it in the player ${held}; MS13 ${ms13}`);
    ctx.assert.ok(created && arvelHosted && dead && took && held && ms13 >= 40, [...fails, `S4: the solo player could not get the Golden Claw (created ${created}, hosts Arvel ${arvelHosted}, dead ${dead}, opened ${opened}, took ${took}, server ${held}, MS13 ${ms13})`].join("; "));
    await relog("S4 quest item");
    const claw = await ctx.drv(`return sp.Game.getPlayer().getItemCount(sp.Game.getFormEx(${CLAW}));`);
    const ms13After = await stage(MS13);
    ctx.evidence.push(`S4: after the relog the client holds ${claw} claw, MS13 ${ms13After}`);
    if (claw !== 1 || ms13After < 40) fails.push(`S4: after the relog the client holds ${claw} claw and MS13 is at ${ms13After}`);

    ctx.assert.ok(!fails.length, fails.join("; "));
  },
};
