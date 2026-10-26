const RIVERWOOD = { cellOrWorldDesc: "3c:Skyrim.esm", pos: [19157, -46588, -94], rot: [0, 0, 0] };

module.exports = {
  engines: 1,
  timeout: 5 * 60000,
  setup: async (ctx) => {
    await ctx.character(1);
  },
  async run(ctx) {
    const actor = await ctx.ready(1);
    await ctx.probe(`mp.set(${actor}, "locationalData", ${JSON.stringify(RIVERWOOD)}); return 0;`);
    await ctx.sleep(15000);
    ctx.evidence.push(`storage: ${await ctx.drv(`const m = sp.storage["worldModel"]; const h = sp.storage["hosted"]; const v = sp.storage["view"];
      return JSON.stringify({ keys: Object.keys(sp.storage).slice(0, 40), model: typeof m, forms: m && m.forms ? m.forms.length : -1, refrIds: m && m.forms ? m.forms.filter((f) => f).slice(0, 12).map((f) => f.refrId) : [], hosted: Array.isArray(h) ? h.slice(0, 8) : typeof h, view: typeof v });`)}`);
  },
};
