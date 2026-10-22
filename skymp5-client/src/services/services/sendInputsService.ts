import { ClientListener, CombinedController, Sp } from "./clientListener";
import { SinglePlayerService } from "./singlePlayerService";
import { FormModel, WorldModel } from "../../view/model";
import { MsgType } from "../../messages";
import { getMovement } from "../../sync/movementGet";

// TODO: refactor this out
import * as worldViewMisc from "../../view/worldViewMisc";

import { Animation, getAnimationSource } from "../../sync/animation";
import { Actor, EquipEvent, FormType, SpeakSoundEvent } from "skyrimPlatform";
import { getAppearance } from "../../sync/appearance";
import { ActorValues, getActorValues } from "../../sync/actorvalues";
import { getEquipment } from "../../sync/equipment";
import { nextHostAttempt, teleportingHosts, tryHost } from "../../view/hostAttempts";
import { isRelayedSpeak, isTalkTarget } from "../../view/talkEvents";
import { ObjectReferenceEx } from "../../extensions/objectReferenceEx";
import { CoopService } from "./coopService";
import { SkympClient } from "./skympClient";
import { MessageWithRefrId } from "../events/sendMessageWithRefrIdEvent";
import { UpdateMovementMessage } from "../messages/updateMovementMessage";
import { ChangeValuesMessage } from "../messages/changeValuesMessage";
import { UpdateAnimationMessage } from "../messages/updateAnimationMessage";
import { UpdateEquipmentMessage } from "../messages/updateEquipmentMessage";
import { UpdateAppearanceMessage } from "../messages/updateAppearanceMessage";
import { RemoteServer } from "./remoteServer";
import { DeathService } from "./deathService";
import { logTrace } from "../../logging";

const playerFormId = 0x14;
const espActorIdOffset = 0x100000000;
const idleHostedMovementRateMs = 500;
const idleHostedMovementAfterMs = 3000;
const hostedSitResendMs = 3000;

// TODO: split this service into EquipmentService, MovementService, AnimationService, ActorValueService, HostAttemptsService
export class SendInputsService extends ClientListener {
    constructor(private sp: Sp, private controller: CombinedController) {
        super();
        this.controller.on("update", () => this.onUpdate());
        this.controller.on("equip", (e) => this.onEquip(e));
        this.controller.on("unequip", (e) => this.onUnequip(e));
        this.controller.on("loadGame", () => this.onLoadGame());
        this.controller.on("speakSound", (e) => this.onSpeakSound(e));
        this.controller.emitter.on("hostStartMessage", (e) => this.onHostStart(e.message.target));
        this.controller.emitter.on("hostStopMessage", (e) => this.onHostStop(e.message.target));
    }

    private onSpeakSound(e: SpeakSoundEvent) {
        const hosted = this.sp.storage["hosted"];
        if (e.actorId < 0xff000000 && Array.isArray(hosted) && hosted.includes(e.actorId + espActorIdOffset)) {
            this.pendingSpeaks.push(e);
        }
    }

    private applyPendingSpeaks() {
        for (const e of this.pendingSpeaks.splice(0)) {
            const actor = this.sp.Actor.from(this.sp.Game.getFormEx(e.actorId));
            if (actor && !isTalkTarget(e.actorId) && !isRelayedSpeak(e.actorId, e.voiceFile)) {
                getAnimationSource(actor, true).addSpeak(e.voiceFile);
            }
        }
    }

    private onHostStart(remoteId: number) {
        this.startedHosts.add(remoteId);
    }

    private applyStartedHosts() {
        this.startedHosts.forEach((remoteId) => {
            const owner = this.getInputOwner(remoteId);
            if (this.hiddenHosts.delete(remoteId)) {
                owner?.enableNoWait(false);
            }
            if (owner && remoteId >= espActorIdOffset) {
                getAnimationSource(owner, true).restart(owner.getSitState() === 0);
                this.lastSitSent.delete(owner.getFormID().toString(16));
            }
        });
        this.startedHosts.clear();
    }

    private onHostStop(remoteId: number) {
        if (remoteId >= espActorIdOffset) {
            this.stoppedHosts.set(remoteId, Date.now());
        }
    }

    private onUpdate() {
        if (!this.singlePlayerService.isSinglePlayer) {
            this.applyStartedHosts();
            this.applyPendingSpeaks();
            this.sendInputs();
            this.updatePapyrusEventsAllowedForms();

            const player = this.sp.Game.getPlayer()!;
            const isPlayerCasting = player.getAnimationVariableBool("IsCastingRight")
                || player.getAnimationVariableBool("IsCastingLeft")
                || player.getAnimationVariableBool("IsCastingDual");

            if (isPlayerCasting) {
                this.prevCastingDetectedTime = Date.now();
            }
        }
    }

    private updatePapyrusEventsAllowedForms() {
        const hosted = this.sp.storage['hosted'];
        const remoteIds = (Array.isArray(hosted) ? hosted as number[] : []).filter((remoteId) => remoteId >= espActorIdOffset);
        const key = remoteIds.join(",");
        if (key === this.papyrusEventsAllowedKey) {
            return;
        }
        this.papyrusEventsAllowedKey = key;
        const dragon = this.sp.Keyword.getKeyword("ActorTypeDragon");
        this.sp.setPapyrusEventsAllowedForms(remoteIds
            .map((remoteId) => remoteId - espActorIdOffset)
            .filter((formId) => !dragon || !this.sp.Actor.from(this.sp.Game.getFormEx(formId))?.hasKeyword(dragon)));
    }

    private onEquip(event: EquipEvent) {
        if (!event.actor || !event.baseObj) {
            return;
        }

        if (event.actor.getFormID() !== playerFormId) {
            return;
        }

        const type = event.baseObj.getType();
        if (type !== FormType.Book && type !== FormType.Potion && type !== FormType.Ingredient) {
            // Trigger UpdateEquipment only for equips that are not spell tomes, potions, ingredients
            this.equipmentChanged = true;
        }

        // Send OnEquip for any equips including spell tomes, potions, ingredients
        // Otherwise, the server won't trigger spell learn, potion drink, ingredient eat and Papyrus scripts
        this.controller.emitter.emit("sendMessage", {
            message: { t: MsgType.OnEquip, baseId: event.baseObj.getFormID() },
            reliability: "unreliable"
        });
    }

    private onUnequip(event: EquipEvent) {
        if (!event.actor || !event.baseObj) {
            return;
        }

        if (event.actor.getFormID() === playerFormId) {
            this.equipmentChanged = true;
        }
    }

    private onLoadGame() {
        // Currently only armor is equipped after relogging (see remoteServer.ts)
        // This hack forces sending /equipment without weapons/ back to the server
        this.sp.Utility.wait(3).then(() => (this.equipmentChanged = true));
    }

    private sendInputs() {
        const reporting = this.controller.lookupListener(CoopService).isReporting();
        if (reporting) {
            this.releaseLostHosts();
            this.updateHiddenHosts();
        }
        const hosted =
            reporting && typeof this.sp.storage['hosted'] === typeof [] ? this.sp.storage['hosted'] : [];
        const targets = [undefined].concat(hosted as any);

        const modelSource = this.controller.lookupListener(RemoteServer);

        const world = modelSource.getWorldModel();

        targets.forEach((target) => {
            const targetFormModel = target ? this.getForm(target, world) : this.getForm(undefined, world);
            this.sendMovement(target, targetFormModel);
            this.sendAnimation(target);
            this.sendAppearance(target);
            this.sendEquipment(target);
            this.sendActorValuePercentage(target, targetFormModel);
        });
        this.sendHostAttempts();
    }

    private sendMovement(_refrId?: number, form?: FormModel) {
        const owner = this.getInputOwner(_refrId);
        if (!owner) {
          return;
        }

        const refrIdStr = `${_refrId}`;
        const sendMovementRateMs = 130;
        const now = Date.now();
        const last = this.lastSendMovementMoment.get(refrIdStr);
        if (!last || now - last > sendMovementRateMs) {
            this.lastSendMovementMoment.set(refrIdStr, now);
            const data = getMovement(owner, form);
            if (_refrId && form) {
                form.movement = data;
            }
            const key = _refrId ? JSON.stringify([owner.getSitState(), data], (k, v) => (typeof v === "number" && k !== "healthPercentage" ? Math.round(v * 10) / 10 : v)) : "";
            const sent = this.lastSentMovement.get(refrIdStr);
            const changedAt = sent && sent.key === key ? sent.changedAt : now;
            if (_refrId && sent && sent.key === key && now - changedAt >= idleHostedMovementAfterMs && now - sent.at < idleHostedMovementRateMs) {
                return;
            }
            const message: MessageWithRefrId<UpdateMovementMessage> = {
                t: MsgType.UpdateMovement,
                data,
                _refrId
            };
            this.controller.emitter.emit("sendMessageWithRefrId", {
                message,
                reliability: "unreliable"
            });
            this.lastSentMovement.set(refrIdStr, { key, at: now, changedAt });
        }
    }

    private sendActorValuePercentage(_refrId?: number, form?: FormModel) {
        if (_refrId) {
          return;
        }
        const canSend = form && (form.isDead ?? false) === false;
        if (!canSend) {
          return;
        }

        const owner = this.getInputOwner(_refrId);
        if (!owner) {
          return;
        }

        const av = getActorValues(this.sp.Game.getPlayer() as Actor);
        const currentTime = Date.now();
        if (
            this.actorValuesNeedUpdate === false &&
            this.prevValues.health === av.health &&
            this.prevValues.stamina === av.stamina &&
            this.prevValues.magicka === av.magicka
        ) {
            return;
        }


        if (
            currentTime - this.prevActorValuesUpdateTime < 2000 &&
            this.actorValuesNeedUpdate === false
        ) {
            return;
        }

        // Delaying actor values update due to casting
        // TODO: use partial updates for actor values once server finally supports it
        // i.e. keep sending health and stamina during casting, but delay magicka update
        if (
            currentTime - this.prevCastingDetectedTime < 500 &&
            av.health > 0 // don't delay death actor value update
        ) {
            return;
        }

        const deathService = this.controller.lookupListener(DeathService);
        if (deathService.isBusy()) {
            logTrace(this, "Not sending actor values, death service is busy");
            return;
        }

        const message: MessageWithRefrId<ChangeValuesMessage> = {
            t: MsgType.ChangeValues,
            data: av,
            _refrId
        };
        this.controller.emitter.emit("sendMessageWithRefrId", {
            message,
            reliability: "unreliable"
        });
        this.actorValuesNeedUpdate = false;
        this.prevValues = av;
        this.prevActorValuesUpdateTime = currentTime;

    }

    private sendAnimation(_refrId?: number) {
        const owner = this.getInputOwner(_refrId);
        if (!owner) {
          return;
        }

        // Extermly important that it's a local id since AnimationSource depends on it
        const refrIdStr = owner.getFormID().toString(16);

        const animSource = getAnimationSource(owner, !!_refrId);
        if (_refrId) {
            const sitState = owner.getSitState();
            if (sitState === 0 && this.lastSitState.get(refrIdStr)) {
                animSource.addStand();
            }
            if (sitState === 0) {
                this.lastSitSent.delete(refrIdStr);
            } else if (sitState === 3 && Date.now() - (this.lastSitSent.get(refrIdStr) ?? 0) > hostedSitResendMs) {
                const furniture = owner.getFurnitureReference();
                if (furniture) {
                    animSource.addSit(furniture.getFormID());
                    this.lastSitSent.set(refrIdStr, Date.now());
                }
            }
            this.lastSitState.set(refrIdStr, sitState);
            if (!owner.isDead() && owner.getFlyingState() !== 0 && Date.now() - (this.lastFlySent.get(refrIdStr) ?? 0) > 3000) {
                animSource.addFly();
                this.lastFlySent.set(refrIdStr, Date.now());
            }
        }
        for (const anim of _refrId ? animSource.drain() : [animSource.getAnimation()]) {
            const lastAnimationSent = this.lastAnimationSent.get(refrIdStr);
            if (
                !lastAnimationSent ||
                anim.numChanges !== lastAnimationSent.numChanges
            ) {
                // Drink potion anim from this mod https://www.nexusmods.com/skyrimspecialedition/mods/97660
                if (anim.animEventName !== '' && !anim.animEventName.startsWith("DrinkPotion_")) {
                    this.lastAnimationSent.set(refrIdStr, anim);
                    this.updateActorValuesAfterAnimation(anim.animEventName);
                    const message: MessageWithRefrId<UpdateAnimationMessage> = {
                        t: MsgType.UpdateAnimation,
                        data: anim,
                        _refrId
                    };
                    this.controller.emitter.emit("sendMessageWithRefrId", {
                        message,
                        reliability: _refrId ? "reliable" : "unreliable"
                    });
                }
            }
        }
    }

    private sendAppearance(_refrId?: number) {
        if (_refrId) {
          return;
        }
        const shown = this.sp.Ui.isMenuOpen('RaceSex Menu');
        if (shown != this.isRaceSexMenuShown) {
            this.isRaceSexMenuShown = shown;
            if (!shown) {
                this.sp.printConsole('Exited from race menu');

                const appearance = getAppearance(this.sp.Game.getPlayer() as Actor);
                // TODO: log appearance contents to debug appearance issues?
                const message: MessageWithRefrId<UpdateAppearanceMessage> = {
                    t: MsgType.UpdateAppearance,
                    data: appearance,
                    _refrId
                };
                this.controller.emitter.emit("sendMessageWithRefrId", {
                    message,
                    reliability: "reliable"
                });
            }
        }
    }

    private sendEquipment(_refrId?: number) {
        if (_refrId) {
          return;
        }
        if (this.equipmentChanged) {
            this.equipmentChanged = false;

            ++this.numEquipmentChanges;

            const eq = getEquipment(
                this.sp.Game.getPlayer() as Actor,
                this.numEquipmentChanges,
            );
            const message: MessageWithRefrId<UpdateEquipmentMessage> = {
                t: MsgType.UpdateEquipment,
                data: eq,
                _refrId
            };

            this.controller.emitter.emit("sendMessageWithRefrId", {
                message,
                reliability: "reliable"
            });
        }
    }

    private sendHostAttempts() {
        const remoteId = nextHostAttempt();
        if (!remoteId || !this.controller.lookupListener(CoopService).isReporting()) {
          return;
        }

        if (remoteId < espActorIdOffset) {
            this.controller.emitter.emit("sendMessage", {
                message: {
                    t: MsgType.Host,
                    remoteId
                },
                reliability: "unreliable"
            });
            return;
        }

        const actor = this.getInputOwner(remoteId);
        const player = this.sp.Game.getPlayer()!;
        const hidden = this.hiddenHosts.has(remoteId);
        if (
            !actor || actor.isDead() || (!hidden && (!actor.is3DLoaded() || actor.isDisabled()))
            || ObjectReferenceEx.getWorldOrCell(actor) !== ObjectReferenceEx.getWorldOrCell(player)
            || actor.getDistance(player) > 4096
            || Date.now() - (this.yieldedAt.get(remoteId) ?? 0) < 10000
            || teleportingHosts.has(remoteId)
            || this.controller.lookupListener(CoopService).yieldsHost(actor)
        ) {
            return;
        }

        this.controller.emitter.emit("sendMessage", {
            message: {
                t: MsgType.Host,
                remoteId,
                worldOrCell: ObjectReferenceEx.getWorldOrCell(actor),
                pos: [actor.getPositionX(), actor.getPositionY(), actor.getPositionZ()],
                rot: [actor.getAngleX(), actor.getAngleY(), actor.getAngleZ()]
            },
            reliability: "unreliable"
        });
    }

    private releaseLostHosts() {
        const hosted = this.sp.storage['hosted'];
        if (!Array.isArray(hosted)) {
            return;
        }
        const now = Date.now();
        hosted.filter((remoteId: number) => remoteId >= espActorIdOffset).forEach((remoteId: number) => {
            const actor = this.getInputOwner(remoteId);
            const yields = !!actor && this.controller.lookupListener(CoopService).yieldsHost(actor);
            if (actor && actor.is3DLoaded() && !actor.isDisabled() && !yields) {
                this.lostHostSince.delete(remoteId);
                return;
            }
            const since = this.lostHostSince.get(remoteId) ?? now;
            this.lostHostSince.set(remoteId, since);
            if (now - since < 2000) {
                return;
            }
            this.lostHostSince.delete(remoteId);
            if (yields) {
                this.yieldedAt.set(remoteId, now);
            }
            this.controller.emitter.emit("sendMessage", {
                message: { t: MsgType.Host, remoteId, release: true, disabled: !!actor && actor.isDisabled() },
                reliability: "reliable"
            });
            this.sp.storage['hosted'] = (this.sp.storage['hosted'] as number[]).filter((x) => x !== remoteId);
        });
    }

    private updateHiddenHosts() {
        const now = Date.now();
        this.stoppedHosts.forEach((at, remoteId) => {
            if (now - at < 1000) {
                return;
            }
            this.stoppedHosts.delete(remoteId);
            const actor = this.getInputOwner(remoteId);
            if (actor && actor.is3DLoaded() && !worldViewMisc.getViewFromStorage()?.getLocalRefrId(remoteId)) {
                actor.disableNoWait(false);
                this.hiddenHosts.set(remoteId, now);
            }
        });
        this.hiddenHosts.forEach((at, remoteId) => {
            if (worldViewMisc.getViewFromStorage()?.getLocalRefrId(remoteId)) {
                this.hiddenHosts.delete(remoteId);
                this.getInputOwner(remoteId)?.enableNoWait(false);
                return;
            }
            if (now - at < 5000) {
                return;
            }
            this.hiddenHosts.set(remoteId, now);
            tryHost(remoteId);
        });
    }

    private getInputOwner(_refrId?: number) {
        return _refrId
            ? this.sp.Actor.from(this.sp.Game.getFormEx(_refrId >= espActorIdOffset ? _refrId - espActorIdOffset : worldViewMisc.remoteIdToLocalId(_refrId)))
            : this.sp.Game.getPlayer();
    }

    private getForm(refrId: number | undefined, world: WorldModel): FormModel | undefined {
        const form = refrId
            ? world?.forms.find((f) => f?.refrId === refrId)
            : world.forms[world.playerCharacterFormIdx];
        return form;
    }

    private updateActorValuesAfterAnimation(animName: string) {
        if (
            animName === 'JumpLand' ||
            animName === 'JumpLandDirectional' ||
            animName === 'DeathAnim'
        ) {
            this.actorValuesNeedUpdate = true;
        }
    }

    private get singlePlayerService() {
        return this.controller.lookupListener(SinglePlayerService);
    }

    private lastSendMovementMoment = new Map<string, number>();
    private lastSentMovement = new Map<string, { key: string, at: number, changedAt: number }>();
    private lastAnimationSent = new Map<string, Animation>();
    private lastSitState = new Map<string, number>();
    private lastSitSent = new Map<string, number>();
    private lastFlySent = new Map<string, number>();
    private actorValuesNeedUpdate = false;
    private isRaceSexMenuShown = false;
    private equipmentChanged = false;
    private numEquipmentChanges = 0;
    private prevValues: ActorValues = { health: 0, stamina: 0, magicka: 0 };
    private prevActorValuesUpdateTime = 0;
    private prevCastingDetectedTime = 0;
    private lostHostSince = new Map<number, number>();
    private yieldedAt = new Map<number, number>();
    private hiddenHosts = new Map<number, number>();
    private startedHosts = new Set<number>();
    private pendingSpeaks = new Array<SpeakSoundEvent>();
    private stoppedHosts = new Map<number, number>();
    private papyrusEventsAllowedKey = "";
}
