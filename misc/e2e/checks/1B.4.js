const ALVOR = 0x13482;
const SPAWN = [20837, -45138, -21];

module.exports = {
  gameHour: 8,
  timeout: 10 * 60000,
  setup: async (ctx) => {
    await ctx.character(1, { pos: SPAWN, angleZ: 270, worldOrCell: 0x3c });
  },
  async run(ctx) {
    const actor = await ctx.ready(1);
    const hex = (v) => v.toString(16);
    const round = (p) => p.map(Math.round);
    const npc = `const a = sp.Actor.from(sp.Game.getFormEx(${ALVOR}));`;
    const server = () => ctx.probe(`return { cell: mp.getActorCellOrWorld(${ALVOR}), pos: mp.getActorPos(${ALVOR}), hoster: mp.get(${ALVOR}, "hoster"), disabled: mp.get(${ALVOR}, "isDisabled") };`);
    const localState = () => ctx.drv(`${npc} const c = a.getWorldSpace() || a.getParentCell(); return { loaded: a.is3DLoaded(), disabled: a.isDisabled(), deleted: a.isDeleted(), cell: c ? c.getFormID() : 0, pos: [a.getPositionX(), a.getPositionY(), a.getPositionZ()] };`);
    const replay = () => ctx.probe(`mp.sendCustomPacket(mp.getUserByActor(${actor}), JSON.stringify({ customPacketType: "questApply", entries: [], replay: true })); return 0;`);
    const hold = async (ms, test) => { const end = Date.now() + ms; let s; do { s = await server(); if (!test(s)) return { ok: false, s }; await ctx.sleep(500); } while (Date.now() < end); return { ok: true, s }; };

    const near = await ctx.npcLocation(ALVOR);
    await ctx.probe(`mp.set(${actor}, "locationalData", ${JSON.stringify({ ...near, pos: [near.pos[0] + 200, near.pos[1], near.pos[2] + 50] })}); return 0;`);
    let s = await server();
    const hosted = await ctx.waitFor(async () => { s = await server(); return s.hoster === actor; }, 30000, "the server gives Alvor to the player").catch(() => false);
    ctx.evidence.push(`the player next to Alvor: server ${hex(s.cell)} at ${round(s.pos)}, hoster ${hex(s.hoster)}`);
    ctx.assert.ok(hosted, "the server did not give Alvor to the only player near him");
    const house = parseInt(near.cellOrWorldDesc, 16);
    await ctx.waitFor(() => ctx.drv(`const p = sp.Game.getPlayer(); const c = p.getParentCell(); return !sp.Ui.isMenuOpen("Loading Menu") && p.is3DLoaded() && !!c && c.getFormID() === ${house};`).catch(() => false), 120000, "the player is loaded in Alvor's house");
    const placed = await ctx.waitFor(async () => { const [l, sv] = await Promise.all([localState(), server()]); return l.loaded && l.cell === sv.cell && Math.hypot(l.pos[0] - sv.pos[0], l.pos[1] - sv.pos[1]) < 200; }, 60000, "the player's game has Alvor at the server position").catch(() => false);
    ctx.assert.ok(placed, "the new hoster did not put its copy of Alvor at the server position");

    const beforeReplay = await server();
    const target = [beforeReplay.pos[0] + 300, beforeReplay.pos[1], beforeReplay.pos[2]];
    await replay();
    await ctx.sleep(300);
    const movementGated = { ok: true, s: beforeReplay };
    for (const end = Date.now() + 2000; Date.now() < end && movementGated.ok;) {
      await ctx.drv(`${npc} sp.Debug.sendAnimationEvent(a, "IdleForceDefaultState"); a.translateTo(${target.join(", ")}, a.getAngleX(), a.getAngleY(), a.getAngleZ(), 1200, 0); return 0;`);
      await ctx.sleep(400);
      movementGated.s = await server();
      movementGated.ok = Math.hypot(movementGated.s.pos[0] - beforeReplay.pos[0], movementGated.s.pos[1] - beforeReplay.pos[1]) < 150;
    }
    const pushed = (await localState()).pos;
    const pushedBy = Math.hypot(pushed[0] - beforeReplay.pos[0], pushed[1] - beforeReplay.pos[1]);
    let synced = await server();
    const movementResumed = await ctx.waitFor(async () => { synced = await server(); const l = (await localState()).pos; return Math.hypot(synced.pos[0] - l[0], synced.pos[1] - l[1]) < 100; }, 10000, "the server takes the hosted position after the replay").catch(() => false);
    ctx.evidence.push(`replay, hosted movement: the hoster moved Alvor ${Math.round(pushedBy)} units during a quest replay; server held within 150 units for 2 s: ${movementGated.ok} (last ${round(movementGated.s.pos)}); after the replay the server follows: ${movementResumed} (${round(synced.pos)})`);

    const beforeDisable = await localState();
    await ctx.drv(`${npc} a.disableNoWait(false); return 0;`);
    let gone = await server();
    const reported = await ctx.waitFor(async () => { gone = await server(); return gone.hoster === 0 && gone.disabled === true; }, 15000, "the server disables Alvor at the hoster's report").catch(() => false);
    const stayed = reported ? await hold(6000, (x) => x.hoster === 0 && x.disabled === true) : { ok: false, s: gone };
    ctx.evidence.push(`disable: a script disables Alvor on the hoster: server hoster ${hex(gone.hoster)}, disabled ${gone.disabled}; unchanged after 6 s: ${stayed.ok}; the real actor was never deleted: ${!beforeDisable.deleted}`);

    const replayAt = Date.now();
    await replay();
    await ctx.sleep(300);
    await ctx.drv(`${npc} a.enable(false); return 0;`);
    await ctx.sleep(300);
    const shownAfterEnable = await localState();
    const enableGated = await hold(2300, (x) => x.hoster === 0 && x.disabled === true);
    const log = () => require("fs").readFileSync(require("path").join(ctx.dir, "server.log"), "utf8");
    const rejection = new RegExp(`\\[([0-9-]+) ([0-9:.]+)\\][^\\n]*Rejected host claim on ${hex(ALVOR)} by ${hex(actor)}: disabled during play`);
    const refused = await ctx.waitFor(() => rejection.test(log()), 20000, "the server refuses the report").catch(() => false);
    const firstRejection = refused ? log().match(rejection) : null;
    const rejectedAfter = firstRejection ? new Date(`${firstRejection[1]}T${firstRejection[2]}`).getTime() - replayAt : -1;
    const regained = await server();
    const hiddenAt = Date.now();
    const hidden = refused && await ctx.waitFor(() => localState().then((l) => l.disabled || !l.loaded), 5000, "the client hides the refused Alvor").then(() => true).catch(() => false);
    const after = await localState();
    if (!refused) ctx.evidence.push(`enable: the client did not report Alvor: ${JSON.stringify(await ctx.drv(`${npc} const p = sp.Game.getPlayer(); const h = sp.storage["hosted"]; const c = a.getParentCell(); const pc = p.getParentCell();
      return { hosted: Array.isArray(h) ? h.map((x) => x.toString(16)) : String(h), dead: a.isDead(), disabled: a.isDisabled(), loaded: a.is3DLoaded(), dialogue: a.isInDialogueWithPlayer() || a.getDialogueTarget() !== null, cell: c ? c.getFormID().toString(16) : 0, playerCell: pc ? pc.getFormID().toString(16) : 0, d: Math.round(a.getDistance(p)), ai: a.isAIEnabled(), race: a.getRace() ? a.getRace().getFormID().toString(16) : 0, random: (() => { const seen = new Set(); for (let i = 0; i < 200; i++) { const r = sp.Game.findRandomActor(p.getPositionX(), p.getPositionY(), p.getPositionZ(), 8192); if (r) seen.add(r.getFormID().toString(16)); } return [...seen]; })() };`).catch((e) => String(e)))}`);
    ctx.evidence.push(`enable: a script enables Alvor on the client during a quest replay: server unchanged during the replay: ${enableGated.ok} (last ${JSON.stringify(enableGated.s)}); after it the server refuses the report of an NPC disabled during play: ${refused} (${JSON.stringify(regained)}); the client hides its copy: ${hidden ? `${Date.now() - hiddenAt} ms` : "no"} (local 3D ${after.loaded}, disabled ${after.disabled}, deleted ${after.deleted}); shown after the enable: ${shownAfterEnable.loaded && !shownAfterEnable.disabled}; first rejection ${rejectedAfter} ms after the replay started`);

    ctx.assert.ok(pushedBy > 200, `the hoster did not move Alvor during the quest replay (${Math.round(pushedBy)} units), so the movement gate is not tested`);
    ctx.assert.ok(movementGated.ok, `the hoster sent Alvor's movement during a quest replay (server at ${round(movementGated.s.pos)})`);
    ctx.assert.ok(movementResumed, "the hoster did not send Alvor's movement after the quest replay");
    ctx.assert.ok(!beforeDisable.deleted && !after.deleted, "the client deleted the real actor");
    ctx.assert.ok(reported && stayed.ok, "the server did not keep Alvor disabled and without a hoster after a script disabled him on the hoster");
    ctx.assert.ok(enableGated.ok, `the client reported Alvor during a quest replay (${JSON.stringify(enableGated.s)})`);
    ctx.assert.ok(refused && regained.disabled === true, "the server did not refuse to enable Alvor, whom a script disabled during play");
    ctx.assert.ok(shownAfterEnable.loaded && !shownAfterEnable.disabled, "not exercised: the script enable did not show Alvor on the client");
    ctx.assert.ok(rejectedAfter >= 2500, `the client reported Alvor during the quest replay (first rejection ${rejectedAfter} ms after it started)`);
    ctx.assert.ok(hidden, "the client still shows Alvor 5 s after the server refused to enable him");
  },
};
