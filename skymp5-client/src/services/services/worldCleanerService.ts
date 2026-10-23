import { ClientListener, CombinedController, Sp } from "./clientListener";
import { Actor, ObjectLoadedEvent } from "skyrimPlatform";
import { CoopService } from "./coopService";
import { MsgType } from "../../messages";
import { ObjectReferenceEx } from "../../extensions/objectReferenceEx";
import { getViewFromStorage } from "../../view/worldViewMisc";
import { movingActors } from "../../sync/movementApply";
import { RemoteServer } from "./remoteServer";
import { logTrace } from "../../logging";

const serverBannedRaceIds = [0x000e7713, 0x001052a3, 0x0010760a];

export class WorldCleanerService extends ClientListener {
  constructor(private sp: Sp, private controller: CombinedController) {
    super();
    this.controller.on("update", () => this.onUpdate());
    this.controller.on("objectLoaded", (e) => this.onObjectLoaded(e));
  }

  private onObjectLoaded(e: ObjectLoadedEvent) {
    const actor = this.sp.Actor.from(e.object);
    if (!e.isLoaded || !actor) {
      return;
    }
    const id = actor.getFormID();
    const hosted = this.sp.storage["hosted"];
    if (id === 0x14 || id >= 0xff000000 || (Array.isArray(hosted) && hosted.includes(id + 0x100000000))) {
      return;
    }
    if (serverBannedRaceIds.includes(actor.getRace()?.getFormID() ?? 0)) {
      return;
    }
    actor.enableAI(false);
  }

  modWcProtection(actorId: number, mod: number): void {
    const currentProtection = this.protection.get(actorId);
    this.protection.set(actorId, currentProtection ? currentProtection + mod : mod);
  }

  getWcProtection(actorId: number): number {
    return this.protection.get(actorId) || 0;
  }

  pauseUntil(timestampMs: number): void {
    this.pausedUntil = timestampMs;
  }

  private onUpdate() {
    this.sp.updateAnimations(Array.from(movingActors.keys()));
    this.processOneActor();
  }

  private processOneActor() {
    const pc = this.sp.Game.getPlayer();
    if (pc === null || Date.now() < this.pausedUntil) {
      return;
    }

    const actor = this.sp.Game.findRandomActor(
      pc.getPositionX(),
      pc.getPositionY(),
      pc.getPositionZ(),
      8192
    );
    if (actor === null) {
      return;
    }

    const actorId = actor.getFormID();

    const currentProtection = this.protection.get(actorId) || 0;
    if (currentProtection > 0) {
      return;
    }

    if (actorId < 0xff000000) {
      this.reportUnstreamed(actor, pc);
      return;
    }

    if (actor.isDisabled() || actor.isDeleted()) {
      return;
    }

    if (this.controller.lookupListener(CoopService).isQuestActor(actor)) {
      return;
    }

    if (this.isActorInDialogue(actor)) {
      // Deleting actor in dialogue crashes Skyrim
      // https://github.com/skyrim-multiplayer/issue-tracker/issues/13
      actor.setPosition(0, 0, 0);
      actor.disableNoWait(true); // Seems to not crash
      return;
    }

    actor.disable(false).then(() => {
      const ac = this.sp.Actor.from(this.sp.Game.getFormEx(actorId));
      if (!ac || this.isActorInDialogue(ac)) {
        return;
      }
      ac.delete();
    });
  }

  private isDisabledOnServer(remoteId: number): boolean {
    const form = this.controller.lookupListener(RemoteServer).getWorldModel().forms.find((f) => f?.refrId === remoteId);
    return !!(form as Record<string, unknown> | undefined)?.isDisabled;
  }

  private reportUnstreamed(actor: Actor, pc: Actor) {
    const actorId = actor.getFormID();
    const remoteId = actorId + 0x100000000;
    const hosted = this.sp.storage["hosted"];
    if (
      actorId === 0x14 || !this.controller.lookupListener(CoopService).isReporting()
      || (Array.isArray(hosted) && hosted.includes(remoteId))
      || (getViewFromStorage()?.getLocalRefrId(remoteId) && !this.isDisabledOnServer(remoteId))
      || serverBannedRaceIds.includes(actor.getRace()?.getFormID() ?? 0)
      || actor.isDead() || actor.isDisabled() || !actor.is3DLoaded() || actor.isInDialogueWithPlayer()
      || ObjectReferenceEx.getWorldOrCell(actor) !== ObjectReferenceEx.getWorldOrCell(pc)
      || actor.getDistance(pc) > 4096
    ) {
      this.unstreamedSince.delete(actorId);
      return;
    }
    const now = Date.now();
    const teleports = this.controller.lookupListener(RemoteServer).getPlayerTeleports();
    const since = this.unstreamedSince.get(actorId);
    if (since !== undefined && since.teleports !== teleports) {
      this.unstreamedSince.delete(actorId);
      return;
    }
    if (since === undefined) {
      this.unstreamedSince.set(actorId, { at: now, teleports });
      logTrace(this, `Reporting ${actorId.toString(16)} at ${ObjectReferenceEx.getWorldOrCell(actor).toString(16)} ${[actor.getPositionX(), actor.getPositionY(), actor.getPositionZ()].map(Math.round)}`);
      this.controller.emitter.emit("sendMessage", {
        message: {
          t: MsgType.Host,
          remoteId,
          worldOrCell: ObjectReferenceEx.getWorldOrCell(actor),
          pos: [actor.getPositionX(), actor.getPositionY(), actor.getPositionZ()],
          rot: [actor.getAngleX(), actor.getAngleY(), actor.getAngleZ()]
        },
        reliability: "reliable"
      });
    } else if (now - since.at >= 2000) {
      this.unstreamedSince.delete(actorId);
      logTrace(this, `Hiding ${actorId.toString(16)}: the server does not stream it`);
      actor.disableNoWait(false);
    }
  }

  private isActorInDialogue(ac: Actor) {
    return ac.isInDialogueWithPlayer() || ac.getDialogueTarget() !== null;
  }

  private protection = new Map<number, number>();
  private pausedUntil = 0;
  private unstreamedSince = new Map<number, { at: number, teleports: number }>();
}
