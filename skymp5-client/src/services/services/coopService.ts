import { Actor, Cell, Debug, DxScanCode, Faction, Game, GlobalVariable, ObjectReference, Quest, QuestStageEvent, QuestStartStopEvent, ReferenceAlias, SpeakSoundEvent, TESModPlatform, Ui, Utility, WorldSpace } from "skyrimPlatform";
import { logError, logTrace } from "../../logging";
import { ObjectReferenceEx } from "../../extensions/objectReferenceEx";
import { ConnectionMessage } from "../events/connectionMessage";
import { GameLoadEvent } from "../events/gameLoadEvent";
import { QueryKeyCodeBindings } from "../events/queryKeyCodeBindings";
import { CustomPacketMessage } from "../messages/customPacketMessage";
import { MsgType } from "../../messages";
import { ClientListener, CombinedController, Sp } from "./clientListener";
import { getViewFromStorage, localIdToRemoteId, remoteIdToLocalId } from "../../view/worldViewMisc";
import { isRelayedSpeak, isTalkTarget, markRelayedSpeak, nextTalk, setTalkTarget } from "../../view/talkEvents";
import { WorldCleanerService } from "./worldCleanerService";
import { RemoteServer } from "./remoteServer";

const STOP = -1;
const MQ_QUICKSTART_GLOBAL = 0x4679e;
const COMPASS_RECT_MS = 1000;
const HUD_STAGE = [1280, 720];
const QUEST_LOG_REQUEST_DELAY_MS = 3000;
const REPLAY_SETTLE_SECONDS = 3;
const MAX_REPLAY_DRIFT = 2048;
const MAX_WORLD_CLEANER_PAUSE_MS = 20000;
const ECHO_TTL_MS = 10000;
const PARTY_KEY = DxScanCode.F7;
const MQ104 = 0x2610c;
const MQ104_SOUL_STAGE = 90;
const DRAGONS_ABSORBED_GLOBAL = 0x1c0f2;
const DIALOGUE_FOLLOWER = 0x750ba;
const DISMISSED_FOLLOWER_FACTION = 0x5c84c;
const FOLLOWER_SLOTS = [
  { alias: 0, countGlobal: 0xbcc98, canDoFavor: true },
  { alias: 1, countGlobal: 0x5c84a, canDoFavor: false },
];
const FOLLOWERS_INTERVAL_MS = 1000;
const QUEST_ITEM_WAIT_STEPS = 20;
const QUEST_ITEM_WAIT_STEP_SECONDS = 0.5;

type QuestLogEntry = [quest: number, stage: number];

interface PartyPosition {
  actor: number;
  pos: number[];
  cellOrWorld: number;
}

interface PartyState {
  you: number;
  party: { leader: number, members: { actor: number, name: string, followers?: number[] }[] } | null;
  invites: { inviter: number, name: string }[];
}

const talkHoldMs = 60000;
const DIALOGUE_MENU = "Dialogue Menu";
const HUD_ROOT = "_root.HUDMovieBaseInstance";
const TALK_AFTER_MS = 1500;
const TALK_TEXT_MS = 300;
const TALK_TOPIC_HOLD_MS = 2000;

export class CoopService extends ClientListener {
  constructor(private sp: Sp, private controller: CombinedController) {
    super();

    this.controller.emitter.on("customPacketMessage", (e) => this.onCustomPacketMessage(e));
    this.controller.emitter.on("gameLoad", (e) => this.onGameLoad(e));
    this.controller.emitter.on("connectionDisconnect", () => this.onDisconnect());
    this.controller.emitter.on("connectionAccepted", () => this.onConnectionAccepted());
    this.controller.emitter.on("queryKeyCodeBindings", (e) => this.onQueryKeyCodeBindings(e));
    this.controller.on("questStage", (e) => this.onQuestStage(e));
    this.controller.on("questStop", (e) => this.onQuestStop(e));
    this.controller.on("update", () => this.onUpdate());
    this.controller.on("speakSound", (e) => this.talkSpeaks.push(e));
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
    this.unreported = [];
    this.followersKey = this.followersKeyOf(FOLLOWER_SLOTS.map(() => 0));
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
    this.reconnecting = true;
  }

  private onConnectionAccepted() {
    if (!this.reconnecting) {
      return;
    }
    this.reconnecting = false;
    this.reporting = false;
    this.questLogRequestAt = Date.now() + QUEST_LOG_REQUEST_DELAY_MS;
  }

  private onUpdate() {
    this.updateCompass();
    this.relayTalk();
    for (let talk = nextTalk(); talk; talk = nextTalk()) {
      this.send({ customPacketType: "talk", npc: talk[0], on: talk[1] });
      logTrace(this, "talk", talk[0].toString(16), talk[1]);
    }
    this.talkHolds.forEach((at, npc) => {
      if (Date.now() - at > talkHoldMs) {
        this.setTalkHold(npc, false, []);
      }
    });
    this.reportFollowers();
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

  private async applyQuestLog(batches: { entries: QuestLogEntry[], replay: boolean, followers?: unknown, questItems?: unknown }[]) {
    const loadCount = this.loadCount;
    for (const { entries, replay, followers, questItems } of batches) {
      const before = replay ? this.getLocation(Game.getPlayer()!) : undefined;
      const teleports = this.controller.lookupListener(RemoteServer).getPlayerTeleports();
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
          await this.relinkQuestItems(questItems);
          await Utility.wait(REPLAY_SETTLE_SECONDS);
          if (loadCount === this.loadCount) {
            if (teleports === this.controller.lookupListener(RemoteServer).getPlayerTeleports()) {
              this.restoreLocation(Game.getPlayer()!, before);
            }
            this.applyFollowers(followers);
          }
        }
      } finally {
        if (replay && loadCount === this.loadCount) {
          this.reporting = true;
          this.reportUnreported(entries);
          logTrace(this, "Quest log replay done", entries.length);
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
    if (!e.quest) {
      return;
    }
    if (!this.reporting) {
      if (this.applying) {
        this.unreported.push([e.quest.getFormID(), e.stage]);
      }
    } else if (!this.isEcho(e.quest.getFormID(), e.stage)) {
      this.reportStage(e.quest.getFormID(), e.stage);
    }
  }

  private reportStage(quest: number, stage: number) {
    this.track(quest, stage);
    this.send({ customPacketType: "questStage", quest, stage });
  }

  private reportUnreported(replayed: QuestLogEntry[]) {
    const unreported = this.unreported;
    this.unreported = [];
    unreported.filter(([quest]) => !replayed.some(([q]) => q === quest)).forEach(([quest, stage]) => this.reportStage(quest, stage));
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
          this.applyQueue.push({ entries: content["entries"] as QuestLogEntry[], replay: content["replay"] === true, followers: content["followers"], questItems: content["questItems"] });
        }
        break;
      case "talkLine":
        if (typeof content["npc"] === "number" && typeof content["file"] === "string" && typeof content["text"] === "string") {
          const [npc, file, text] = [content["npc"], content["file"], content["text"]];
          this.controller.once("update", () => this.playTalkLine(npc, file, text));
        }
        break;
      case "talkTopic":
        if (typeof content["name"] === "string" && typeof content["text"] === "string") {
          const line = `${content["name"]}: ${content["text"]}`;
          this.controller.once("update", () => this.showSubtitle(line, true));
        }
        break;
      case "talkHold":
        if (typeof content["npc"] === "number" && Array.isArray(content["pos"])) {
          const [npc, on, pos] = [content["npc"], content["on"] === true, content["pos"] as number[]];
          this.controller.once("update", () => this.setTalkHold(npc, on, pos));
        }
        break;
      case "partyState": {
        const state = content as unknown as PartyState;
        const newInvite = (state.invites?.length ?? 0) > (this.partyState?.invites?.length ?? 0);
        this.partyState = state;
        this.setQuestAuthority(!state.party || state.party.leader === state.you);
        this.controller.once("update", () => this.dismissLostFollowers());
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
      case "questItemCounts":
        this.controller.once("update", () => this.removeStrayQuestItems(content["counts"]));
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
    const toLeft = (bearing: number) => Math.round((50 + (((((bearing - heading) % 360) + 540) % 360) - 180) / 3.6) * 100) / 100;
    const view = getViewFromStorage();
    const markers = members.filter((m) => m.cellOrWorld === here).map((m) => {
      const local = Actor.from(Game.getFormEx(view?.getLocalRefrId(m.actor) ?? 0));
      const pos = local && local.is3DLoaded() ? [local.getPositionX(), local.getPositionY()] : m.pos;
      return {
        actor: m.actor,
        name: party?.members.find((x) => x.actor === m.actor)?.name ?? "",
        left: toLeft((Math.atan2(pos[0] - player.getPositionX(), pos[1] - player.getPositionY()) * 180) / Math.PI),
      };
    });
    if (Date.now() - this.compassAt >= COMPASS_RECT_MS) {
      this.compassAt = Date.now();
      this.compassRect = this.nativeCompassRect() ?? this.compassRect;
    }
    const key = JSON.stringify({ markers, rect: this.compassRect });
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
        bar.style.cssText = "position:fixed;pointer-events:none;z-index:1000;font:bold 10px sans-serif;color:#d8d0b8;text-shadow:0 0 2px #000";
        document.body.appendChild(bar);
      }
      const [left, top, width, height] = state.rect;
      Object.assign(bar.style, { left: left + "%", top: top + "%", width: width + "%", height: height + "%" });
      const seen = new Set();
      for (const m of state.markers) {
        seen.add(String(m.actor));
        let e = bar.querySelector('[data-actor="' + m.actor + '"]');
        if (!e) {
          e = document.createElement("div");
          e.dataset.actor = String(m.actor);
          e.style.cssText = "position:absolute;top:50%;width:8px;height:8px;margin:-4px 0 0 -4px";
          const diamond = document.createElement("div");
          diamond.style.cssText = "width:8px;height:8px;transform:rotate(45deg);background:#7fd3ff;border:1px solid #102030;box-sizing:border-box";
          const name = document.createElement("div");
          name.style.cssText = "position:absolute;left:4px;top:12px;transform:translateX(-50%);white-space:nowrap";
          e.replaceChildren(diamond, name);
          bar.appendChild(e);
        }
        e.style.left = m.left + "%";
        e.lastChild.textContent = m.name;
      }
      for (const e of Array.from(bar.children)) {
        if (!seen.has(e.dataset.actor)) {
          e.remove();
        }
      }
    })();`);
  }

  private nativeCompassRect(): number[] | undefined {
    const value = (path: string) => Ui.getFloat("HUD Menu", `_root.HUDMovieBaseInstance${path}`);
    const frame = ".CompassShoutMeterHolder.Compass.CompassFrame";
    const width = value(`${frame}._width`);
    const height = value(`${frame}._height`);
    if (!width || !height) {
      return undefined;
    }
    const x = value("._x") + value(".CompassShoutMeterHolder._x") + value(`${frame}._x`);
    const y = value("._y") + value(".CompassShoutMeterHolder._y") + value(`${frame}._y`);
    return [(x - width / 2) / HUD_STAGE[0] * 100, (y - height / 2) / HUD_STAGE[1] * 100, width / HUD_STAGE[0] * 100, height / HUD_STAGE[1] * 100];
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

  private async relinkQuestItems(items: unknown) {
    if (!Array.isArray(items)) {
      return;
    }
    const strays = new Array<number[]>();
    for (const item of items) {
      if (!Array.isArray(item) || item.length !== 5 || !item.every((x) => typeof x === "number")) {
        continue;
      }
      const [questId, aliasId, baseId, holderAliasId, held] = item as number[];
      for (let i = 0; held && i < QUEST_ITEM_WAIT_STEPS; i++) {
        const waitBase = Game.getFormEx(baseId);
        if (!waitBase || (Game.getPlayer()?.getItemCount(waitBase) ?? 0) >= 1) {
          break;
        }
        await Utility.wait(QUEST_ITEM_WAIT_STEP_SECONDS);
      }
      const player = Game.getPlayer();
      const current = this.sp.getQuestAliasReference(questId, aliasId);
      const base = Game.getFormEx(baseId);
      const holder = ObjectReference.from(Game.getFormEx(this.sp.getQuestAliasReference(questId, holderAliasId)));
      const inHolder = !!holder && !!current && this.sp.getInventoryReferences(holder.getFormID()).some((l) => l.ref === current);
      if (!player) {
        return;
      }
      if (!held) {
        if (inHolder) {
          strays.push([questId, aliasId, holder!.getFormID()]);
        }
        continue;
      }
      if (current && this.sp.getInventoryReferences(player.getFormID()).some((l) => l.ref === current)) {
        continue;
      }
      if (!base || !holder || !inHolder || player.getItemCount(base) < 1) {
        logTrace(this, "Quest item not relinked", questId.toString(16), aliasId, baseId.toString(16), "holder", holder?.getFormID().toString(16), "in holder", inHolder);
        continue;
      }
      player.removeItem(base, 1, true, null);
      holder.removeItem(base, 1, true, player);
      const relinked = this.sp.getInventoryReferences(player.getFormID()).some((l) => l.ref === current);
      if (!relinked) {
        player.addItem(base, 1, true);
      }
      logTrace(this, relinked ? "Quest item relinked" : "Quest item relink failed, the plain copy is back", questId.toString(16), aliasId, baseId.toString(16));
    }
    if (strays.length) {
      this.questItemHoldersLoad = this.loadCount;
      this.send({ customPacketType: "questItemHolders", holders: strays });
    }
  }

  private removeStrayQuestItems(counts: unknown) {
    if (!Array.isArray(counts) || this.questItemHoldersLoad !== this.loadCount) {
      return;
    }
    for (const entry of counts) {
      if (!Array.isArray(entry) || entry.length !== 4 || !entry.every((x) => typeof x === "number") || entry[3] !== 0) {
        continue;
      }
      const [questId, aliasId, holderId] = entry as number[];
      const current = this.sp.getQuestAliasReference(questId, aliasId);
      const holder = ObjectReference.from(Game.getFormEx(holderId));
      const base = current ? ObjectReference.from(Game.getFormEx(current))?.getBaseObject() : null;
      if (holder && base && this.sp.getInventoryReferences(holderId).some((l) => l.ref === current)) {
        holder.removeItem(base, 1, true, null);
        logTrace(this, "Stray quest item removed", questId.toString(16), aliasId, holderId.toString(16));
      }
    }
  }

  private followersKeyOf(refs: number[]) {
    return refs.join(",");
  }

  private reportFollowers() {
    const now = Date.now();
    if (!this.reporting || now - this.followersAt < FOLLOWERS_INTERVAL_MS) {
      return;
    }
    this.followersAt = now;
    const refs = FOLLOWER_SLOTS.map((slot) => this.sp.getQuestAliasReference(DIALOGUE_FOLLOWER, slot.alias) || 0);
    const key = this.followersKeyOf(refs);
    if (key !== this.followersKey) {
      this.followersKey = key;
      this.send({ customPacketType: "followers", refs });
    }
  }

  private applyFollowers(refs: unknown) {
    const quest = Quest.from(Game.getFormEx(DIALOGUE_FOLLOWER));
    const player = Game.getPlayer();
    if (!Array.isArray(refs) || !quest || !player) {
      return;
    }
    FOLLOWER_SLOTS.forEach((slot, i) => {
      const ref = refs[i];
      const actor = typeof ref === "number" && ref ? Actor.from(Game.getFormEx(ref)) : null;
      const alias = ReferenceAlias.from(quest.getAlias(slot.alias));
      if (!actor || !alias || actor.isDead()) {
        return;
      }
      actor.removeFromFaction(Faction.from(Game.getFormEx(DISMISSED_FOLLOWER_FACTION)));
      const rank = actor.getRelationshipRank(player);
      if (rank >= 0 && rank < 3) {
        actor.setRelationshipRank(player, 3);
      }
      actor.setPlayerTeammate(true, slot.canDoFavor);
      alias.forceRefTo(actor);
      actor.evaluatePackage();
      GlobalVariable.from(Game.getFormEx(slot.countGlobal))?.setValue(1);
    });
    this.followersKey = this.followersKeyOf(FOLLOWER_SLOTS.map((slot) => this.sp.getQuestAliasReference(DIALOGUE_FOLLOWER, slot.alias) || 0));
    logTrace(this, "Followers applied", JSON.stringify(refs), "now", this.followersKey);
  }

  private dismissLostFollowers() {
    const party = this.partyState?.party;
    const quest = Quest.from(Game.getFormEx(DIALOGUE_FOLLOWER));
    if (!party || !quest) {
      return;
    }
    FOLLOWER_SLOTS.forEach((slot) => {
      const ref = this.sp.getQuestAliasReference(DIALOGUE_FOLLOWER, slot.alias);
      if (!ref || !party.members.some((m) => m.actor !== this.partyState?.you && m.followers?.includes(ref))) {
        return;
      }
      const actor = Actor.from(Game.getFormEx(ref));
      actor?.setPlayerTeammate(false, false);
      actor?.setFactionRank(Faction.from(Game.getFormEx(DISMISSED_FOLLOWER_FACTION)), 0);
      ReferenceAlias.from(quest.getAlias(slot.alias))?.clear();
      GlobalVariable.from(Game.getFormEx(slot.countGlobal))?.setValue(0);
      actor?.evaluatePackage();
      logTrace(this, "Follower dismissed, another member owns it", ref.toString(16));
    });
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

  private relayTalk() {
    const open = Ui.isMenuOpen(DIALOGUE_MENU);
    const topic = open ? this.sp.getDialogueTopic() : undefined;
    if (topic?.text && this.talkTopic && (topic.id !== this.talkTopic.id || topic.text !== this.talkTopic.text)) {
      this.send({ customPacketType: "talkTopic", text: topic.text });
    }
    this.talkTopic = topic;
    const now = Date.now();
    if (open && this.talkNpc) {
      setTalkTarget(this.talkNpc, now + TALK_AFTER_MS);
    }
    for (const e of this.talkSpeaks.splice(0)) {
      const npc = e.actorId < 0xff000000 ? Actor.from(Game.getFormEx(e.actorId)) : null;
      const talking = !!npc?.isInDialogueWithPlayer();
      if ((talking || isTalkTarget(e.actorId)) && !isRelayedSpeak(e.actorId, e.voiceFile)) {
        if (talking) {
          this.talkNpc = e.actorId;
          setTalkTarget(e.actorId, now + TALK_AFTER_MS);
        }
        this.talkLines.push([e, now]);
      }
    }
    const subtitles = this.talkLines.length ? this.sp.getSubtitles() : [];
    this.talkLines = this.talkLines.filter(([e, at]) => {
      const text = subtitles.find((s) => s.speakerId === e.actorId)?.text;
      if (!text && now - at < TALK_TEXT_MS) {
        return true;
      }
      this.send({ customPacketType: "talkLine", npc: localIdToRemoteId(e.actorId), file: e.voiceFile, text: text || "" });
      return false;
    });
    if (this.subtitleHideAt && Date.now() > this.subtitleHideAt) {
      this.subtitleHideAt = 0;
      Ui.invokeString("HUD Menu", `${HUD_ROOT}.HideSubtitle`, "");
    } else if (this.subtitleHideAt && Ui.isMenuOpen("HUD Menu")) {
      const blank = !(Ui.getString("HUD Menu", `${HUD_ROOT}.SubtitleText.text`) || "").trim();
      if (blank && this.subtitleOnHud) {
        logTrace(this, "The game cleared the relayed subtitle, showing it again");
        Ui.invokeString("HUD Menu", `${HUD_ROOT}.ShowSubtitle`, this.subtitleShown);
      }
      this.subtitleOnHud = !blank;
    }
  }

  private playTalkLine(npc: number, file: string, text: string) {
    const id = remoteIdToLocalId(npc);
    const ac = Actor.from(Game.getFormEx(id));
    if (!ac) {
      return;
    }
    markRelayedSpeak(id, file);
    this.sp.speakSound(id, file);
    if (text) {
      this.showSubtitle(`${ac.getDisplayName()}: ${text}`);
    }
  }

  private showSubtitle(text: string, topic = false) {
    const now = Date.now();
    const shown = !topic && now - this.subtitleTopicAt < TALK_TOPIC_HOLD_MS ? `${this.subtitleTopic}\n${text}` : text;
    if (topic) {
      this.subtitleTopic = text;
      this.subtitleTopicAt = now;
    }
    Ui.invokeString("HUD Menu", `${HUD_ROOT}.ShowSubtitle`, shown);
    this.subtitleShown = shown;
    this.subtitleOnHud = false;
    this.subtitleHideAt = now + Math.min(10000, 2000 + shown.length * 60);
  }

  private setTalkHold(npc: number, on: boolean, pos: number[]) {
    if (on) {
      this.talkHolds.set(npc, Date.now());
    } else {
      this.talkHolds.delete(npc);
    }
    logTrace(this, "talkHold", npc.toString(16), on);
    const ac = Actor.from(Game.getFormEx(npc));
    if (!ac) {
      return;
    }
    ac.setDontMove(on);
    ac.setRestrained(on);
    if (on) {
      ac.setAngle(0, 0, (Math.atan2(pos[0] - ac.getPositionX(), pos[1] - ac.getPositionY()) * 180) / Math.PI);
    } else {
      ac.evaluatePackage();
    }
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
  private reconnecting = false;
  private unreported = new Array<QuestLogEntry>();
  private applying = false;
  private applyQueue = new Array<{ entries: QuestLogEntry[], replay: boolean, followers?: unknown, questItems?: unknown }>();
  private followersAt = 0;
  private followersKey = "";
  private questItemHoldersLoad = -1;
  private isQuestAuthority: boolean | undefined;
  private partyState: PartyState | undefined;
  private partyPositions = new Array<PartyPosition>();
  private compassAt = 0;
  private compassKey = "";
  private compassRect = [35.8, 3.3, 28.3, 3.7];
  private trackedQuests = new Set<number>();
  private expectedEchoes = new Map<string, number>();
  private talkHolds = new Map<number, number>();
  private talkSpeaks = new Array<SpeakSoundEvent>();
  private talkLines = new Array<[SpeakSoundEvent, number]>();
  private talkNpc = 0;
  private talkTopic: { id: number, text: string } | undefined;
  private subtitleHideAt = 0;
  private subtitleShown = "";
  private subtitleOnHud = false;
  private subtitleTopic = "";
  private subtitleTopicAt = 0;
  private partyKeyDown = false;
  private loadCount = 0;
}
