import { test } from "node:test";
import * as assert from "node:assert/strict";
import { Parties, INVITE_TTL_MS } from "./party";
import { QuestLogEntry, STOP, applyStage, applyStop, lastStage, outOfSyncQuests, parseQuestLog } from "./questLog";

const MQ102 = 0x4e50d;
const MQ103 = 0xd0800;

test("a stage is logged once", () => {
  const log: QuestLogEntry[] = [];
  assert.equal(applyStage(log, MQ102, 10, false, false), true);
  assert.equal(applyStage(log, MQ102, 10, false, false), false);
  assert.equal(applyStage(log, MQ102, 20, false, false), true);
  assert.equal(lastStage(log, MQ102), 20);
});

test("a repeatable quest logs a stage again after another stage", () => {
  const log: QuestLogEntry[] = [];
  applyStage(log, MQ102, 10, true, false);
  assert.equal(applyStage(log, MQ102, 10, true, false), false);
  applyStage(log, MQ102, 20, true, false);
  assert.equal(applyStage(log, MQ102, 10, true, false), true);
});

test("a kept stop adds one marker, and a new run replaces the old run", () => {
  const log: QuestLogEntry[] = [[MQ103, 5]];
  applyStage(log, MQ102, 10, false, false);
  assert.equal(applyStop(log, MQ102, true), true);
  assert.equal(applyStop(log, MQ102, true), false);
  assert.equal(lastStage(log, MQ102), STOP);
  applyStage(log, MQ102, 10, false, false);
  assert.deepEqual(log, [[MQ103, 5], [MQ102, 10]]);
});

test("a run-once quest ignores a stage after its stop", () => {
  const log: QuestLogEntry[] = [[MQ102, 10], [MQ102, STOP]];
  assert.equal(applyStage(log, MQ102, 10, false, true), false);
  assert.deepEqual(log, [[MQ102, 10], [MQ102, STOP]]);
});

test("a stop that is not kept removes the quest", () => {
  const log: QuestLogEntry[] = [[MQ102, 10], [MQ103, 5], [MQ102, 20]];
  assert.equal(applyStop(log, MQ102, false), true);
  assert.deepEqual(log, [[MQ103, 5]]);
});

test("quests with a different last stage are out of sync", () => {
  const a: QuestLogEntry[] = [[MQ102, 10], [MQ102, 20], [MQ103, 5]];
  const b: QuestLogEntry[] = [[MQ102, 20]];
  assert.deepEqual([...outOfSyncQuests(a, b)], [MQ103]);
});

test("a bad stored value gives an empty log", () => {
  assert.deepEqual(parseQuestLog("x"), []);
  assert.deepEqual(parseQuestLog([[1, 2], [1], ["a", 2], [3, 4]]), [[1, 2], [3, 4]]);
});

test("invite, accept, leave and leader change", () => {
  const parties = new Parties(3);
  assert.equal(parties.invite(1, 1, 0), "You cannot invite yourself");
  assert.equal(parties.invite(1, 2, 0), undefined);
  assert.equal(parties.accept(2, 3, 0), "The invite expired");
  const party = parties.accept(2, 1, 0);
  assert.ok(typeof party !== "string");
  assert.deepEqual(party.members, [1, 2]);
  assert.equal(parties.invite(2, 3, 0), "Only the party leader can invite");
  parties.invite(1, 3, 0);
  parties.accept(3, 1, 0);
  assert.equal(parties.invite(1, 4, 0), "The party is full");
  parties.leave(1);
  assert.equal(parties.partyOf(2)?.leader, 2);
  parties.leave(3);
  assert.equal(parties.partyOf(2), undefined);
});

test("an invite expires", () => {
  const parties = new Parties(4);
  parties.invite(1, 2, 0);
  assert.equal(parties.decline(2, 3), false);
  assert.deepEqual(parties.invitesOf(2, INVITE_TTL_MS - 1), [1]);
  assert.deepEqual(parties.invitesOf(2, INVITE_TTL_MS), []);
  assert.equal(parties.accept(2, 1, INVITE_TTL_MS), "The invite expired");
});

test("an out of sync member plays a quest alone", () => {
  const parties = new Parties(4);
  parties.invite(1, 2, 0);
  parties.accept(2, 1, 0);
  parties.invite(1, 3, 0);
  const party = parties.accept(3, 1, 0);
  assert.ok(typeof party !== "string");
  party.outOfSync.set(3, new Set([MQ103]));
  assert.deepEqual(parties.questGroup(2, MQ103), [1, 2]);
  assert.deepEqual(parties.questGroup(3, MQ103), [3]);
  assert.deepEqual(parties.questGroup(3, MQ102), [1, 2, 3]);
  assert.deepEqual(parties.questGroup(9, MQ102), [9]);
});

test("promote and kick need the leader", () => {
  const parties = new Parties(4);
  parties.invite(1, 2, 0);
  parties.accept(2, 1, 0);
  assert.equal(parties.promote(2, 1), "Only the party leader can do this");
  assert.equal(parties.canKick(1, 5), "This player is not in your party");
  const party = parties.promote(1, 2);
  assert.ok(typeof party !== "string");
  assert.equal(party.leader, 2);
  assert.equal(parties.canKick(2, 1), undefined);
});
