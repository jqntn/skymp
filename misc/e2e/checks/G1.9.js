const fs = require("fs");
const path = require("path");
const TOLERANCE = 10;
const PLACEMENTS = [
  { dx: 0, dy: 1500, heading: 0, memberHeading: 45 },
  { dx: 1500, dy: 0, heading: 0, memberHeading: 270 },
  { dx: -1000, dy: -1200, heading: 90, memberHeading: 160 },
  { dx: -1400, dy: 600, heading: 200, memberHeading: 0 },
  { dx: 9000, dy: 7000, heading: 300, memberHeading: 110 },
];
const LETTERS = { N: 0, E: 90, S: 180, W: 270 };
const STRANGERS = [{ profileId: 930191, dx: -2000, dy: 1800 }, { profileId: 930192, dx: 2200, dy: -1600 }];

module.exports = {
  engines: 2,
  timeout: 15 * 60000,
  setup: async (ctx) => {
    await ctx.character(1);
    await ctx.character(2);
  },
  async run(ctx) {
    const actors = [await ctx.ready(1), await ctx.ready(2)];
    const [leader, member] = actors;
    const hex = (v) => (v >>> 0).toString(16);
    const send = (n, content) => ctx.drv(`sp.mpClientPlugin.send(JSON.stringify({ t: 1, contentJsonDump: ${JSON.stringify(JSON.stringify(content))} }), true); return 0;`, n);
    const ask = `window.skyrimPlatform.sendMessage("e2e-compass", JSON.stringify({ markers: Array.from(document.querySelectorAll("#skymp-party-compass [data-actor]")).map((m) => ({ actor: Number(m.dataset.actor), left: parseFloat(m.style.left), width: m.getBoundingClientRect().width })), cardinals: Array.from(document.querySelectorAll("#skymp-party-compass [data-cardinal]")).map((c) => ({ text: c.dataset.cardinal, left: parseFloat(c.style.left) })) }));`;
    const markers = async (n) => {
      await ctx.drv(`const s = globalThis.__e2eCompass || (globalThis.__e2eCompass = { seq: 0 }); if (!s.listening) { s.listening = true; sp.on("browserMessage", (e) => { if (e.arguments && e.arguments[0] === "e2e-compass") { s.data = e.arguments[1]; s.seq++; } }); } s.asked = s.seq; sp.browser.executeJavaScript(${JSON.stringify(ask)}); return 0;`, n);
      await ctx.waitFor(() => ctx.drv(`return globalThis.__e2eCompass.seq > globalThis.__e2eCompass.asked;`, n), 5000, `engine ${n}'s web UI answers`);
      return ctx.drv(`return { visible: sp.browser.isVisible(), ...JSON.parse(globalThis.__e2eCompass.data) };`, n);
    };
    const pose = (n) => ctx.drv(`const p = sp.Game.getPlayer(); return { x: p.getPositionX(), y: p.getPositionY(), heading: p.getAngleZ(), camera: sp.getCameraAngleZ() };`, n);
    const norm = (a) => ((((a + 180) % 360) + 360) % 360) - 180;
    const fails = [];
    const look = async (n, other) => {
      const ui = await markers(n);
      const me = await pose(n);
      const them = await pose(other);
      const expected = norm((Math.atan2(them.x - me.x, them.y - me.y) * 180) / Math.PI - me.heading);
      const mine = ui.markers.filter((m) => m.actor === actors[other - 1]);
      const shown = mine.length === 1 ? norm((mine[0].left - 50) * 3.6) : null;
      const letters = ui.cardinals.length === 4 && ui.cardinals.every((c) => Math.abs(norm((c.left - 50) * 3.6 - (LETTERS[c.text] - me.heading))) <= TOLERANCE);
      return { ui, me, expected, shown, letters, ok: ui.visible && letters && ui.markers.length === 1 && mine.length === 1 && mine[0].width > 0 && Math.abs(norm(shown - expected)) <= TOLERANCE };
    };

    const base = await ctx.probe(`return mp.get(${leader}, "locationalData");`);
    const strangers = [];
    for (const s of STRANGERS) {
      strangers.push(await ctx.probe(`const bot = mp.createBot(); (globalThis.g19bots = globalThis.g19bots || []).push(bot);
        bot.send({ t: 1, contentJsonDump: JSON.stringify({ customPacketType: "loginWithSkympIo", gameData: { profileId: ${s.profileId} } }) });
        await new Promise((r) => setTimeout(r, 800));
        const actor = mp.getUserActor(bot.getUserId());
        mp.set(actor, "locationalData", ${JSON.stringify({ ...base, pos: [base.pos[0] + s.dx, base.pos[1] + s.dy, base.pos[2]] })});
        return actor;`));
    }
    ctx.assert.ok(strangers.every((a) => a), "a bot player got no actor");
    await ctx.probe(`const [a, b] = globalThis.g19bots; const actorOf = (bot) => mp.getUserActor(bot.getUserId());
      a.send({ t: 1, contentJsonDump: JSON.stringify({ customPacketType: "partyInvite", target: actorOf(b) }) });
      await new Promise((r) => setTimeout(r, 1000));
      b.send({ t: 1, contentJsonDump: JSON.stringify({ customPacketType: "partyAccept", inviter: actorOf(a) }) });
      return 0;`);
    const botsJoined = await ctx.waitFor(() => fs.readFileSync(path.join(ctx.dir, "server.log"), "utf8").includes(`Coop: ${hex(strangers[1])} joined party`), 15000, "the bots form their own party").then(() => true).catch(() => false);
    ctx.assert.ok(botsJoined, "the two bot players did not form a party");
    ctx.evidence.push(`bot players ${strangers.map(hex).join(", ")} formed their own party near engine 1`);

    await ctx.sleep(3000);
    const outside = [await markers(1), await markers(2)];
    ctx.evidence.push(`before the party: engine 1 web UI visible ${outside[0].visible}, markers ${JSON.stringify(outside[0].markers)}; engine 2 visible ${outside[1].visible}, markers ${JSON.stringify(outside[1].markers)}`);
    if (outside.some((o) => o.markers.length)) fails.push("a client shows a marker for a player outside its party");

    await send(1, { customPacketType: "partyInvite", target: member });
    await ctx.sleep(1500);
    await send(2, { customPacketType: "partyAccept", inviter: leader });
    const joined = await ctx.waitFor(() => fs.readFileSync(path.join(ctx.dir, "server.log"), "utf8").includes(`Coop: ${hex(member)} joined party`), 15000, "engine 2 joins the party").then(() => true).catch(() => false);
    ctx.assert.ok(joined, "engine 2 did not join engine 1's party");

    for (const p of PLACEMENTS) {
      await ctx.drv(`sp.Game.getPlayer().setAngle(0, 0, ${p.heading}); return 0;`, 1);
      await ctx.probe(`mp.set(${member}, "locationalData", ${JSON.stringify({ ...base, pos: [base.pos[0] + p.dx, base.pos[1] + p.dy, base.pos[2] + 200] })}); return 0;`);
      await ctx.waitFor(() => ctx.drv(`const pl = sp.Game.getPlayer(); return !sp.Ui.isMenuOpen("Loading Menu") && Math.hypot(pl.getPositionX() - ${base.pos[0] + p.dx}, pl.getPositionY() - ${base.pos[1] + p.dy}) < 300;`, 2).catch(() => false), 90000, "engine 2 arrives");
      await ctx.drv(`sp.Game.getPlayer().setAngle(0, 0, ${p.memberHeading}); return 0;`, 2);
      await ctx.sleep(3000);
      const a = await look(1, 2);
      const b = await look(2, 1);
      if (p === PLACEMENTS[1]) ctx.shot("compass-engine1", 1);
      ctx.evidence.push(`member at (${p.dx}, ${p.dy}) from the leader, leader heading ${p.heading}, member heading ${p.memberHeading}: engine 1 (heading ${a.me.heading.toFixed(1)}, camera ${a.me.camera.toFixed(1)}) expects ${a.expected.toFixed(1)}, shows ${a.shown === null ? "-" : a.shown.toFixed(1)} (${JSON.stringify(a.ui)}); engine 2 (heading ${b.me.heading.toFixed(1)}, camera ${b.me.camera.toFixed(1)}) expects ${b.expected.toFixed(1)}, shows ${b.shown === null ? "-" : b.shown.toFixed(1)} (${JSON.stringify(b.ui)})`);
      if (!a.ok) fails.push(`engine 1's marker for engine 2 at (${p.dx}, ${p.dy}), heading ${p.heading}: expected ${a.expected.toFixed(1)}, shown ${a.shown === null ? "none" : a.shown.toFixed(1)}, ${a.ui.markers.length} markers in all, letters right ${a.letters}`);
      if (!b.ok) fails.push(`engine 2's marker for engine 1 at (${p.dx}, ${p.dy}): expected ${b.expected.toFixed(1)}, shown ${b.shown === null ? "none" : b.shown.toFixed(1)}, ${b.ui.markers.length} markers in all, letters right ${b.letters}`);
    }

    await send(2, { customPacketType: "partyLeave" });
    await ctx.sleep(3000);
    const left = [await markers(1), await markers(2)];
    ctx.evidence.push(`after engine 2 leaves the party: engine 1 markers ${JSON.stringify(left[0].markers)}; engine 2 markers ${JSON.stringify(left[1].markers)}`);
    if (left.some((o) => o.markers.length)) fails.push("a marker stays after the party ends");

    ctx.assert.ok(!fails.length, fails.join("; "));
  },
};
