import { Actor, Cell, Debug, DxScanCode, Game, GlobalVariable, ObjectReference, Quest, QuestStageEvent, QuestStartStopEvent, TESModPlatform, Utility, WorldSpace } from "skyrimPlatform";
import { logError, logTrace } from "../../logging";
import { ObjectReferenceEx } from "../../extensions/objectReferenceEx";
import { ConnectionMessage } from "../events/connectionMessage";
import { GameLoadEvent } from "../events/gameLoadEvent";
import { QueryKeyCodeBindings } from "../events/queryKeyCodeBindings";
import { CustomPacketMessage } from "../messages/customPacketMessage";
import { MsgType } from "../../messages";
import { ClientListener, CombinedController, Sp } from "./clientListener";
import { getViewFromStorage, localIdToRemoteId } from "../../view/worldViewMisc";
import { WorldCleanerService } from "./worldCleanerService";

const STOP = -1;
const MQ_QUICKSTART_GLOBAL = 0x4679e;
const COMPASS_INTERVAL_MS = 100;
const COMPASS_CARDINALS: [string, number][] = [["N", 0], ["E", 90], ["S", 180], ["W", 270]];
const QUEST_LOG_REQUEST_DELAY_MS = 3000;
const REPLAY_SETTLE_SECONDS = 3;
const MAX_REPLAY_DRIFT = 2048;
const MAX_WORLD_CLEANER_PAUSE_MS = 20000;
const ECHO_TTL_MS = 10000;
const PARTY_KEY = DxScanCode.F7;
const MQ104 = 0x2610c;
const MQ104_SOUL_STAGE = 90;
const DRAGONS_ABSORBED_GLOBAL = 0x1c0f2;

type QuestLogEntry = [quest: number, stage: number];

interface PartyPosition {
  actor: number;
  pos: number[];
  cellOrWorld: number;
}

interface PartyState {
  you: number;
  party: { leader: number, members: { actor: number, name: string }[] } | null;
  invites: { inviter: number, name: string }[];
}

export class CoopService extends ClientListener {
  constructor(private sp: Sp, private controller: CombinedController) {
    super();

    this.controller.emitter.on("customPacketMessage", (e) => this.onCustomPacketMessage(e));
    this.controller.emitter.on("gameLoad", (e) => this.onGameLoad(e));
    this.controller.emitter.on("connectionDisconnect", () => this.onDisconnect());
    this.controller.emitter.on("queryKeyCodeBindings", (e) => this.onQueryKeyCodeBindings(e));
    this.controller.on("questStage", (e) => this.onQuestStage(e));
    this.controller.on("questStop", (e) => this.onQuestStop(e));
    this.controller.on("update", () => this.onUpdate());
    this.controller.once("update", () => this.setQuestAuthority(true));
  }

  private onGameLoad(e: GameLoadEvent) {
    if (!e.isCausedBySkyrimPlatform) {
      this.questLogRequestAt = 0;
      this.reporting = false;
      return;
    }
    this.questLogRequestAt = Date.now() + QUEST_LOG_REQUEST_DELAY_MS;
    this.reporting = false;
    this.applyQueue = [];
    this.loadCount++;
    this.trackedQuests.clear();
    this.controller.lookupListener(WorldCleanerService).pauseUntil(Date.now() + MAX_WORLD_CLEANER_PAUSE_MS);
  }

  isQuestActor(actor: Actor): boolean {
    if (this.trackedQuests.size === 0) {
      return false;
    }
    return this.sp.getReferenceAliasQuests(actor.getFormID()).some((questId) => this.trackedQuests.has(questId));
  }

  isReporting(): boolean {
    return this.reporting;
  }

  yieldsToLeader(actor: Actor): boolean {
    const party = this.partyState?.party;
    if (!party || party.leader === this.partyState?.you || !this.isQuestActor(actor)) {
      return false;
    }
    const leader = ObjectReference.from(Game.getFormEx(getViewFromStorage()?.getLocalRefrId(party.leader) ?? 0));
    return !!leader && ObjectReferenceEx.getWorldOrCell(leader) === ObjectReferenceEx.getWorldOrCell(actor) && leader.getDistance(actor) <= 4096;
  }

  private track(questId: number, stage: number) {
    if (stage === STOP) {
      this.trackedQuests.delete(questId);
    } else {
      this.trackedQuests.add(questId);
    }
  }

  private onDisconnect() {
    this.partyState = undefined;
    this.setQuestAuthority(true);
  }

  private onUpdate() {
    this.updateCompass();
    if (this.questLogRequestAt && Date.now() >= this.questLogRequestAt) {
      this.questLogRequestAt = 0;
      GlobalVariable.from(Game.getFormEx(MQ_QUICKSTART_GLOBAL))?.setValue(-1);
      this.reporting = true;
      this.send({ customPacketType: "questLogRequest" });
      this.send({ customPacketType: "questsRunning", quests: this.sp.getRunningQuests() });
    }
    if (this.applyQueue.length > 0 && !this.applying) {
      this.applying = true;
      const queue = this.applyQueue;
      this.applyQueue = [];
      this.applyQuestLog(queue)
        .catch((err) => logError(this, "applyQuestLog failed", err))
        .finally(() => this.applying = false);
    }
  }

  private async applyQuestLog(batches: { entries: QuestLogEntry[], replay: boolean }[]) {
    const loadCount = this.loadCount;
    for (const { entries, replay } of batches) {
      const before = replay ? this.getLocation(Game.getPlayer()!) : undefined;
      if (replay) {
        this.reporting = false;
      }
      try {
        for (const [questId, stage] of entries) {
          if (loadCount !== this.loadCount) {
            return;
          }
          try {
            await this.applyQuestLogEntry(questId, stage, replay);
          } catch (err) {
            logError(this, "Failed to apply quest stage", questId, stage, err);
          }
        }
        if (before) {
          await Utility.wait(REPLAY_SETTLE_SECONDS);
          if (loadCount === this.loadCount) {
            this.restoreLocation(Game.getPlayer()!, before);
          }
        }
      } finally {
        if (replay && loadCount === this.loadCount) {
          this.reporting = true;
          this.controller.lookupListener(WorldCleanerService).pauseUntil(0);
        }
      }
    }
  }

  private async applyQuestLogEntry(questId: number, stage: number, replay: boolean) {
    this.track(questId, stage);
    const quest = Quest.from(Game.getFormEx(questId));
    if (!quest) {
      logError(this, "Unknown quest", questId);
      return;
    }
    if (stage === STOP) {
      if (!quest.isStopped()) {
        if (!replay) {
          this.expectEcho(questId, STOP);
        }
        quest.stop();
      }
    } else if (!quest.isStageDone(stage)) {
      if (!replay) {
        this.expectEcho(questId, stage);
      }
      await quest.setCurrentStageID(stage);
    }
  }

  private getLocation(refr: ObjectReference) {
    return {
      worldOrCell: ObjectReferenceEx.getWorldOrCell(refr),
      pos: [refr.getPositionX(), refr.getPositionY(), refr.getPositionZ()],
      rot: [refr.getAngleX(), refr.getAngleY(), refr.getAngleZ()],
    };
  }

  private restoreLocation(refr: ObjectReference, before: ReturnType<CoopService["getLocation"]>) {
    const now = this.getLocation(refr);
    const drift = Math.hypot(now.pos[0] - before.pos[0], now.pos[1] - before.pos[1], now.pos[2] - before.pos[2]);
    if (now.worldOrCell === before.worldOrCell && drift <= MAX_REPLAY_DRIFT) {
      return;
    }
    logTrace(this, "A quest replay moved the player, moving back");
    TESModPlatform.moveRefrToPosition(
      refr,
      Cell.from(Game.getFormEx(before.worldOrCell)),
      WorldSpace.from(Game.getFormEx(before.worldOrCell)),
      before.pos[0], before.pos[1], before.pos[2],
      before.rot[0], before.rot[1], before.rot[2],
    );
  }

  private expectEcho(questId: number, stage: number) {
    const now = Date.now();
    this.expectedEchoes.forEach((expiresAt, key) => expiresAt <= now && this.expectedEchoes.delete(key));
    this.expectedEchoes.set(`${questId}:${stage}`, now + ECHO_TTL_MS);
  }

  private isEcho(questId: number, stage: number): boolean {
    const key = `${questId}:${stage}`;
    const expiresAt = this.expectedEchoes.get(key);
    this.expectedEchoes.delete(key);
    return expiresAt !== undefined && expiresAt > Date.now();
  }

  private onQuestStage(e: QuestStageEvent) {
    if (this.reporting && e.quest && !this.isEcho(e.quest.getFormID(), e.stage)) {
      this.track(e.quest.getFormID(), e.stage);
      this.send({ customPacketType: "questStage", quest: e.quest.getFormID(), stage: e.stage });
    }
  }

  private onQuestStop(e: QuestStartStopEvent) {
    if (this.reporting && e.quest && !this.isEcho(e.quest.getFormID(), STOP)) {
      this.track(e.quest.getFormID(), STOP);
      this.send({ customPacketType: "questStop", quest: e.quest.getFormID(), completed: e.quest.isCompleted() });
    }
  }

  private onCustomPacketMessage(e: ConnectionMessage<CustomPacketMessage>) {
    let content: Record<string, unknown>;
    try {
      content = JSON.parse(e.message.contentJsonDump);
    } catch {
      return;
    }
    switch (content["customPacketType"]) {
      case "questApply":
        if (Array.isArray(content["entries"])) {
          this.applyQueue.push({ entries: content["entries"] as QuestLogEntry[], replay: content["replay"] === true });
        }
        break;
      case "partyState": {
        const state = content as unknown as PartyState;
        const newInvite = (state.invites?.length ?? 0) > (this.partyState?.invites?.length ?? 0);
        this.partyState = state;
        this.setQuestAuthority(!state.party || state.party.leader === state.you);
        if (newInvite) {
          this.notify("F7: accept the invite. Shift+F7: decline.");
        }
        break;
      }
      case "aliasFillRequest": {
        const quest = content["quest"];
        const aliases = content["aliases"];
        if (typeof quest === "number" && Array.isArray(aliases)) {
          this.controller.once("update", () => this.sendAliasFill(quest, aliases.filter((a): a is number => typeof a === "number")));
        }
        break;
      }
      case "partyNotice":
        if (typeof content["text"] === "string") {
          this.notify(content["text"]);
        }
        break;
      case "dragonSoul":
        this.controller.once("update", () => this.absorbDragonSoul());
        break;
      case "partyPositions":
        if (Array.isArray(content["members"])) {
          this.partyPositions = content["members"] as PartyPosition[];
        }
        break;
    }
  }

  private updateCompass() {
    const now = Date.now();
    if (now - this.compassAt < COMPASS_INTERVAL_MS) {
      return;
    }
    this.compassAt = now;
    const player = Game.getPlayer();
    if (!player) {
      return;
    }
    const here = player.getWorldSpace()?.getFormID() ?? player.getParentCell()?.getFormID() ?? 0;
    const party = this.partyState?.party;
    const members = party ? this.partyPositions : [];
    let heading = player.getAngleZ();
    try {
      heading = this.sp.getCameraAngleZ();
    } catch {
    }
    const toLeft = (bearing: number) => Math.round((50 + (((((bearing - heading) % 360) + 540) % 360) - 180) / 3.6) * 10) / 10;
    const markers = members.filter((m) => m.cellOrWorld === here).map((m) => ({
      actor: m.actor,
      name: party?.members.find((x) => x.actor === m.actor)?.name ?? "",
      left: toLeft((Math.atan2(m.pos[0] - player.getPositionX(), m.pos[1] - player.getPositionY()) * 180) / Math.PI),
    }));
    const cardinals = this.partyState?.party ? COMPASS_CARDINALS.map(([text, bearing]) => ({ text, left: toLeft(bearing) })) : [];
    const key = JSON.stringify({ markers, cardinals });
    if (key === this.compassKey) {
      return;
    }
    this.compassKey = key;
    this.sp.browser.executeJavaScript(`(() => {
      const state = ${key};
      let bar = document.getElementById("skymp-party-compass");
      if (!bar) {
        bar = document.createElement("div");
        bar.id = "skymp-party-compass";
        bar.style.cssText = "position:fixed;top:7%;left:35%;width:30%;height:40px;pointer-events:none;z-index:1000;font:bold 11px sans-serif;color:#d8d0b8;text-shadow:0 0 2px #000";
        document.body.appendChild(bar);
      }
      bar.style.borderTop = state.cardinals.length ? "1px solid rgba(216,208,184,0.5)" : "none";
      bar.replaceChildren(...state.cardinals.map((c) => {
        const e = document.createElement("div");
        e.dataset.cardinal = c.text;
        e.textContent = c.text;
        e.style.cssText = "position:absolute;top:1px;left:" + c.left + "%;transform:translateX(-50%)";
        return e;
      }), ...state.markers.map((m) => {
        const e = document.createElement("div");
        e.dataset.actor = String(m.actor);
        e.style.cssText = "position:absolute;top:16px;left:" + m.left + "%;transform:translateX(-50%);text-align:center;white-space:nowrap;font-size:10px";
        const diamond = document.createElement("div");
        diamond.style.cssText = "width:9px;height:9px;margin:0 auto 3px;transform:rotate(45deg);background:#7fd3ff;border:1px solid #102030";
        const name = document.createElement("div");
        name.textContent = m.name;
        e.replaceChildren(diamond, name);
        return e;
      }));
    })();`);
  }

  private sendAliasFill(quest: number, aliases: number[]) {
    try {
      this.send({ customPacketType: "aliasFill", quest, refs: aliases.map((alias) => [alias, this.sp.getQuestAliasReference(quest, alias)]) });
    } catch (e) {
      logError(this, "aliasFillRequest failed for quest", quest.toString(16), e);
    }
  }

  private absorbDragonSoul() {
    const player = Game.getPlayer();
    if (!player) {
      return;
    }
    player.modActorValue("DragonSouls", 1);
    const absorbed = GlobalVariable.from(Game.getFormEx(DRAGONS_ABSORBED_GLOBAL));
    absorbed?.setValue(absorbed.getValue() + 1);
    const mq104 = Quest.from(Game.getFormEx(MQ104));
    if (this.isQuestAuthority && mq104?.isRunning() && !mq104.isStageDone(MQ104_SOUL_STAGE)) {
      mq104.setCurrentStageID(MQ104_SOUL_STAGE);
    }
  }

  private setQuestAuthority(isAuthority: boolean) {
    if (this.isQuestAuthority === isAuthority) {
      return;
    }
    this.isQuestAuthority = isAuthority;
    const allowQuestPapyrusEvents = (this.sp as unknown as Record<string, unknown>)["allowQuestPapyrusEvents"];
    if (typeof allowQuestPapyrusEvents !== "function") {
      logError(this, "This SkyrimPlatform has no allowQuestPapyrusEvents, quest scripts stay blocked");
      return;
    }
    allowQuestPapyrusEvents(isAuthority);
    logTrace(this, "Quest authority", isAuthority);
  }

  private onQueryKeyCodeBindings(e: QueryKeyCodeBindings) {
    const wasDown = this.partyKeyDown;
    this.partyKeyDown = e.isDown([PARTY_KEY]);
    if (this.partyKeyDown && !wasDown) {
      const shift = e.isDown([DxScanCode.LeftShift]) || e.isDown([DxScanCode.RightShift]);
      this.controller.once("update", () => this.onPartyKey(shift));
    }
  }

  private onPartyKey(shift: boolean) {
    const you = this.partyState?.you ?? 0;
    const party = this.partyState?.party ?? null;
    const invites = this.partyState?.invites ?? [];
    const isLeader = !party || party.leader === you;

    if (invites.length > 0) {
      if (shift) {
        invites.forEach((invite) => this.send({ customPacketType: "partyDecline", inviter: invite.inviter }));
      } else {
        this.send({ customPacketType: "partyAccept", inviter: invites[invites.length - 1].inviter });
      }
      return;
    }

    const target = this.getTargetPlayer();
    const targetIsMember = !!party && party.members.some((m) => m.actor === target);

    if (shift) {
      if (target && targetIsMember && isLeader) {
        this.send({ customPacketType: "partyKick", target });
      } else if (party) {
        this.send({ customPacketType: "partyLeave" });
      } else {
        Debug.notification("You are not in a party");
      }
    } else if (target && !targetIsMember) {
      this.send({ customPacketType: "partyInvite", target });
    } else if (target && targetIsMember && isLeader && target !== you) {
      this.send({ customPacketType: "partyPromote", target });
    } else {
      this.showPartyStatus();
    }
  }

  private getTargetPlayer(): number {
    const refr = Game.getCurrentCrosshairRef();
    if (!refr) {
      return 0;
    }
    const remoteId = localIdToRemoteId(refr.getFormID());
    return remoteId >= 0xff000000 && remoteId <= 0xffffffff ? remoteId : 0;
  }

  private showPartyStatus() {
    const party = this.partyState?.party;
    if (!party) {
      Debug.notification("You are not in a party. Look at a player and press F7 to invite them.");
      return;
    }
    const names = party.members.map((m) => m.actor === party.leader ? `${m.name} (leader)` : m.name);
    Debug.notification(`Party: ${names.join(", ")}`);
    Debug.notification("Shift+F7: leave the party");
  }

  private notify(text: string) {
    this.controller.once("update", () => Debug.notification(text));
  }

  private send(content: Record<string, unknown>) {
    const message: CustomPacketMessage = {
      t: MsgType.CustomPacket,
      contentJsonDump: JSON.stringify(content),
    };
    this.controller.emitter.emit("sendMessage", { message, reliability: "reliable" });
  }

  private questLogRequestAt = 0;
  private reporting = false;
  private applying = false;
  private applyQueue = new Array<{ entries: QuestLogEntry[], replay: boolean }>();
  private isQuestAuthority: boolean | undefined;
  private partyState: PartyState | undefined;
  private partyPositions = new Array<PartyPosition>();
  private compassAt = 0;
  private compassKey = "";
  private trackedQuests = new Set<number>();
  private expectedEchoes = new Map<string, number>();
  private partyKeyDown = false;
  private loadCount = 0;
}
