const assert = require("node:assert");

const MQ101 = 0x3372b;
const MQ102 = 0x4e50d;
const MQ102B = 0x2610a;
const MQ00 = 0x1c5d9;
const STOP = -1;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const send = (bot, content) => bot.send({ t: 1, contentJsonDump: JSON.stringify(content) });

const sent = [];
const originalSendCustomPacket = mp.sendCustomPacket.bind(mp);
Object.defineProperty(mp, "sendCustomPacket", {
  value: (userId, json) => {
    sent.push({ userId, content: JSON.parse(json) });
    return originalSendCustomPacket(userId, json);
  },
});
const lastTo = (userId, type) => sent.filter((p) => p.userId === userId && p.content.customPacketType === type).map((p) => p.content).pop();
const countTo = (userId, type) => sent.filter((p) => p.userId === userId && p.content.customPacketType === type).length;
const questLog = (actor) => mp.get(actor, "private.questLog");
const hasEntry = (actor, quest, stage) => questLog(actor).some(([q, s]) => q === quest && s === stage);

const main = async () => {
  const bots = [mp.createBot(), mp.createBot(), mp.createBot()];
  bots.forEach((bot, i) => send(bot, { customPacketType: "loginWithSkympIo", gameData: { profileId: 920001 + i } }));
  await sleep(300);
  const [u1, u2, u3] = bots.map((bot) => bot.getUserId());
  const [a1, a2, a3] = [u1, u2, u3].map((u) => mp.getUserActor(u));
  const [bot1, bot2, bot3] = bots;
  assert.ok(a1 && a2 && a3);

  const pos = mp.getActorPos(a1);
  assert.ok(Math.hypot(pos[0] - 12155.9, pos[1] + 71991.3, pos[2] - 6015.5) < 1, `start pos ${pos}`);
  assert.equal(mp.getActorCellOrWorld(a1), 0x3c);
  assert.ok(Math.abs(mp.get(a1, "spawnPoint").pos[0] - 12155.9) < 1);
  assert.deepEqual(questLog(a1), [[MQ102B, 0], [MQ102B, 30]]);

  send(bot1, { customPacketType: "questLogRequest" });
  send(bot1, { customPacketType: "questLogRequest" });
  await sleep(100);
  assert.equal(countTo(u1, "questApply"), 1);
  assert.deepEqual(lastTo(u1, "questApply"), { customPacketType: "questApply", entries: [[MQ102B, 0], [MQ102B, 30]], replay: true });

  send(bot1, { customPacketType: "partyInvite", target: a2 });
  await sleep(100);
  assert.equal(lastTo(u2, "partyState").invites[0].inviter, a1);
  send(bot2, { customPacketType: "partyAccept", inviter: a1 });
  await sleep(100);
  assert.equal(lastTo(u1, "partyState").party.leader, a1);
  assert.deepEqual(lastTo(u2, "partyState").party.members.map((m) => m.actor), [a1, a2]);

  send(bot1, { customPacketType: "questStage", quest: MQ102B, stage: 10 });
  await sleep(100);
  assert.deepEqual(lastTo(u2, "questApply").entries, [[MQ102B, 10]]);
  assert.deepEqual(questLog(a2), [[MQ102B, 0], [MQ102B, 30], [MQ102B, 10]]);

  send(bot2, { customPacketType: "questStage", quest: MQ102, stage: 10 });
  await sleep(100);
  assert.deepEqual(lastTo(u1, "questApply").entries, [[MQ102, 10]]);

  const sentBefore = sent.length;
  send(bot1, { customPacketType: "questStage", quest: MQ102, stage: 10 });
  send(bot1, { customPacketType: "questStage", quest: MQ102, stage: 9999 });
  send(bot1, { customPacketType: "questStage", quest: 0x14, stage: 0 });
  send(bot1, { customPacketType: "questStage", quest: "x", stage: 0 });
  send(bot1, { customPacketType: "questStage", quest: MQ00, stage: 5 });
  await sleep(100);
  assert.equal(sent.length, sentBefore);
  assert.equal(questLog(a1).length, 4);

  send(bot1, { customPacketType: "questStage", quest: MQ101, stage: 900 });
  send(bot1, { customPacketType: "questStop", quest: MQ101, completed: true });
  await sleep(100);
  assert.deepEqual(questLog(a2).slice(-2), [[MQ101, 900], [MQ101, STOP]]);

  const logBeforeEcho = JSON.stringify(questLog(a1));
  send(bot2, { customPacketType: "questStage", quest: MQ101, stage: 900 });
  send(bot2, { customPacketType: "questStop", quest: MQ101, completed: false });
  await sleep(100);
  assert.equal(JSON.stringify(questLog(a1)), logBeforeEcho);

  send(bot3, { customPacketType: "questStage", quest: MQ102, stage: 20 });
  send(bot1, { customPacketType: "partyInvite", target: a3 });
  send(bot3, { customPacketType: "partyAccept", inviter: a1 });
  await sleep(100);
  send(bot1, { customPacketType: "questStage", quest: MQ102, stage: 25 });
  await sleep(100);
  assert.ok(hasEntry(a2, MQ102, 25));
  assert.ok(!hasEntry(a3, MQ102, 25));

  send(bot2, { customPacketType: "partyPromote", target: a1 });
  await sleep(100);
  assert.equal(lastTo(u2, "partyNotice").text, "Only the party leader can do this");

  send(bot1, { customPacketType: "partyPromote", target: a3 });
  await sleep(100);
  assert.equal(lastTo(u1, "partyState").party.leader, a3);

  send(bot3, { customPacketType: "partyKick", target: a2 });
  await sleep(100);
  assert.equal(lastTo(u2, "partyState").party, null);
  assert.equal(lastTo(u3, "partyState").party.members.length, 2);

  mp.kick(u3);
  await sleep(300);
  assert.equal(lastTo(u1, "partyState").party, null);
};

main().then(() => {
  console.log("Test passed!");
  process.exit(0);
}).catch((err) => {
  console.log("Test failed!");
  console.error(err);
  process.exit(1);
});
