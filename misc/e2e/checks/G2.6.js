const fs = require("fs");
const path = require("path");
const BFB01 = 0x371de;
const BFB02 = 0x371dd;
const PILLARS = [0xaa8cb, 0xaa8cc, 0xaa8cd];
const LEVER = 0xaa8c3;
const GATE = 0x3b9f1;
const RINGS = { large: 0x4e2ba, medium: 0x4e2bb, small: 0x4e2bc };
const KEYHOLE = 0x4e2b9;
const DOOR = 0x4e2b8;
const CLAW = 0x39647;
const MS13 = 0x39645;
const MS13_DOOR_STAGE = 50;
const SETTLE_MS = 6000;
const GATE_NODE = "RuinsGate01";
const GATE_RISE = 50;
const DOOR_NODE = "DoorBase";
const DOOR_DROP = 50;
const DRAGON = 0x5a6ca;
const MQ104 = 0x2610c;
const MQ104_DRAGON_STAGE = 60;
const SOUL_STAGE = 90;
const REWARD_STAGE = 160;
const ABSORBED = 0x1c0f2;
const FUS = 0x13e22;
const BALGRUUF = 0x1a677;
const LYDIA = 0xa2c94;
const FOLLOWER_FACTION = 0x5c84e;
const SPOT = [7572, -39162, 3807];
const M = "Dialogue Menu";
const R = "_root.DialogueMenu_mc";

module.exports = {
  engines: 2,
  timeout: 40 * 60000,
  setup: async (ctx) => {
    await ctx.character(1, { pos: [5100, -1150, -760], angleZ: 0, worldOrCell: BFB01 });
    await ctx.character(2, { pos: [5450, -640, -760], angleZ: 90, worldOrCell: BFB01 });
  },
  async run(ctx) {
    const actors = [await ctx.ready(1), await ctx.ready(2)];
    const [leader, member] = actors;
    const hex = (v) => (v >>> 0).toString(16);
    const form = (id) => `{ type: "form", desc: mp.getDescFromId(${id}) }`;
    const send = (n, content) => ctx.drv(`sp.mpClientPlugin.send(JSON.stringify({ t: 1, contentJsonDump: ${JSON.stringify(JSON.stringify(content))} }), true); return 0;`, n);
    const stateOf = (id) => ctx.probe(`return mp.callPapyrusFunction("method", "ObjectReference", "GetState", ${form(id)}, []);`);
    const loaded = (id, n) => ctx.waitFor(() => ctx.drv(`const r = sp.ObjectReference.from(sp.Game.getFormEx(${id})); return !sp.Ui.isMenuOpen("Loading Menu") && !!r && r.is3DLoaded();`, n).catch(() => false), 120000, `${hex(id)} is loaded on engine ${n}`);
    const activate = (id, n) => ctx.drv(`sp.ObjectReference.from(sp.Game.getFormEx(${id})).activate(sp.Game.getPlayer(), false); return 0;`, n);
    const watch = (id, n) => ctx.drv(`const w = globalThis.e2eAnims || (globalThis.e2eAnims = {}); w[${id}] = []; sp.hooks.sendAnimationEvent.add({ enter(c) { w[${id}].push(c.animEventName); }, leave() {} }, ${id}, ${id}); return 0;`, n);
    const anims = (id, n) => ctx.drv(`return (globalThis.e2eAnims || {})[${id}] || [];`, n);
    const nodeZ = (id, node, n) => ctx.drv(`return Math.round(sp.NetImmerse.getNodeWorldPositionZ(sp.ObjectReference.from(sp.Game.getFormEx(${id})), "${node}", false));`, n);
    const gateZ = (n) => nodeZ(GATE, GATE_NODE, n);
    const doorZ = (n) => ctx.drv(`return Math.round(sp.NetImmerse.getNodeWorldPositionZ(sp.ObjectReference.from(sp.Game.getFormEx(${DOOR})), "${DOOR_NODE}", false));`, n);
    const fails = [];

    for (const n of [1, 2]) await loaded(GATE, n);
    await loaded(PILLARS[0], 2);
    await send(1, { customPacketType: "partyInvite", target: member });
    await ctx.sleep(1500);
    await send(2, { customPacketType: "partyAccept", inviter: leader });
    const joined = await ctx.waitFor(() => fs.readFileSync(path.join(ctx.dir, "server.log"), "utf8").includes(`Coop: ${hex(member)} joined party`), 15000, "engine 2 joins the party").then(() => true).catch(() => false);
    ctx.assert.ok(joined, "engine 2 did not join engine 1's party");
    for (const n of [1, 2]) await watch(GATE, n);

    const initial = { pillars: await Promise.all(PILLARS.map(stateOf)), gate: await stateOf(GATE) };
    const closedGate = { 1: await gateZ(1), 2: await gateZ(2) };
    ctx.evidence.push(`A: party joined in Bleak Falls Barrow; server script states: pillars ${initial.pillars.join(", ")}, gate ${initial.gate}; gate node ${GATE_NODE} height on engine 1 ${closedGate[1]}, on engine 2 ${closedGate[2]}`);
    const leverActivations = () => fs.readFileSync(path.join(ctx.dir, "server.log"), "utf8").split(`ProcessActivate ${hex(LEVER)} `).length - 1;
    const leverBefore = leverActivations();
    await activate(LEVER, 2);
    const controlAt = Date.now();
    await ctx.sleep(SETTLE_MS);
    const gateStill = async () => ({ 1: await anims(GATE, 1), 2: await anims(GATE, 2), z1: await gateZ(1), z2: await gateZ(2) });
    const moved = (g) => g[1].length || g[2].length || Math.abs(g.z1 - closedGate[1]) > 5 || Math.abs(g.z2 - closedGate[2]) > 5;
    const control = { server: await stateOf(GATE), lever: await stateOf(LEVER), received: leverActivations() - leverBefore, ...(await gateStill()) };
    ctx.evidence.push(`A: control, engine 2 pulled the lever before the pillars were solved: lever activations in the server log ${control.received}, lever server state ${control.lever}, gate server state ${control.server}, gate animation events on engine 1 ${JSON.stringify(control[1])}, on engine 2 ${JSON.stringify(control[2])}, gate height ${control.z1}, ${control.z2}`);
    if (!control.received) fails.push("A: the server did not get the control lever pull");
    if (moved(control)) fails.push("A: the gate moved when the lever was pulled before the pillars were solved");
    for (const wave of [PILLARS, PILLARS.slice(0, 2)]) {
      for (const p of wave) await activate(p, 2);
      await ctx.sleep(SETTLE_MS);
    }
    const solved = { pillars: await Promise.all(PILLARS.map(stateOf)), lever: await stateOf(LEVER), ...(await gateStill()) };
    ctx.evidence.push(`A: before the second pull (${Math.round((Date.now() - controlAt) / 1000)} s after the control pull): lever server state ${solved.lever}, gate animation events on engine 1 ${JSON.stringify(solved[1])}, on engine 2 ${JSON.stringify(solved[2])}, gate height ${solved.z1}, ${solved.z2}`);
    if (moved(solved)) fails.push("A: the gate moved after the control pull, before the second pull");
    await activate(LEVER, 2);
    const gateStates = [];
    const gateBusy = ctx.waitFor(async () => { const st = await stateOf(GATE); if (gateStates[gateStates.length - 1] !== st) gateStates.push(st); return st === "busy"; }, 20000, "the gate's server script turns busy").then(() => true).catch(() => false);
    const gateOpen = await ctx.waitFor(async () => (await anims(GATE, 1)).includes("Open") && (await anims(GATE, 2)).includes("Open") && (await gateZ(1)) >= closedGate[1] + GATE_RISE && (await gateZ(2)) >= closedGate[2] + GATE_RISE, 25000, "the gate opens on both clients").then(() => true).catch(() => false);
    const gate = { server: await stateOf(GATE), 1: await anims(GATE, 1), 2: await anims(GATE, 2), z1: await gateZ(1), z2: await gateZ(2) };
    ctx.evidence.push(`A: engine 2 (member) turned the pillars 1, 2, 3, then 1, 2: server pillar states ${solved.pillars.join(", ")}; engine 2 pulled the lever: gate server state ${gate.server}, gate animation events on engine 1 ${JSON.stringify(gate[1])}, on engine 2 ${JSON.stringify(gate[2])}; gate height on engine 1 ${closedGate[1]} -> ${gate.z1}, on engine 2 ${closedGate[2]} -> ${gate.z2}`);
    const busy = await gateBusy;
    const gateDone = gateOpen && await ctx.waitFor(async () => (await stateOf(GATE)) === "waiting", 40000, "the gate's server script returns to waiting").then(() => true).catch(() => false);
    ctx.evidence.push(`A: gate server state after the opening: ${await stateOf(GATE)}`);
    ctx.evidence.push(`A: gate server states seen after the pull: ${JSON.stringify(gateStates)}`);
    if (!busy) fails.push(`A: the gate's server script never turned busy after the pull (${JSON.stringify(gateStates)})`);
    if (gateOpen && !gateDone) fails.push(`A: the gate's server script did not return to waiting within 40 s after the gate opened`);
    if (!gateOpen) fails.push(`A: the gate did not open on both clients after the member solved the pillars and pulled the lever (animation events: engine 1 ${JSON.stringify(gate[1])}, engine 2 ${JSON.stringify(gate[2])}; height: engine 1 ${closedGate[1]} -> ${gate.z1}, engine 2 ${closedGate[2]} -> ${gate.z2}; server state ${gate.server})`);

    await ctx.probe(`mp.callPapyrusFunction("method", "ObjectReference", "AddItem", ${form(leader)}, [mp.callPapyrusFunction("global", "Game", "GetFormEx", null, [${CLAW}]), 1, true]); return 0;`);
    for (const [n, dx] of [[1, -60], [2, 60]]) {
      await ctx.probe(`mp.set(${actors[n - 1]}, "locationalData", { cellOrWorldDesc: "${hex(BFB02)}:Skyrim.esm", pos: [${128 + dx}, -470, -250], rot: [0, 0, 0] }); return 0;`);
    }
    for (const n of [1, 2]) await loaded(DOOR, n);
    await ctx.waitFor(() => ctx.drv(`return sp.Game.getPlayer().getItemCount(sp.Game.getFormEx(${CLAW}));`, 1).then((c) => c === 1), 15000, "engine 1 has the claw").catch(() => {});
    for (let wave = 0; wave < 2; wave++) {
      for (const r of Object.values(RINGS)) await activate(r, 1);
      await ctx.sleep(SETTLE_MS);
    }
    const rings = Object.fromEntries(await Promise.all(Object.entries(RINGS).map(async ([k, id]) => [k, await stateOf(id)])));
    const closedZ = { 1: await doorZ(1), 2: await doorZ(2) };
    await activate(KEYHOLE, 1);
    const doorOpen = await ctx.waitFor(async () => (await doorZ(1)) <= closedZ[1] - DOOR_DROP && (await doorZ(2)) <= closedZ[2] - DOOR_DROP, 40000, "the claw door sinks on both clients").then(() => true).catch(() => false);
    const stageOf = (n) => ctx.drv(`return sp.Quest.from(sp.Game.getFormEx(${MS13})).getCurrentStageID();`, n);
    const stage = await ctx.waitFor(async () => (await stageOf(1)) >= MS13_DOOR_STAGE && (await stageOf(2)) >= MS13_DOOR_STAGE, 15000, `MS13 reaches stage ${MS13_DOOR_STAGE} on both engines`).then(() => true).catch(() => false);
    const door = { keyhole: await stateOf(KEYHOLE), 1: await doorZ(1), 2: await doorZ(2), ms13: { 1: await ctx.drv(`return sp.Quest.from(sp.Game.getFormEx(${MS13})).getCurrentStageID();`, 1), 2: await ctx.drv(`return sp.Quest.from(sp.Game.getFormEx(${MS13})).getCurrentStageID();`, 2) } };
    ctx.evidence.push(`B: engine 1 (leader, with the claw) turned each ring twice: server ring states ${JSON.stringify(rings)}; engine 1 used the keyhole: keyhole server state ${door.keyhole}, door node ${DOOR_NODE} height on engine 1 ${closedZ[1]} -> ${door[1]}, on engine 2 ${closedZ[2]} -> ${door[2]}; MS13 stage on engine 1 ${door.ms13[1]}, on engine 2 ${door.ms13[2]}`);
    ctx.shot("clawdoor-engine2", 2);
    if (door.keyhole !== "done") fails.push(`B: the keyhole's server script is ${door.keyhole}, not done`);
    if (!doorOpen) fails.push(`B: the claw door did not sink ${DOOR_DROP} units on both clients within 40 s (engine 1 ${closedZ[1]} -> ${door[1]}, engine 2 ${closedZ[2]} -> ${door[2]}, keyhole ${door.keyhole})`);
    if (!stage) fails.push(`B: MS13 did not reach stage ${MS13_DOOR_STAGE} on both engines (engine 1 ${door.ms13[1]}, engine 2 ${door.ms13[2]})`);

    const log = () => fs.readFileSync(path.join(ctx.dir, "server.log"), "utf8");
    const quest = `sp.Quest.from(sp.Game.getFormEx(${MQ104}))`;
    const done = (s, n = 1) => ctx.drv(`return ${quest}.isStageDone(${s});`, n);
    const mqStage = (n = 1) => ctx.drv(`const q = ${quest}; return q.isRunning() ? q.getCurrentStageID() : -1;`, n);
    const souls = (n) => ctx.drv(`return { souls: sp.Game.getPlayer().getActorValue("DragonSouls"), absorbed: sp.GlobalVariable.from(sp.Game.getFormEx(${ABSORBED})).getValue(), fus: sp.Game.isWordUnlocked(sp.WordOfPower.from(sp.Game.getFormEx(${FUS}))) };`, n);
    const answerBox = (n) => ctx.drv(`if (!sp.Ui.isMenuOpen("MessageBoxMenu")) return false; sp.Ui.invokeInt("MessageBoxMenu", "_root.MessageMenu.ClickCallback", 0); return true;`, n);
    const memberLog = () => ctx.probe(`return (mp.get(${member}, "private.questLog") || []).filter(([q]) => q === ${MQ104}).map(([, s]) => s);`);
    const serverRef = (id) => ctx.probe(`return { pos: mp.get(${id}, "locationalData").pos.map(Math.round), disabled: !!mp.get(${id}, "isDisabled"), dead: !!mp.get(${id}, "isDead"), hoster: mp.get(${id}, "hoster") || 0 };`);
    const inWorld = (n) => ctx.waitFor(() => ctx.drv(`const p = sp.Game.getPlayer(); return !sp.Ui.isMenuOpen("Loading Menu") && !!p.getWorldSpace() && p.getWorldSpace().getFormID() === 0x3c;`, n).catch(() => false), 120000, `engine ${n} is outdoors`);
    const moveBoth = async (loc, dx, dy) => {
      for (const [a, k] of [[leader, 1], [member, -1]]) {
        await ctx.probe(`mp.set(${a}, "locationalData", ${JSON.stringify({ ...loc, pos: [loc.pos[0] + dx + k * 40, loc.pos[1] + dy, loc.pos[2] + 30] })}); return 0;`);
      }
    };
    const talk = async (npc, until, prefer, label) => {
      const state = () => ctx.drv(`const open = sp.Ui.isMenuOpen("${M}"); const t = []; let sub = "";
        if (open) { for (let i = 0; i < 8; i++) { let s = ""; try { s = sp.Ui.getString("${M}", "${R}.TopicList.entryList." + i + ".text"); } catch (e) {} if (!s) break; t.push(s); } try { sub = (sp.Ui.getString("${M}", "${R}.SubtitleText.text") || "").trim(); } catch (e) {} }
        return { open, t, sub, msg: sp.Ui.isMenuOpen("MessageBoxMenu"), stage: ${quest}.getCurrentStageID() };`);
      const clicked = [];
      const dismissed = [];
      let s = await state();
      const ok = await ctx.waitFor(async () => {
        s = await state();
        if (await until()) return true;
        if (s.msg) {
          dismissed.push(s.stage);
          await answerBox(1);
          await ctx.sleep(1500);
        } else if (s.open && !s.sub && s.t.length) {
          const fresh = s.t.map((x, i) => [x, i]).filter(([x]) => !clicked.includes(x));
          const [x, i] = fresh.find(([t]) => prefer.test(t)) || fresh[0] || [s.t[0], 0];
          clicked.push(x);
          await ctx.drv(`sp.Ui.setInt("${M}", "${R}.TopicList.selectedIndex", ${i}); sp.Ui.invokeBool("${M}", "${R}.onSelectionClick", true); return 0;`);
          await ctx.sleep(2500);
        } else if (!s.open) {
          await ctx.sleep(2000);
          if (!(await state()).open) await ctx.drv(`sp.Actor.from(sp.Game.getFormEx(${npc})).activate(sp.Game.getPlayer(), false); return 0;`);
          await ctx.sleep(3000);
        }
        return false;
      }, 8 * 60000, label).then(() => true).catch(() => false);
      if ((await state()).open) await ctx.drv(`sp.TESModPlatform.closeMenu("${M}"); return 0;`).catch(() => {});
      return { ok, picks: clicked.length, topics: [...new Set(clicked)], last: s.sub, dismissed };
    };

    await moveBoth({ cellOrWorldDesc: "3c:Skyrim.esm", pos: SPOT, rot: [0, 0, 0] }, 0, 0);
    for (const n of [1, 2]) await inWorld(n);
    await ctx.sleep(3000);
    const before = { 1: await souls(1), 2: await souls(2) };
    await ctx.drv(`return ${quest}.setCurrentStageID(${MQ104_DRAGON_STAGE});`, 1);
    const enabled = await ctx.waitFor(async () => {
      const l = await ctx.drv(`const a = sp.Actor.from(sp.Game.getFormEx(${DRAGON})); return !!a && a.is3DLoaded() && !a.isDisabled();`, 1).catch(() => false);
      const s = await serverRef(DRAGON);
      return l && !s.disabled && (s.hoster === leader || s.hoster === member);
    }, 60000, "Mirmulnir is enabled on the leader and on the server, hosted by a player").then(() => true).catch(() => false);
    const shownOnMember = await ctx.waitFor(() => ctx.drv(`const a = sp.Actor.from(sp.Game.getFormEx(${DRAGON})); return !!a && a.is3DLoaded() && !a.isDisabled();`, 2).catch(() => false), 30000, "Mirmulnir is shown on the member").then(() => true).catch(() => false);
    const alive = { stage1: await mqStage(1), stage2: await mqStage(2), server: await serverRef(DRAGON), member: await memberLog() };
    ctx.evidence.push(`C: both players at the Western Watchtower; the leader set MQ104 to ${MQ104_DRAGON_STAGE} by script: MQ104 stage on the leader ${alive.stage1}, on the member ${alive.stage2}; Mirmulnir on the server ${JSON.stringify(alive.server)} (hoster ${hex(alive.server.hoster)}), shown on the member ${shownOnMember}; the member's MQ104 log ${JSON.stringify(alive.member)}; before: leader ${JSON.stringify(before[1])}, member ${JSON.stringify(before[2])}`);
    if (!enabled) fails.push("C: Mirmulnir is not enabled on the leader and on the server with a player as hoster within 60 s of MQ104 stage 60");
    if (!shownOnMember) fails.push("C: Mirmulnir is not enabled and loaded on the member's client");

    const killedAt = Date.now();
    await ctx.probe(`mp.set(${DRAGON}, "isDead", true); return 0;`);
    const boxes = { 1: 0, 2: 0 };
    const soulStage = await ctx.waitFor(async () => {
      for (const n of [1, 2]) if (await answerBox(n)) boxes[n]++;
      return (await done(SOUL_STAGE, 1)) && (await done(SOUL_STAGE, 2));
    }, 30000, `MQ104 stage ${SOUL_STAGE} is done on both clients`).then(() => true).catch(() => false);
    await ctx.sleep(3000);
    for (const n of [1, 2]) if (await answerBox(n)) boxes[n]++;
    const after = { 1: await souls(1), 2: await souls(2) };
    const soulLines = log().split(/\r?\n/).filter((l) => l.includes(`Coop: dragon ${hex(DRAGON)} gives its soul to`)).map((l) => l.replace(/^.*Coop: /, ""));
    const isDead = (n) => ctx.drv(`const a = sp.Actor.from(sp.Game.getFormEx(${DRAGON})); return !!a && a.isDead();`, n);
    await ctx.waitFor(async () => { for (const n of [1, 2]) if (await answerBox(n)) boxes[n]++; return (await isDead(1)) && (await isDead(2)); }, 30000, "Mirmulnir is dead on both clients").catch(() => {});
    const deadOn = { 1: await isDead(1), 2: await isDead(2) };
    ctx.evidence.push(`D: the server killed Mirmulnir; ${((Date.now() - killedAt) / 1000).toFixed(1)} s later: MQ104 stage on the leader ${await mqStage(1)}, on the member ${await mqStage(2)} (90 done on both ${soulStage}); dead on the leader ${deadOn[1]}, on the member ${deadOn[2]} (waited up to 30 s more); message boxes answered: leader ${boxes[1]}, member ${boxes[2]}; leader ${JSON.stringify(before[1])} -> ${JSON.stringify(after[1])}; member ${JSON.stringify(before[2])} -> ${JSON.stringify(after[2])}; server soul lines ${JSON.stringify(soulLines)}; the member's MQ104 log ${JSON.stringify(await memberLog())}`);
    if (!soulStage) fails.push("D: MQ104 stage 90 is not done on both clients after Mirmulnir died");
    for (const n of [1, 2]) {
      const who = n === 1 ? "leader" : "member";
      if (!deadOn[n]) fails.push(`D: Mirmulnir is not dead on the ${who}'s client`);
      if (after[n].absorbed - before[n].absorbed !== 1) fails.push(`D: the ${who}'s DragonsAbsorbed went ${before[n].absorbed} -> ${after[n].absorbed} (expected +1)`);
      if (!after[n].fus || before[n].fus) fails.push(`D: the ${who}'s Fus unlocked ${before[n].fus} -> ${after[n].fus} (stage 90 teaches it)`);
    }
    for (const a of [leader, member]) if (!soulLines.includes(`dragon ${hex(DRAGON)} gives its soul to ${hex(a)}`)) fails.push(`D: the server gave no soul to ${hex(a)}`);

    const bLoc = await ctx.npcLocation(BALGRUUF);
    const br = bLoc.rot[2] * Math.PI / 180;
    await moveBoth(bLoc, 200 * Math.sin(br), 200 * Math.cos(br));
    await ctx.waitFor(() => ctx.drv(`const a = sp.Actor.from(sp.Game.getFormEx(${BALGRUUF})); return !sp.Ui.isMenuOpen("Loading Menu") && !!a && a.is3DLoaded();`).catch(() => false), 120000, "Balgruuf is loaded");
    const reward = await talk(BALGRUUF, () => done(REWARD_STAGE), /thane|récompense|reward/i, `MQ104 stage ${REWARD_STAGE} is done`);
    const member160 = await ctx.waitFor(async () => (await done(REWARD_STAGE, 2)) && (await memberLog()).includes(REWARD_STAGE), 30000, "MQ104 160 reaches the member").then(() => true).catch(() => false);
    ctx.evidence.push(`E: Balgruuf: ${reward.picks} topic picks (${reward.topics.map((x) => `"${x}"`).join(", ")}), last line "${reward.last}", message boxes answered at MQ104 stages ${JSON.stringify(reward.dismissed)}; 160 done on the leader ${reward.ok}, on the member's client and log ${member160}`);
    if (!reward.ok) fails.push(`E: MQ104 stage ${REWARD_STAGE} (Balgruuf's reward, Lydia enabled) is not done on the leader`);
    if (!member160) fails.push(`E: MQ104 stage ${REWARD_STAGE} did not reach the member's client and log`);

    const lydiaHere = await ctx.waitFor(() => ctx.drv(`const a = sp.Actor.from(sp.Game.getFormEx(${LYDIA})); return !!a && a.is3DLoaded() && !a.isDisabled();`).catch(() => false), 60000, "Lydia is enabled and loaded on the leader").then(() => true).catch(() => false);
    let memberHosted = false;
    if (lydiaHere) {
      const leaderLoc = await ctx.probe(`return mp.get(${leader}, "locationalData");`);
      await ctx.probe(`mp.set(${leader}, "locationalData", ${JSON.stringify({ cellOrWorldDesc: "3c:Skyrim.esm", pos: SPOT, rot: [0, 0, 0] })}); return 0;`);
      await inWorld(1);
      memberHosted = await ctx.waitFor(async () => (await serverRef(LYDIA)).hoster === member, 60000, "the member hosts Lydia while the leader is away").then(() => true).catch(() => false);
      await ctx.probe(`mp.set(${leader}, "locationalData", ${JSON.stringify(leaderLoc)}); return 0;`);
      await ctx.waitFor(() => ctx.drv(`const a = sp.Actor.from(sp.Game.getFormEx(${LYDIA})); return !sp.Ui.isMenuOpen("Loading Menu") && !!a && a.is3DLoaded();`).catch(() => false), 120000, "Lydia is loaded on the leader again");
      await ctx.sleep(3000);
      ctx.evidence.push(`E: the leader went outside and came back: the member hosted Lydia meanwhile ${memberHosted}; Lydia's server hoster before the talk ${hex((await serverRef(LYDIA)).hoster)}`);
      await ctx.drv(`const a = sp.Actor.from(sp.Game.getFormEx(${LYDIA})); const p = sp.Game.getPlayer(); p.setPosition(a.getPositionX() + 120 * Math.sin(a.getAngleZ() * Math.PI / 180), a.getPositionY() + 120 * Math.cos(a.getAngleZ() * Math.PI / 180), a.getPositionZ() + 10); return 0;`);
      await ctx.sleep(2000);
    }
    const follower = () => ctx.drv(`const a = sp.Actor.from(sp.Game.getFormEx(${LYDIA})); const f = sp.Faction.from(sp.Game.getFormEx(${FOLLOWER_FACTION})); return { teammate: a.isPlayerTeammate(), rank: a.getFactionRank(f) };`);
    const lydiaBefore = lydiaHere ? await follower() : null;
    const follow = lydiaHere ? await talk(LYDIA, async () => { const f = await follower(); return f.teammate && f.rank >= 0; }, /suis|suiv|follow|accompagn/i, "Lydia follows the leader") : { ok: false, picks: 0, topics: [], last: "", dismissed: [] };
    const lydiaAfter = lydiaHere ? await follower() : null;
    await ctx.waitFor(async () => (await serverRef(LYDIA)).hoster === leader, 30000, "the leader hosts Lydia").catch(() => {});
    const lydiaServer = await serverRef(LYDIA);
    const lydiaOnMember = await ctx.drv(`const a = sp.Actor.from(sp.Game.getFormEx(${LYDIA})); return a ? { loaded: a.is3DLoaded(), disabled: a.isDisabled() } : null;`, 2);
    ctx.evidence.push(`E: Lydia enabled and loaded on the leader ${lydiaHere}; before the talk ${JSON.stringify(lydiaBefore)}; ${follow.picks} topic picks (${follow.topics.map((x) => `"${x}"`).join(", ")}), last line "${follow.last}"; after ${JSON.stringify(lydiaAfter)}; server ${JSON.stringify(lydiaServer)} (hoster ${hex(lydiaServer.hoster)}); on the member's client ${JSON.stringify(lydiaOnMember)}`);
    ctx.shot("G2_6-lydia-member", 2);
    if (!lydiaHere) fails.push("E: Lydia is not enabled and loaded on the leader after stage 160");
    if (lydiaHere && !memberHosted) fails.push("E: not exercised: the member never hosted Lydia while the leader was away");
    else if (!follow.ok) fails.push(`E: Lydia is not the leader's follower after the talk (${JSON.stringify(lydiaAfter)})`);
    if (lydiaHere && lydiaBefore && lydiaBefore.teammate) fails.push("E: Lydia was already the leader's teammate before the talk");
    if (lydiaServer.disabled || lydiaServer.hoster !== leader) fails.push(`E: on the server Lydia is disabled ${lydiaServer.disabled}, hoster ${hex(lydiaServer.hoster)} (expected enabled, hosted by the leader)`);
    if (follow.ok) {
      const lydiaPos = (n) => ctx.drv(`const a = sp.Actor.from(sp.Game.getFormEx(${LYDIA})); return [a.getPositionX(), a.getPositionY(), a.getPositionZ()].map(Math.round);`, n);
      const start = { server: (await serverRef(LYDIA)).pos, member: await lydiaPos(2) };
      const from = await ctx.drv(`const p = sp.Game.getPlayer(); return [p.getPositionX(), p.getPositionY(), p.getPositionZ()];`);
      const away = await ctx.drv(`const p = sp.Game.getPlayer(); const r = p.getAngleZ() * Math.PI / 180; const x = p.getPositionX() + 800 * Math.sin(r), y = p.getPositionY() + 800 * Math.cos(r); p.setPosition(x, y, p.getPositionZ() + 10); return [x, y];`);
      const dist2 = (a, b) => Math.round(Math.hypot(a[0] - b[0], a[1] - b[1]));
      const followed = await ctx.waitFor(async () => dist2((await serverRef(LYDIA)).pos, away) < dist2(start.server, away) - 300 && dist2(await lydiaPos(2), away) < dist2(start.member, away) - 300, 20000, "Lydia walks after the leader").then(() => true).catch(() => false);
      const end = { server: (await serverRef(LYDIA)).pos, member: await lydiaPos(2) };
      ctx.evidence.push(`E: the leader moved about 800 units from ${JSON.stringify(from.map(Math.round))} to ${JSON.stringify(away.map(Math.round))}: Lydia on the server ${JSON.stringify(start.server)} -> ${JSON.stringify(end.server)} (${dist2(start.server, away)} -> ${dist2(end.server, away)} from the leader), on the member's client ${JSON.stringify(start.member)} -> ${JSON.stringify(end.member)} (${dist2(start.member, away)} -> ${dist2(end.member, away)})`);
      if (!followed) fails.push("E: Lydia did not walk after the leader on the server and on the member's client within 20 s");
    }

    ctx.assert.ok(!fails.length, fails.join("; "));
  },
};
