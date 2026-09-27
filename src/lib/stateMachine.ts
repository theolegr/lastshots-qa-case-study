import { Party } from "@/lib/api";

// Party phase is derived from two layers:
//
// 1. DB status (human-triggered) — "waiting" → "playing" is a user action (host starts the party).
// 2. Timestamps (time-triggered) — "playing" → "voting" → "results" happen automatically
//    when ends_at / voting_ends_at pass. No DB write needed for these transitions.
//
// getPartyPhase() merges both layers into a single PartyPhase for the UI.

export type PartyPhase = "waiting" | "playing" | "voting" | "results";
export type PartyAction = "join" | "submit" | "vote" | "viewResults";

const VALID_TRANSITIONS: Record<PartyPhase, PartyPhase[]> = {
  waiting: ["playing"],
  playing: ["voting"],
  voting: ["results"],
  results: [],
};

const ALLOWED_ACTIONS: Record<PartyAction, PartyPhase[]> = {
  join: ["waiting", "playing"],
  submit: ["playing"],
  vote: ["voting"],
  viewResults: ["results"],
};

export function getPartyPhase(party: Party): PartyPhase {
  // Layer 1: DB status
  if (party.status === "waiting") return "waiting";

  // Layer 2: timestamp-derived phases (status is "playing" from here)
  const now = new Date();
  const endsAt = party.ends_at ? new Date(party.ends_at) : null;
  const votingEndsAt = party.voting_ends_at ? new Date(party.voting_ends_at) : null;

  if (votingEndsAt && now > votingEndsAt) return "results";
  if (endsAt && now > endsAt) return "voting";
  return "playing";
}

export function transition(from: PartyPhase, to: PartyPhase): PartyPhase {
  if (!VALID_TRANSITIONS[from].includes(to)) {
    throw new Error(`Invalid transition: ${from} → ${to}`);
  }
  return to;
}

export function canPerformAction(phase: PartyPhase, action: PartyAction): boolean {
  return ALLOWED_ACTIONS[action].includes(phase);
}
