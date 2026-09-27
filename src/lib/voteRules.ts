// Pure vote validation and score calculation logic — no database, no side effects.

export interface Photo {
  id: string;
  participant_id: string;
  captured_at: string;
}

export interface Vote {
  photo_id: string;
  voter_id: string;
}

export interface ScoreEntry {
  photo_id: string;
  voteCount: number;
}

/** Returns false if the user is the photo author (self-vote). */
export function isVoteAllowed(userId: string, photo: Photo): boolean {
  return userId !== photo.participant_id;
}

/** Returns false if the user has reached their vote quota. */
export function hasRemainingVotes(userId: string, votes: Vote[], quota: number): boolean {
  const used = votes.filter((v) => v.voter_id === userId).length;
  return used < quota;
}

/** Removes duplicate votes (same photo_id + voter_id). */
export function deduplicateVotes(votes: Vote[]): Vote[] {
  const seen = new Set<string>();
  return votes.filter((v) => {
    const key = `${v.photo_id}:${v.voter_id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Returns a ranking array sorted by vote count descending. */
export function calculateScores(votes: Vote[]): ScoreEntry[] {
  const counts = new Map<string, number>();
  for (const v of votes) {
    counts.set(v.photo_id, (counts.get(v.photo_id) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([photo_id, voteCount]) => ({ photo_id, voteCount }))
    .sort((a, b) => b.voteCount - a.voteCount);
}

/** Sort comparator for tie-breaking: earliest captured photo first. */
export function tieBreakCompare(a: Photo, b: Photo): number {
  return new Date(a.captured_at).getTime() - new Date(b.captured_at).getTime();
}

/** Deterministic tie-breaker: earliest captured photo wins. */
export function resolveTie(photoA: Photo, photoB: Photo): Photo {
  return tieBreakCompare(photoA, photoB) <= 0 ? photoA : photoB;
}
