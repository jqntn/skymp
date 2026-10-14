const fs = require("fs");
const path = require("path");
const ALVOR = 0x13482;
const WORK_MARKER = 0x2c308;
const SPAWN = [20837, -45138, -21];
const TUTORIAL_BLACKSMITHING = 0x105385;
const APPEARANCE = { isFemale: false, raceId: 0x13746, weight: 50, skinColor: -1, hairColor: -1, headpartIds: [], headTextureSetId: 0, options: new Array(19).fill(0), presets: new Array(4).fill(0), tints: [], name: "E2eLeader" };

module.exports = {
  engines: 2,
  gameHour: 8,
  timeout: 15 * 60000,
  setup: async (ctx) => {
    await ctx.character(1, { pos: SPAWN, angleZ: 270, worldOrCell: 0x3c });
    const member = await ctx.character(2);
    await ctx.probe(`mp.set(${member}, "private.questLog", [[${TUTORIAL_BLACKSMITHING}, 0]]); return 0;`);
    ctx.alvorStart = await ctx.probe(`return { cell: mp.getActorCellOrWorld(${ALVOR}), pos: mp.getActorPos(${ALVOR}), hoster: mp.get(${ALVOR}, "hoster"), disabled: mp.get(${ALVOR}, "isDisabled") };`);
  },
  async run(ctx) {
    const actor = await ctx.ready(1);
    const member = await ctx.ready(2);
    const hex = (v) => v.toString(16);
    const round = (p) => p.map(Math.round);
    const npc = `const a = sp.Actor.from(sp.Game.getFormEx(${ALVOR}));`;
    const server = () => ctx.probe(`return { cell: mp.getActorCellOrWorld(${ALVOR}), pos: mp.getActorPos(${ALVOR}), hoster: mp.get(${ALVOR}, "hoster"), disabled: mp.get(${ALVOR}, "isDisabled") };`);
    const localState = () => ctx.drv(`${npc} const c = a.getParentCell(); return { attached: !!c && c.isAttached(), loaded: a.is3DLoaded(), disabled: a.isDisabled(), deleted: a.isDeleted(), pos: [a.getPositionX(), a.getPositionY(), a.getPositionZ()] };`);
    const marker = await ctx.drv(`const r = sp.ObjectReference.from(sp.Game.getFormEx(${WORK_MARKER})); return [r.getPositionX(), r.getPositionY(), r.getPositionZ()];`);
    const fromMarker = (p) => Math.hypot(p[0] - marker[0], p[1] - marker[1]);
    const atForge = (s) => s.cell === 0x3c && fromMarker(s.pos) < 500;
    const go = async (pos, what, n = 1) => {
      await ctx.probe(`mp.set(${n === 1 ? actor : member}, "locationalData", { cellOrWorldDesc: "3c:Skyrim.esm", pos: ${JSON.stringify(pos)}, rot: [0, 0, 0] }); return 0;`);
      await ctx.waitFor(() => ctx.drv(`const p = sp.Game.getPlayer(); return !sp.Ui.isMenuOpen("Loading Menu") && Math.hypot(p.getPositionX() - ${pos[0]}, p.getPositionY() - ${pos[1]}) < 300;`, n).catch(() => false), 120000, what);
    };
    const replay = () => ctx.probe(`mp.sendCustomPacket(mp.getUserByActor(${actor}), JSON.stringify({ customPacketType: "questApply", entries: [], replay: true })); return 0;`);
    const send = (n, content) => ctx.drv(`sp.mpClientPlugin.send(JSON.stringify({ t: 1, contentJsonDump: ${JSON.stringify(JSON.stringify(content))} }), true); return 0;`, n);
    const hold = async (ms, test) => { const end = Date.now() + ms; let s; do { s = await server(); if (!test(s)) return { ok: false, s }; await ctx.sleep(500); } while (Date.now() < end); return { ok: true, s }; };

    const first = ctx.alvorStart;
    const local = await ctx.drv(`${npc} const w = a.getWorldSpace(); return { world: w ? w.getFormID() : 0, pos: [a.getPositionX(), a.getPositionY(), a.getPositionZ()], loaded: a.is3DLoaded() };`);
    ctx.evidence.push(`at 8:00 the client has Alvor in ${hex(local.world)} at ${round(local.pos)} (3D ${local.loaded}); before the engines start, the server has Alvor in ${hex(first.cell)} at ${round(first.pos)}, hoster ${hex(first.hoster)}`);

    let s = first;
    const claimed = await ctx.waitFor(async () => { s = await server(); return atForge(s) && s.hoster === actor; }, 20000, "the server takes Alvor's position from the client").catch(() => false);
    ctx.evidence.push(`claim without a FormView: server ${hex(s.cell)} at ${round(s.pos)}, ${Math.round(fromMarker(s.pos))} units from the work marker, hoster ${hex(s.hoster)}`);
    ctx.shot("1B_4_claim");

    const forge = (await localState()).pos;
    const cellX = Math.floor(forge[0] / 4096);
    const far = [(cellX + 2) * 4096 + 2048, forge[1], forge[2] + 3000];
    const stale = [(cellX + 1) * 4096 + 2048, forge[1], forge[2]];
    await ctx.drv(`sp.Game.setGameSettingFloat("fJumpFallHeightMin", 1000000); return 0;`);

    await go(far, "the player is two cells east of Alvor");
    await ctx.sleep(4000);
    const awayState = await server();
    const atFar = await localState();
    ctx.evidence.push(`hide: the player went two cells east of Alvor (${round(forge)}): server hoster ${hex(awayState.hoster)}; Alvor's cell attached ${atFar.attached}, Alvor 3D ${atFar.loaded}, hidden ${atFar.disabled}`);

    await ctx.probe(`mp.set(${ALVOR}, "locationalData", { cellOrWorldDesc: "${hex(first.cell)}:Skyrim.esm", pos: ${JSON.stringify(first.pos)}, rot: [0, 0, 0] }); return 0;`);
    await go(SPAWN, "the player is back at the forge");
    let retry = await server();
    const reclaimed = await ctx.waitFor(async () => { retry = await server(); return atForge(retry) && retry.hoster === actor; }, 20000, "the client claims the hidden Alvor again").catch(() => false);
    let afterRetry = await localState();
    const claimedAt = Date.now();
    const shown = reclaimed && await ctx.waitFor(async () => { afterRetry = await localState(); return afterRetry.loaded && !afterRetry.disabled; }, 5000, "the client shows Alvor after the claim").catch(() => false);
    ctx.evidence.push(`retry: the server moved Alvor back to ${hex(first.cell)} while he was hidden; back at the forge the server has ${hex(retry.cell)} at ${round(retry.pos)}, ${Math.round(fromMarker(retry.pos))} units from the marker, hoster ${hex(retry.hoster)}; local Alvor 3D ${afterRetry.loaded}, disabled ${afterRetry.disabled} (${Date.now() - claimedAt} ms after the claim)`);

    await go(far, "the player is two cells east of Alvor again");
    await ctx.waitFor(() => ctx.drv(`${npc} return a.isDisabled() || !a.getParentCell().isAttached();`).catch(() => false), 15000, "Alvor is hidden again").catch(() => false);
    await ctx.drv(`${npc} a.enable(false); return 0;`);
    const shownFar = await ctx.waitFor(() => ctx.drv(`${npc} return a.is3DLoaded() && !a.isDisabled();`).catch(() => false), 20000, "Alvor is loaded two cells away, as for a player who never hosted him").catch(() => false);
    const unclaimedFar = await hold(6000, (x) => x.hoster === 0);
    await ctx.drv(`globalThis.e2eNearStale = 1e9; globalThis.e2eStaleHandle = sp.on("update", () => { ${npc} if (a) globalThis.e2eNearStale = Math.min(globalThis.e2eNearStale, Math.hypot(a.getPositionX() - ${stale[0]}, a.getPositionY() - ${stale[1]})); }); return 0;`);
    await ctx.probe(`mp.set(${ALVOR}, "locationalData", { cellOrWorldDesc: "3c:Skyrim.esm", pos: ${JSON.stringify(stale)}, rot: [0, 0, 0] }); return 0;`);
    await ctx.sleep(6000);
    const streamed = await ctx.drv(`${npc} return { loaded: a.is3DLoaded(), disabled: a.isDisabled(), near: globalThis.e2eNearStale };`);
    await go(SPAWN, "the player is back at the forge");
    let back = await server();
    const kept = await ctx.waitFor(async () => { back = await server(); return atForge(back) && back.hoster === actor; }, 6000, "the server takes Alvor's local position over its stale one").catch(() => false);
    const nearStale = await ctx.drv(`sp.unsubscribe(globalThis.e2eStaleHandle); return globalThis.e2eNearStale;`);
    ctx.evidence.push(`walk-in: the driver enabled the hidden Alvor two cells away (a player who never hosted him): loaded ${shownFar}; server hoster held at 0 for 6 s: ${unclaimedFar.ok}`);
    ctx.evidence.push(`first movement: the server then streamed a stale Alvor ${Math.round(fromMarker(stale))} units from the marker; 6 s later the local Alvor was 3D ${streamed.loaded}, disabled ${streamed.disabled}, at least ${Math.round(streamed.near)} units from the stale spot; back home: at least ${Math.round(nearStale)} units from it; server ${hex(back.cell)} at ${round(back.pos)}, ${Math.round(fromMarker(back.pos))} units from the marker, hoster ${hex(back.hoster)}`);

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
    ctx.evidence.push(`replay, hosted movement: a quest replay starts, then the hoster takes Alvor out of his furniture and translates him 300 units (every 400 ms): ${Math.round(pushedBy)} units from the server position at the end of the hold (${round(pushed)}); server position held within 150 units of ${round(beforeReplay.pos)} for 2 s: ${movementGated.ok} (last ${round(movementGated.s.pos)}); after the replay the server follows the local position: ${movementResumed} (${round(synced.pos)})`);

    const beforeDisable = await localState();
    await ctx.drv(`${npc} a.disableNoWait(false); return 0;`);
    let gone = back;
    const released = await ctx.waitFor(async () => { gone = await server(); return gone.hoster === 0 && gone.disabled === true; }, 15000, "the hoster releases the disabled Alvor").catch(() => false);
    const stayedReleased = released ? await hold(6000, (x) => x.hoster === 0) : { ok: false, s: gone };
    ctx.evidence.push(`release: a script disables Alvor on the hoster: server hoster ${hex(gone.hoster)}, disabled ${gone.disabled}; hoster still 0 after 6 s: ${stayedReleased.ok}; the real actor was never deleted: ${!beforeDisable.deleted}`);

    await replay();
    await ctx.sleep(300);
    await ctx.drv(`${npc} a.enable(false); return 0;`);
    const claimGated = await hold(2300, (x) => x.hoster === 0);
    let regained = await server();
    const claimResumed = await ctx.waitFor(async () => { regained = await server(); return regained.hoster === actor; }, 20000, "the client claims Alvor after the replay").catch(() => false);
    const afterClaim = await localState();
    ctx.evidence.push(`replay, claim: a quest replay starts, then a script enables Alvor on the client: hoster held at 0 during the replay: ${claimGated.ok} (last ${hex(claimGated.s.hoster)}); after the replay the client claims him: ${claimResumed} (hoster ${hex(regained.hoster)}, server disabled ${regained.disabled}; local 3D ${afterClaim.loaded}, disabled ${afterClaim.disabled})`);

    await ctx.probe(`mp.set(${actor}, "appearance", ${JSON.stringify(APPEARANCE)}); return 0;`);
    await go([SPAWN[0] - 300, SPAWN[1], SPAWN[2]], "the member comes to the forge", 2);
    const tracked = await ctx.drv(`return sp.getReferenceAliasQuests(${ALVOR});`, 2);
    await send(1, { customPacketType: "partyInvite", target: member });
    await ctx.sleep(1500);
    await send(2, { customPacketType: "partyAccept", inviter: actor });
    const joined = await ctx.waitFor(() => fs.readFileSync(path.join(ctx.dir, "server.log"), "utf8").includes(`Coop: ${hex(member)} joined party`), 15000, "the member joins the party").catch(() => false);
    await go(far, "the leader is two cells east of Alvor");
    let alone = await server();
    const memberHosts = await ctx.waitFor(async () => { alone = await server(); return alone.hoster === member; }, 30000, "the member hosts Alvor while the leader is away").catch(() => false);
    await go(SPAWN, "the leader is back at the forge");
    let yielded = await server();
    const leaderHosts = await ctx.waitFor(async () => { yielded = await server(); return yielded.hoster === actor; }, 25000, "the member yields Alvor to the leader").catch(() => false);
    const leaderKeeps = leaderHosts ? await hold(12000, (x) => x.hoster === actor) : { ok: false, s: yielded };
    ctx.evidence.push(`party: Alvor's alias quests on the member ${tracked.map(hex)}, member quest log [${hex(TUTORIAL_BLACKSMITHING)}, 0]; joined: ${joined}; leader two cells away: hoster ${hex(alone.hoster)} (member ${hex(member)}): ${memberHosts}; leader back within 4096: hoster ${hex(yielded.hoster)} (leader ${hex(actor)}): ${leaderHosts}; the leader still hosts 12 s later: ${leaderKeeps.ok} (last ${hex(leaderKeeps.s.hoster)})`);

    ctx.assert.ok(local.world === 0x3c && local.loaded, "the client does not have Alvor loaded outdoors at 8:00");
    ctx.assert.ok(!atForge(first), "the server already had Alvor at the forge, so the claim is not tested");
    ctx.assert.ok(claimed, "the server did not take Alvor's local position and host from the client");
    ctx.assert.ok(atFar.attached, "Alvor's cell is not loaded two cells away, so the walk-in is not tested");
    ctx.assert.equal(awayState.hoster, 0, "the server kept the host after the player left the grid");
    ctx.assert.ok(atFar.disabled, "the client kept a loaded copy of Alvor visible after the server stopped the host and stopped sending him");
    ctx.assert.ok(reclaimed && shown, "the client did not claim and show the hidden Alvor again when the server did not send him");
    ctx.assert.ok(shownFar, "Alvor did not load two cells away, so the first movement of a loaded actor is not tested");
    ctx.assert.ok(unclaimedFar.ok, `the client claimed Alvor from more than 4096 units (hoster ${hex(unclaimedFar.s.hoster)})`);
    ctx.assert.ok(streamed.loaded && !streamed.disabled, "the client hid or unloaded Alvor when the server sent him");
    ctx.assert.ok(nearStale < 1e9, "the frame sampler did not run");
    ctx.assert.ok(nearStale > 500, `the client moved the loaded Alvor to the stale server position (${Math.round(nearStale)} units from it)`);
    ctx.assert.ok(kept, "the server did not take Alvor's local position within 6 s when the client came back");
    ctx.assert.ok(pushedBy > 200, `the hoster did not move Alvor during the quest replay (${Math.round(pushedBy)} units), so the movement gate is not tested`);
    ctx.assert.ok(movementGated.ok, `the hoster sent Alvor's movement during a quest replay (server at ${round(movementGated.s.pos)})`);
    ctx.assert.ok(movementResumed, "the hoster did not send Alvor's movement after the quest replay");
    ctx.assert.ok(!beforeDisable.deleted, "the client deleted the real actor");
    ctx.assert.ok(released, "the client kept hosting Alvor after a script disabled him");
    ctx.assert.ok(stayedReleased.ok, "the client claimed the disabled Alvor again");
    ctx.assert.ok(claimGated.ok, `the client claimed Alvor during a quest replay (hoster ${hex(claimGated.s.hoster)})`);
    ctx.assert.ok(claimResumed, "the client did not claim Alvor after the quest replay");
    ctx.assert.ok(tracked.includes(TUTORIAL_BLACKSMITHING), "Alvor is not an alias of TutorialBlacksmithing on the member, so the party rule is not tested");
    ctx.assert.ok(joined, "the member did not join the party");
    ctx.assert.ok(memberHosts, "the member did not host Alvor while the leader was away");
    ctx.assert.ok(leaderHosts, "the member kept the quest actor Alvor while the party leader was within 4096 units");
    ctx.assert.ok(leaderKeeps.ok, `the member took Alvor back from the leader (hoster ${hex(leaderKeeps.s.hoster)})`);
  },
};
