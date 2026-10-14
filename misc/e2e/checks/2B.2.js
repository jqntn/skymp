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

module.exports = {
  engines: 2,
  timeout: 20 * 60000,
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
    const gateOpen = await ctx.waitFor(async () => (await anims(GATE, 1)).includes("Open") && (await anims(GATE, 2)).includes("Open") && (await gateZ(1)) >= closedGate[1] + GATE_RISE && (await gateZ(2)) >= closedGate[2] + GATE_RISE, 25000, "the gate opens on both clients").then(() => true).catch(() => false);
    const gate = { server: await stateOf(GATE), 1: await anims(GATE, 1), 2: await anims(GATE, 2), z1: await gateZ(1), z2: await gateZ(2) };
    ctx.evidence.push(`A: engine 2 (member) turned the pillars 1, 2, 3, then 1, 2: server pillar states ${solved.pillars.join(", ")}; engine 2 pulled the lever: gate server state ${gate.server}, gate animation events on engine 1 ${JSON.stringify(gate[1])}, on engine 2 ${JSON.stringify(gate[2])}; gate height on engine 1 ${closedGate[1]} -> ${gate.z1}, on engine 2 ${closedGate[2]} -> ${gate.z2}`);
    const gateDone = gateOpen && await ctx.waitFor(async () => (await stateOf(GATE)) === "waiting", 40000, "the gate's server script returns to waiting").then(() => true).catch(() => false);
    ctx.evidence.push(`A: gate server state after the opening: ${await stateOf(GATE)}`);
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
    if (!doorOpen) fails.push(`B: the claw door did not sink ${DOOR_DROP} units on both clients within 40 s (engine 1 ${closedZ[1]} -> ${door[1]}, engine 2 ${closedZ[2]} -> ${door[2]}, keyhole ${door.keyhole})`);
    if (!stage) fails.push(`B: MS13 did not reach stage ${MS13_DOOR_STAGE} on both engines (engine 1 ${door.ms13[1]}, engine 2 ${door.ms13[2]})`);

    ctx.assert.ok(!fails.length, fails.join("; "));
  },
};
