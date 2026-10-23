const fs = require("fs");
const path = require("path");

const BANDIT = 0x1ebf6;
const INITIALLY_DISABLED = 0x215d7;
const IRON_SWORD = 0x12eb7;
const GOLD = 0xf;
const INTERIOR = 0x165a8;
const BOT_PROFILE = 920401;

module.exports = {
  engines: 0,
  timeout: 5 * 60000,
  async run(ctx) {
    const hex = (v) => (v >>> 0).toString(16);
    const log = () => fs.readFileSync(path.join(ctx.dir, "server.log"), "utf8").split(/\r?\n/);
    const count = (re) => log().filter((l) => re.test(l)).length;
    const [claimer, player] = await ctx.probe(`const bots = [mp.createBot(), mp.createBot()]; globalThis.p4bots = bots;
      bots.forEach((b, i) => b.send({ t: 1, contentJsonDump: JSON.stringify({ customPacketType: "loginWithSkympIo", gameData: { profileId: ${BOT_PROFILE} + i } }) }));
      const actorOf = (b) => { try { return mp.getUserActor(b.getUserId()); } catch (e) { return 0; } };
      for (let i = 0; i < 100 && !bots.every(actorOf); i++) await new Promise((r) => setTimeout(r, 100));
      return bots.map(actorOf);`);
    ctx.assert.ok(claimer && player, "not exercised: the bots got no actors");
    const users = await ctx.probe(`return globalThis.p4bots.map((b) => b.getUserId());`);
    const loc = await ctx.probe(`return mp.get(${BANDIT}, "locationalData");`);
    const world = parseInt(loc.cellOrWorldDesc.split(":")[0], 16);
    const at = (dx) => ({ ...loc, pos: [loc.pos[0] + dx, loc.pos[1], loc.pos[2]] });
    const place = (actor, dx) => ctx.probe(`mp.set(${actor}, "locationalData", ${JSON.stringify(at(dx))}); return 0;`);
    const send = (bot, msg) => ctx.probe(`globalThis.p4bots[${bot}].send(${JSON.stringify(msg)}); return 0;`);
    const custom = (bot, content) => send(bot, { t: 1, contentJsonDump: JSON.stringify(content) });
    const grants = () => count(new RegExp(`Hoster changed from \\w+ to ${hex(claimer)}`));
    const state = async () => ({ grants: grants(), ...(await serverState()) });
    const serverState = () => ctx.probe(`const r = (id) => { const l = mp.get(id, "locationalData"); return { hoster: mp.get(id, "hoster") || 0, cell: l.cellOrWorldDesc, pos: l.pos.map(Math.round), disabled: !!mp.get(id, "isDisabled") }; };
      const items = (mp.get(${claimer}, "inventory") || {}).entries || []; const n = (b) => items.filter((e) => e.baseId === b).reduce((s, e) => s + e.count, 0);
      return { bandit: r(${BANDIT}), player: r(${player}), sword: n(${IRON_SWORD}), gold: n(${GOLD}) };`);
    const fails = [];
    const expect = async (label, re, times, packet, unchanged) => {
      const before = count(re);
      const s0 = await state();
      for (let i = 0; i < times; i++) await packet();
      await ctx.waitFor(() => count(re) - before >= times, 5000, label).catch(() => 0);
      await ctx.sleep(500);
      const logged = count(re) - before;
      const s1 = await state();
      const changed = unchanged.filter((k) => JSON.stringify(k(s0)) !== JSON.stringify(k(s1)));
      ctx.evidence.push(`${label}: ${times} packet(s), ${logged} matching log line(s)${changed.length ? `, state changed ${JSON.stringify(s0)} -> ${JSON.stringify(s1)}` : ""}`);
      if (logged !== times) fails.push(`${label}: ${logged} matching log lines for ${times} packet(s) (${re})`);
      if (changed.length) fails.push(`${label}: the packet changed the server state (${JSON.stringify(s0)} -> ${JSON.stringify(s1)})`);
    };
    const claim = (target, worldOrCell, pos) => () => send(0, { t: 14, remoteId: target, ...(worldOrCell === undefined ? {} : { worldOrCell, pos, rot: [0, 0, 0] }) });
    const rejected = (target, reason) => new RegExp(`Rejected host claim on ${hex(target)} by ${hex(claimer)}: ${reason}`);
    const bandit = (s) => [s.bandit, s.grants];
    const playerState = (s) => [s.player, s.grants];

    await place(claimer, 300);
    await place(player, -300);
    await ctx.sleep(1000);
    const s = await state();
    ctx.evidence.push(`claimer ${hex(claimer)} and player ${hex(player)} (users ${users}) 300 units from the bandit ${hex(BANDIT)} in ${loc.cellOrWorldDesc}; bandit ${JSON.stringify(s.bandit)}`);
    ctx.assert.ok(s.bandit.hoster === 0, `not exercised: the bandit is hosted by ${hex(s.bandit.hoster)}`);

    await expect("claim from the wrong cell", rejected(BANDIT, "the claimer is in another cell"), 1, claim(BANDIT, INTERIOR, at(300).pos), [bandit]);
    await expect("claim from too far", rejected(BANDIT, "the position is missing, not finite, or more than 4096"), 1, claim(BANDIT, world, at(5300).pos), [bandit]);
    await expect("claim on the actor of a player", rejected(player, "the target is a player"), 1, claim(player, world, at(-250).pos), [playerState]);
    await expect("claim with an ACHR id as the cell", rejected(BANDIT, "the location is not a cell or a worldspace"), 1, claim(BANDIT, BANDIT, at(300).pos), [bandit]);
    await expect("claim with an unknown id as the cell", rejected(BANDIT, "the location is not a cell or a worldspace"), 1, claim(BANDIT, 0x7ffff0, at(300).pos), [bandit]);
    await expect("claim without a location from 300 units", rejected(BANDIT, "no location"), 1, claim(BANDIT), [bandit]);
    await place(claimer, 40000);
    await ctx.sleep(1000);
    await expect("claim without a location from 40000 units", rejected(BANDIT, "no location"), 1, claim(BANDIT), [bandit]);
    await place(claimer, 300);
    await ctx.sleep(1000);

    await expect("script items outside the window", /Coop: script items of \w+: losses -, gains -, refused 12eb7x1$/, 1, () => custom(0, { customPacketType: "scriptItems", gains: [{ baseId: IRON_SWORD, count: 1 }], losses: [] }), [(x) => x.sword]);
    await expect("script items above the gold limit", /Coop: script items of \w+: losses -, gains -, refused fx1001 \(dialogue\)$/, 1, () => custom(0, { customPacketType: "scriptItems", gains: [{ baseId: GOLD, count: 1001 }], losses: [], dialogue: true }), [(x) => x.gold]);
    const gold0 = (await state()).gold;
    await custom(0, { customPacketType: "scriptItems", gains: [{ baseId: GOLD, count: 600 }], losses: [], dialogue: true });
    const goldAccepted = await ctx.waitFor(async () => (await state()).gold === gold0 + 600, 5000, "600 gold in the window").then(() => true).catch(() => false);
    ctx.evidence.push(`control: 600 gold in a dialogue window accepted ${goldAccepted}`);
    ctx.assert.ok(goldAccepted, [...fails, "not exercised: 600 gold in a dialogue window was not accepted"].join("; "));
    await expect("script items above the gold limit across one window", /Coop: script items of \w+: losses -, gains -, refused fx600 \(dialogue\)$/, 1, () => custom(0, { customPacketType: "scriptItems", gains: [{ baseId: GOLD, count: 600 }], losses: [], dialogue: true }), [(x) => x.gold]);

    await expect("repeated espAnim events", new RegExp(`Rejected custom packet "espAnim" from user ${users[0]}: no handler`), 3, () => custom(0, { customPacketType: "espAnim", ref: 0x1fb9f, name: "Open" }), [bandit]);

    const wrong = log().filter((l) => /Rejected custom packet/.test(l) && !/"espAnim"/.test(l));
    ctx.evidence.push(`handled packets logged as rejected: ${wrong.length}`);
    if (wrong.length) fails.push(`handled packets were logged as rejected: ${wrong.slice(0, 3).join(" | ")}`);
    await ctx.probe(`mp.set(${BANDIT}, "isDisabled", true); return 0;`);
    await expect("claim on an NPC disabled during play", rejected(BANDIT, "disabled during play"), 1, claim(BANDIT, world, loc.pos), [bandit]);
    const guard = await ctx.probe(`return mp.get(${INITIALLY_DISABLED}, "locationalData");`);
    await ctx.probe(`mp.set(${claimer}, "locationalData", ${JSON.stringify({ ...guard, pos: [guard.pos[0] + 100, guard.pos[1], guard.pos[2]] })}); return 0;`);
    await ctx.sleep(1000);
    await expect("control: a valid claim on an initially disabled NPC", new RegExp(`NPC ${hex(INITIALLY_DISABLED)} enabled at the report of ${hex(claimer)}`), 1, claim(INITIALLY_DISABLED, parseInt(guard.cellOrWorldDesc.split(":")[0], 16), guard.pos), []);
    const enabled = !(await ctx.probe(`return mp.get(${INITIALLY_DISABLED}, "isDisabled");`));
    ctx.evidence.push(`control: the initially disabled guard ${hex(INITIALLY_DISABLED)} is enabled after the valid claim: ${enabled}`);
    if (!enabled) fails.push("control: a valid claim did not enable the initially disabled guard");

    ctx.assert.ok(!fails.length, fails.join("; "));
  },
};
