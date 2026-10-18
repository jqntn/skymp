import { test } from "node:test";
import { EventEmitter } from "events";
import { Coop } from "./coop";
import { SystemContext } from "./system";
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

test("a member's script gain is accepted only after a stage relayed to it", () => {
  const LEADER = 0xff000000;
  const MEMBER = 0xff000001;
  const QUEST = 0x39645;
  const GOLD = 0xf;
  const dnam = new Uint8Array(12);
  dnam[8] = 1;
  const indx = new Uint8Array(2);
  indx[0] = 100;
  const records: Record<number, unknown> = { [QUEST]: { type: "QUST", fields: [{ type: "DNAM", data: dnam }, { type: "INDX", data: indx }] }, [GOLD]: { type: "MISC", fields: [] } };
  const props = new Map<string, unknown>();
  const svr = {
    getUserActor: (userId: number) => LEADER + userId,
    getUserByActor: (actor: number) => actor - LEADER,
    isConnected: () => true,
    getActorName: () => "player",
    getActorCellOrWorld: () => 0x3c,
    getActorPos: () => [0, 0, 0],
    sendCustomPacket: () => {},
    get: (id: number, name: string) => props.get(`${id}:${name}`),
    set: (id: number, name: string, value: unknown) => props.set(`${id}:${name}`, value),
    lookupEspmRecordById: (id: number) => ({ record: records[id] }),
  };
  const ctx = { svr, gm: new EventEmitter() } as unknown as SystemContext;
  const coop = new Coop(() => {}, 4);
  const gold = () => (props.get(`${MEMBER}:inventory`) as { entries: { baseId: number; count: number }[] }).entries.find((e) => e.baseId === GOLD)?.count;
  coop.customPacket(0, "partyInvite", { target: MEMBER }, ctx);
  coop.customPacket(1, "partyAccept", { inviter: LEADER }, ctx);
  props.set(`${MEMBER}:inventory`, { entries: [{ baseId: GOLD, count: 140 }] });
  coop.customPacket(1, "scriptItems", { gains: [{ baseId: GOLD, count: 400 }], losses: [] }, ctx);
  assert.equal(gold(), 140);
  coop.customPacket(0, "questStage", { quest: QUEST, stage: 100 }, ctx);
  coop.customPacket(1, "scriptItems", { gains: [{ baseId: GOLD, count: 400 }], losses: [] }, ctx);
  assert.equal(gold(), 540);
});

test("a dragon death sends its soul to the party members near it", async () => {
  const LEADER = 0xff000000;
  const MEMBER = 0xff000001;
  const DRAGON = 0x5a6ca;
  const WOLF = 0x23ab9;
  const HEAD = 0x1ca05;
  const TEMPLATE = 0xfae86;
  const records: Record<number, unknown> = {
    [HEAD]: { type: "NPC_", fields: [] },
    [TEMPLATE]: { type: "NPC_", fields: [{ type: "VMAD", data: new TextEncoder().encode("\u0005\u0000\u0002\u0000\u0001\u0000\u0011\u0000dragonActorSCRIPT") }] },
  };
  const chains: Record<number, number[]> = { [DRAGON]: [HEAD, TEMPLATE], [WOLF]: [HEAD] };
  const pos: Record<number, number[]> = { [LEADER]: [0, 0, 0], [MEMBER]: [50, 0, 0], [DRAGON]: [100, 0, 0], [WOLF]: [100, 0, 0] };
  const sent: [number, Record<string, unknown>][] = [];
  const svr = {
    getUserActor: (userId: number) => LEADER + userId,
    getUserByActor: (actor: number) => actor - LEADER,
    isConnected: () => true,
    getActorName: () => "player",
    getActorCellOrWorld: () => 0x3c,
    getActorPos: (actor: number) => pos[actor],
    sendCustomPacket: (userId: number, json: string) => sent.push([userId, JSON.parse(json)]),
    get: (id: number, name: string) => (name === "templateChain" ? chains[id] : undefined),
    set: () => {},
    lookupEspmRecordById: (id: number) => ({ record: records[id] }),
  } as Record<string, unknown>;
  const ctx = { svr, gm: new EventEmitter() } as unknown as SystemContext;
  const coop = new Coop(() => {}, 4);
  await coop.initAsync(ctx);
  coop.customPacket(0, "partyInvite", { target: MEMBER }, ctx);
  coop.customPacket(1, "partyAccept", { inviter: LEADER }, ctx);
  const souls = () => sent.filter(([, c]) => c.customPacketType === "dragonSoul").map(([userId]) => userId);
  const onDeath = svr.onDeath as (actor: number, killer: number) => unknown;
  onDeath(WOLF, 0);
  assert.deepEqual(souls(), []);
  onDeath(DRAGON, 0);
  assert.deepEqual(souls(), [0, 1]);
  pos[MEMBER] = [9000, 0, 0];
  onDeath(DRAGON, 0);
  assert.deepEqual(souls(), [0, 1, 0]);
  svr.onDeath = () => false;
  onDeath(DRAGON, 0);
  assert.deepEqual(souls(), [0, 1, 0]);
});

test("followers are kept and sent back with the login replay", () => {
  const PLAYER = 0xff000000;
  const LYDIA = 0xa2c94;
  const DOOR = 0x1a6f4;
  const records: Record<number, unknown> = { [LYDIA]: { type: "ACHR", fields: [] }, [DOOR]: { type: "REFR", fields: [] } };
  const props = new Map<string, unknown>();
  const sent: Record<string, unknown>[] = [];
  const svr = {
    getUserActor: (userId: number) => PLAYER + userId,
    getUserByActor: (actor: number) => actor - PLAYER,
    isConnected: () => true,
    getActorName: () => "player",
    getActorCellOrWorld: () => 0x3c,
    getActorPos: () => [0, 0, 0],
    sendCustomPacket: (_userId: number, json: string) => sent.push(JSON.parse(json)),
    get: (id: number, name: string) => props.get(`${id}:${name}`),
    set: (id: number, name: string, value: unknown) => props.set(`${id}:${name}`, value),
    lookupEspmRecordById: (id: number) => ({ record: records[id] }),
  };
  const ctx = { svr, gm: new EventEmitter() } as unknown as SystemContext;
  const coop = new Coop(() => {}, 4);
  const replay = () => sent.filter((c) => c.customPacketType === "questApply").pop()?.followers;
  coop.customPacket(0, "questLogRequest", {}, ctx);
  assert.deepEqual(replay(), [0, 0]);
  coop.customPacket(0, "followers", { refs: [LYDIA, 0] }, ctx);
  coop.customPacket(0, "followers", { refs: [LYDIA] }, ctx);
  assert.deepEqual(props.get(`${PLAYER}:private.coopFollowers`), [LYDIA, 0]);
  coop.customPacket(0, "followers", { refs: [LYDIA, 0xff000005] }, ctx);
  assert.deepEqual(props.get(`${PLAYER}:private.coopFollowers`), [LYDIA, 0]);
  coop.customPacket(0, "followers", { refs: [DOOR, 0] }, ctx);
  assert.deepEqual(props.get(`${PLAYER}:private.coopFollowers`), [0, 0]);
  coop.customPacket(0, "followers", { refs: [LYDIA, 0] }, ctx);
  const fresh = new Coop(() => {}, 4);
  fresh.customPacket(0, "questLogRequest", {}, ctx);
  assert.deepEqual(replay(), [LYDIA, 0]);
});

test("the last party member who asks a follower to follow owns her", () => {
  const LEADER = 0xff000000;
  const MEMBER = 0xff000001;
  const LYDIA = 0xa2c94;
  const props = new Map<string, unknown>();
  const svr = {
    getUserActor: (userId: number) => LEADER + userId,
    getUserByActor: (actor: number) => actor - LEADER,
    isConnected: () => true,
    getActorName: () => "player",
    getActorCellOrWorld: () => 0x3c,
    getActorPos: () => [0, 0, 0],
    sendCustomPacket: () => {},
    get: (id: number, name: string) => props.get(`${id}:${name}`),
    set: (id: number, name: string, value: unknown) => props.set(`${id}:${name}`, value),
    lookupEspmRecordById: () => ({ record: { type: "ACHR", fields: [] as unknown[] } }),
  };
  const ctx = { svr, gm: new EventEmitter() } as unknown as SystemContext;
  const coop = new Coop(() => {}, 4);
  const stored = (actor: number) => props.get(`${actor}:private.coopFollowers`);
  coop.customPacket(0, "followers", { refs: [LYDIA, 0] }, ctx);
  coop.customPacket(1, "followers", { refs: [LYDIA, 0] }, ctx);
  assert.deepEqual(stored(LEADER), [LYDIA, 0]);
  coop.customPacket(0, "partyInvite", { target: MEMBER }, ctx);
  coop.customPacket(1, "partyAccept", { inviter: LEADER }, ctx);
  coop.customPacket(1, "followers", { refs: [0, LYDIA] }, ctx);
  assert.deepEqual(stored(LEADER), [0, 0]);
  assert.deepEqual(stored(MEMBER), [0, LYDIA]);
  coop.customPacket(0, "followers", { refs: [LYDIA, 0] }, ctx);
  assert.deepEqual(stored(MEMBER), [0, 0]);
});

test("a player who goes offline stays in the party, and an offline leader is replaced after the grace", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
  const LEADER = 0xff000000;
  const MEMBER = 0xff000001;
  const online = new Set([0, 1]);
  const sent: [number, Record<string, unknown>][] = [];
  const svr = {
    getUserActor: (userId: number) => LEADER + userId,
    getUserByActor: (actor: number) => actor - LEADER,
    isConnected: (userId: number) => online.has(userId),
    getActorName: () => "player",
    getActorCellOrWorld: () => 0x3c,
    getActorPos: () => [0, 0, 0],
    sendCustomPacket: (userId: number, json: string) => sent.push([userId, JSON.parse(json)]),
    get: (): unknown => undefined,
    set: () => {},
    lookupEspmRecordById: (): { record?: unknown } => ({}),
  };
  const ctx = { svr, gm: new EventEmitter() } as unknown as SystemContext;
  const coop = new Coop(() => {}, 4);
  const replace = (coop as unknown as { replaceOfflineLeader: (c: SystemContext, p: unknown) => void }).replaceOfflineLeader.bind(coop);
  const party = () => (coop as unknown as { parties: { partyOf: (a: number) => { leader: number; members: number[] } | undefined } }).parties.partyOf(MEMBER);
  coop.customPacket(0, "partyInvite", { target: MEMBER }, ctx);
  coop.customPacket(1, "partyAccept", { inviter: LEADER }, ctx);
  coop.disconnect(0, ctx);
  online.delete(0);
  assert.deepEqual(party()?.members, [LEADER, MEMBER]);
  t.mock.timers.tick(60_000);
  replace(ctx, party());
  assert.equal(party()?.leader, LEADER);
  online.add(0);
  coop.customPacket(0, "questLogRequest", {}, ctx);
  const state = sent.filter(([userId, c]) => userId === 0 && c.customPacketType === "partyState").pop()?.[1] as { party: { leader: number } };
  assert.equal(state.party.leader, LEADER);
  coop.disconnect(0, ctx);
  online.delete(0);
  t.mock.timers.tick(6 * 60_000);
  replace(ctx, party());
  assert.equal(party()?.leader, MEMBER);
  coop.disconnect(1, ctx);
  online.delete(1);
  const kept = party();
  t.mock.timers.tick(6 * 60_000);
  replace(ctx, kept);
  assert.equal(party(), undefined);
});

test("a holder's quest item count is answered once per replay, only where the server created it", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
  const PLAYER = 0xff000000;
  const STONE = 0xdf202;
  const BOSS = 0x9bcd6;
  const OTHER = 0x1a67e;
  const records: Record<number, unknown> = { [STONE]: { type: "MISC", fields: [] } };
  const props = new Map<string, unknown>([[`${PLAYER}:private.questLog`, [[MQ103, 10]]], [`${BOSS}:private.coopCreated`, [[MQ103, 18]]]]);
  const sent: Record<string, unknown>[] = [];
  const svr = {
    getUserActor: (userId: number) => PLAYER + userId,
    getUserByActor: (actor: number) => actor - PLAYER,
    isConnected: () => true,
    getActorName: () => "player",
    sendCustomPacket: (_userId: number, json: string) => sent.push(JSON.parse(json)),
    get: (id: number, name: string) => props.get(`${id}:${name}`),
    set: (id: number, name: string, value: unknown) => props.set(`${id}:${name}`, value),
    lookupEspmRecordById: (id: number) => ({ record: records[id] }),
  };
  const ctx = { svr, gm: new EventEmitter() } as unknown as SystemContext;
  const coop = new Coop(() => {}, 4);
  (coop as unknown as { questInfos: Map<number, unknown> }).questInfos.set(MQ103, { stages: new Set([10]), runOnce: false, repeatStages: false, items: { created: [{ alias: 18, item: STONE, holderAlias: 52, questObject: true }], holders: new Map() } });
  const counts = () => sent.filter((c) => c.customPacketType === "questItemCounts").map((c) => c.counts);
  coop.customPacket(0, "questItemHolders", { holders: [[MQ103, 18, BOSS]] }, ctx);
  assert.deepEqual(counts(), []);
  coop.customPacket(0, "questLogRequest", {}, ctx);
  assert.deepEqual(sent.filter((c) => c.customPacketType === "questApply").pop()?.questItems, [[MQ103, 18, STONE, 52, 0]]);
  coop.customPacket(0, "questItemHolders", { holders: [[MQ103, 18, OTHER], [MQ103, 18, BOSS]] }, ctx);
  coop.customPacket(0, "questItemHolders", { holders: [[MQ103, 18, BOSS]] }, ctx);
  assert.deepEqual(counts(), [[]]);
  t.mock.timers.tick(5000);
  coop.customPacket(0, "questLogRequest", {}, ctx);
  coop.customPacket(0, "questItemHolders", { holders: [[MQ103, 18, BOSS], [MQ103, 18, 0x14]] }, ctx);
  assert.deepEqual(counts(), [[], [[MQ103, 18, BOSS, 0]]]);
  t.mock.timers.tick(5000);
  coop.customPacket(0, "questLogRequest", {}, ctx);
  t.mock.timers.tick(200_000);
  coop.customPacket(0, "questItemHolders", { holders: [[MQ103, 18, BOSS]] }, ctx);
  assert.equal(counts().length, 2);
});
