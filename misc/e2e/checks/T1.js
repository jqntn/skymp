const BANDIT = 0x1ebf6;
const MENU = "ContainerMenu";
const AWAY = { cellOrWorldDesc: "1a26f:Skyrim.esm", pos: [26691, 1678, -1404], rot: [0, 0, 0] };
const LYING = 40;
const NEAR = 500;

module.exports = {
  engines: 2,
  timeout: 15 * 60000,
  setup: async (ctx) => {
    await ctx.character(1);
    await ctx.character(2);
  },
  async run(ctx) {
    const actors = [await ctx.ready(1), await ctx.ready(2)];
    const hex = (v) => (v >>> 0).toString(16);
    const npc = `const a = sp.Actor.from(sp.Game.getFormEx(${BANDIT}));`;
    const server = () => ctx.probe(`const l = mp.get(${BANDIT}, "locationalData"); return { dead: !!mp.get(${BANDIT}, "isDead"), hoster: mp.get(${BANDIT}, "hoster") || 0, cell: l.cellOrWorldDesc, pos: l.pos };`);
    const loaded = (n) => ctx.waitFor(() => ctx.drv(`${npc} return !sp.Ui.isMenuOpen("Loading Menu") && !!a && a.is3DLoaded();`, n).catch(() => false), 120000, `the bandit is loaded on engine ${n}`);
    const heal = (n) => ctx.probe(`mp.set(${actors[n - 1]}, "percentages", { health: 1, magicka: 1, stamina: 1 }); return 0;`).catch(() => 0);
    const pose = (n) => ctx.drv(`${npc} if (!a || !a.is3DLoaded()) return null; const pl = sp.Game.getPlayer(); pl.setAngle(0, 0, pl.getAngleZ() + pl.getHeadingAngle(a));
      const N = sp.NetImmerse; const z = N.getNodeWorldPositionZ(a, "NPC Pelvis [Pelv]", false);
      return { dead: a.isDead(), hips: z - a.getPositionZ(), pelvis: [N.getNodeWorldPositionX(a, "NPC Pelvis [Pelv]", false), N.getNodeWorldPositionY(a, "NPC Pelvis [Pelv]", false), z], ground: a.getPositionZ(), speed: a.getAnimationVariableFloat("Speed") };`, n);

    await ctx.probe(`mp.set(${actors[0]}, "locationalData", ${JSON.stringify(AWAY)}); return 0;`);
    const loc = await ctx.npcLocation(BANDIT, 2);
    await ctx.probe(`mp.set(${actors[1]}, "locationalData", ${JSON.stringify({ ...loc, pos: [loc.pos[0] + 600, loc.pos[1], loc.pos[2] + 50] })}); return 0;`);
    await loaded(2);
    await ctx.waitFor(() => server().then((s) => s.hoster === actors[1]), 60000, "engine 2 hosts the bandit");
    ctx.assert.ok(!(await server()).dead, "not exercised: the bandit is already dead on the server");

    await ctx.drv(`${npc} a.startCombat(sp.Game.getPlayer()); return 0;`, 2);
    const running = await ctx.waitFor(async () => (await heal(2), ctx.drv(`${npc} return a.getAnimationVariableFloat("Speed") > 150;`, 2)), 15000, "the bandit runs at engine 2's player").then(() => true).catch(() => false);
    await ctx.drv(`${npc} a.kill(sp.Game.getPlayer()); return 0;`, 2);
    await ctx.waitFor(() => server().then((s) => s.dead), 15000, "the server has the bandit dead");
    await ctx.sleep(8000);
    const dead = await server();
    ctx.evidence.push(`the bandit ${running ? "ran" : "did not run"} at engine 2's player before the kill; server: dead ${dead.dead}, hoster ${hex(dead.hoster)}, at ${dead.cell} ${dead.pos.map(Math.round)}; engine 1 away in ${AWAY.cellOrWorldDesc}`);

    await ctx.probe(`mp.set(${actors[0]}, "locationalData", ${JSON.stringify({ cellOrWorldDesc: dead.cell, pos: [dead.pos[0] - 300, dead.pos[1], dead.pos[2] + 50], rot: [0, 0, 0] })}); return 0;`);
    await loaded(1);
    const fails = [];
    for (const wait of [3000, 7000]) {
      await ctx.sleep(wait);
      const p = await pose(1);
      const off = p ? Math.round(Math.hypot(p.pelvis[0] - dead.pos[0], p.pelvis[1] - dead.pos[1])) : null;
      ctx.evidence.push(`engine 1 ${wait === 3000 ? 3 : 10} s after the bandit loaded: ${p ? `dead ${p.dead}, pelvis ${p.hips.toFixed(1)} above the reference, ${off} units from the server's death position, Speed ${p.speed.toFixed(0)}` : "not loaded"}`);
      if (wait !== 3000) {
        if (!p) fails.push("the bandit is not loaded on engine 1 at the corpse");
        else {
          if (!p.dead) fails.push("engine 1 shows the bandit alive");
          if (p.hips > LYING) fails.push(`engine 1 shows the corpse upright: pelvis ${p.hips.toFixed(1)} above its reference (lying is below ${LYING})`);
          if (off > NEAR) fails.push(`engine 1 shows the corpse ${off} units from the server's death position`);
        }
      }
    }
    ctx.shot("T1-corpse", 1);
    await ctx.drv(`${npc} const p = sp.Game.getPlayer(); p.setPosition(a.getPositionX() + 80, a.getPositionY(), a.getPositionZ() + 20); return 0;`, 1);
    await ctx.sleep(1500);
    await ctx.drv(`${npc} a.activate(sp.Game.getPlayer(), false); return 0;`, 1);
    const opened = await ctx.waitFor(() => ctx.drv(`return sp.Ui.isMenuOpen("${MENU}");`, 1), 10000, "the corpse opens on engine 1").then(() => true).catch(() => false);
    ctx.evidence.push(`engine 1 opens the corpse: ${opened}`);
    if (!opened) fails.push("engine 1 cannot loot the corpse");
    else await ctx.drv(`sp.TESModPlatform.closeMenu("${MENU}"); return 0;`, 1).catch(() => 0);
    ctx.assert.ok(!fails.length, fails.join("; "));
  },
};
