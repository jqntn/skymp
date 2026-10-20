module.exports = {
  suite: ["G1.1", "G1.2", "G1.3", "G1.4", "G1.5", "G1.6", "G1.8", "G1.9", "G2.1", "G2.2", "G2.3", "G2.4", "G2.5", "G2.6"],
  proxy: { delayMs: 150, loss: 0.02 },
  excluded: "G1.7 not run: it waits for the user's hand check",
};
