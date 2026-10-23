import { ClientListener, CombinedController, Sp } from "./clientListener";
import { SinglePlayerService } from "./singlePlayerService";
import { FormModel, WorldModel } from "../../view/model";
import { MsgType } from "../../messages";
import { getMovement } from "../../sync/movementGet";
import { moveActorTo } from "../../sync/movementApply";
import { Transform } from "../../sync/movement";

// TODO: refactor this out
import * as worldViewMisc from "../../view/worldViewMisc";

import { Animation, getAnimationSource, relayedCombatTargets, relayedSeats } from "../../sync/animation";
import { Actor, EquipEvent, FormType, SpeakSoundEvent } from "skyrimPlatform";
import { getAppearance } from "../../sync/appearance";
import { ActorValues, getActorValues } from "../../sync/actorvalues";
import { getEquipment } from "../../sync/equipment";
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
const serverPositionToleranceUnits = 512;

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
            if (owner && remoteId >= espActorIdOffset) {
                this.placeAtServerPosition(owner, remoteId);
                getAnimationSource(owner, true).restart(owner.getSitState() === 0);
                this.lastSitSent.delete(owner.getFormID().toString(16));
                const target = relayedCombatTargets.get(owner.getFormID()) ?? 0;
                logTrace(this, `Host start of ${owner.getFormID().toString(16)}: sit ${owner.getSitState()}, combat target ${target.toString(16)}, at ${[owner.getPositionX(), owner.getPositionY(), owner.getPositionZ()].map(Math.round)}`);
                if (target) {
                    this.pendingCombat.set(remoteId, { target, until: Date.now() + 2000 });
                }
            }
        });
        this.startedHosts.clear();
    }

    private placeAtServerPosition(owner: Actor, remoteId: number) {
        const m = this.getForm(remoteId, this.controller.lookupListener(RemoteServer).getWorldModel())?.movement;
        if (!m || (ObjectReferenceEx.getWorldOrCell(owner) === m.worldOrCell
            && Math.hypot(owner.getPositionX() - m.pos[0], owner.getPositionY() - m.pos[1], owner.getPositionZ() - m.pos[2]) <= serverPositionToleranceUnits)) {
            return;
        }
        this.placingHosts.set(remoteId, { at: 0, tries: 0 });
    }

    private isPlacing(remoteId: number, owner: Actor, m?: Transform) {
        const placing = this.placingHosts.get(remoteId);
        if (placing === undefined) {
            return false;
        }
        if (!m || (ObjectReferenceEx.getWorldOrCell(owner) === m.worldOrCell
            && Math.hypot(owner.getPositionX() - m.pos[0], owner.getPositionY() - m.pos[1]) <= serverPositionToleranceUnits)) {
            this.placingHosts.delete(remoteId);
            return false;
        }
        if (Date.now() - placing.at > 1000) {
            this.placingHosts.set(remoteId, { at: Date.now(), tries: placing.tries + 1 });
            if (placing.tries < 3) {
                logTrace(this, `Placing ${owner.getFormID().toString(16)} from ${ObjectReferenceEx.getWorldOrCell(owner).toString(16)} ${[owner.getPositionX(), owner.getPositionY(), owner.getPositionZ()].map(Math.round)} to ${m.worldOrCell.toString(16)} ${m.pos.map(Math.round)}, player in ${ObjectReferenceEx.getWorldOrCell(this.sp.Game.getPlayer()!).toString(16)}`);
            }
            moveActorTo(owner, m, placing.tries % 2 === 1);
        }
        return true;
    }

    private applyPendingCombat() {
        const myRemoteId = this.controller.lookupListener(RemoteServer).getMyRemoteRefrId();
        this.pendingCombat.forEach(({ target, until }, remoteId) => {
            const owner = this.getInputOwner(remoteId);
            if (!owner || Date.now() > until) {
                this.pendingCombat.delete(remoteId);
                return;
            }
            if (!owner.isAIEnabled()) {
                return;
            }
            this.pendingCombat.delete(remoteId);
            const local = !target ? 0 : target === myRemoteId ? playerFormId : worldViewMisc.remoteIdToLocalId(target);
            const enemy = local ? this.sp.Actor.from(this.sp.Game.getFormEx(local)) : null;
            if (enemy && !enemy.isDead() && !owner.isDead()) {
                owner.startCombat(enemy);
            }
        });
    }

    private onUpdate() {
        if (!this.singlePlayerService.isSinglePlayer) {
            this.applyStartedHosts();
            this.applyPendingCombat();
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
            this.reportDisabledHosts();
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
    }

    private sendMovement(_refrId?: number, form?: FormModel) {
        const owner = this.getInputOwner(_refrId);
        if (!owner) {
          return;
        }

        if (_refrId && this.isPlacing(_refrId, owner, form?.movement)) {
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
                reliability: _refrId ? "reliable" : "unreliable"
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
                relayedSeats.delete(owner.getFormID());
            }
            if (sitState === 0) {
                this.lastSitSent.delete(refrIdStr);
            } else if (sitState === 3 && Date.now() - (this.lastSitSent.get(refrIdStr) ?? 0) > hostedSitResendMs) {
                const inherited = relayedSeats.get(owner.getFormID());
                const furniture = owner.getFurnitureReference()?.getFormID() ?? inherited?.furniture;
                if (furniture) {
                    animSource.addSit(furniture, inherited?.enter);
                    this.lastSitSent.set(refrIdStr, Date.now());
                }
            }
            this.lastSitState.set(refrIdStr, sitState);
            const enemy = owner.isInCombat() ? owner.getCombatTarget() : null;
            const target = enemy ? worldViewMisc.localIdToRemoteId(enemy.getFormID(), true) : 0;
            const lastCombat = this.lastCombatSent.get(refrIdStr);
            if (!lastCombat || lastCombat.target !== target || (target && Date.now() - lastCombat.at > hostedSitResendMs)) {
                animSource.addCombat(target);
                this.lastCombatSent.set(refrIdStr, { target, at: Date.now() });
            }
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

    private reportDisabledHosts() {
        const hosted = this.sp.storage['hosted'];
        if (!Array.isArray(hosted)) {
            return;
        }
        const now = Date.now();
        hosted.filter((remoteId: number) => remoteId >= espActorIdOffset).forEach((remoteId: number) => {
            if (!this.getInputOwner(remoteId)?.isDisabled()) {
                this.disabledHostSince.delete(remoteId);
                return;
            }
            const since = this.disabledHostSince.get(remoteId) ?? now;
            this.disabledHostSince.set(remoteId, since);
            if (now - since < 2000) {
                return;
            }
            this.disabledHostSince.delete(remoteId);
            this.controller.emitter.emit("sendMessage", {
                message: { t: MsgType.Host, remoteId, release: true, disabled: true },
                reliability: "reliable"
            });
            this.sp.storage['hosted'] = (this.sp.storage['hosted'] as number[]).filter((x) => x !== remoteId);
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
    private lastCombatSent = new Map<string, { target: number, at: number }>();
    private pendingCombat = new Map<number, { target: number, until: number }>();
    private placingHosts = new Map<number, { at: number, tries: number }>();
    private actorValuesNeedUpdate = false;
    private isRaceSexMenuShown = false;
    private equipmentChanged = false;
    private numEquipmentChanges = 0;
    private prevValues: ActorValues = { health: 0, stamina: 0, magicka: 0 };
    private prevActorValuesUpdateTime = 0;
    private prevCastingDetectedTime = 0;
    private disabledHostSince = new Map<number, number>();
    private startedHosts = new Set<number>();
    private pendingSpeaks = new Array<SpeakSoundEvent>();
    private papyrusEventsAllowedKey = "";
}
