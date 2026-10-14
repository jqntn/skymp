export interface EspField {
  type: string;
  data: Uint8Array;
}

export interface CreatedItem {
  alias: number;
  item: number;
  holderAlias: number;
}

export interface AliasHolder {
  ref?: number;
  npc?: number;
}

export interface QuestItems {
  created: CreatedItem[];
  holders: Map<number, AliasHolder>;
}

const CREATE_IN = 0x8000;

const u32 = (f: EspField) => new DataView(f.data.buffer, f.data.byteOffset, f.data.byteLength).getUint32(0, true);

export const parseQuestItems = (fields: EspField[]): QuestItems => {
  const created = new Array<CreatedItem>();
  const holders = new Map<number, AliasHolder>();
  let alias: number | null = null;
  let item = 0;
  for (const f of fields) {
    if (f.type === "ALST" || f.type === "ALLS") {
      alias = f.data.byteLength >= 4 ? u32(f) : null;
      item = 0;
    } else if (f.type === "ALED") {
      alias = null;
    } else if (alias === null || f.data.byteLength < 4) {
      continue;
    } else if (f.type === "ALFR") {
      holders.set(alias, { ...holders.get(alias), ref: u32(f) });
    } else if (f.type === "ALUA") {
      holders.set(alias, { ...holders.get(alias), npc: u32(f) });
    } else if (f.type === "ALCO") {
      item = u32(f);
    } else if (f.type === "ALCA" && item) {
      const value = u32(f);
      if ((value >>> 16) & CREATE_IN) {
        created.push({ alias, item, holderAlias: value & 0xffff });
      }
    }
  }
  return { created, holders };
};

export const isCreatedItem = (granted: unknown, baseId: number, itemsOf: (quest: unknown) => QuestItems | undefined): boolean =>
  Array.isArray(granted) &&
  granted.some((g) => Array.isArray(g) && !!itemsOf(g[0])?.created.some((c) => c.alias === g[1] && c.item === baseId));

export const acceptsHolder = (holder: AliasHolder | undefined, ref: unknown, record: { type: string; fields: EspField[] } | undefined): boolean => {
  if (!Number.isInteger(ref) || (ref as number) <= 0 || (ref as number) >= 0xff000000 || !record) {
    return false;
  }
  if (record.type !== "ACHR" && record.type !== "REFR") {
    return false;
  }
  if (holder?.ref !== undefined && holder.ref !== ref) {
    return false;
  }
  if (holder?.npc !== undefined) {
    const name = record.fields.find((f) => f.type === "NAME");
    return record.type === "ACHR" && !!name && name.data.byteLength >= 4 && u32(name) === holder.npc;
  }
  return true;
};
