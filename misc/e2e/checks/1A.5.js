const s11 = require("./S1.1.js");

module.exports = {
  ...s11,
  run: (ctx) => {
    ctx.npcs = [["Alvor", 0x13482]];
    ctx.evidence.push("the puppet applies the hoster's movement only when isHostedByOther, an UpdateProperty with the raw ESP id, reaches the FormView of the real actor");
    return s11.run(ctx);
  },
};
