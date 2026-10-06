export type QuestLogEntry = [quest: number, stage: number];

export const STOP = -1;

export const lastStage = (log: QuestLogEntry[], quest: number): number | undefined => {
  for (let i = log.length - 1; i >= 0; --i) {
    if (log[i][0] === quest) {
      return log[i][1];
    }
  }
  return undefined;
};

export const prune = (log: QuestLogEntry[], quest: number): boolean => {
  const before = log.length;
  let j = 0;
  for (const entry of log) {
    if (entry[0] !== quest) {
      log[j++] = entry;
    }
  }
  log.length = j;
  return j !== before;
};

export const applyStage = (log: QuestLogEntry[], quest: number, stage: number, repeatStages: boolean, runOnce: boolean): boolean => {
  const last = lastStage(log, quest);
  if (last === STOP) {
    if (runOnce) {
      return false;
    }
    prune(log, quest);
  } else if (repeatStages ? last === stage : log.some(([q, s]) => q === quest && s === stage)) {
    return false;
  }
  log.push([quest, stage]);
  return true;
};

export const applyStop = (log: QuestLogEntry[], quest: number, keep: boolean): boolean => {
  if (!keep) {
    return prune(log, quest);
  }
  const last = lastStage(log, quest);
  if (last === undefined || last === STOP) {
    return false;
  }
  log.push([quest, STOP]);
  return true;
};

const lastStages = (log: QuestLogEntry[]): Map<number, number> => new Map(log);

export const outOfSyncQuests = (a: QuestLogEntry[], b: QuestLogEntry[]): Set<number> => {
  const la = lastStages(a);
  const lb = lastStages(b);
  const res = new Set<number>();
  for (const quest of [...la.keys(), ...lb.keys()]) {
    if (la.get(quest) !== lb.get(quest)) {
      res.add(quest);
    }
  }
  return res;
};

export const parseQuestLog = (value: unknown): QuestLogEntry[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((e): e is QuestLogEntry =>
    Array.isArray(e) && e.length === 2 && Number.isInteger(e[0]) && Number.isInteger(e[1]));
};
