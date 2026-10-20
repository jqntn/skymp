module.exports = {
  engines: 1,
  timeout: 300000,
  setup: (ctx) => ctx.character(1),
  async run(ctx) {
    await ctx.ready(1);
    await ctx.sleep(20000);
    const errors = ctx.clientLog(1).filter((l) => l.includes("[Exception]"));
    ctx.evidence.push(`${ctx.clientLog(1).length} client log lines, ${errors.length} [Exception] lines`);
    for (const e of errors.slice(0, 3)) ctx.evidence.push(`exception: ${e}`);
    ctx.assert.equal(errors.length, 0, `client exceptions: ${errors[0]}`);
  },
};
