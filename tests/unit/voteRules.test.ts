// @covers RS-002, RS-004, VT-002, VT-003, VT-004, VT-005
import { describe, it, expect } from "vitest";
import {
  isVoteAllowed,
  hasRemainingVotes,
  deduplicateVotes,
  calculateScores,
  resolveTie,
} from "@/lib/voteRules";

// ─── isVoteAllowed ───────────────────────────────────────────────────────────

describe("isVoteAllowed", () => {
  const photo = { id: "photo-1", participant_id: "user-A", captured_at: "2025-01-01T00:00:00Z" };

  it("returns false when userId matches photo.participant_id (self-vote)", () => {
    expect(isVoteAllowed("user-A", photo)).toBe(false);
  });

  it("returns true when userId does not match photo.participant_id", () => {
    expect(isVoteAllowed("user-B", photo)).toBe(true);
  });
});

// ─── hasRemainingVotes ───────────────────────────────────────────────────────

describe("hasRemainingVotes", () => {
  const votes = [
    { photo_id: "p1", voter_id: "user-A" },
    { photo_id: "p2", voter_id: "user-A" },
    { photo_id: "p3", voter_id: "user-A" },
    { photo_id: "p4", voter_id: "user-B" },
    { photo_id: "p5", voter_id: "user-B" },
  ];

  it("returns false when vote count equals quota", () => {
    expect(hasRemainingVotes("user-A", votes, 3)).toBe(false);
  });

  it("returns true when vote count is below quota", () => {
    expect(hasRemainingVotes("user-A", votes, 5)).toBe(true);
  });

  it("only counts votes from the given user, not others", () => {
    // user-B has 2 votes, not 5
    expect(hasRemainingVotes("user-B", votes, 3)).toBe(true);
    expect(hasRemainingVotes("user-B", votes, 2)).toBe(false);
  });
});

// ─── deduplicateVotes ────────────────────────────────────────────────────────

describe("deduplicateVotes", () => {
  it("with 3 identical votes returns an array of length 1", () => {
    const votes = [
      { photo_id: "p1", voter_id: "user-A" },
      { photo_id: "p1", voter_id: "user-A" },
      { photo_id: "p1", voter_id: "user-A" },
    ];
    expect(deduplicateVotes(votes)).toHaveLength(1);
  });

  it("keeps distinct votes and removes only duplicates", () => {
    const votes = [
      { photo_id: "p1", voter_id: "user-A" },
      { photo_id: "p1", voter_id: "user-A" }, // dup
      { photo_id: "p1", voter_id: "user-B" }, // different voter — kept
      { photo_id: "p2", voter_id: "user-A" }, // different photo — kept
    ];
    expect(deduplicateVotes(votes)).toHaveLength(3);
  });

  it("preserves insertion order of first occurrences", () => {
    const votes = [
      { photo_id: "p2", voter_id: "user-A" },
      { photo_id: "p1", voter_id: "user-A" },
      { photo_id: "p2", voter_id: "user-A" }, // dup
    ];
    const result = deduplicateVotes(votes);
    expect(result.map((v) => v.photo_id)).toEqual(["p2", "p1"]);
  });

  it("returns an empty array for empty input", () => {
    expect(deduplicateVotes([])).toEqual([]);
  });
});

// ─── calculateScores ─────────────────────────────────────────────────────────

describe("calculateScores", () => {
  it("returns photos sorted by descending vote count", () => {
    const votes = [
      { photo_id: "p1", voter_id: "u1" },
      { photo_id: "p2", voter_id: "u1" },
      { photo_id: "p2", voter_id: "u2" },
      { photo_id: "p3", voter_id: "u1" },
      { photo_id: "p3", voter_id: "u2" },
      { photo_id: "p3", voter_id: "u3" },
    ];
    const scores = calculateScores(votes);
    expect(scores).toEqual([
      { photo_id: "p3", voteCount: 3 },
      { photo_id: "p2", voteCount: 2 },
      { photo_id: "p1", voteCount: 1 },
    ]);
  });

  it("includes all photos when vote counts are tied", () => {
    const votes = [
      { photo_id: "p1", voter_id: "u1" },
      { photo_id: "p2", voter_id: "u2" },
    ];
    const scores = calculateScores(votes);
    expect(scores).toHaveLength(2);
    expect(scores.map((s) => s.photo_id)).toContain("p1");
    expect(scores.map((s) => s.photo_id)).toContain("p2");
  });

  it("returns an empty array for empty input without throwing", () => {
    expect(calculateScores([])).toEqual([]);
  });
});

// ─── resolveTie ──────────────────────────────────────────────────────────────

describe("resolveTie", () => {
  const early = { id: "photo-bbb", participant_id: "u2", captured_at: "2025-01-01T10:00:00Z" };
  const late  = { id: "photo-aaa", participant_id: "u1", captured_at: "2025-01-01T12:00:00Z" };

  it("returns the photo captured earliest regardless of argument order", () => {
    expect(resolveTie(early, late)).toBe(early);
    expect(resolveTie(late, early)).toBe(early);
  });

  it("returns the first argument when both were captured at the same instant", () => {
    // `tieBreakCompare` returns a millisecond difference, so identical
    // timestamps give exactly 0 and the `<= 0` decides. Nothing pinned that
    // case, so flipping it to `< 0` left the suite green under mutation testing.
    //
    // Worth stating plainly, because the docstring calls this "deterministic":
    // it is deterministic *given argument order*, not given the pair. Two
    // photos captured in the same millisecond rank by call order, which is
    // arbitrary. Vanishingly unlikely in practice, and pinned here rather than
    // left to be rediscovered.
    const a = { id: "photo-a", participant_id: "u1", captured_at: "2025-01-01T10:00:00Z" };
    const b = { id: "photo-b", participant_id: "u2", captured_at: "2025-01-01T10:00:00Z" };
    expect(resolveTie(a, b)).toBe(a);
    expect(resolveTie(b, a)).toBe(b);
  });
});
