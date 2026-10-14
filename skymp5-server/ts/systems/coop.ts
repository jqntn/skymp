import { Content, Log, System, SystemContext } from "./system";
import { Parties, Party } from "./party";
import { QuestLogEntry, STOP, applyStage, applyStop, lastStage, outOfSyncQuests, parseQuestLog } from "./questLog";
import { CreatedItem, QuestItems, acceptsHolder, isCreatedItem, parseQuestItems } from "./questItems";

export const QUEST_LOG_PROPERTY = "private.questLog";
export const COOP_CREATED_PROPERTY = "private.coopCreated";

const MAX_QUEST_LOG_ENTRIES = 20000;
const NEARBY_DISTANCE = 8192;
const QUEST_LOG_REQUEST_COOLDOWN_MS = 2000;
const INVALID_USER_ID = 65535;
const QUEST_FLAG_ALLOW_REPEATED_STAGES = 0x8;
const QUEST_FLAG_RUN_ONCE = 0x100;
const QUEST_TYPE_NONE = 0;
const ALIAS_FILL_TTL_MS = 60000;
const MAX_RUNNING_QUESTS = 10000;

interface QuestInfo {
  stages: Set<number>;
  runOnce: boolean;
  repeatStages: boolean;
  items: QuestItems;
}

type Handler = (ctx: SystemContext, actor: number, content: Content, userId: number) => void;

const isFormId = (x: unknown): x is number => Number.isInteger(x) && (x as number) > 0 && (x as number) <= 0xffffffff;
const hex = (x: number) => x.toString(16);

export class Coop implements System {
  systemName = "Coop";

  constructor(log: Log, maxPartySize: number) {
    this.log = log;
    this.parties = new Parties(maxPartySize);
  }

  async initAsync(ctx: SystemContext): Promise<void> {
    let gamemode = ctx.svr.onTakeItem;
    Object.defineProperty(ctx.svr, "onTakeItem", {
      configurable: true,
      get: () => (source: number, taker: number, baseId: number, count: number) =>
        gamemode?.(source, taker, baseId, count) !== false && this.mayTake(ctx, source, taker, baseId),
      set: (handler) => {
        gamemode = handler;
      },
    });
  }

  disconnect(userId: number, ctx: SystemContext): void {
    this.lastQuestLogRequest.delete(userId);
    this.runningQuestsReported.delete(userId);
    const actor = ctx.svr.getUserActor(userId);
    if (!actor) {
      return;
    }
    this.parties.forget(actor);
    this.leaveParty(ctx, actor, `${this.name(ctx, actor)} left the party`, false);
    this.questLogs.delete(actor);
  }

  customPacket(userId: number, type: string, content: Content, ctx: SystemContext): void {
    const handler = this.handlers[type];
    if (!handler) {
      return;
    }
    const actor = ctx.svr.getUserActor(userId);
    if (!actor) {
      return;
    }
    handler(ctx, actor, content, userId);
  }

  private readonly handlers: Record<string, Handler> = {
    partyInvite: (ctx, actor, content) => this.invite(ctx, actor, content.target),
    partyAccept: (ctx, actor, content) => this.accept(ctx, actor, content.inviter),
    partyDecline: (ctx, actor, content) => this.decline(ctx, actor, content.inviter),
    partyLeave: (ctx, actor) => this.leaveParty(ctx, actor, `${this.name(ctx, actor)} left the party`),
    partyKick: (ctx, actor, content) => this.kick(ctx, actor, content.target),
    partyPromote: (ctx, actor, content) => this.promote(ctx, actor, content.target),
    questLogRequest: (ctx, actor, _content, userId) => this.sendQuestLog(ctx, actor, userId),
    questStage: (ctx, actor, content) => this.onQuestStage(ctx, actor, content.quest, content.stage),
    questStop: (ctx, actor, content) => this.onQuestStop(ctx, actor, content.quest, content.completed === true),
    aliasFill: (ctx, actor, content) => this.onAliasFill(ctx, actor, content.quest, content.refs),
    questsRunning: (ctx, actor, content, userId) => this.onQuestsRunning(ctx, actor, content.quests, userId),
  };

  private invite(ctx: SystemContext, inviter: number, target: unknown): void {
    if (!isFormId(target)) {
      return;
    }
    if (!this.isOnline(ctx, target)) {
      return this.notice(ctx, inviter, "This player is not online");
    }
    if (!this.isNearby(ctx, inviter, target)) {
      return this.notice(ctx, inviter, "This player is too far away");
    }
    const error = this.parties.invite(inviter, target, Date.now());
    if (error) {
      return this.notice(ctx, inviter, error);
    }
    this.notice(ctx, inviter, `You invited ${this.name(ctx, target)} to your party`);
    this.sendState(ctx, target);
    this.notice(ctx, target, `${this.name(ctx, inviter)} invites you to a party`);
  }

  private accept(ctx: SystemContext, invitee: number, inviter: unknown): void {
    if (!isFormId(inviter)) {
      return;
    }
    if (!this.isOnline(ctx, inviter)) {
      this.parties.decline(invitee, inviter);
      this.sendState(ctx, invitee);
      return this.notice(ctx, invitee, "The inviter is not online");
    }
    const party = this.parties.accept(invitee, inviter, Date.now());
    if (typeof party === "string") {
      this.sendState(ctx, invitee);
      return this.notice(ctx, invitee, party);
    }
    party.outOfSync.set(invitee, outOfSyncQuests(this.questLog(ctx, invitee), this.questLog(ctx, party.leader)));
    this.log(`Coop: ${hex(invitee)} joined party ${party.id}, leader ${hex(party.leader)}, out of sync: ${[...party.outOfSync.get(invitee)!].map(hex)}`);
    this.broadcast(ctx, party, `${this.name(ctx, invitee)} joined the party`);
  }

  private decline(ctx: SystemContext, invitee: number, inviter: unknown): void {
    if (!isFormId(inviter)) {
      return;
    }
    const declined = this.parties.decline(invitee, inviter);
    this.sendState(ctx, invitee);
    if (declined) {
      this.notice(ctx, inviter, `${this.name(ctx, invitee)} declined your invite`);
    }
  }

  private leaveParty(ctx: SystemContext, actor: number, text: string, notifyActor = true): void {
    const party = this.parties.partyOf(actor);
    if (!party) {
      return;
    }
    const others = party.members.filter((m) => m !== actor);
    const oldLeader = party.leader;
    this.parties.leave(actor);
    this.log(`Coop: ${hex(actor)} left party ${party.id}, leader ${party.members.length ? hex(party.leader) : "none"}`);
    if (party.leader !== oldLeader) {
      this.resync(ctx, party);
    }
    if (notifyActor) {
      this.sendState(ctx, actor);
    }
    for (const member of others) {
      this.sendState(ctx, member);
      this.notice(ctx, member, text);
    }
  }

  private kick(ctx: SystemContext, leader: number, target: unknown): void {
    if (!isFormId(target)) {
      return;
    }
    const error = this.parties.canKick(leader, target);
    if (error) {
      return this.notice(ctx, leader, error);
    }
    this.leaveParty(ctx, target, `${this.name(ctx, target)} was removed from the party`);
    this.notice(ctx, target, "You were removed from the party");
  }

  private promote(ctx: SystemContext, leader: number, target: unknown): void {
    if (!isFormId(target)) {
      return;
    }
    const party = this.parties.promote(leader, target);
    if (typeof party === "string") {
      return this.notice(ctx, leader, party);
    }
    this.resync(ctx, party);
    this.log(`Coop: ${hex(target)} leads party ${party.id}`);
    this.broadcast(ctx, party, `${this.name(ctx, target)} is now the party leader`);
  }

  private resync(ctx: SystemContext, party: Party): void {
    party.outOfSync.delete(party.leader);
    const leaderLog = this.questLog(ctx, party.leader);
    for (const member of party.members) {
      if (member !== party.leader) {
        party.outOfSync.set(member, outOfSyncQuests(this.questLog(ctx, member), leaderLog));
      }
    }
  }

  private sendQuestLog(ctx: SystemContext, actor: number, userId: number): void {
    const now = Date.now();
    if (now - (this.lastQuestLogRequest.get(userId) ?? -Infinity) < QUEST_LOG_REQUEST_COOLDOWN_MS) {
      return;
    }
    this.lastQuestLogRequest.set(userId, now);
    const log = this.questLog(ctx, actor);
    this.log(`Coop: replay of ${log.length} quest log entries to ${hex(actor)}`);
    this.send(ctx, actor, { customPacketType: "questApply", entries: log, replay: true });
  }

  private onQuestStage(ctx: SystemContext, reporter: number, quest: unknown, stage: unknown): void {
    if (!isFormId(quest) || !Number.isInteger(stage)) {
      return;
    }
    const info = this.questInfo(ctx, quest);
    if (!info || !info.stages.has(stage as number)) {
      return;
    }
    const changed = new Array<number>();
    for (const actor of this.parties.questGroup(reporter, quest)) {
      if (info.repeatStages && actor !== reporter) {
        continue;
      }
      const log = this.questLog(ctx, actor);
      if (log.length >= MAX_QUEST_LOG_ENTRIES) {
        this.log(`Coop: the quest log of ${hex(actor)} is full`);
        continue;
      }
      if (applyStage(log, quest, stage as number, info.repeatStages, info.runOnce)) {
        this.saveQuestLog(ctx, actor, log, actor === reporter ? undefined : [quest, stage as number]);
        changed.push(actor);
      }
    }
    if (changed.length) {
      this.log(`Coop: quest ${hex(quest)} stage ${stage} from ${hex(reporter)}, logged for ${changed.map(hex)}`);
    }
    if (changed.includes(reporter) && info.items.created.length) {
      this.requestQuestItems(ctx, reporter, quest as number, info);
    }
  }

  private onQuestsRunning(ctx: SystemContext, reporter: number, quests: unknown, userId: number): void {
    const party = this.parties.partyOf(reporter);
    if (this.runningQuestsReported.has(userId) || !Array.isArray(quests) || quests.length > MAX_RUNNING_QUESTS || (party && party.leader !== reporter)) {
      return;
    }
    this.runningQuestsReported.add(userId);
    const log = this.questLog(ctx, reporter);
    for (const pair of quests) {
      const quest = Array.isArray(pair) ? pair[0] : undefined;
      const info = isFormId(quest) ? this.questInfo(ctx, quest) : null;
      if (info?.items.created.length && lastStage(log, quest as number) !== STOP) {
        this.requestQuestItems(ctx, reporter, quest as number, info);
      }
    }
  }

  private mayTake(ctx: SystemContext, source: number, taker: number, baseId: number): boolean {
    const party = this.parties.partyOf(taker);
    if (!party || party.leader === taker) {
      return true;
    }
    const itemsOf = (quest: unknown) => (isFormId(quest) ? this.questInfo(ctx, quest)?.items : undefined);
    if (!isCreatedItem(ctx.svr.get(source, COOP_CREATED_PROPERTY), baseId, itemsOf)) {
      return true;
    }
    this.log(`Coop: ${hex(taker)} cannot take quest item ${hex(baseId)} from ${hex(source)}, only the leader can`);
    this.notice(ctx, taker, "Only the party leader can take quest items");
    return false;
  }

  private requestQuestItems(ctx: SystemContext, reporter: number, quest: number, info: QuestInfo): void {
    const aliases = new Set<number>();
    for (const created of info.items.created) {
      const forced = info.items.holders.get(created.holderAlias)?.ref;
      if (forced !== undefined) {
        this.grantQuestItem(ctx, forced, quest, created);
      } else {
        aliases.add(created.holderAlias);
      }
    }
    if (aliases.size) {
      this.aliasFillRequests.set(`${reporter}:${quest}`, Date.now());
      this.send(ctx, reporter, { customPacketType: "aliasFillRequest", quest, aliases: [...aliases] });
    }
  }

  private onAliasFill(ctx: SystemContext, reporter: number, quest: unknown, refs: unknown): void {
    const key = `${reporter}:${quest}`;
    const requestedAt = this.aliasFillRequests.get(key);
    this.aliasFillRequests.delete(key);
    if (requestedAt === undefined || Date.now() - requestedAt > ALIAS_FILL_TTL_MS || !isFormId(quest) || !Array.isArray(refs)) {
      return;
    }
    const info = this.questInfo(ctx, quest);
    if (!info) {
      return;
    }
    for (const pair of refs) {
      if (!Array.isArray(pair)) {
        continue;
      }
      const [alias, ref] = pair;
      const holder = info.items.holders.get(alias);
      let record;
      try {
        record = isFormId(ref) ? ctx.svr.lookupEspmRecordById(ref).record : undefined;
      } catch {
        record = undefined;
      }
      if (!acceptsHolder(holder, ref, record)) {
        this.log(`Coop: alias ${alias} of quest ${hex(quest)} from ${hex(reporter)} rejected (${ref})`);
        continue;
      }
      for (const created of info.items.created.filter((c) => c.holderAlias === alias)) {
        this.grantQuestItem(ctx, ref as number, quest, created);
      }
    }
  }

  private grantQuestItem(ctx: SystemContext, holder: number, quest: number, created: CreatedItem): void {
    try {
      const done = ctx.svr.get(holder, COOP_CREATED_PROPERTY);
      const granted = Array.isArray(done) ? (done as unknown[]) : [];
      if (granted.some((g) => Array.isArray(g) && g[0] === quest && g[1] === created.alias)) {
        return;
      }
      const item = ctx.svr.callPapyrusFunction("global", "Game", "GetFormEx", null, [created.item]);
      ctx.svr.callPapyrusFunction("method", "ObjectReference", "AddItem", { type: "form", desc: ctx.svr.getDescFromId(holder) }, [item, 1, true]);
      ctx.svr.set(holder, COOP_CREATED_PROPERTY, [...granted, [quest, created.alias]]);
      this.log(`Coop: quest ${hex(quest)} alias ${created.alias} created ${hex(created.item)} in ${hex(holder)}`);
    } catch (e) {
      this.log(`Coop: quest ${hex(quest)} alias ${created.alias} could not create ${hex(created.item)} in ${hex(holder)}`, e);
    }
  }

  private onQuestStop(ctx: SystemContext, reporter: number, quest: unknown, completed: boolean): void {
    if (!isFormId(quest)) {
      return;
    }
    const info = this.questInfo(ctx, quest);
    if (!info || lastStage(this.questLog(ctx, reporter), quest) === STOP) {
      return;
    }
    const changed = new Array<number>();
    for (const actor of this.parties.questGroup(reporter, quest)) {
      if (info.repeatStages && actor !== reporter) {
        continue;
      }
      const log = this.questLog(ctx, actor);
      if (applyStop(log, quest, completed || info.runOnce)) {
        this.saveQuestLog(ctx, actor, log, actor === reporter ? undefined : [quest, STOP]);
        changed.push(actor);
      }
    }
    if (changed.length) {
      this.log(`Coop: quest ${hex(quest)} stopped (completed: ${completed}) from ${hex(reporter)}, logged for ${changed.map(hex)}`);
    }
  }

  private questLog(ctx: SystemContext, actor: number): QuestLogEntry[] {
    let log = this.questLogs.get(actor);
    if (!log) {
      log = parseQuestLog(ctx.svr.get(actor, QUEST_LOG_PROPERTY));
      this.questLogs.set(actor, log);
    }
    return log;
  }

  private saveQuestLog(ctx: SystemContext, actor: number, log: QuestLogEntry[], relayed?: QuestLogEntry): void {
    ctx.svr.set(actor, QUEST_LOG_PROPERTY, log);
    if (relayed) {
      this.send(ctx, actor, { customPacketType: "questApply", entries: [relayed], replay: false });
    }
  }

  private questInfo(ctx: SystemContext, quest: number): QuestInfo | null {
    if (this.questInfos.has(quest)) {
      return this.questInfos.get(quest)!;
    }
    let info: QuestInfo | null = null;
    try {
      const record = ctx.svr.lookupEspmRecordById(quest).record;
      const dnam = record?.type === "QUST" ? record.fields.find((f) => f.type === "DNAM") : undefined;
      const dnamView = dnam && dnam.data.byteLength >= 12
        ? new DataView(dnam.data.buffer, dnam.data.byteOffset, dnam.data.byteLength)
        : undefined;
      if (record && dnamView && dnamView.getUint32(8, true) !== QUEST_TYPE_NONE) {
        const flags = dnamView.getUint16(0, true);
        info = {
          stages: new Set(),
          runOnce: !!(flags & QUEST_FLAG_RUN_ONCE),
          repeatStages: !!(flags & QUEST_FLAG_ALLOW_REPEATED_STAGES),
          items: parseQuestItems(record.fields),
        };
        for (const field of record.fields) {
          if (field.type === "INDX" && field.data.byteLength >= 2) {
            info.stages.add(new DataView(field.data.buffer, field.data.byteOffset, 2).getInt16(0, true));
          }
        }
      }
    } catch (e) {
      this.log(`Coop: lookup of quest ${hex(quest)} failed`, e);
    }
    this.questInfos.set(quest, info);
    return info;
  }

  private broadcast(ctx: SystemContext, party: Party, text: string): void {
    for (const member of party.members) {
      this.sendState(ctx, member);
      this.notice(ctx, member, text);
    }
  }

  private sendState(ctx: SystemContext, actor: number): void {
    const party = this.parties.partyOf(actor);
    this.send(ctx, actor, {
      customPacketType: "partyState",
      you: actor,
      party: party
        ? { leader: party.leader, members: party.members.map((m) => ({ actor: m, name: this.name(ctx, m) })) }
        : null,
      invites: this.parties.invitesOf(actor, Date.now()).map((inviter) => ({ inviter, name: this.name(ctx, inviter) })),
    });
  }

  private notice(ctx: SystemContext, actor: number, text: string): void {
    this.send(ctx, actor, { customPacketType: "partyNotice", text });
  }

  private send(ctx: SystemContext, actor: number, content: Content): void {
    const userId = ctx.svr.getUserByActor(actor);
    if (userId === INVALID_USER_ID || !ctx.svr.isConnected(userId)) {
      return;
    }
    try {
      ctx.svr.sendCustomPacket(userId, JSON.stringify(content));
    } catch (e) {
      this.log(`Coop: failed to send ${content.customPacketType} to ${hex(actor)}`, e);
    }
  }

  private isOnline(ctx: SystemContext, actor: number): boolean {
    const userId = ctx.svr.getUserByActor(actor);
    return userId !== INVALID_USER_ID && ctx.svr.isConnected(userId);
  }

  private isNearby(ctx: SystemContext, a: number, b: number): boolean {
    if (ctx.svr.getActorCellOrWorld(a) !== ctx.svr.getActorCellOrWorld(b)) {
      return false;
    }
    const pa = ctx.svr.getActorPos(a);
    const pb = ctx.svr.getActorPos(b);
    return Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]) <= NEARBY_DISTANCE;
  }

  private name(ctx: SystemContext, actor: number): string {
    try {
      return ctx.svr.getActorName(actor) || "Someone";
    } catch {
      return "Someone";
    }
  }

  private log: Log;
  private parties: Parties;
  private lastQuestLogRequest = new Map<number, number>();
  private runningQuestsReported = new Set<number>();
  private questLogs = new Map<number, QuestLogEntry[]>();
  private questInfos = new Map<number, QuestInfo | null>();
  private aliasFillRequests = new Map<string, number>();
}
