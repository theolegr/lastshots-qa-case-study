// Pure results computation: podium ranking and per-situation winners.
// No database, no side effects.
//
// This logic used to live inside `api.ts:getVoteResults`, which fetched its own
// votes (`await getPartyVotes(partyId)`) before ranking them. That single line
// of I/O made 55 lines of ranking rules unreachable from a unit test — `api.ts`
// imports the Supabase client, which touches `localStorage` at module scope and
// cannot be imported in a Node test environment at all. The ranking was
// therefore exercised only through one happy-path E2E, leaving every edge case
// (no votes, fewer than three photos, a situation nobody shot, a total tie)
// unasserted.
//
// `getVoteResults` is now a thin I/O wrapper around this function.

import { tieBreakCompare } from "./voteRules";

/** Minimum shape a photo needs to be ranked. */
export interface RankablePhoto {
  id: string;
  participant_id: string;
  situation_id: string;
  captured_at: string;
}

export interface CountableVote {
  photo_id: string;
}

export interface IdentifiableSituation {
  id: string;
}

export interface NamedParticipant {
  id: string;
  name: string;
}

export interface PodiumEntry<P> {
  position: number;
  photo: P;
  voteCount: number;
  participantName: string;
}

export interface SituationWinnerEntry<P, S> {
  situation: S;
  photo: P | null;
  voteCount: number;
  participantName: string;
}

/** Name shown when a photo's author is missing from the participant list. */
export const UNKNOWN_PARTICIPANT_NAME = "Unknown";

/** How many photos the podium holds. */
export const PODIUM_SIZE = 3;

/** Tallies votes per photo id. Photos with no votes are simply absent. */
export function countVotesByPhoto(votes: CountableVote[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const vote of votes) {
    counts.set(vote.photo_id, (counts.get(vote.photo_id) ?? 0) + 1);
  }
  return counts;
}

/**
 * Ranking comparator: most votes first, earliest capture wins a tie.
 *
 * The tie-break delegates to `tieBreakCompare` in `voteRules` — deliberately,
 * so that the rule has exactly one implementation shared by `resolveTie` and by
 * every ranking here.
 */
function compareByVotesThenCapture<P extends RankablePhoto>(
  counts: Map<string, number>
): (a: P, b: P) => number {
  return (a, b) => {
    const aVotes = counts.get(a.id) ?? 0;
    const bVotes = counts.get(b.id) ?? 0;
    if (bVotes !== aVotes) return bVotes - aVotes;
    return tieBreakCompare(a, b);
  };
}

/**
 * Computes the podium and the per-situation winners from an already-fetched
 * vote list.
 *
 * Behaviour worth stating explicitly, because it is intentional and tested:
 * - The podium is the top {@link PODIUM_SIZE} photos of the *whole party*, and
 *   is filled even when the photos have zero votes. A small party still gets a
 *   podium rather than an empty screen.
 * - `situations` is mapped in the order given, and a situation nobody shot
 *   yields `photo: null`, `voteCount: 0` and an empty participant name — the
 *   results page renders a placeholder row for it.
 * - Input arrays are never mutated.
 */
export function computeResults<
  P extends RankablePhoto,
  S extends IdentifiableSituation,
  A extends NamedParticipant,
>(input: {
  votes: CountableVote[];
  photos: P[];
  situations: S[];
  participants: A[];
}): { podium: PodiumEntry<P>[]; situationWinners: SituationWinnerEntry<P, S>[] } {
  const { votes, photos, situations, participants } = input;

  const voteCounts = countVotesByPhoto(votes);
  const byRank = compareByVotesThenCapture<P>(voteCounts);

  const participantName = (participantId: string): string =>
    participants.find((p) => p.id === participantId)?.name ?? UNKNOWN_PARTICIPANT_NAME;

  // `[...photos]` — sort() mutates in place, and the caller's array is also
  // what the results page renders as "all photos".
  const podium: PodiumEntry<P>[] = [...photos]
    .sort(byRank)
    .slice(0, PODIUM_SIZE)
    .map((photo, index) => ({
      position: index + 1,
      photo,
      voteCount: voteCounts.get(photo.id) ?? 0,
      participantName: participantName(photo.participant_id),
    }));

  const situationWinners: SituationWinnerEntry<P, S>[] = situations.map((situation) => {
    const winner =
      photos.filter((p) => p.situation_id === situation.id).sort(byRank)[0] ?? null;

    return {
      situation,
      photo: winner,
      voteCount: winner ? (voteCounts.get(winner.id) ?? 0) : 0,
      participantName: winner ? participantName(winner.participant_id) : "",
    };
  });

  return { podium, situationWinners };
}
