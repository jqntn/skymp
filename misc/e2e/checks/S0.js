const playerState = `const p = sp.Game.getPlayer(); const w = p.getWorldSpace(); const c = p.getParentCell();
return { pos: [p.getPositionX(), p.getPositionY(), p.getPositionZ()], worldOrCell: w ? w.getFormID() : c.getFormID(), raceMenu: sp.Ui.isMenuOpen("RaceSex Menu") };`;

const dist = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));

module.exports = {
  engines: 1,
  timeout: 420000,
  setup: (ctx) => ctx.character(1),
  async run(ctx) {
    const actor = await ctx.ready(1);
    const serverPos = () => ctx.probe(`return { pos: mp.getActorPos(${actor}), worldOrCell: mp.getActorCellOrWorld(${actor}) };`);
    const start = await ctx.drv(playerState);
    const serverStart = await serverPos();
    await ctx.drv(`const p = sp.Game.getPlayer(); p.setPosition(p.getPositionX() + 300, p.getPositionY() + 200, p.getPositionZ() + 50); return 0;`);
    await ctx.sleep(3000);

    let client;
    let server;
    let d = Infinity;
    await ctx.waitFor(async () => {
      client = await ctx.drv(playerState);
      server = await serverPos();
      d = dist(client.pos, server.pos);
      return d <= 64 && client.worldOrCell === server.worldOrCell;
    }, 15000, "server position within 64 units of the client").catch(() => {});
    ctx.shot("S0");

    const moved = dist(client.pos, start.pos);
    const serverMoved = dist(server.pos, serverStart.pos);
    ctx.evidence.push(`actor ${actor.toString(16)}, RaceMenu open: ${client.raceMenu}`);
    ctx.evidence.push(`client moved ${moved.toFixed(0)} units from ${start.pos.map(Math.round)}, server moved ${serverMoved.toFixed(0)} units from ${serverStart.pos.map(Math.round)}`);
    ctx.evidence.push(`client ${client.pos.map(Math.round)} in ${client.worldOrCell.toString(16)}, server ${server.pos.map(Math.round)} in ${server.worldOrCell.toString(16)}, distance ${d.toFixed(1)}`);
    ctx.assert.ok(!client.raceMenu, "RaceMenu is open");
    ctx.assert.ok(moved > 150, `the player did not move (${moved.toFixed(0)} units)`);
    ctx.assert.ok(serverMoved > 150, `the server position did not follow the move (${serverMoved.toFixed(0)} units)`);
    ctx.assert.equal(server.worldOrCell, client.worldOrCell, "cell or world differs");
    ctx.assert.ok(d <= 64, `server position is ${d.toFixed(1)} units from the client`);
    ctx.assert.equal(ctx.shots.length, 1, "no screenshot");
  },
};
