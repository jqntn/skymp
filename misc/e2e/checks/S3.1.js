const GATE = 0x3b9f1;
const OTHER = 0xaa8cb;

module.exports = {
  engines: 1,
  timeout: 6 * 60000,
  setup: (ctx) => ctx.character(1, { pos: [4992, -1150, -760], angleZ: 180, worldOrCell: 0x371de }),
  async run(ctx) {
    await ctx.ready(1);
    const loaded = (id) => `const r = sp.ObjectReference.from(sp.Game.getFormEx(${id})); return !!r && r.is3DLoaded();`;
    await ctx.waitFor(() => ctx.drv(loaded(GATE)).catch(() => false), 60000, "the gate is loaded");
    await ctx.waitFor(() => ctx.drv(loaded(OTHER)).catch(() => false), 60000, "a pillar is loaded");
    const base = await ctx.drv(`const b = sp.ObjectReference.from(sp.Game.getFormEx(${GATE})).getBaseObject(); return [b.getFormID(), b.getType()];`);
    await ctx.drv(`globalThis.e2eS31 = [];
      globalThis.e2eS31Hook = sp.hooks.sendAnimationEvent.add({
        enter(c) { globalThis.e2eS31.push(["enter", c.selfId, c.animEventName]); },
        leave(c) { globalThis.e2eS31.push(["leave", c.selfId, c.animEventName, c.animationSucceeded]); },
      }, ${GATE}, ${GATE});
      globalThis.e2eS31Other = [];
      globalThis.e2eS31OtherHook = sp.hooks.sendAnimationEvent.add({
        enter(c) { globalThis.e2eS31Other.push(c.animEventName); },
        leave() {},
      }, ${OTHER}, ${OTHER});
      return 0;`);
    await ctx.sleep(2000);
    const quiet = await ctx.drv(`return globalThis.e2eS31.length;`);
    await ctx.drv(`sp.ObjectReference.from(sp.Game.getFormEx(${OTHER})).playAnimationAndWait("Open", "Opened"); return 0;`);
    await ctx.sleep(1500);
    const afterOther = await ctx.drv(`return globalThis.e2eS31.length;`);
    const otherSeen = await ctx.drv(`const s = globalThis.e2eS31Other; sp.hooks.sendAnimationEvent.remove(globalThis.e2eS31OtherHook); return s;`);
    await ctx.drv(`sp.ObjectReference.from(sp.Game.getFormEx(${GATE})).playAnimationAndWait("Open", "Opened"); return 0;`);
    await ctx.sleep(4000);
    const seen = await ctx.drv(`return globalThis.e2eS31.slice();`);
    await ctx.drv(`sp.ObjectReference.from(sp.Game.getFormEx(${GATE})).playAnimation("Close"); return 0;`);
    await ctx.sleep(1500);
    const fromJs = await ctx.drv(`const n = globalThis.e2eS31.length - ${seen.length}; sp.hooks.sendAnimationEvent.remove(globalThis.e2eS31Hook); return n;`);
    const enters = seen.filter((x) => x[0] === "enter" && x[1] === GATE && x[2] === "Open");
    const leaves = seen.filter((x) => x[0] === "leave" && x[1] === GATE && x[2] === "Open");
    ctx.evidence.push(`gate ${GATE.toString(16)} (base ${base[0].toString(16)}, form type ${base[1]}): ${quiet} hook calls before any animation, ${afterOther} after a latent playAnimationAndWait on pillar ${OTHER.toString(16)} (its own hook saw ${JSON.stringify(otherSeen)}), after a latent playAnimationAndWait("Open", "Opened") on the gate, as a Papyrus script calls it: ${JSON.stringify(seen.map((x) => [x[0], x[1].toString(16), ...x.slice(2)]))}; then ${fromJs} calls after a JS playAnimation("Close") on the gate (SkyrimPlatform hides its own synchronous native calls from hooks)`);
    ctx.shot("S3_1");
    ctx.assert.equal(base[1], 24, "the gate is not an activator");
    ctx.assert.equal(quiet, 0, "the hook fired before any animation");
    ctx.assert.equal(afterOther, 0, "the hook fired for a ref outside its id range");
    ctx.assert.deepEqual(otherSeen, ["Open"], "the pillar's own hook did not see its Open");
    ctx.assert.equal(enters.length, 1, `the hook fired ${enters.length} times for the gate's Open`);
    ctx.assert.equal(leaves.length, 1, `the hook left ${leaves.length} times for the gate's Open`);
    ctx.assert.ok(leaves[0][3], "the gate's graph did not accept Open");
  },
};
