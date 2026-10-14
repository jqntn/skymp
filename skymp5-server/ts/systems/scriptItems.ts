export interface ItemCount {
  baseId: number;
  count: number;
}

export interface ItemWindow {
  openedAt: number;
  spent: Map<number, number>;
}

export interface InventoryEntry {
  baseId: number;
  count: number;
  [extra: string]: unknown;
}

export const GAIN_WINDOW_MS = 15000;
export const REPLAY_QUIET_MS = 10000;
export const GOLD = 0xf;
export const MAX_GOLD = 1000;
export const MAX_PER_BASE = 5;
const MAX_ENTRIES = 64;
const MAX_COUNT = 1000000;
const PLAYABLE_TYPES = new Set(["WEAP", "ARMO", "AMMO", "MISC", "KEYM", "ALCH", "INGR", "BOOK", "SCRL", "SLGM", "LIGH"]);

export const parseItems = (value: unknown): ItemCount[] | null => {
  if (!Array.isArray(value) || value.length > MAX_ENTRIES) {
    return null;
  }
  const items = new Array<ItemCount>();
  for (const e of value) {
    const baseId = e?.baseId;
    const count = e?.count;
    if (!Number.isInteger(baseId) || baseId <= 0 || baseId > 0xffffffff || !Number.isInteger(count) || count <= 0 || count > MAX_COUNT) {
      return null;
    }
    items.push({ baseId, count });
  }
  return items;
};

export const acceptGains = (
  gains: ItemCount[],
  window: ItemWindow | undefined,
  replayAt: number,
  now: number,
  typeOf: (baseId: number) => string | undefined,
): ItemCount[] => {
  if (!window || now - window.openedAt > GAIN_WINDOW_MS || now - replayAt < REPLAY_QUIET_MS) {
    return [];
  }
  const accepted = new Array<ItemCount>();
  for (const gain of gains) {
    const type = typeOf(gain.baseId);
    const spent = window.spent.get(gain.baseId) ?? 0;
    const limit = gain.baseId === GOLD ? MAX_GOLD : MAX_PER_BASE;
    if (type && PLAYABLE_TYPES.has(type) && spent + gain.count <= limit) {
      window.spent.set(gain.baseId, spent + gain.count);
      accepted.push(gain);
    }
  }
  return accepted;
};

const isSimple = (e: InventoryEntry) => Object.keys(e).every((k) => k === "baseId" || k === "count");

export const applyItems = (entries: InventoryEntry[], losses: ItemCount[], gains: ItemCount[]): InventoryEntry[] => {
  const result = entries.map((e) => ({ ...e }));
  for (const loss of losses) {
    let left = loss.count;
    const holders = result.filter((e) => e.baseId === loss.baseId).sort((a, b) => Number(isSimple(b)) - Number(isSimple(a)));
    for (const e of holders) {
      const taken = Math.min(left, e.count);
      e.count -= taken;
      left -= taken;
    }
  }
  for (const gain of gains) {
    const simple = result.find((e) => e.baseId === gain.baseId && isSimple(e));
    if (simple) {
      simple.count += gain.count;
    } else {
      result.push({ baseId: gain.baseId, count: gain.count });
    }
  }
  return result.filter((e) => e.count > 0);
};
