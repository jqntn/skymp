const fs = require("fs");
const path = require("path");
const MQ104 = 0x2610c;
const LYDIA = 0xa2c94;
const FOLLOWER_FACTION = 0x5c84e;
const FOLLOW = /suis|suiv|follow|accompagn/i;
const SPOT = [7572, -39162, 3807];
const RELAYS = [[0x85d40, 10], [0xd9b64, 30], [0xd0800, 10], [0xd9b64, 40]];
const MS13 = 0x39645;
const ARVEL = 0x39655;
const CLAW = 0x39647;
const MENU = "ContainerMenu";
const LIST = "_root.Menu_mc.InventoryLists_mc._ItemsList";
const APPEARANCE = { isFemale: false, raceId: 0x13746, weight: 50, skinColor: 0, hairColor: 0, headpartIds: [], headTextureSetId: 0, options: [], presets: [], tints: [], name: "e2e" };

module.exports = {
  engines: 2,
  timeout: 40 * 60000,
  setup: async (ctx) => {
    for (const a of [await ctx.character(1, { pos: SPOT, angleZ: 0, worldOrCell: 0x3c }), await ctx.character(2, { pos: [SPOT[0] + 150, SPOT[1], SPOT[2]], angleZ: 0, worldOrCell: 0x3c })]) {
      await ctx.probe(`mp.set(${a}, "appearance", ${JSON.stringify(APPEARANCE)}); return 0;`);
    }
  },
  async run(ctx) {
    const actors = [await ctx.ready(1), await ctx.ready(2)];
    const [leader, member] = actors;
    const hex = (v) => (v >>> 0).toString(16);
    const lines = () => fs.readFileSync(path.join(ctx.dir, "server.log"), "utf8");
    const send = (n, content) => ctx.drv(`sp.mpClientPlugin.send(JSON.stringify({ t: 1, contentJsonDump: ${JSON.stringify(JSON.stringify(content))} }), true); return 0;`, n);
    const stage = (q, n) => ctx.drv(`return sp.Quest.from(sp.Game.getFormEx(${q})).getCurrentStageID();`, n);
    const logOf = (a) => ctx.probe(`const l = mp.get(${a}, "private.questLog"); return Array.isArray(l) ? l : [];`);
    const follower = (n) => ctx.drv(`const a = sp.Actor.from(sp.Game.getFormEx(${LYDIA})); const f = sp.Faction.from(sp.Game.getFormEx(${FOLLOWER_FACTION})); return a ? { teammate: a.isPlayerTeammate(), rank: a.getFactionRank(f) } : null;`, n);
    const follows = async (n) => { const f = await follower(n); return !!f && f.teammate && f.rank >= 0; };
    const snapshot = () => ctx.probe(`const one = (a) => { const l = mp.get(a, "locationalData"); const inv = (mp.get(a, "inventory") || { entries: [] }).entries.map((e) => e.baseId + "x" + e.count).sort(); return { questLog: mp.get(a, "private.questLog") || [], followers: mp.get(a, "private.coopFollowers") || [], inventory: inv, cell: l.cellOrWorldDesc, pos: l.pos.map(Math.round) }; };
      const ly = mp.get(${LYDIA}, "locationalData");
      return { leader: one(${leader}), member: one(${member}), lydia: { disabled: !!mp.get(${LYDIA}, "isDisabled"), dead: !!mp.get(${LYDIA}, "isDead"), cell: ly.cellOrWorldDesc } };`);
    const diff = (a, b) => {
      const out = [];
      for (const who of ["leader", "member"]) {
        const lost = a[who].questLog.filter((e) => !b[who].questLog.some((f) => f[0] === e[0] && f[1] === e[1]));
        if (lost.length) out.push(`${who} quest log lost ${JSON.stringify(lost)}`);
        const again = b[who].questLog.filter((e) => !a[who].questLog.some((f) => f[0] === e[0] && f[1] === e[1]) && a[who].questLog.some((f) => f[0] === e[0]));
        if (again.length) out.push(`${who} quest log has new entries for quests it had before the restart ${JSON.stringify(again)}`);
        for (const k of ["followers", "inventory", "cell"]) if (JSON.stringify(a[who][k]) !== JSON.stringify(b[who][k])) out.push(`${who} ${k}: ${JSON.stringify(a[who][k])} -> ${JSON.stringify(b[who][k])}`);
        const d = Math.hypot(...a[who].pos.map((v, i) => v - b[who].pos[i]));
        if (d > 150) out.push(`${who} moved ${Math.round(d)} units`);
      }
      for (const k of ["disabled", "dead", "cell"]) if (a.lydia[k] !== b.lydia[k]) out.push(`Lydia ${k}: ${a.lydia[k]} -> ${b.lydia[k]}`);
      return out;
    };
    const fails = [];
    let restarts = 0;
    const grants = (text) => [...text.matchAll(/Coop: quest (\w+) alias (\d+) created \w+ in (\w+)/g)].map((m) => `${m[1]}:${m[2]}:${m[3]}`);
    let granted = new Set();
    const crash = async (label) => {
      const before = await snapshot();
      await ctx.sleep(5000);
      const mark = lines().length;
      granted = new Set([...granted, ...grants(lines())]);
      await ctx.restartServer();
      restarts++;
      const back = await ctx.waitFor(() => [leader, member].every((a) => new RegExp(`replay of \\d+ quest log entries to ${hex(a)}`).test(lines().slice(mark))), 240000, `both players log in again after the restart at ${label}`).then(() => true).catch(() => false);
      for (const n of [1, 2]) await ctx.waitFor(() => ctx.drv(`const p = sp.Game.getPlayer(); return !sp.Ui.isMenuOpen("Loading Menu") && !!p && p.is3DLoaded();`, n).catch(() => false), 120000, `engine ${n} is in the world after the restart at ${label}`).catch(() => {});
      await ctx.sleep(15000);
      const raceMenu = await Promise.all([1, 2].map((n) => ctx.drv(`return sp.Ui.isMenuOpen("RaceSex Menu");`, n).catch(() => null)));
      const after = await snapshot();
      const changed = diff(before, after);
      const added = ["leader", "member"].map((w) => `${w} ${after[w].questLog.filter((e) => !before[w].questLog.some((f) => f[0] === e[0] && f[1] === e[1])).map((e) => `${hex(e[0])}:${e[1]}`).join(" ") || "none"}`).join(", ");
      const again = grants(lines().slice(mark)).filter((g) => granted.has(g));
      if (again.length) changed.push(`the server created quest items again after the restart (it lost its grant records): ${again.join(", ")}`);
      const [q, s] = RELAYS[restarts - 1];
      await ctx.drv(`sp.Quest.from(sp.Game.getFormEx(${q})).setCurrentStageID(${s}); return 0;`, 1);
      const relayed = await ctx.waitFor(() => logOf(member).then((l) => l.some((e) => e[0] === q && e[1] === s)), 20000, "the party relays a stage to the member").then(() => true).catch(() => false);
      ctx.evidence.push(`${label}: server killed and restarted, both clients reconnected and got their quest log replay ${back}; race menu open ${JSON.stringify(raceMenu)}; changed: ${changed.join("; ") || "nothing"}; new quest log entries (quests new to the log) ${added}; the leader's ${hex(q)} stage ${s} relayed to the member's log ${relayed}`);
      if (!back) fails.push(`${label}: the players could not log in again after the restart`);
      if (changed.length) fails.push(`${label}: the state changed across the restart: ${changed.join("; ")}`);
      if (!relayed) fails.push(`${label}: after the restart the party no longer relays the leader's quest stages to the member`);
      return after;
    };

    await send(1, { customPacketType: "partyInvite", target: member });
    await ctx.sleep(1500);
    await send(2, { customPacketType: "partyAccept", inviter: leader });
    const joined = await ctx.waitFor(() => lines().includes(`Coop: ${hex(member)} joined party`), 15000, "engine 2 joins the party").then(() => true).catch(() => false);
    ctx.assert.ok(joined, "engine 2 did not join engine 1's party");
    await crash("S1 party");

    await ctx.drv(`return sp.Quest.from(sp.Game.getFormEx(${MQ104})).setCurrentStageID(10);`, 1);
    await ctx.sleep(3000);
    await ctx.drv(`return sp.Quest.from(sp.Game.getFormEx(${MQ104})).setCurrentStageID(160);`, 1);
    await ctx.waitFor(() => logOf(member).then((l) => l.some((e) => e[0] === MQ104 && e[1] === 160)), 20000, "MQ104 160 reaches the member's log").catch(() => {});
    await ctx.sleep(3000);
    await crash("S2 quest stages");
    const mq104 = [await stage(MQ104, 1), await stage(MQ104, 2)];
    ctx.evidence.push(`S2: MQ104 on the clients after the restart: leader ${mq104[0]}, member ${mq104[1]}`);
    if (mq104.some((x) => x < 160)) fails.push(`S2: after the restart MQ104 is at ${mq104.join(" and ")} on the clients, not 160`);

    await ctx.probe(`mp.callPapyrusFunction("method", "ObjectReference", "Enable", { type: "form", desc: mp.getDescFromId(${LYDIA}) }, [false]); return 0;`);
    await ctx.sleep(3000);
    const loc = await ctx.npcLocation(LYDIA);
    for (const [a, k] of [[leader, 1], [member, -1]]) {
      await ctx.probe(`mp.set(${a}, "locationalData", ${JSON.stringify({ ...loc, pos: [loc.pos[0] + 120 * k, loc.pos[1] + 80, loc.pos[2] + 30] })}); return 0;`);
    }
    for (const n of [1, 2]) await ctx.waitFor(() => ctx.drv(`const a = sp.Actor.from(sp.Game.getFormEx(${LYDIA})); const p = sp.Game.getPlayer(); return !sp.Ui.isMenuOpen("Loading Menu") && p.is3DLoaded() && !!a && a.is3DLoaded() && !a.isDisabled();`, n).catch(() => false), 120000, `Lydia is loaded on engine ${n}`);
    const talk = await ctx.talk(LYDIA, () => follows(2), FOLLOW, "Lydia follows the member", { engine: 2, quest: MQ104 });
    const stored = await ctx.waitFor(() => ctx.probe(`const s = mp.get(${member}, "private.coopFollowers"); return Array.isArray(s) && s.includes(${LYDIA});`), 20000, "the server stores Lydia for the member").then(() => true).catch(() => false);
    if (!(talk.ok && stored)) ctx.assert.ok(!fails.length, fails.join("; "));
    ctx.assert.ok(talk.ok && stored, `not exercised: Lydia did not become the member's follower (talk ${talk.ok}, stored ${stored})`);
    await crash("S3 follower");
    const kept = await ctx.waitFor(() => follows(2), 30000, "Lydia follows the member after the restart").then(() => true).catch(() => false);
    const hoster = await ctx.probe(`return mp.get(${LYDIA}, "hoster") || 0;`);
    ctx.evidence.push(`S3: after the restart Lydia follows the member on his client ${kept}, hoster ${hex(hoster)}`);
    if (!kept) fails.push("S3: after the restart Lydia no longer follows the member on his client");

    const ref = (id) => `const c = sp.ObjectReference.from(sp.Game.getFormEx(${id}));`;
    const serverCount = (holder, item) => ctx.probe(`return ((mp.get(${holder}, "inventory") || { entries: [] }).entries).filter((e) => e.baseId === ${item}).reduce((s, e) => s + e.count, 0);`);
    const open = async (id, n) => {
      await ctx.drv(`${ref(id)} const p = sp.Game.getPlayer(); p.setPosition(c.getPositionX() + ${n === 1 ? 60 : -60}, c.getPositionY(), c.getPositionZ() + 40); return 0;`, n);
      await ctx.sleep(1500);
      for (let attempt = 0; attempt < 2; attempt++) {
        await ctx.drv(`${ref(id)} c.activate(sp.Game.getPlayer(), false); return 0;`, n);
        if (await ctx.waitFor(() => ctx.drv(`return sp.Ui.isMenuOpen("${MENU}");`, n), 10000, `${hex(id)} opens on engine ${n}`).catch(() => false)) return true;
      }
      return false;
    };
    const menuTake = async (item, n) => {
      const name = await ctx.drv(`return sp.Game.getFormEx(${item}).getName();`, n);
      const idx = await ctx.drv(`const len = sp.Ui.getInt("${MENU}", "${LIST}.EntriesA.length"); for (let i = 0; i < len; i++) if (sp.Ui.getString("${MENU}", "${LIST}.EntriesA." + i + ".text") === ${JSON.stringify(name)}) return i; return -1;`, n);
      if (idx < 0) return false;
      await ctx.drv(`sp.Ui.setInt("${MENU}", "${LIST}.selectedIndex", ${idx}); return 0;`, n);
      await ctx.sleep(500);
      await ctx.drv(`sp.Ui.invokeInt("${MENU}", "${LIST}.onItemPress", 1); return 0;`, n);
      const taken = await ctx.waitFor(() => ctx.drv(`return sp.Game.getPlayer().getItemCount(sp.Game.getFormEx(${item})) > 0;`, n), 5000, `the menu take on engine ${n}`, Error, 100).then(() => true).catch(() => false);
      await ctx.sleep(2000);
      await ctx.drv(`sp.TESModPlatform.closeMenu("${MENU}"); return 0;`, n).catch(() => 0);
      return taken;
    };
    const arvel = await ctx.npcLocation(ARVEL);
    for (const [a, dx] of [[leader, 100], [member, -100]]) {
      await ctx.probe(`mp.set(${a}, "locationalData", ${JSON.stringify({ ...arvel, pos: [arvel.pos[0] + dx, arvel.pos[1], arvel.pos[2] + 30] })}); return 0;`);
    }
    for (const n of [1, 2]) await ctx.waitFor(() => ctx.drv(`${ref(ARVEL)} return !sp.Ui.isMenuOpen("Loading Menu") && !!c && c.is3DLoaded();`, n).catch(() => false), 120000, `Arvel is loaded on engine ${n}`);
    await ctx.drv(`sp.Quest.from(sp.Game.getFormEx(${MS13})).setCurrentStageID(10); return 0;`, 1);
    await ctx.waitFor(() => serverCount(ARVEL, CLAW).then((x) => x > 0), 20000, "the server creates the claw in Arvel").catch(() => {});
    const arvelHoster = await ctx.probe(`return mp.get(${ARVEL}, "hoster") || 0;`);
    await ctx.drv(`sp.Actor.from(sp.Game.getFormEx(${ARVEL})).kill(sp.Game.getPlayer()); return 0;`, arvelHoster === member ? 2 : 1);
    await ctx.waitFor(() => ctx.probe(`return !!mp.get(${ARVEL}, "isDead");`), 15000, "the server has Arvel dead").catch(() => {});
    await ctx.sleep(3000);
    const took = (await open(ARVEL, 1)) && (await menuTake(CLAW, 1));
    const held = await ctx.waitFor(() => serverCount(leader, CLAW).then((x) => x === 1), 15000, "the server gives the claw to the leader").then(() => true).catch(() => false);
    const ms13Before = await stage(MS13, 1);
    ctx.evidence.push(`S4: the leader took the Golden Claw from Arvel in the menu ${took}; the server has it in the leader ${held}; MS13 on the leader ${ms13Before}`);
    if (!(took && held && ms13Before >= 40)) ctx.assert.ok(!fails.length, fails.join("; "));
    ctx.assert.ok(took && held && ms13Before >= 40, `not exercised: the leader does not hold the claw with MS13 at 40 (took ${took}, server ${held}, MS13 ${ms13Before})`);
    await crash("S4 quest item");
    const claw = await ctx.drv(`return sp.Game.getPlayer().getItemCount(sp.Game.getFormEx(${CLAW}));`, 1);
    const ms13After = await stage(MS13, 1);
    ctx.evidence.push(`S4: after the restart the leader's client holds ${claw} claw, MS13 ${ms13After}`);
    if (claw !== 1 || ms13After < 40) fails.push(`S4: after the restart the leader's client holds ${claw} claw and MS13 is at ${ms13After}`);

    ctx.assert.ok(!fails.length, fails.join("; "));
  },
};
