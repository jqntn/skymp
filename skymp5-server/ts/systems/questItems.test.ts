import { test } from "node:test";
import * as assert from "node:assert/strict";
import { EspField, acceptsHolder, parseQuestItems } from "./questItems";

const field = (type: string, value: number): EspField => {
  const data = new Uint8Array(4);
  new DataView(data.buffer).setUint32(0, value, true);
  return { type, data };
};

const ARVEL_NPC = 0x39646;
const ARVEL = 0x39655;
const CLAW = 0x39647;
const JOURNAL = 0x39654;

const ms13 = [
  field("ALST", 1), field("ALUA", ARVEL_NPC), { type: "ALED", data: new Uint8Array(0) },
  field("ALST", 16), field("ALCO", JOURNAL), field("ALCA", 0x80000001), { type: "ALED", data: new Uint8Array(0) },
  field("ALST", 10), field("ALFR", 0x1fc43), { type: "ALED", data: new Uint8Array(0) },
  field("ALST", 11), field("ALCO", CLAW), field("ALCA", 0x80000001), { type: "ALED", data: new Uint8Array(0) },
  field("ALST", 19), field("ALCO", 0x12345), field("ALCA", 0x00000001), { type: "ALED", data: new Uint8Array(0) },
];

test("create-in items and their holder aliases are parsed, create-at items are not", () => {
  const items = parseQuestItems(ms13);
  assert.deepEqual(items.created, [
    { alias: 16, item: JOURNAL, holderAlias: 1 },
    { alias: 11, item: CLAW, holderAlias: 1 },
  ]);
  assert.deepEqual(items.holders.get(1), { npc: ARVEL_NPC });
  assert.deepEqual(items.holders.get(10), { ref: 0x1fc43 });
});

test("a fill is accepted only for an ESP ref that matches the holder alias", () => {
  const arvel = { type: "ACHR", fields: [field("NAME", ARVEL_NPC)] };
  const other = { type: "ACHR", fields: [field("NAME", 0x1347a)] };
  assert.equal(acceptsHolder({ npc: ARVEL_NPC }, ARVEL, arvel), true);
  assert.equal(acceptsHolder({ npc: ARVEL_NPC }, 0x1347b, other), false);
  assert.equal(acceptsHolder({ npc: ARVEL_NPC }, ARVEL, { type: "REFR", fields: [field("NAME", ARVEL_NPC)] }), false);
  assert.equal(acceptsHolder({ ref: 0x1fc43 }, 0x1fc43, { type: "REFR", fields: [] }), true);
  assert.equal(acceptsHolder({ ref: 0x1fc43 }, 0x1fc44, { type: "REFR", fields: [] }), false);
  assert.equal(acceptsHolder(undefined, 0xd2ec2, { type: "ACHR", fields: [] }), true);
  assert.equal(acceptsHolder(undefined, 0xd2ec2, { type: "CONT", fields: [] }), false);
  assert.equal(acceptsHolder(undefined, 0xff000010, { type: "ACHR", fields: [] }), false);
  assert.equal(acceptsHolder(undefined, "39655", arvel), false);
  assert.equal(acceptsHolder(undefined, ARVEL, undefined), false);
});
