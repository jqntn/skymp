const ALVOR = 0x13482;
const WORK_MARKER = 0x2c308;
const SPAWN = [20837, -45138, -21];
const RADIUS = 500;
const HOLD_MS = 5000;

module.exports = {
  engines: 1,
  gameHour: 8,
  timeout: 6 * 60000,
  setup: (ctx) => ctx.character(1, { pos: SPAWN, angleZ: 270, worldOrCell: 0x3c }),
  async run(ctx) {
    await ctx.ready(1);
    const hour = await ctx.drv(`return sp.GlobalVariable.from(sp.Game.getFormEx(0x38)).getValue();`);
    const forge = await ctx.drv(`const r = sp.ObjectReference.from(sp.Game.getFormEx(${WORK_MARKER}));
      return r ? { id: r.getFormID(), name: "RiverwoodBlacksmithWorkMarker", pos: [r.getPositionX(), r.getPositionY(), r.getPositionZ()] } : null;`);
    ctx.assert.ok(forge, "RiverwoodBlacksmithWorkMarker is not loaded");
    const read = () => ctx.drv(`const a = sp.Actor.from(sp.Game.getFormEx(${ALVOR})); const w = a.getWorldSpace(); const c = a.getParentCell();
      return { world: w ? w.getFormID() : 0, cell: c ? c.getFormID() : 0, pos: [a.getPositionX(), a.getPositionY(), a.getPositionZ()], loaded: a.is3DLoaded(), enabled: !a.isDisabled() };`);
    const atForge = (s) => s.world === 0x3c && s.loaded && s.enabled && Math.hypot(s.pos[0] - forge.pos[0], s.pos[1] - forge.pos[1]) < RADIUS;
    const where = (s) => `${s.world ? `world ${s.world.toString(16)}` : `cell ${s.cell.toString(16)}`} at ${s.pos.map(Math.round)}, ${Math.round(Math.hypot(s.pos[0] - forge.pos[0], s.pos[1] - forge.pos[1]))} units from the forge, 3D loaded ${s.loaded}, enabled ${s.enabled}`;
    let st;
    const t0 = Date.now();
    await ctx.waitFor(async () => atForge(st = await read()), 60000, "Alvor at the forge").catch(() => {});
    const first = st;
    const waited = Date.now() - t0;
    const server = await ctx.probe(`return { cell: mp.getActorCellOrWorld(${ALVOR}), pos: mp.getActorPos(${ALVOR}) };`);
    ctx.evidence.push(`game hour ${hour.toFixed(2)}; ${forge.name} ${forge.id.toString(16)} at ${forge.pos.map(Math.round)}; client after ${waited} ms: Alvor in ${where(first)}; server: ${server.cell.toString(16)} at ${server.pos.map(Math.round)}`);
    ctx.shot("S1_3");
    if (!atForge(first) && server.cell !== 0x3c) throw new ctx.Accepted(`the server has Alvor in cell ${server.cell.toString(16)}, his house, where nobody is: an NPC pauses while no player is near (user decisions 2026-10-12 and 2026-10-23)`);
    ctx.assert.ok(atForge(first), `Alvor is not at the forge ${waited} ms after the player arrived: ${where(first)}`);
    await ctx.sleep(HOLD_MS);
    const later = await read();
    ctx.evidence.push(`${HOLD_MS} ms later: Alvor in ${where(later)}`);
    ctx.assert.ok(atForge(later), `Alvor left the forge area within ${HOLD_MS} ms: ${where(later)}`);
  },
};
