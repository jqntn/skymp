import { Actor, ContainerChangedEvent, printConsole } from "skyrimPlatform";
import { ClientListener, CombinedController, Sp } from "./clientListener";
import { MsgType } from "../../messages";
import { delayPcInventoryApply, getPcInventory, isPcInventoryApplyPending } from "./remoteServer";
import { CoopService } from "./coopService";
import { getInventory, getDiff, hasExtras, removeSimpleItemsAsManyAsPossible, sumInventories } from "../../sync/inventory";
import { LastInvService } from "./lastInvService";

import { PutItemMessage } from "../messages/putItemMessage";
import { TakeItemMessage } from "../messages/takeItemMessage";
import { SweetTaffySweetCantDropService } from "./sweetTaffySweetCantDropService";
import { localIdToRemoteId } from "../../view/worldViewMisc";
import { CustomPacketMessage } from "../messages/customPacketMessage";

const SCRIPT_ITEMS_DELAY_MS = 1000;
const SCRIPT_ITEMS_ANSWER_MS = 5000;
const MENUS_WITH_OWN_SYNC = ["ContainerMenu", "BarterMenu", "GiftMenu", "Crafting Menu"];

export class ContainersService extends ClientListener {
    constructor(private sp: Sp, private controller: CombinedController) {
        super();
        controller.on('containerChanged', (e) => this.onContainerChanged(e));
        controller.on('update', () => this.onUpdate());
        controller.emitter.on('setInventoryMessage', () => this.onServerInventory());
    }

    private onServerInventory() {
        this.answerDeadline = 0;
        if (this.scriptCheck) {
            this.scriptCheck.at = Date.now() + SCRIPT_ITEMS_DELAY_MS;
        }
    }

    private onUpdate() {
        const check = this.scriptCheck;
        if (!check || Date.now() < check.at) {
            return;
        }
        if (isPcInventoryApplyPending() || Date.now() < this.answerDeadline) {
            check.at = Date.now() + SCRIPT_ITEMS_DELAY_MS;
            return;
        }
        this.scriptCheck = undefined;
        const serverInv = getPcInventory();
        const player = this.sp.Game.getPlayer();
        if (!serverInv || !player) {
            return;
        }
        const diff = getDiff(getInventory(player), serverInv, true).entries.filter((e) => check.baseIds.has(e.baseId));
        if (!diff.length) {
            return;
        }
        const message: CustomPacketMessage = {
            t: MsgType.CustomPacket,
            contentJsonDump: JSON.stringify({
                customPacketType: "scriptItems",
                gains: diff.filter((e) => e.count > 0).map((e) => ({ baseId: e.baseId, count: e.count })),
                losses: diff.filter((e) => e.count < 0).map((e) => ({ baseId: e.baseId, count: -e.count })),
                dialogue: check.dialogue,
            }),
        };
        this.controller.emitter.emit("sendMessage", { message, reliability: "reliable" });
        this.answerDeadline = Date.now() + SCRIPT_ITEMS_ANSWER_MS;
    }

    private watchScriptItems(e: ContainerChangedEvent) {
        const oldId = e.oldContainer ? e.oldContainer.getFormID() : 0;
        const newId = e.newContainer ? e.newContainer.getFormID() : 0;
        if ((oldId !== 0x14 && newId !== 0x14) || !e.baseObj || !this.controller.lookupListener(CoopService).isReporting()) {
            return;
        }
        if ((oldId && newId && this.sp.Ui.isMenuOpen("ContainerMenu")) || MENUS_WITH_OWN_SYNC.some((m) => this.sp.Ui.isMenuOpen(m))) {
            return;
        }
        const check = this.scriptCheck ?? { at: 0, baseIds: new Set<number>(), dialogue: false };
        check.at = Date.now() + SCRIPT_ITEMS_DELAY_MS;
        check.baseIds.add(e.baseObj.getFormID());
        check.dialogue ||= this.sp.Ui.isMenuOpen("Dialogue Menu");
        this.scriptCheck = check;
        delayPcInventoryApply();
    }

    private scriptCheck?: { at: number; baseIds: Set<number>; dialogue: boolean };
    private answerDeadline = 0;

    private onContainerChanged(e: ContainerChangedEvent) {
        this.watchScriptItems(e);
        const sweetCantDropService = this.controller.lookupListener(SweetTaffySweetCantDropService);

        if (e.oldContainer && e.newContainer) {
            if (
                e.oldContainer.getFormID() === 0x14 ||
                e.newContainer.getFormID() === 0x14
            ) {
                const lastInvService = this.controller.lookupListener(LastInvService);

                if (!lastInvService.lastInv) {
                    lastInvService.lastInv = getPcInventory();
                }
                if (lastInvService.lastInv) {
                    const newInv = getInventory(this.sp.Game.getPlayer() as Actor);

                    // It seems that 'ignoreWorn = false' fixes this:
                    // https://github.com/skyrim-multiplayer/issue-tracker/issues/43
                    // For some reason excess diff is produced when 'ignoreWorn = true'
                    // I thought that it would be vice versa but that's how it works
                    const ignoreWorn = false;
                    const diff = getDiff(lastInvService.lastInv, newInv, ignoreWorn);

                    printConsole('diff:');
                    for (let i = 0; i < diff.entries.length; ++i) {
                        printConsole(`[${i}] ${JSON.stringify(diff.entries[i])}`);
                    }
                    const msgs = diff.entries
                        .filter((entry) =>
                            // TODO: review this condition, seems to be incorrect
                            entry.count > 0
                                ? sweetCantDropService.canDropOrPutItem(entry.baseId)
                                : true,
                        )
                        .filter((entry) => entry.count !== 0)
                        .map((entry) => {
                            const entryCopy = JSON.parse(JSON.stringify(entry)) as typeof entry;
                            const msg: PutItemMessage | TakeItemMessage = {
                                ...entryCopy,
                                t: entry.count > 0 ? MsgType.PutItem : MsgType.TakeItem,
                                target: e.oldContainer.getFormID() === 0x14
                                    ? localIdToRemoteId(e.newContainer.getFormID())
                                    : localIdToRemoteId(e.oldContainer.getFormID())
                            };
                            msg.count = Math.abs(msg.count);
                            if (this.sp.Game.getFormEx(entry.baseId)?.getName() === msg.name) {
                                delete msg.name;
                            }
                            return msg;
                        });

                    msgs.forEach((msg) => this.controller.emitter.emit("sendMessage", {
                        message: msg,
                        reliability: "reliable"
                    }));

                    // Prevent emitting 1,2,3,4,5 changes when taking/putting 5 potions one by one
                    // This code makes it 1,1,1,1,1 but works only for extra-less items
                    // At the moment of writing this I think it's not needed for items with extras
                    diff.entries.forEach((entry) => {
                        if (lastInvService.lastInv && !hasExtras(entry)) {
                            const put = entry.count > 0;
                            const take = entry.count < 0;
                            if (put) {
                                lastInvService.lastInv = removeSimpleItemsAsManyAsPossible(
                                    lastInvService.lastInv,
                                    entry.baseId,
                                    entry.count,
                                );
                            } else if (take) {
                                const add = { entries: [entry] };
                                add.entries[0].count *= -1;
                                lastInvService.lastInv = sumInventories(lastInvService.lastInv, add);
                            }
                        }
                    });
                }
            }
        }
    }
}
