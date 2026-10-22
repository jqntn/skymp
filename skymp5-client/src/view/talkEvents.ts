import { storage } from "skyrimPlatform";

storage["talkEvents"] = [];
storage["relayedSpeaks"] = [];
storage["talkTarget"] = [0, 0];

export const pushTalk = (npc: number, on: boolean): void => {
  (storage["talkEvents"] as Array<[number, boolean]>).push([npc, on]);
};

export const nextTalk = (): [number, boolean] | undefined => {
  return (storage["talkEvents"] as Array<[number, boolean]>).shift();
};

const relayedSpeakMs = 500;

const relayedSpeaks = (): Array<[number, string, number]> => {
  return (storage["relayedSpeaks"] as Array<[number, string, number]>).filter((x) => Date.now() - x[2] < relayedSpeakMs);
};

export const markRelayedSpeak = (actorId: number, file: string): void => {
  storage["relayedSpeaks"] = [...relayedSpeaks(), [actorId, file, Date.now()]];
};

export const isRelayedSpeak = (actorId: number, file: string): boolean => {
  return relayedSpeaks().some((x) => x[0] === actorId && x[1] === file);
};

export const setTalkTarget = (actorId: number, until: number): void => {
  storage["talkTarget"] = [actorId, until];
};

export const isTalkTarget = (actorId: number): boolean => {
  const [id, until] = storage["talkTarget"] as [number, number];
  return id === actorId && Date.now() < until;
};
