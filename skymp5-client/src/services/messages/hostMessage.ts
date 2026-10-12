import { MsgType } from "../../messages";

export interface HostMessage {
    t: MsgType.Host,
    remoteId: number,
    worldOrCell?: number,
    pos?: [number, number, number],
    rot?: [number, number, number],
    release?: boolean,
    disabled?: boolean
}
