const fs = require("fs");
const path = require("path");

const GAME = fs.readFileSync(path.join(__dirname, "..", "..", "..", "build", "CMakeCache.txt"), "utf8").match(/^SKYRIM_DIR:\w+=(.*)$/m)[1].trim();
const BFB01 = "371de:Skyrim.esm";
const BFB02 = "371dd:Skyrim.esm";
const PILLARS = [0xaa8cb, 0xaa8cc, 0xaa8cd];
const LEVER = 0xaa8c3;
const GATE = 0x3b9f1;
const DARTS = [0x39fdd, 0x3720f, 0x2ad49, 0x2ad43];
const RINGS = { large: 0x4e2ba, medium: 0x4e2bb, small: 0x4e2bc };
const KEYHOLE = 0x4e2b9;
const DOOR = 0x4e2b8;
const GOLDEN_CLAW = 0x39647;
const BUSY_MS = 16500;

module.exports = {
  timeout: 8 * 60000,
  settings: { logLevel: "trace", archives: [path.join(GAME, "Data", "Skyrim - Misc.bsa")] },
  async run(ctx) {
    const log = () => fs.readFileSync(path.join(ctx.dir, "server.log"), "utf8");
    const since = (mark) => log().slice(mark);
    const form = (id) => `{ type: "form", desc: mp.getDescFromId(${id}) }`;
    const moveBot = (cell, pos) => ctx.probe(`mp.set(globalThis.s2actor, "locationalData", { cellOrWorldDesc: "${cell}", pos: ${JSON.stringify(pos)}, rot: [0, 0, 0] }); return 0;`);
    const activate = (id) => ctx.probe(`mp.callPapyrusFunction("method", "ObjectReference", "Activate", ${form(id)}, [${form("globalThis.s2actor")}, false]); return 0;`);
    const stateOf = (id) => ctx.probe(`return mp.callPapyrusFunction("method", "ObjectReference", "GetState", ${form(id)}, []);`);
    const hex = (id) => id.toString(16);

    const actor = await ctx.probe(`const bot = mp.createBot(); globalThis.s2bot = bot;
      bot.send({ t: 1, contentJsonDump: JSON.stringify({ customPacketType: "loginWithSkympIo", gameData: { profileId: 930001 } }) });
      await new Promise((r) => setTimeout(r, 800));
      return globalThis.s2actor = mp.getUserActor(bot.getUserId());`);
    ctx.assert.ok(actor, "the bot got no actor");
    await moveBot(BFB01, [5300, -800, -760]);
    await ctx.sleep(2000);
    const initial = await Promise.all(PILLARS.map(stateOf));
    ctx.evidence.push(`bot actor ${hex(actor)} in BleakFallsBarrow01; pillar states ${initial.join(", ")}`);

    let mark = log().length;
    await activate(LEVER);
    await ctx.sleep(3000);
    const control = since(mark);
    const dartsFired = DARTS.filter((d) => control.includes(`SendPapyrusEvent ${hex(d)} - OnActivate`));
    const gateBefore = control.includes(`form ${hex(GATE)} Opening`);
    ctx.evidence.push(`control, lever before the pillars are solved: dart traps activated ${dartsFired.map(hex).join(", ") || "none"}, gate opening ${gateBefore}`);
    ctx.assert.equal(dartsFired.length, DARTS.length, "the unsolved lever did not fire the dart traps");
    ctx.assert.ok(!gateBefore, "the gate opened before the pillars were solved");

    mark = log().length;
    for (const wave of [PILLARS, PILLARS.slice(0, 2)]) {
      for (const p of wave) await activate(p);
      await ctx.sleep(BUSY_MS);
    }
    const pillars = await Promise.all(PILLARS.map(stateOf));
    const solved = [...since(mark).matchAll(/propset propName=\[Identifier 'numPillarsSolved'\] object=\[Object 'form aa8c3'\] result=\[Integer '(\d+)'\]/g)].map((m) => +m[1]);
    ctx.evidence.push(`pillars after 2 and 2 and 1 turns: ${pillars.join(", ")}; the lever counted ${solved.join(" -> ")} solved pillars`);
    mark = log().length;
    await activate(LEVER);
    await ctx.waitFor(() => since(mark).includes(`form ${hex(GATE)} Opened`), 25000, "the gate opens").catch(() => {});
    const opening = since(mark);
    const gateOpened = opening.includes(`form ${hex(GATE)} Opened`);
    const dartsAgain = DARTS.filter((d) => opening.includes(`SendPapyrusEvent ${hex(d)} - OnActivate`));
    const missing = [...new Set([...opening.matchAll(/Method not found - '(\w+)'/g)].map((m) => m[1]))];
    ctx.evidence.push(`lever after the solve: gate ${hex(GATE)} script logged Opened ${gateOpened}, dart traps ${dartsAgain.map(hex).join(", ") || "none"}, missing natives ${missing.join(", ") || "none"}`);
    ctx.assert.ok(gateOpened, "the gate did not open after the pillars were solved");
    ctx.assert.equal(dartsAgain.length, 0, "the solved lever fired dart traps");

    await moveBot(BFB02, [128, -470, -256]);
    await ctx.sleep(2000);
    await ctx.probe(`const claw = mp.callPapyrusFunction("global", "Game", "GetFormEx", null, [${GOLDEN_CLAW}]);
      mp.callPapyrusFunction("method", "ObjectReference", "AddItem", ${form("globalThis.s2actor")}, [claw, 1, true]); return 0;`);
    const hasClaw = await ctx.probe(`return mp.get(globalThis.s2actor, "inventory").entries.some((e) => e.baseId === ${GOLDEN_CLAW});`);
    ctx.assert.ok(hasClaw, "the bot has no Golden Claw");
    mark = log().length;
    await activate(KEYHOLE);
    await ctx.sleep(3000);
    const early = since(mark);
    const earlyState = await stateOf(KEYHOLE);
    const earlyDoor = early.includes(`callmethod object=[Object 'form ${hex(DOOR)}'] funcName=playAnimation`);
    ctx.evidence.push(`control, keyhole before the rings are solved: keyhole state ${earlyState}, door animated ${earlyDoor}`);
    ctx.assert.ok(earlyState !== "done" && !earlyDoor, "the claw door opened before the rings were solved");
    await ctx.sleep(BUSY_MS);
    for (let wave = 0; wave < 2; wave++) {
      for (const r of Object.values(RINGS)) await activate(r);
      await ctx.sleep(BUSY_MS);
    }
    const rings = Object.fromEntries(await Promise.all(Object.entries(RINGS).map(async ([k, id]) => [k, await stateOf(id)])));
    mark = log().length;
    await activate(KEYHOLE);
    await ctx.waitFor(async () => (await stateOf(KEYHOLE)) === "done", 20000, "the keyhole is done").catch(() => {});
    const keyhole = await stateOf(KEYHOLE);
    const opened = since(mark);
    const doorAnim = opened.includes(`callmethod object=[Object 'form ${hex(DOOR)}'] funcName=playAnimation`);
    const missing2 = [...new Set([...opened.matchAll(/Method not found - '(\w+)'/g)].map((m) => m[1]))];
    ctx.evidence.push(`claw door: rings ${JSON.stringify(rings)} after 2 turns each, keyhole state ${keyhole}, door ${hex(DOOR)} animated ${doorAnim}, missing natives ${missing2.join(", ") || "none"}`);
    ctx.assert.deepEqual(rings, { large: "position02", medium: "position03", small: "position01" }, "the rings are not at the solve positions");
    ctx.assert.equal(keyhole, "done", "the keyhole did not open the claw door");
    ctx.assert.ok(doorAnim, "the claw door did not animate");
  },
};
