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
const BOT_PROFILE = 920102;
const MEMBER_SPOT = [5450, -640, -760];

module.exports = {
  engines: 1,
  timeout: 20 * 60000,
  setup: async (ctx) => {
    await ctx.character(1, { pos: [5100, -1150, -760], angleZ: 0, worldOrCell: BFB01 });
  },
  async run(ctx) {
    const leader = await ctx.ready(1);
    const hex = (v) => (v >>> 0).toString(16);
    const log = () => fs.readFileSync(path.join(ctx.dir, "server.log"), "utf8");
    const form = (id) => `{ type: "form", desc: mp.getDescFromId(${id}) }`;
    const stateOf = (id) => ctx.probe(`return mp.callPapyrusFunction("method", "ObjectReference", "GetState", ${form(id)}, []);`);
    const loaded = (id) => ctx.waitFor(() => ctx.drv(`const r = sp.ObjectReference.from(sp.Game.getFormEx(${id})); return !sp.Ui.isMenuOpen("Loading Menu") && !!r && r.is3DLoaded();`).catch(() => false), 120000, `${hex(id)} is loaded on the leader`);
    const leaderActivate = (id) => ctx.drv(`sp.ObjectReference.from(sp.Game.getFormEx(${id})).activate(sp.Game.getPlayer(), false); return 0;`);
    const botActivate = (id) => ctx.probe(`globalThis.g22bot.send({ t: 6, data: { caster: 0x14, target: ${id}, isSecondActivation: false } }); return 0;`);
    const nodeZ = (id, node) => ctx.drv(`return Math.round(sp.NetImmerse.getNodeWorldPositionZ(sp.ObjectReference.from(sp.Game.getFormEx(${id})), "${node}", false));`);
    const activations = (id) => log().split(`ProcessActivate ${hex(id)} `).length - 1;
    const memberLog = () => ctx.probe(`return mp.get(globalThis.g22member, "private.questLog") || [];`);
    const fails = [];

    const member = await ctx.probe(`const bot = mp.createBot(); globalThis.g22bot = bot;
      bot.send({ t: 1, contentJsonDump: JSON.stringify({ customPacketType: "loginWithSkympIo", gameData: { profileId: ${BOT_PROFILE} } }) });
      await new Promise((r) => setTimeout(r, 800));
      const a = mp.getUserActor(bot.getUserId()); globalThis.g22member = a;
      mp.set(a, "locationalData", { cellOrWorldDesc: "${hex(BFB01)}:Skyrim.esm", pos: ${JSON.stringify(MEMBER_SPOT)}, rot: [0, 0, 90] });
      return a;`);
    ctx.assert.ok(member, "the bot member got no actor");
    await loaded(GATE);
    await ctx.drv(`sp.mpClientPlugin.send(JSON.stringify({ t: 1, contentJsonDump: JSON.stringify({ customPacketType: "partyInvite", target: ${member} }) }), true); return 0;`);
    await ctx.sleep(1500);
    await ctx.probe(`globalThis.g22bot.send({ t: 1, contentJsonDump: JSON.stringify({ customPacketType: "partyAccept", inviter: ${leader} }) }); return 0;`);
    const joined = await ctx.waitFor(() => log().includes(`Coop: ${hex(member)} joined party`), 15000, "the bot joins the party").then(() => true).catch(() => false);
    ctx.assert.ok(joined, "the bot member did not join the leader's party");
    await ctx.drv(`const w = globalThis.e2eAnims = {}; w[${GATE}] = []; sp.hooks.sendAnimationEvent.add({ enter(c) { w[${GATE}].push(c.animEventName); }, leave() {} }, ${GATE}, ${GATE}); return 0;`);
    const gateAnims = () => ctx.drv(`return (globalThis.e2eAnims || {})[${GATE}] || [];`);

    const closedGate = await nodeZ(GATE, GATE_NODE);
    const initial = { pillars: await Promise.all(PILLARS.map(stateOf)), gate: await stateOf(GATE) };
    ctx.evidence.push(`A: bot member ${hex(member)} joined leader ${hex(leader)} in Bleak Falls Barrow; server script states: pillars ${initial.pillars.join(", ")}, gate ${initial.gate}; gate node ${GATE_NODE} on the leader ${closedGate}`);
    const leverBefore = activations(LEVER);
    await botActivate(LEVER);
    await ctx.sleep(SETTLE_MS);
    const control = { received: activations(LEVER) - leverBefore, gate: await stateOf(GATE), anims: await gateAnims(), z: await nodeZ(GATE, GATE_NODE) };
    ctx.evidence.push(`A: control, the member pulled the lever before the pillars: lever activations in the server log ${control.received}, gate server state ${control.gate}, gate events on the leader ${JSON.stringify(control.anims)}, gate height ${control.z}`);
    if (!control.received) fails.push("A: the server did not get the member's control pull");
    if (control.anims.length || Math.abs(control.z - closedGate) > 5) fails.push("A: the gate moved when the member pulled the lever before solving the pillars");
    for (const wave of [PILLARS, PILLARS.slice(0, 2)]) {
      for (const p of wave) await botActivate(p);
      await ctx.sleep(SETTLE_MS);
    }
    const solved = { pillars: await Promise.all(PILLARS.map(stateOf)) };
    await botActivate(LEVER);
    const busy = await ctx.waitFor(async () => (await stateOf(GATE)) !== "waiting", 15000, "the gate's server script leaves waiting").then(() => stateOf(GATE)).catch(() => null);
    const gateOpen = await ctx.waitFor(async () => (await gateAnims()).includes("Open") && (await nodeZ(GATE, GATE_NODE)) >= closedGate + GATE_RISE, 25000, "the gate opens on the leader").then(() => true).catch(() => false);
    const gate = { anims: await gateAnims(), z: await nodeZ(GATE, GATE_NODE) };
    const gateDone = !!busy && await ctx.waitFor(async () => (await stateOf(GATE)) === "waiting", 40000, "the gate's server script returns to waiting").then(() => true).catch(() => false);
    ctx.evidence.push(`A: the member turned the pillars 1, 2, 3, then 1, 2 (bot activations to the server): server pillar states ${initial.pillars.join(", ")} -> ${solved.pillars.join(", ")}; the member pulled the lever: gate events on the leader ${JSON.stringify(gate.anims)}, gate height ${closedGate} -> ${gate.z}; gate server script after the pull: ${busy || "stayed waiting"}, then back to waiting ${gateDone}`);
    if (!gateOpen) fails.push(`A: the gate did not open on the leader after the member solved the pillars and pulled the lever (events ${JSON.stringify(gate.anims)}, height ${closedGate} -> ${gate.z})`);
    if (!busy) fails.push("A: the gate's server script never left waiting after the member's lever pull");
    else if (!gateDone) fails.push(`A: the gate's server script stayed ${busy} and did not return to waiting within 40 s`);

    await ctx.probe(`mp.callPapyrusFunction("method", "ObjectReference", "AddItem", ${form(leader)}, [mp.callPapyrusFunction("global", "Game", "GetFormEx", null, [${CLAW}]), 1, true]); return 0;`);
    for (const [a, dx] of [[leader, -60], [member, 60]]) {
      await ctx.probe(`mp.set(${a}, "locationalData", { cellOrWorldDesc: "${hex(BFB02)}:Skyrim.esm", pos: [${128 + dx}, -470, -250], rot: [0, 0, 0] }); return 0;`);
    }
    await loaded(DOOR);
    await ctx.waitFor(() => ctx.drv(`return sp.Game.getPlayer().getItemCount(sp.Game.getFormEx(${CLAW}));`).then((c) => c === 1), 15000, "the leader has the claw").catch(() => {});
    for (let wave = 0; wave < 2; wave++) {
      for (const r of Object.values(RINGS)) await leaderActivate(r);
      await ctx.sleep(SETTLE_MS);
    }
    const rings = Object.fromEntries(await Promise.all(Object.entries(RINGS).map(async ([k, id]) => [k, await stateOf(id)])));
    const closedDoor = await nodeZ(DOOR, DOOR_NODE);
    await leaderActivate(KEYHOLE);
    const doorOpen = await ctx.waitFor(async () => (await nodeZ(DOOR, DOOR_NODE)) <= closedDoor - DOOR_DROP, 40000, "the claw door sinks on the leader").then(() => true).catch(() => false);
    const stage = () => ctx.drv(`return sp.Quest.from(sp.Game.getFormEx(${MS13})).getCurrentStageID();`);
    const leaderStage = await ctx.waitFor(async () => (await stage()) >= MS13_DOOR_STAGE, 15000, `MS13 reaches ${MS13_DOOR_STAGE} on the leader`).then(() => true).catch(() => false);
    const relayed = await ctx.waitFor(async () => (await memberLog()).some(([q, s]) => q === MS13 && s >= MS13_DOOR_STAGE), 15000, `the member's log has MS13 ${MS13_DOOR_STAGE}`).then(() => true).catch(() => false);
    const door = { keyhole: await stateOf(KEYHOLE), z: await nodeZ(DOOR, DOOR_NODE), stage: await stage(), member: (await memberLog()).filter(([q]) => q === MS13).map(([, s]) => s) };
    ctx.evidence.push(`B: the leader, given the claw by the server, turned each ring twice: server ring states ${JSON.stringify(rings)}; used the keyhole: keyhole server state ${door.keyhole}, door node ${DOOR_NODE} on the leader ${closedDoor} -> ${door.z}; MS13 on the leader ${door.stage}, in the member's server quest log ${JSON.stringify(door.member)}`);
    ctx.shot("G2_2-clawdoor");
    if (!doorOpen) fails.push(`B: the claw door did not sink ${DOOR_DROP} units on the leader within 40 s (${closedDoor} -> ${door.z}, keyhole ${door.keyhole})`);
    if (!leaderStage) fails.push(`B: MS13 did not reach ${MS13_DOOR_STAGE} on the leader (${door.stage})`);
    if (!relayed) fails.push(`B: the member's server quest log has no MS13 ${MS13_DOOR_STAGE} (${JSON.stringify(door.member)})`);

    ctx.assert.ok(!fails.length, fails.join("; "));
  },
};
