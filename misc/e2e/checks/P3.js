const BANDIT = 0x1ebf6;
const TAKE_MS = 5000;
const HOLD_MS = 6000;
const JUMP = 200;
const INTERIOR = { cellOrWorldDesc: "165a8:Skyrim.esm", pos: [-803, 386, 320], rot: [0, 0, 0] };
const APPEARANCE = { isFemale: false, raceId: 0x13746, weight: 50, skinColor: -1, hairColor: -1, headpartIds: [], headTextureSetId: 0, options: new Array(19).fill(0), presets: new Array(4).fill(0), tints: [], name: "E2eHoster" };

module.exports = {
  engines: 2,
  timeout: 20 * 60000,
  setup: async (ctx) => {
    for (const n of [1, 2]) {
      const actor = await ctx.character(n);
      await ctx.probe(`mp.set(${actor}, "appearance", ${JSON.stringify({ ...APPEARANCE, name: `E2eHoster${n}` })}); return 0;`);
    }
  },
  async run(ctx) {
    const actors = [await ctx.ready(1), await ctx.ready(2)];
    const hex = (v) => (v >>> 0).toString(16);
    const npc = `const a = sp.Actor.from(sp.Game.getFormEx(${BANDIT}));`;
    const server = () => ctx.probe(`const l = mp.get(${BANDIT}, "locationalData"); return { hoster: mp.get(${BANDIT}, "hoster") || 0, dead: !!mp.get(${BANDIT}, "isDead"), cell: l.cellOrWorldDesc, pos: l.pos.map(Math.round) };`);
    const heal = () => ctx.probe(`for (const a of ${JSON.stringify(actors)}) mp.set(a, "percentages", { health: 1, magicka: 1, stamina: 1 }); return 0;`).catch(() => 0);
    const view = (n) => ctx.drv(`${npc} return a && a.is3DLoaded() && !a.isDisabled() ? [a.getPositionX(), a.getPositionY(), a.getPositionZ()].map(Math.round) : null;`, n).catch(() => null);
    const copies = (n) => ctx.drv(`${npc} const base = a.getBaseObject().getFormID(); const name = a.getDisplayName(); const seen = new Set(); for (let i = 0; i < 400; i++) { const r = sp.Game.findRandomActor(a.getPositionX(), a.getPositionY(), a.getPositionZ(), 3000); if (!r || seen.has(r.getFormID()) || r.isDisabled() || !r.is3DLoaded()) continue; if ((r.getBaseObject() && r.getBaseObject().getFormID() === base) || r.getDisplayName() === name) seen.add(r.getFormID()); } return { ids: [...seen], name, dead: a.isDead(), ai: a.isAIEnabled(), shown: a.is3DLoaded() && !a.isDisabled() };`, n).catch((e) => ({ error: e.message.slice(0, 60), ids: [] }));
    const dist = (a, b) => Math.round(Math.hypot(...a.map((v, i) => v - b[i])));
    const loc = await ctx.npcLocation(BANDIT);
    const near = (n) => ({ ...loc, pos: [loc.pos[0] + (n === 1 ? 300 : -300), loc.pos[1], loc.pos[2] + 50] });
    const goNear = async (n) => {
      await ctx.probe(`mp.set(${actors[n - 1]}, "locationalData", ${JSON.stringify(near(n))}); return 0;`);
      await ctx.waitFor(async () => (await heal(), ctx.drv(`${npc} return !sp.Ui.isMenuOpen("Loading Menu") && !!a && a.is3DLoaded();`, n).catch(() => false)), 120000, `the bandit is loaded on engine ${n}`);
    };
    const fails = [];
    const takeover = async (label, from, to, cause, quits) => {
      const waitAt = Date.now();
      const shown = await ctx.waitFor(async () => (await heal(), !!(await view(to))), 30000, `the NPC is shown on engine ${to}`).then(() => true).catch(() => false);
      ctx.evidence.push(`before "${label}": the NPC ${shown ? `shown on engine ${to} after ${((Date.now() - waitAt) / 1000).toFixed(1)} s` : `not shown on engine ${to} within 30 s`}`);
      if (!shown) fails.push(`${label}: engine ${to} did not show the NPC within 30 s before the cause`);
      const before = await server();
      ctx.assert.ok(before.hoster === actors[from - 1] && !before.dead, [...fails, `not exercised: before "${label}" the hoster is ${hex(before.hoster)}, not engine ${from}'s player`].join("; "));
      const baseline = await copies(to);
      const samples = [[0, before.pos, await view(to)]];
      const at = Date.now();
      await cause();
      let s = before;
      let takenAt = null;
      let lost = null;
      let exitAt = null;
      while (Date.now() - at < (takenAt === null ? TAKE_MS + 25000 : takenAt + HOLD_MS)) {
        const [, srv, seen] = await Promise.all([heal(), server(), view(to)]);
        const t = Date.now() - at;
        s = srv;
        samples.push([t, s.pos, seen]);
        if (quits && exitAt === null && !ctx.running(from)) exitAt = t;
        if (takenAt === null && s.hoster === actors[to - 1]) takenAt = t;
        else if (takenAt !== null && lost === null && s.hoster !== actors[to - 1]) lost = [t, s.hoster];
        await ctx.sleep(250);
      }
      const largest = (k) => samples.slice(1).map((x, i) => [x[0], x[k] && samples[i][k] ? dist(x[k], samples[i][k]) : 0]).reduce((m, x) => (x[1] > m[1] ? x : m), [0, 0]);
      const jump = largest(1);
      const seenJump = largest(2);
      const hidden = samples.find((x) => !x[2]);
      const after = await copies(to);
      const extra = after.ids.filter((id) => id >= 0xff000000 || !baseline.ids.includes(id)).map(hex);
      const sec = (ms) => `${(ms / 1000).toFixed(1)} s`;
      ctx.evidence.push(`${label}: hoster ${hex(before.hoster)} at ${before.pos}${quits ? `; engine ${from} exited ${exitAt === null ? "not within the samples" : `${sec(exitAt)} after the quit`}` : ""}; engine ${to}'s player took it ${takenAt === null ? "never in 30 s" : `${sec(takenAt)} after`}${lost ? `, then lost it to ${hex(lost[1])} at ${sec(lost[0])}` : ""}; largest step between samples ${jump[1]} at ${sec(jump[0])} on the server, ${seenJump[1]} at ${sec(seenJump[0])} on engine ${to}${hidden ? `; not shown on engine ${to} at ${sec(hidden[0])}` : ""}; server dead ${s.dead}; on engine ${to} before ${JSON.stringify({ ...baseline, ids: baseline.ids.map(hex) })}, after ${JSON.stringify({ ...after, ids: after.ids.map(hex) })}`);
      if (takenAt === null || takenAt > TAKE_MS) fails.push(`${label}: engine ${to}'s player took the NPC ${takenAt === null ? "not within 30 s" : `after ${sec(takenAt)}`}, not within ${TAKE_MS / 1000} s`);
      if (lost) fails.push(`${label}: engine ${to}'s player lost the NPC to ${hex(lost[1])} ${sec(lost[0])} after the cause`);
      if (jump[1] > JUMP) fails.push(`${label}: the NPC jumped ${jump[1]} units on the server at ${sec(jump[0])}`);
      if (seenJump[1] > JUMP) fails.push(`${label}: the NPC jumped ${seenJump[1]} units on engine ${to} at ${sec(seenJump[0])}`);
      if (hidden) fails.push(`${label}: the NPC was not shown on engine ${to} at ${sec(hidden[0])}`);
      if (s.dead || after.dead) fails.push(`${label}: the NPC died (server ${s.dead}, engine ${to} ${after.dead})`);
      if (after.error || baseline.error) fails.push(`${label}: engine ${to} could not list the NPC's copies (${after.error || baseline.error})`);
      else if (!after.shown || !after.ai) fails.push(`${label}: engine ${to} does not drive the NPC (shown ${after.shown}, AI ${after.ai})`);
      if (extra.length) fails.push(`${label}: engine ${to} shows new copies of the NPC (${extra.join(", ")})`);
    };

    await goNear(2);
    await goNear(1);
    const hosted = await ctx.waitFor(async () => (await heal(), (await server()).hoster !== 0), 30000, "a client hosts the bandit").then(() => true).catch(() => false);
    ctx.assert.ok(hosted, "not exercised: no client hosts the bandit");
    const first = (await server()).hoster === actors[0] ? 1 : 2;
    const second = 3 - first;
    await takeover("the hoster changes cell", first, second, () => ctx.probe(`mp.set(${actors[first - 1]}, "locationalData", ${JSON.stringify(INTERIOR)}); return 0;`));
    await goNear(first);
    await ctx.drv(`${npc} a.startCombat(sp.Game.getPlayer()); return 0;`, second).catch(() => 0);
    const fighting = await ctx.waitFor(async () => (await heal(), ctx.drv(`${npc} return a.getCombatState() === 1;`, second).catch(() => false)), 30000, "the bandit fights").then(() => true).catch(() => false);
    ctx.evidence.push(`the bandit fights on engine ${second} before the quit ${fighting}`);
    ctx.assert.ok(fighting, [...fails, `not exercised: the bandit is not in combat on engine ${second}`].join("; "));
    await takeover("the hoster closes the game in combat", second, first, async () => void ctx.drv("sp.Debug.quitGame(); return 0;", second).catch(() => 0), true);

    ctx.assert.ok(!fails.length, fails.join("; "));
  },
};
