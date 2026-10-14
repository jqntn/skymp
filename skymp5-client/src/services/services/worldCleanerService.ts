import { ClientListener, CombinedController, Sp } from "./clientListener";
import { Actor, ObjectLoadedEvent } from "skyrimPlatform";
import { CoopService } from "./coopService";
import { tryHost } from "../../view/hostAttempts";
import { getViewFromStorage } from "../../view/worldViewMisc";

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
    this.sp.updateAnimations();
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
      this.claim(actorId);
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

  private claim(actorId: number) {
    const remoteId = actorId + 0x100000000;
    const hosted = this.sp.storage["hosted"];
    if (
      actorId === 0x14 || Date.now() < (this.claimAfter.get(actorId) ?? 0)
      || (Array.isArray(hosted) && hosted.includes(remoteId))
      || getViewFromStorage()?.getLocalRefrId(remoteId)
    ) {
      return;
    }
    this.claimAfter.set(actorId, Date.now() + 5000);
    tryHost(remoteId);
  }

  private isActorInDialogue(ac: Actor) {
    return ac.isInDialogueWithPlayer() || ac.getDialogueTarget() !== null;
  }

  private protection = new Map<number, number>();
  private pausedUntil = 0;
  private claimAfter = new Map<number, number>();
}
