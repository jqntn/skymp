import * as sp from "skyrimPlatform";
import { EventEmitterType } from "../events/events";

export interface ClientListenerEvents {
    on: typeof sp.on,
    once: typeof sp.once
};

// these are only available in the git version, so we augment the module
// TODO: use typings from the current codebase, not npm module
declare module "skyrimPlatform" {
    function setTextsVisibility(visibility: 'inheritBrowser' | 'off' | 'on'): void;
    function getTextsVisibility(): 'inheritBrowser' | 'off' | 'on';
    function setTextRefr(textId: number, refrFormId: number): void; // pass 0 to detach
    function setTextRefrNode(textId: number, nodeName: string): void;
    function setTextRefrOffset(textId: number, offset: number[]): void;
    function setTextRefrScreenOffset(textId: number, offset: number[]): void;
    function getTextRefr(textId: number): number;
    function getTextRefrNode(textId: number): string;
    function getTextRefrOffset(textId: number): number[];
    function getTextRefrScreenOffset(textId: number): number[];
    function getReferenceAliasQuests(refrFormId: number): number[];
    function getInventoryReferences(refrFormId: number): { ref: number, baseId: number }[];
    function getRunningQuests(): [number, number][];
    function getCameraAngleZ(): number;
    function setPapyrusEventsAllowedForms(formIds: number[]): void;
    function updateAnimations(drivenFormIds?: number[]): void;
    function isAnimationGraphReady(formId: number): boolean;
    function speakSound(formId: number, voiceFile: string): void;
    function getDialogueTopic(): { id: number, text: string };
    function getSubtitles(): { speakerId: number, text: string }[];
    function getQuestAliasReference(questFormId: number, aliasId: number): number;
    interface SpeakSoundEvent {
        actorId: number;
        voiceFile: string;
    }
    function on(eventName: 'speakSound', callback: (event: SpeakSoundEvent) => void): EventHandle;
    function once(eventName: 'speakSound', callback: (event: SpeakSoundEvent) => void): EventHandle;
}

export type Sp = Omit<typeof sp, "on" | "once">;

export abstract class ClientListener {
    // Don't let TypeScript treat this class as empty
    private _nonEmptyClassMark = '';
}

export type ClientListenerConstructor<T> = {
    new(...args: any[]): T;
    readonly name: string;
}

export type ListenerLookupController = {
    lookupListener<T extends ClientListener>(constructor: ClientListenerConstructor<T>): T;
};

export type EventsController = {
    readonly on: typeof sp.on,
    readonly once: typeof sp.once,
    readonly emitter: EventEmitterType
};

export type CombinedController = EventsController & ListenerLookupController;
