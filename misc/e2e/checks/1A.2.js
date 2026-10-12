module.exports = {
  server: false,
  timeout: 5 * 60000,
  async run(ctx) {
    ctx.unit("[1A.2]");
  },
};
