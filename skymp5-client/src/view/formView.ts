import { Actor, ActorBase, createText, Debug, destroyText, Form, FormType, Game, isAnimationGraphReady, Keyword, NetImmerse, ObjectReference, once, printConsole, setTextPos, setTextSize, setTextString, storage, TESModPlatform, Ui, Utility, worldPointToScreenPoint } from "skyrimPlatform";
import { setDefaultAnimsDisabled, applyAnimation, standUp, instantEnter } from "../sync/animation";
import { pushTalk } from "./talkEvents";
import { Appearance, applyAppearance } from "../sync/appearance";
import { isBadMenuShown, applyEquipment } from "../sync/equipment";
import { RespawnNeededError } from "../lib/errors";
import { FormModel } from "./model";
import { applyMovement } from "../sync/movementApply";
import { SpawnProcess } from "./spawnProcess";
import { ObjectReferenceEx } from "../extensions/objectReferenceEx";
import { PlayerCharacterDataHolder } from "./playerCharacterDataHolder";
import { getMovement } from "../sync/movementGet";
import { lastTryHost, tryHost } from "./hostAttempts";
import { ModelApplyUtils } from "./modelApplyUtils";
import { Inventory } from "../sync/inventory";
import { localIdToRemoteId } from "./worldViewMisc";
import { SpApiInteractor } from "../services/spApiInteractor";
import { WorldCleanerService } from "../services/services/worldCleanerService";
import { GamemodeUpdateService } from "../services/services/gamemodeUpdateService";

export interface ScreenResolution {
  width: number;
  height: number;
}

let _screenResolution: ScreenResolution | undefined;
export const getScreenResolution = (): ScreenResolution => {
  if (!_screenResolution) {
    _screenResolution = {
      width: Utility.getINIInt("iSize W:Display"),
      height: Utility.getINIInt("iSize H:Display"),
    }
  }
  return _screenResolution;
}

const espActorIdOffset = 0x100000000;
const seatWaitMs = 4000;
const talkRefreshMs = 20000;

const pelvisNodes = ["NPC Pelvis [Pelv]", "NPC Pelvis"];

const bodyOffset = (ac: Actor): number[] => {
  const node = pelvisNodes.find((name) => NetImmerse.hasNode(ac, name, false));
  if (!node) {
    return [0, 0, 0];
  }
  return [
    NetImmerse.getNodeWorldPositionX(ac, node, false) - ac.getPositionX(),
    NetImmerse.getNodeWorldPositionY(ac, node, false) - ac.getPositionY(),
    NetImmerse.getNodeWorldPositionZ(ac, node, false) - ac.getPositionZ(),
  ];
};

const endPuppetHold = (ac: Actor, damageMult: number, lethalHit: boolean, serverDead: boolean, healthPercentage?: number) => {
  ac.endDeferredKill();
  if (!serverDead && (lethalHit || ac.getActorValue("health") <= 0)) {
    ac.resurrect();
    if (healthPercentage !== undefined && healthPercentage < 1) {
      const missing = ac.getBaseActorValue("health") * (1 - Math.max(healthPercentage, 0.01));
      ac.damageActorValue("health", missing);
    }
  }
  ac.setActorValue("attackDamageMult", damageMult);
};

export class FormView {
  constructor(private remoteRefrId?: number) { }

  update(model: FormModel): void {
    const realActorId = model.refrId && model.refrId > espActorIdOffset ? model.refrId - espActorIdOffset : 0;

    // Other players mutate into PC clones when moving to another location
    if (model.movement) {
      if (!this.lastWorldOrCell)
        this.lastWorldOrCell = model.movement.worldOrCell;
      if (this.lastWorldOrCell !== model.movement.worldOrCell) {
        printConsole(
          `[1] worldOrCell changed, destroying FormView ${this.lastWorldOrCell.toString(
            16
          )} => ${model.movement.worldOrCell.toString(16)}`
        );
        this.lastWorldOrCell = model.movement.worldOrCell;
        this.destroy();
        this.refrId = 0;
        this.appearanceBasedBaseId = 0;
        return;
      }
    }



    // Don't spawn dead actors if not already
    if (model.isDead && !realActorId) {
      if (this.refrId === 0) {
        return;
      }
    }

    // Players with different worldOrCell should be invisible
    if (model.movement) {
      const worldOrCell = ObjectReferenceEx.getWorldOrCell(Game.getPlayer() as Actor);
      if (
        worldOrCell !== 0 &&
        model.movement.worldOrCell !== worldOrCell
      ) {
        this.destroy();
        this.refrId = 0;
        return;
      }
    }

    // Apply appearance before base form selection to prevent double-spawn
    if (model.appearance || (!model.appearance && this.appearanceState.appearance)) {
      if (
        !this.appearanceState.appearance ||
        model.numAppearanceChanges !== this.appearanceState.lastNumChanges
      ) {

        // Both non-null
        if (model.appearance && this.appearanceState.appearance) {
          const modelAppearanceCopy: Appearance = JSON.parse(JSON.stringify(model.appearance));
          const stateAppearanceCopy: Appearance = JSON.parse(JSON.stringify(this.appearanceState.appearance));
          modelAppearanceCopy.name = "";
          stateAppearanceCopy.name = "";
          const equalWithoutNames = JSON.stringify(modelAppearanceCopy) === JSON.stringify(stateAppearanceCopy);

          if (equalWithoutNames) {
            // Change name inplace
            const refr = ObjectReference.from(Game.getFormEx(this.refrId));
            refr?.getBaseObject()?.setName(model.appearance.name);
            refr?.setDisplayName(model.appearance.name, true);
            //printConsole("Appearance updated, changing name inplace");
          } else {
            // Force re-apply appearance on the next getAppearanceBasedBase call
            this.appearanceBasedBaseId = 0;
            //printConsole("Appearance updated");
          }
        } else {
          // Force re-apply appearance on the next getAppearanceBasedBase call
          this.appearanceBasedBaseId = 0;
          //printConsole("Appearance updated");
        }

        this.appearanceState.appearance = model.appearance || null;
        this.appearanceState.lastNumChanges = model.numAppearanceChanges as number;
      }
    }

    const refId =
      model.refrId && model.refrId < 0xff000000 ? model.refrId : realActorId;
    if (refId) {
      if (this.refrId !== refId) {
        this.destroy();
        this.refrId = refId;
        this.realActor = !!realActorId;
        this.ready = true;
        const refr = ObjectReference.from(Game.getFormEx(this.refrId));
        const base = refr?.getBaseObject();
        if (refr && base && !realActorId) {
          ObjectReferenceEx.dealWithRef(refr, base);
        }
        const actor = Actor.from(refr);
        if (actor && realActorId) {
          actor.blockActivation(false);
          if (actor.isDisabled()) {
            actor.enable(false);
          }
        }
      }
    } else {
      let templateChain = model.templateChain;

      // There is no place for random/leveling in 1-sized chain
      // Just spawn an NPC, do not generate a temporary TESNPC form
      if (templateChain?.length === 1) {
        templateChain = undefined;
      }

      // TODO: getLeveledBase crashes too often ATM
      let base = null; //Game.getFormEx(this.getLeveledBase(templateChain));
      if (base === null) {
        base = Game.getFormEx(model.baseId || NaN);
      }
      if (base === null) {
        base = Game.getFormEx(this.getAppearanceBasedBase());
      }
      if (base === null) {
        return;
      }

      let refr = ObjectReference.from(Game.getFormEx(this.refrId));

      let respawnRequired = false;
      if (!refr) {
        respawnRequired = true;
      } else if (!refr.getBaseObject()) {
        respawnRequired = true;
      } else if ((refr.getBaseObject() as Form).getFormID() !== base.getFormID()) {
        respawnRequired = true;
      }

      if (respawnRequired) {
        this.destroy();

        const player = Game.getPlayer() as Actor;

        const spawnMethodOriginal = {
          spawn(baseForm: Form, _spawnPosition: [number, number, number], _spawnRotation: [number, number, number]): ObjectReference {
            return player.placeAtMe(
              baseForm,
              1,
              true,
              true
            ) as ObjectReference;
          },

          triggerSpawnProcess(spawningRefr: ObjectReference, spawnPosition: [number, number, number], appearance: Appearance | null, callback: () => void) {
            new SpawnProcess(
              appearance,
              spawnPosition,
              spawningRefr.getFormID(),
              callback
            );
          }
        };

        const spawnMethodStub = {
          spawn(baseForm: Form, spawnPosition: [number, number, number], spawnRotation: [number, number, number]): ObjectReference {
            const f = storage["formViewFunc1"] as Function;
            const ref: ObjectReference = f(baseForm, spawnPosition, spawnRotation);
            return ref;
          },

          triggerSpawnProcess(spawningRefr: ObjectReference, spawnPosition: [number, number, number], appearance: Appearance | null, callback: () => void) {
            const f = storage["formViewFunc2"] as Function;
            f(spawningRefr, spawnPosition, appearance, callback);
          }
        };

        const spawnUsingStubMethod = base.getType() === FormType.NPC
          && !this.appearanceState.appearance
          && storage["formViewFunc1Set"] === true
          && storage["formViewFunc2Set"] === true;
        const spawnMethod = spawnUsingStubMethod ? spawnMethodStub : spawnMethodOriginal;

        if (model.movement) {
          refr = spawnMethod.spawn(base, model.movement.pos, model.movement.rot);
        } else {
          printConsole("model.movement was " + model.movement);
        }

        this.state = {};
        delete this.wasHostedByOther;
        if (base.getType() !== FormType.NPC) {
          refr?.setAngle(
            model.movement?.rot[0] || 0,
            model.movement?.rot[1] || 0,
            model.movement?.rot[2] || 0
          );
        } else {
          const race = Actor.from(refr)?.getRace()?.getFormID();
          const draugrRace = 0xd53;
          const falmerRace = 0x131f4;
          const chaurusRace = 0x131eb;
          const frostbiteSpiderRaceGiant = 0x4e507;
          const frostbiteSpiderRaceLarge = 0x53477;
          const dwarvenCenturionRace = 0x131f1;
          const dwarvenSphereRace = 0x131f2;
          const dwarvenSpiderRace = 0x131f3;
          const sprigganRace = 0x2013b77;
          const sprigganRace2 = 0xf3903;
          const sprigganRace3 = 0x13204;
          const sprigganRace4 = 0x401b644;
          const sprigganRace5 = 0x9aa44;
          const wolfRace = 0x1320a;

          // potential masterambushscript
          if (race === draugrRace
            || race === falmerRace
            || race === chaurusRace
            || race === frostbiteSpiderRaceGiant
            || race === frostbiteSpiderRaceLarge
            || race === dwarvenCenturionRace
            || race === dwarvenSphereRace
            || race === dwarvenSpiderRace
            || race === sprigganRace
            || race === sprigganRace2
            || race === sprigganRace3
            || race === sprigganRace4
            || race === sprigganRace5
            || race === wolfRace) {
            Actor.from(refr)?.setActorValue("Aggression", 2);
          }
        }

        if (refr !== null) {
          SpApiInteractor.getControllerInstance().lookupListener(WorldCleanerService).modWcProtection(refr.getFormID(), 1);
        }

        // TODO: reset all states?
        this.eqState = this.getDefaultEquipState();
        this.animState = this.getDefaultAnimState();

        this.ready = false;

        let spawnPos;
        if (model.movement) {
          spawnPos = model.movement.pos;
          // printConsole("Spawn NPC at movement.pos");
        } else {
          spawnPos = ObjectReferenceEx.getPos(Game.getPlayer() as Actor);
          printConsole("Spawn NPC at player pos");
        }

        if (refr) {
          spawnMethod.triggerSpawnProcess(refr, spawnPos, model.appearance || null, () => {
            this.ready = true;
            this.spawnMoment = Date.now();
          });
        } else {
          printConsole("Unable to triggerSpawnProcess for null refr");
        }

        if (model.appearance && model.appearance.name) {
          refr?.setDisplayName("" + model.appearance.name, true);
        }
        Actor.from(refr)?.setActorValue("attackDamageMult", 0);
      }
      this.refrId = (refr as ObjectReference).getFormID();
    }

    if (!this.ready) {
      return;
    }

    const refr = ObjectReference.from(Game.getFormEx(this.refrId));
    if (refr) {
      const actor = Actor.from(refr);
      if (actor && !this.localImmortal && !this.realActor) {
        actor.startDeferredKill();
        actor.setActorValue("health", 1000000);
        actor.setActorValue("magicka", 1000000);
        this.localImmortal = true;
      }
      this.applyAll(refr, model);

      const gamemodeUpdateService = SpApiInteractor.getControllerInstance().lookupListener(GamemodeUpdateService);
      gamemodeUpdateService.updateNeighbor(refr, model, this.state);
    }
  }

  destroy(): void {
    this.isOnScreen = false;
    this.spawnMoment = 0;
    const refrId = this.refrId;
    const realActor = this.realActor;
    const wasPuppet = this.puppetMode === true;
    const damageMult = this.savedDamageMult;
    const lethalHit = this.puppetLethalHit;
    const serverDead = this.serverDead;
    const healthPercentage = this.serverHealthPercentage;
    const pendingEnable = this.enableAt !== 0;
    const flightHeld = this.flightHeld;
    this.flightHeld = false;
    this.enableAt = 0;
    this.puppetLethalHit = false;
    this.realActor = false;
    this.corpseBlocked = false;
    this.corpseInventory = undefined;
    this.puppetMode = undefined;
    once("update", () => {
      if (realActor) {
        const ac = Actor.from(Game.getFormEx(refrId));
        ac?.clearKeepOffsetFromActor();
        ac?.enableAI(false);
        if (pendingEnable) {
          ac?.enableNoWait(false);
        }
        if (flightHeld) {
          ac?.setDontMove(false);
        }
        if (ac && wasPuppet) {
          endPuppetHold(ac, damageMult, lethalHit, serverDead, healthPercentage);
        }
        setDefaultAnimsDisabled(refrId, false);
      }
      if (refrId >= 0xff000000) {
        const refr = ObjectReference.from(Game.getFormEx(refrId));
        if (refr) {
          refr.delete();
        }
        SpApiInteractor.getControllerInstance().lookupListener(WorldCleanerService).modWcProtection(refrId, -1);
        const ac = Actor.from(refr);
        if (ac) {
          TESModPlatform.setWeaponDrawnMode(ac, -1);
        }
      }
    })

    this.localImmortal = false;
    this.removeNickname();
  }

  private realActor = false;
  private corpseBlocked = false;
  private corpseInventory?: Inventory;
  private hostedHere = false;
  private enableAt = 0;
  private puppetMode?: boolean;
  private savedDamageMult = 1;
  private puppetLethalHit = false;
  private serverDead = false;
  private serverHealthPercentage?: number;
  private lastHarvestedApply = 0;
  private lastOpenApply = 0;
  private isSetNodeTextureSetApplied = false;
  private isSetNodeScaleApplied = false;

  private applyAll(refr: ObjectReference, model: FormModel) {
    let forcedWeapDrawn: boolean | null = null;

    if (PlayerCharacterDataHolder.getCrosshairRefId() === this.refrId) {
      this.lastHarvestedApply = 0;
      this.lastOpenApply = 0;
    }
    const now = Date.now();
    if (!this.realActor && now - this.lastHarvestedApply > 666) {
      this.lastHarvestedApply = now;
      ModelApplyUtils.applyModelIsHarvested(refr, !!model.isHarvested);
    }
    if (!this.realActor && now - this.lastOpenApply > 133) {
      this.lastOpenApply = now;
      ModelApplyUtils.applyModelIsOpen(refr, !!model.isOpen);
    }
    if (!this.isSetNodeScaleApplied) {
      this.isSetNodeScaleApplied = true;
      ModelApplyUtils.applyModelNodeScale(refr, model.setNodeScale);
    }
    if (!this.isSetNodeTextureSetApplied) {
      this.isSetNodeTextureSetApplied = true;
      ModelApplyUtils.applyModelNodeTextureSet(refr, model.setNodeTextureSet);
    }

    if (
      model.inventory &&
      PlayerCharacterDataHolder.getCrosshairRefId() == this.refrId &&
      !isBadMenuShown()
    ) {
      // Do not let actors breaking their equipment via inventory apply
      // However, actually, actors do not have inventory in their models
      // Except your clone.
      if (!Actor.from(refr)) {
        ModelApplyUtils.applyModelInventory(refr, model.inventory);
        model.inventory = undefined;
      }
    }

    if (model.animation) {
      if (model.animation.animEventName === "SkympFakeUnequip") {
        forcedWeapDrawn = false;
      } else if (model.animation.animEventName === "SkympFakeEquip") {
        forcedWeapDrawn = true;
      }
    }

    // TODO: make host service
    const hosted = storage['hosted'];
    let alreadyHosted = false;
    if (Array.isArray(hosted)) {
      const remoteId = localIdToRemoteId(this.refrId);

      if (hosted.includes(remoteId) || hosted.includes(remoteId + 0x100000000)) {
        alreadyHosted = true;
      }
    }
    setDefaultAnimsDisabled(this.refrId, alreadyHosted ? false : true);

    if (alreadyHosted && !this.hostedHere) {
      Actor.from(refr)?.clearKeepOffsetFromActor();
    }
    this.hostedHere = alreadyHosted;

    const talksToPlayer = this.realActor && (!!Actor.from(refr)?.isInDialogueWithPlayer() || (this.movState.talksToPlayer && Ui.isMenuOpen("Dialogue Menu")));
    if (talksToPlayer && !this.movState.talksToPlayer) {
      Actor.from(refr)?.clearKeepOffsetFromActor();
      refr.stopTranslation();
    }
    if (model.isHostedByOther && model.refrId && model.refrId > espActorIdOffset && (talksToPlayer !== this.movState.talksToPlayer || (talksToPlayer && Date.now() - this.movState.talkSentAt > talkRefreshMs))) {
      pushTalk(model.refrId - espActorIdOffset, talksToPlayer);
      this.movState.talkSentAt = Date.now();
    }
    this.movState.talksToPlayer = talksToPlayer;

    if (model.movement && this.hostedHere) {
      this.movState.lastNumChanges = +(model.numMovementChanges as number);
      this.movState.lastApply = Date.now();
      this.movState.everApplied = true;
    } else if (model.movement) {
      let ac = Actor.from(refr);
      if (
        this.movState.lastApply &&
        Date.now() - this.movState.lastApply > 1500
      ) {
        if (Date.now() - this.movState.lastRehost > 1000) {
          this.movState.lastRehost = Date.now();
          const remoteId = this.remoteRefrId;
          if (ac && ac.is3DLoaded()) {
            this.tryHostIfNeed(ac, remoteId as number);
            printConsole("tryHostIfNeed - reason: not seeing movement for long time");
          }
        }
      }

      if (
        +(model.numMovementChanges as number) !==
        this.movState.lastNumChanges ||
        Date.now() - this.movState.lastApply > 2000
      ) {
        this.movState.lastApply = Date.now();
        if (talksToPlayer && model.isHostedByOther) {
          this.movState.lastNumChanges = +(model.numMovementChanges as number);
        } else if (
          this.realActor && ac && ac.is3DLoaded() && !model.isHostedByOther && !model.isDead && !this.movState.everApplied
          && ObjectReferenceEx.getWorldOrCell(ac) === ObjectReferenceEx.getWorldOrCell(Game.getPlayer() as Actor)
        ) {
          this.movState.lastNumChanges = +(model.numMovementChanges as number);
          this.movState.everApplied = true;
          this.tryHostIfNeed(ac, this.remoteRefrId as number);
        } else if (this.realActor && !model.isHostedByOther && !model.isDead && !this.movState.everApplied) {
          this.movState.lastNumChanges = +(model.numMovementChanges as number);
          this.movState.everApplied = true;
        } else if (model.isHostedByOther || !this.movState.everApplied) {
          const backup = model.movement.isWeapDrawn;
          if (forcedWeapDrawn === true || forcedWeapDrawn === false) {
            model.movement.isWeapDrawn = forcedWeapDrawn;
          }
          try {
            applyMovement(refr, model.movement, !!model.isMyClone, !!model.isDead);
          } catch (e) {
            if (e instanceof RespawnNeededError) {
              this.lastWorldOrCell = model.movement.worldOrCell;
              this.destroy();
              this.refrId = 0;
              this.appearanceBasedBaseId = 0;
              return;
            } else {
              throw e;
            }
          }
          model.movement.isWeapDrawn = backup;

          this.movState.lastNumChanges = +(model.numMovementChanges as number);
          this.movState.everApplied = true;
        } else {
          const remoteId = this.remoteRefrId;
          if (ac && remoteId && ac.is3DLoaded()) {
            ac.clearKeepOffsetFromActor();

            // TODO: make host service
            const hosted = storage['hosted'];
            let alreadyHosted = false;
            if (Array.isArray(hosted)) {
              const remoteId = localIdToRemoteId(ac.getFormID());
              if (hosted.includes(remoteId) || hosted.includes(remoteId + 0x100000000)) {
                alreadyHosted = true;
              }
            }

            if (!alreadyHosted) {
              if (this.tryHostIfNeed(ac, remoteId)) {

                // previously, we did this cleanup on each update
                // but I guess it's too expensive and can possibly hurt FPS
                TESModPlatform.setWeaponDrawnMode(ac, -1);
              }
            }
          }
        }
      }
    }

    const ac = Actor.from(refr);
    if (this.realActor && ac) {
      const wantAI = this.hostedHere || talksToPlayer;
      if (this.hostedHere && this.wasHostedByOther && !ac.isAIEnabled() && !ac.isOnMount() && ac.getSitState() !== 0) {
        ac.disableNoWait(false);
        this.enableAt = Date.now() + 300;
      }
      const deadOnServer = !!model.isDead || !!model.movement?.isDead;
      const serverPos = !this.hostedHere ? model.movement?.pos : undefined;
      if (!deadOnServer) {
        this.deathReloads = 0;
        this.corpseTarget = undefined;
      }
      const holdFlight = !wantAI && !!model.isHostedByOther && !deadOnServer && !ac.isDead() && ac.isFlying();
      if (holdFlight !== this.flightHeld) {
        this.flightHeld = holdFlight;
        ac.setDontMove(holdFlight);
      }
      this.hosterDeadAt = !this.hostedHere && !!model.movement?.isDead && !ac.isDead() ? this.hosterDeadAt || Date.now() : 0;
      const deathStuck = !!this.hosterDeadAt && Date.now() - this.hosterDeadAt > 1000;
      if (deadOnServer && !ac.isDead() && (ac.isFlying() || deathStuck) && this.deathReloads < 3 && !this.enableAt) {
        this.deathReloads++;
        this.hosterDeadAt = this.hosterDeadAt && Date.now();
        ac.disableNoWait(false);
        if (serverPos) {
          ac.setPosition(serverPos[0], serverPos[1], serverPos[2]);
        }
        this.enableAt = Date.now() + 500;
      }
      const corpseTarget = deadOnServer && ac.isDead() && serverPos ? [serverPos[0], serverPos[1], serverPos[2]] : undefined;
      if (corpseTarget && (!this.corpseTarget || Math.hypot(corpseTarget[0] - this.corpseTarget[0], corpseTarget[1] - this.corpseTarget[1], corpseTarget[2] - this.corpseTarget[2]) > 32)) {
        this.corpseTarget = corpseTarget;
        this.corpseTargetAt = Date.now();
      }
      const body = corpseTarget && ac.is3DLoaded() ? bodyOffset(ac) : undefined;
      if (
        corpseTarget && body && !this.enableAt && Date.now() - this.corpseTargetAt > 2000 && Date.now() - this.corpseMovedAt > 3000
        && Math.hypot(ac.getPositionX() + body[0] - corpseTarget[0], ac.getPositionY() + body[1] - corpseTarget[1], ac.getPositionZ() + body[2] - corpseTarget[2]) > 128
      ) {
        this.corpseMovedAt = Date.now();
        const refrId = this.refrId;
        ac.forceRemoveRagdollFromWorld().then(() => once("update", () => {
          const corpse = Actor.from(Game.getFormEx(refrId));
          if (corpse) {
            const offset = bodyOffset(corpse);
            corpse.setPosition(corpseTarget[0] - offset[0], corpseTarget[1] - offset[1], corpseTarget[2] - offset[2]);
          }
        }));
      }
      if (this.enableAt && Date.now() >= this.enableAt) {
        this.enableAt = 0;
        ac.enableNoWait(false);
      }
      if (wantAI !== ac.isAIEnabled()) {
        ac.enableAI(wantAI);
      }
      this.wasHostedByOther = !this.hostedHere && (this.wasHostedByOther || !!model.isHostedByOther);
      if (!wantAI && ac.isInCombat()) {
        ac.stopCombat();
      }
      const puppet = !this.hostedHere;
      this.serverDead = !!model.isDead;
      const corpse = (this.serverDead || !!model.movement?.isDead) && ac.isDead();
      if (corpse !== this.corpseBlocked) {
        ac.blockActivation(corpse);
        this.corpseBlocked = corpse;
      }
      if (corpse && model.inventory && model.inventory !== this.corpseInventory && !Utility.isInMenuMode()) {
        this.corpseInventory = model.inventory;
        ModelApplyUtils.applyModelCorpseInventory(ac, model.inventory);
      }
      this.serverHealthPercentage = model.movement?.healthPercentage;
      if (this.puppetMode && !this.serverDead && ac.getActorValue("health") <= 0) {
        this.puppetLethalHit = true;
      }
      if (this.puppetMode && puppet && ac.getActorValue("attackDamageMult") !== 0) {
        ac.startDeferredKill();
        ac.setActorValue("attackDamageMult", 0);
      }
      if (puppet !== this.puppetMode) {
        if (puppet) {
          this.animState.seatWaitFrom = Date.now();
          this.animState.seat = undefined;
          this.animState.ownSeat = false;
          this.animState.seatTries = 0;
          this.animState.standTries = 0;
          const damageMult = ac.getActorValue("attackDamageMult");
          if (damageMult > 0) {
            this.savedDamageMult = damageMult;
          }
          ac.startDeferredKill();
          ac.setActorValue("attackDamageMult", 0);
        } else if (this.puppetMode) {
          endPuppetHold(ac, this.savedDamageMult, this.puppetLethalHit, this.serverDead, this.serverHealthPercentage);
          this.puppetLethalHit = false;
        }
        this.puppetMode = puppet;
      }
    }

    const animReady = refr.is3DLoaded() && (!this.realActor || isAnimationGraphReady(refr.getFormID()));
    if (animReady && Date.now() >= this.animState.applyAfter) {
      const otherHostedPuppet = this.realActor && !this.hostedHere && !!model.isHostedByOther && !!ac && !ac.isDead() && !ac.isOnMount() && !ac.isAIEnabled();
      if (otherHostedPuppet && ac && Date.now() >= this.animState.postureAt) {
        this.animState.postureAt = Date.now() + 1000;
        const seat = this.animState.seat;
        if (ac.getSitState() !== 0) {
          const unknownTooLong = seat === undefined && Date.now() - this.animState.seatWaitFrom > seatWaitMs;
          const otherFurniture = !!seat && ac.getFurnitureReference()?.getFormID() !== seat.furniture;
          if ((seat === null || (!this.animState.ownSeat && (unknownTooLong || otherFurniture))) && this.animState.standTries < 3) {
            this.animState.standTries++;
            standUp(ac);
          }
        } else if (seat && seat.enter && this.animState.seatTries < 3) {
          this.animState.seatTries++;
          this.animState.postureAt = Date.now() + 2000;
          this.animState.ownSeat = true;
          Debug.sendAnimationEvent(ac, instantEnter(seat.enter));
        }
      }
      const queued = model.animationQueue?.splice(0) ?? [];
      const lastNumChanges = this.animState.lastNumChanges;
      if (model.animation && !this.hostedHere && !this.movState.talksToPlayer) {
        for (const anim of queued.length ? queued : [model.animation]) {
          applyAnimation(refr, anim, this.animState);
        }
      }
      if (this.animState.useAnimOverrides && this.animState.overriddenAnimEventName) {
        this.animState.followUpAnimEventName = this.animState.overriddenAnimEventName;
        this.animState.overriddenAnimEventName = undefined;
        this.animState.applyAfter = Date.now() + 1000;
      } else if (this.animState.followUpAnimEventName) {
        if (this.animState.lastNumChanges === lastNumChanges && !this.hostedHere) {
          Debug.sendAnimationEvent(refr, this.animState.followUpAnimEventName);
        }
        this.animState.followUpAnimEventName = undefined;
      }
      // Use them only once, for spawning actors with correct animations
      this.animState.useAnimOverrides = false;
    }


    if (model.appearance) {
      const actor = Actor.from(refr);
      if (actor && !PlayerCharacterDataHolder.isInJumpState()) {
        if (PlayerCharacterDataHolder.getWorldOrCell()) {
          if (
            this.lastPcWorldOrCell &&
            PlayerCharacterDataHolder.getWorldOrCell() !== this.lastPcWorldOrCell
          ) {
            // Redraw tints if PC world/cell changed
            this.isOnScreen = false;
          }
          this.lastPcWorldOrCell = PlayerCharacterDataHolder.getWorldOrCell();
        }

        const headPos = [
          NetImmerse.getNodeWorldPositionX(actor, "NPC Head [Head]", false),
          NetImmerse.getNodeWorldPositionY(actor, "NPC Head [Head]", false),
          NetImmerse.getNodeWorldPositionZ(actor, "NPC Head [Head]", false),
        ];
        const [screenPoint] = worldPointToScreenPoint(headPos);
        const isOnScreen =
          screenPoint[0] > 0 &&
          screenPoint[1] > 0 &&
          screenPoint[2] > 0 &&
          screenPoint[0] < 1 &&
          screenPoint[1] < 1 &&
          screenPoint[2] < 1;
        if (isOnScreen != this.isOnScreen) {
          this.isOnScreen = isOnScreen;
          if (isOnScreen) {
            actor.queueNiNodeUpdate();
            (Game.getPlayer() as Actor).queueNiNodeUpdate();
          }
        }
      }
    }

    if (model.equipment && !this.realActor) {
      if (this.eqState.lastNumChanges !== model.equipment.numChanges) {
        const ac = Actor.from(refr);
        // If we do not block inventory here, we will be able to reproduce the bug:
        // 1. Place ~90 bots and force them to reequip iron swords to the left hand (rate should be ~50ms)
        // 2. Open your inventory and reequip different items fast
        // 3. After 1-2 minutes close your inventory and see that HUD disappeared
        if (
          ac &&
          !isBadMenuShown() &&
          Date.now() - this.eqState.lastEqMoment > 500 &&
          Date.now() - this.spawnMoment > -1 &&
          this.spawnMoment > 0
        ) {
          //if (this.spawnMoment > 0 && Date.now() - this.spawnMoment > 5000) {
          if (applyEquipment(ac, model.equipment)) {
            this.eqState.lastNumChanges = model.equipment.numChanges;
          }
          this.eqState.lastEqMoment = Date.now();
          //}
          //const res: boolean = applyEquipment(ac, model.equipment);
          //if (res) this.eqState.lastNumChanges = model.equipment.numChanges;
        }
      }
    }

    if (FormView.isDisplayingNicknames && this.refrId && model.appearance?.name) {
      const headPart = "NPC Head [Head]";
      const maxNicknameDrawDistance = 1000;
      const playerActor = Game.getPlayer()!;
      const isVisibleByPlayer = !model.movement?.isSneaking
        && playerActor.getDistance(refr) <= maxNicknameDrawDistance
        && playerActor.hasLOS(refr)
        && !this.isSweetHidePerson(refr);
      if (isVisibleByPlayer) {
        const headScreenPos = worldPointToScreenPoint([
          NetImmerse.getNodeWorldPositionX(refr, headPart, false),
          NetImmerse.getNodeWorldPositionY(refr, headPart, false),
          NetImmerse.getNodeWorldPositionZ(refr, headPart, false) + 32
        ])[0];
        const resolution = getScreenResolution();
        const textXPos = Math.round(headScreenPos[0] * resolution.width);
        const textYPos = Math.round((1 - headScreenPos[1]) * resolution.height);

        if (!this.textNameId && headScreenPos[2] > 0) {
          this.textNameId = createText(textXPos, textYPos, refr.getDisplayName(), [1, 1, 1, 0.8]);
          setTextSize(this.textNameId, 0.5);
          SpApiInteractor.getControllerInstance().emitter.emit("nicknameCreate", {
            remoteRefrId: this.getRemoteRefrId(),
            textId: this.textNameId
          });
        } else {
          const deleteNickname = headScreenPos[2] < 0;
          if (deleteNickname) {
            this.removeNickname();
          }
          if (this.textNameId) {
            setTextPos(this.textNameId, textXPos, textYPos);
          }
        }
      } else {
        this.removeNickname();
      }
    } else {
      this.removeNickname();
    }
  }

  private isSweetHidePerson(refr: ObjectReference): boolean {
    const actor = Actor.from(refr)
    if (!actor) {
      return false;
    }
    const keyword = Keyword.getKeyword('SweetHidePerson');
    return actor.wornHasKeyword(keyword);
  }

  private removeNickname() {
    if (this.textNameId) {
      SpApiInteractor.getControllerInstance().emitter.emit("nicknameDestroy", {
        remoteRefrId: this.getRemoteRefrId(),
        textId: this.textNameId
      });
      destroyText(this.textNameId);
      this.textNameId = undefined;
    }
  }

  private getAppearanceBasedBase(): number {
    const base = ActorBase.from(Game.getFormEx(this.appearanceBasedBaseId));
    if (!base && this.appearanceState.appearance) {
      this.appearanceBasedBaseId = applyAppearance(this.appearanceState.appearance).getFormID();
    }
    return this.appearanceBasedBaseId;
  }

  private getLeveledBase(templateChain: number[] | undefined): number {
    if (templateChain === undefined) {
      return 0;
    }

    const str = templateChain.join(',');

    if (this.leveledBaseId === 0) {
      // @ts-ignore
      const leveledBase = TESModPlatform.evaluateLeveledNpc(str);
      if (!leveledBase) {
        printConsole("Failed to evaluate leveled npc", str);
      }
      this.leveledBaseId = leveledBase?.getFormID() || 0;
    }

    return this.leveledBaseId;
  }

  private getDefaultEquipState() {
    return { lastNumChanges: 0, lastEqMoment: 0 };
  };

  private getDefaultAppearanceState() {
    return { lastNumChanges: 0, appearance: null as (null | Appearance) };
  };

  private getDefaultAnimState() {
    return { lastNumChanges: 0, useAnimOverrides: true, seat: undefined as { furniture: number, enter: string } | null | undefined, ownSeat: false, seatTries: 0, standTries: 0, postureAt: 0, seatWaitFrom: Date.now(), applyAfter: 0, followUpAnimEventName: undefined as string | undefined, overriddenAnimEventName: undefined as string | undefined };
  };

  private tryHostIfNeed(ac: Actor, remoteId: number) {
    const last = lastTryHost[remoteId];
    if (!last || Date.now() - last >= 1000) {
      lastTryHost[remoteId] = Date.now();

      if (
        getMovement(ac).worldOrCell ===
        getMovement(Game.getPlayer() as Actor).worldOrCell
      ) {
        tryHost(remoteId);
        return true;
      }
    }
    return false;
  };

  getLocalRefrId(): number {
    return this.refrId;
  }

  getRemoteRefrId(): number {
    return this.remoteRefrId as number;
  }

  private refrId = 0;
  private deathReloads = 0;
  private hosterDeadAt = 0;
  private corpseMovedAt = 0;
  private flightHeld = false;
  private corpseTarget?: number[];
  private corpseTargetAt = 0;
  private ready = false;
  private animState = this.getDefaultAnimState();
  private movState = {
    lastNumChanges: 0,
    lastApply: 0,
    lastRehost: 0,
    everApplied: false,
    talksToPlayer: false,
    talkSentAt: 0,
  };
  private appearanceState = this.getDefaultAppearanceState();
  private eqState = this.getDefaultEquipState();
  private appearanceBasedBaseId = 0;
  private leveledBaseId = 0;
  private isOnScreen = false;
  private lastPcWorldOrCell = 0;
  private lastWorldOrCell = 0;
  private spawnMoment = 0;
  private wasHostedByOther: boolean | undefined = undefined;
  private state = {};
  private localImmortal = false;
  private textNameId: number | undefined = undefined;


  public static isDisplayingNicknames: boolean = true;
}
