import { storage } from "skyrimPlatform";

storage["talkEvents"] = [];

export const pushTalk = (npc: number, on: boolean): void => {
  (storage["talkEvents"] as Array<[number, boolean]>).push([npc, on]);
};

export const nextTalk = (): [number, boolean] | undefined => {
  return (storage["talkEvents"] as Array<[number, boolean]>).shift();
};
