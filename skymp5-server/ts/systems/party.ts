export interface Party {
  id: number;
  leader: number;
  members: number[];
  outOfSync: Map<number, Set<number>>;
}

export const INVITE_TTL_MS = 60_000;

export class Parties {
  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  partyOf(actor: number): Party | undefined {
    return this.byActor.get(actor);
  }

  questGroup(actor: number, quest: number): number[] {
    const party = this.byActor.get(actor);
    if (!party) {
      return [actor];
    }
    const group = party.members.filter((m) => m === party.leader || !party.outOfSync.get(m)?.has(quest));
    return group.includes(actor) ? group : [actor];
  }

  invitesOf(invitee: number, now: number): number[] {
    const invites = this.invites.get(invitee);
    if (!invites) {
      return [];
    }
    for (const [inviter, expiresAt] of invites) {
      if (expiresAt <= now) {
        invites.delete(inviter);
      }
    }
    return [...invites.keys()];
  }

  invite(inviter: number, invitee: number, now: number): string | undefined {
    if (inviter === invitee) {
      return "You cannot invite yourself";
    }
    if (this.byActor.has(invitee)) {
      return "This player is already in a party";
    }
    const party = this.byActor.get(inviter);
    if (party && party.leader !== inviter) {
      return "Only the party leader can invite";
    }
    if (party && party.members.length >= this.maxSize) {
      return "The party is full";
    }
    let invites = this.invites.get(invitee);
    if (!invites) {
      invites = new Map();
      this.invites.set(invitee, invites);
    }
    invites.set(inviter, now + INVITE_TTL_MS);
    return undefined;
  }

  accept(invitee: number, inviter: number, now: number): Party | string {
    if (!this.invitesOf(invitee, now).includes(inviter)) {
      return "The invite expired";
    }
    if (this.byActor.has(invitee)) {
      return "Leave your party first";
    }
    let party = this.byActor.get(inviter);
    if (party && party.leader !== inviter) {
      this.invites.get(invitee)?.delete(inviter);
      return "The inviter is no longer the party leader";
    }
    if (party && party.members.length >= this.maxSize) {
      return "The party is full";
    }
    if (!party) {
      party = { id: this.nextId++, leader: inviter, members: [inviter], outOfSync: new Map() };
      this.byActor.set(inviter, party);
    }
    party.members.push(invitee);
    this.byActor.set(invitee, party);
    this.invites.delete(invitee);
    return party;
  }

  decline(invitee: number, inviter: number): boolean {
    return this.invites.get(invitee)?.delete(inviter) ?? false;
  }

  leave(actor: number): Party | undefined {
    const party = this.byActor.get(actor);
    if (!party) {
      return undefined;
    }
    party.members = party.members.filter((m) => m !== actor);
    party.outOfSync.delete(actor);
    this.byActor.delete(actor);
    if (party.leader === actor && party.members.length > 0) {
      party.leader = party.members[0];
    }
    if (party.members.length === 1) {
      this.byActor.delete(party.members[0]);
      party.members = [];
    }
    return party;
  }

  promote(leader: number, target: number): Party | string {
    const party = this.byActor.get(leader);
    if (!party || party.leader !== leader) {
      return "Only the party leader can do this";
    }
    if (!party.members.includes(target) || target === leader) {
      return "This player is not in your party";
    }
    party.leader = target;
    return party;
  }

  canKick(leader: number, target: number): string | undefined {
    const party = this.byActor.get(leader);
    if (!party || party.leader !== leader) {
      return "Only the party leader can do this";
    }
    if (!party.members.includes(target) || target === leader) {
      return "This player is not in your party";
    }
    return undefined;
  }

  forget(actor: number): void {
    this.invites.delete(actor);
    for (const invites of this.invites.values()) {
      invites.delete(actor);
    }
  }

  private maxSize: number;
  private nextId = 1;
  private byActor = new Map<number, Party>();
  private invites = new Map<number, Map<number, number>>();
}
