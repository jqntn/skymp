import { test } from "node:test";
import * as assert from "node:assert/strict";
import { GAIN_WINDOW_MS, GOLD, REPLAY_QUIET_MS, acceptGains, applyItems, parseItems } from "./scriptItems";

const CLAW = 0x39647;
const SWORD = 0x12eb7;
const NPC = 0x13482;
const typeOf = (baseId: number) => ({ [GOLD]: "MISC", [CLAW]: "MISC", [SWORD]: "WEAP", [NPC]: "NPC_" } as Record<number, string>)[baseId];
const open = (openedAt: number) => ({ openedAt, spent: new Map<number, number>() });

test("script items must be a short list of positive counts", () => {
  assert.deepEqual(parseItems([{ baseId: GOLD, count: 400 }]), [{ baseId: GOLD, count: 400 }]);
  assert.equal(parseItems([{ baseId: GOLD, count: 0 }]), null);
  assert.equal(parseItems([{ baseId: "f", count: 1 }]), null);
  assert.equal(parseItems({}), null);
  assert.equal(parseItems(new Array(65).fill({ baseId: GOLD, count: 1 })), null);
});

test("gains are accepted only in an open window and not right after a replay", () => {
  const gold = [{ baseId: GOLD, count: 400 }];
  assert.deepEqual(acceptGains(gold, open(0), -Infinity, GAIN_WINDOW_MS, typeOf), gold);
  assert.deepEqual(acceptGains(gold, open(0), -Infinity, GAIN_WINDOW_MS + 1, typeOf), []);
  assert.deepEqual(acceptGains(gold, undefined, -Infinity, 0, typeOf), []);
  assert.deepEqual(acceptGains(gold, open(0), 0, REPLAY_QUIET_MS - 1, typeOf), []);
});

test("a window allows 1000 gold, 5 of another base, and playable items only", () => {
  const window = open(0);
  assert.deepEqual(acceptGains([{ baseId: GOLD, count: 600 }], window, -Infinity, 1, typeOf).length, 1);
  assert.deepEqual(acceptGains([{ baseId: GOLD, count: 401 }], window, -Infinity, 1, typeOf), []);
  assert.deepEqual(acceptGains([{ baseId: GOLD, count: 400 }, { baseId: SWORD, count: 6 }, { baseId: CLAW, count: 5 }, { baseId: NPC, count: 1 }], window, -Infinity, 1, typeOf), [{ baseId: GOLD, count: 400 }, { baseId: CLAW, count: 5 }]);
});

test("losses come from plain entries first, gains go to a plain entry", () => {
  const entries = [{ baseId: CLAW, count: 1, health: 1.5 }, { baseId: CLAW, count: 1 }, { baseId: GOLD, count: 140 }];
  assert.deepEqual(applyItems(entries, [{ baseId: CLAW, count: 1 }], [{ baseId: GOLD, count: 400 }]), [{ baseId: CLAW, count: 1, health: 1.5 }, { baseId: GOLD, count: 540 }]);
  assert.deepEqual(applyItems(entries, [{ baseId: CLAW, count: 5 }, { baseId: SWORD, count: 1 }], [{ baseId: SWORD, count: 1 }]), [{ baseId: GOLD, count: 140 }, { baseId: SWORD, count: 1 }]);
});
