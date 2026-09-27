// @covers RS-002, RS-004
import { describe, it, expect } from "vitest";
import {
  computeResults,
  countVotesByPhoto,
  PODIUM_SIZE,
  UNKNOWN_PARTICIPANT_NAME,
  type RankablePhoto,
} from "@/lib/resultsRules";

// Results ranking was previously reachable only through `api.ts:getVoteResults`,
// which fetched its own votes — so the only coverage it had was one happy-path
// E2E (`podium-correctness.spec.ts`, 3 photos with distinct vote counts). Every
// degenerate shape a real party can produce went unasserted. That is what these
// tests are for.

// ─── Builders ────────────────────────────────────────────────────────────────

const photo = (
  id: string,
  overrides: Partial<RankablePhoto> = {}
): RankablePhoto => ({
  id,
  participant_id: "p1",
  situation_id: "s1",
  captured_at: "2026-01-01T10:00:00.000Z",
  ...overrides,
});

const votesFor = (...photoIds: string[]) => photoIds.map((photo_id) => ({ photo_id }));

const PARTICIPANTS = [
  { id: "p1", name: "Alice" },
  { id: "p2", name: "Bob" },
  { id: "p3", name: "Carla" },
];

const SITUATIONS = [{ id: "s1" }, { id: "s2" }];

// ─── countVotesByPhoto ───────────────────────────────────────────────────────

describe("countVotesByPhoto", () => {
  it("returns an empty map for no votes", () => {
    expect(countVotesByPhoto([]).size).toBe(0);
  });

  it("tallies repeated votes for the same photo", () => {
    const counts = countVotesByPhoto(votesFor("a", "b", "a", "a"));
    expect(counts.get("a")).toBe(3);
    expect(counts.get("b")).toBe(1);
  });

  it("omits photos that received no votes rather than storing a zero", () => {
    // Callers must treat "absent" as zero. Asserting the distinction here stops
    // a future refactor from quietly switching to `0`-filled entries and
    // breaking any `.has()` check downstream.
    const counts = countVotesByPhoto(votesFor("a"));
    expect(counts.has("b")).toBe(false);
    expect(counts.get("b") ?? 0).toBe(0);
  });
});

// ─── Podium ranking ──────────────────────────────────────────────────────────

describe("computeResults — podium", () => {
  it("ranks photos by vote count, descending", () => {
    const photos = [
      photo("a", { participant_id: "p1" }),
      photo("b", { participant_id: "p2" }),
      photo("c", { participant_id: "p3" }),
    ];
    const { podium } = computeResults({
      votes: votesFor("b", "b", "b", "c", "c", "a"),
      photos,
      situations: SITUATIONS,
      participants: PARTICIPANTS,
    });

    expect(podium.map((e) => e.photo.id)).toEqual(["b", "c", "a"]);
    expect(podium.map((e) => e.voteCount)).toEqual([3, 2, 1]);
    expect(podium.map((e) => e.position)).toEqual([1, 2, 3]);
    expect(podium.map((e) => e.participantName)).toEqual(["Bob", "Carla", "Alice"]);
  });

  it("breaks ties on equal votes by earliest capture time", () => {
    const photos = [
      photo("late", { captured_at: "2026-01-01T12:00:00.000Z" }),
      photo("early", { captured_at: "2026-01-01T09:00:00.000Z" }),
    ];
    const { podium } = computeResults({
      votes: votesFor("late", "early"),
      photos,
      situations: SITUATIONS,
      participants: PARTICIPANTS,
    });

    expect(podium.map((e) => e.photo.id)).toEqual(["early", "late"]);
  });

  it("orders a three-way total tie entirely by capture time", () => {
    const photos = [
      photo("c", { captured_at: "2026-01-01T12:00:00.000Z" }),
      photo("a", { captured_at: "2026-01-01T10:00:00.000Z" }),
      photo("b", { captured_at: "2026-01-01T11:00:00.000Z" }),
    ];
    const { podium } = computeResults({
      votes: votesFor("a", "b", "c"),
      photos,
      situations: SITUATIONS,
      participants: PARTICIPANTS,
    });

    expect(podium.map((e) => e.photo.id)).toEqual(["a", "b", "c"]);
  });

  it("still fills a podium when nobody voted at all", () => {
    // A party where voting is skipped entirely must not render an empty podium.
    // Ordering falls through to the tie-break, so it stays deterministic.
    const photos = [
      photo("b", { captured_at: "2026-01-01T11:00:00.000Z" }),
      photo("a", { captured_at: "2026-01-01T10:00:00.000Z" }),
    ];
    const { podium } = computeResults({
      votes: [],
      photos,
      situations: SITUATIONS,
      participants: PARTICIPANTS,
    });

    expect(podium.map((e) => e.photo.id)).toEqual(["a", "b"]);
    expect(podium.every((e) => e.voteCount === 0)).toBe(true);
  });

  it("returns fewer than three entries when the party has fewer photos", () => {
    const { podium } = computeResults({
      votes: votesFor("only"),
      photos: [photo("only")],
      situations: SITUATIONS,
      participants: PARTICIPANTS,
    });

    expect(podium).toHaveLength(1);
    expect(podium[0].position).toBe(1);
  });

  it("returns an empty podium when the party has no photos", () => {
    const { podium } = computeResults({
      votes: [],
      photos: [],
      situations: SITUATIONS,
      participants: PARTICIPANTS,
    });

    expect(podium).toEqual([]);
  });

  it("never returns more than PODIUM_SIZE entries", () => {
    const photos = Array.from({ length: 10 }, (_, i) =>
      photo(`p${i}`, { captured_at: `2026-01-01T${String(10 + i).padStart(2, "0")}:00:00.000Z` })
    );
    const { podium } = computeResults({
      votes: [],
      photos,
      situations: SITUATIONS,
      participants: PARTICIPANTS,
    });

    expect(podium).toHaveLength(PODIUM_SIZE);
  });

  it("falls back to a placeholder name when the author is not in the participant list", () => {
    // Reachable in practice: a participant row deleted (or filtered out by RLS)
    // while their photo survives. The results page must still render.
    const { podium } = computeResults({
      votes: votesFor("orphan"),
      photos: [photo("orphan", { participant_id: "ghost" })],
      situations: SITUATIONS,
      participants: PARTICIPANTS,
    });

    expect(podium[0].participantName).toBe(UNKNOWN_PARTICIPANT_NAME);
    // And the literal, once. Asserting only against the constant is circular:
    // both sides move together, so blanking `UNKNOWN_PARTICIPANT_NAME` to ""
    // kept this test green under mutation testing. This is the
    // string a user actually sees when a photo's author has left the party.
    expect(podium[0].participantName).toBe("Unknown");
  });

  it("ignores votes pointing at photos that are not in the list", () => {
    // Defensive: a vote whose photo was deleted must not crash ranking or
    // inflate anyone's count.
    const { podium } = computeResults({
      votes: votesFor("deleted", "deleted", "kept"),
      photos: [photo("kept")],
      situations: SITUATIONS,
      participants: PARTICIPANTS,
    });

    expect(podium).toHaveLength(1);
    expect(podium[0].voteCount).toBe(1);
  });
});

// ─── Situation winners ───────────────────────────────────────────────────────

describe("computeResults — situation winners", () => {
  it("picks the most-voted photo within each situation independently", () => {
    const photos = [
      photo("s1-low", { situation_id: "s1", participant_id: "p1" }),
      photo("s1-high", { situation_id: "s1", participant_id: "p2" }),
      photo("s2-only", { situation_id: "s2", participant_id: "p3" }),
    ];
    const { situationWinners } = computeResults({
      votes: votesFor("s1-high", "s1-high", "s1-low", "s2-only"),
      photos,
      situations: SITUATIONS,
      participants: PARTICIPANTS,
    });

    expect(situationWinners.map((w) => w.photo?.id)).toEqual(["s1-high", "s2-only"]);
    expect(situationWinners.map((w) => w.voteCount)).toEqual([2, 1]);
    expect(situationWinners.map((w) => w.participantName)).toEqual(["Bob", "Carla"]);
  });

  it("returns a null winner for a situation nobody shot", () => {
    const { situationWinners } = computeResults({
      votes: votesFor("s1-only"),
      photos: [photo("s1-only", { situation_id: "s1" })],
      situations: SITUATIONS,
      participants: PARTICIPANTS,
    });

    const empty = situationWinners.find((w) => w.situation.id === "s2")!;
    expect(empty.photo).toBeNull();
    expect(empty.voteCount).toBe(0);
    expect(empty.participantName).toBe("");
  });

  it("emits one entry per situation, in the order given", () => {
    const { situationWinners } = computeResults({
      votes: [],
      photos: [],
      situations: [{ id: "s2" }, { id: "s1" }],
      participants: PARTICIPANTS,
    });

    expect(situationWinners.map((w) => w.situation.id)).toEqual(["s2", "s1"]);
  });

  it("breaks a within-situation tie by earliest capture time", () => {
    const photos = [
      photo("late", { situation_id: "s1", captured_at: "2026-01-01T12:00:00.000Z" }),
      photo("early", { situation_id: "s1", captured_at: "2026-01-01T09:00:00.000Z" }),
    ];
    const { situationWinners } = computeResults({
      votes: votesFor("late", "early"),
      photos,
      situations: [{ id: "s1" }],
      participants: PARTICIPANTS,
    });

    expect(situationWinners[0].photo?.id).toBe("early");
  });

  it("can award a situation to a photo with zero votes", () => {
    // Consistent with the podium: a shot situation always has a winner, even
    // when nobody voted in it.
    const { situationWinners } = computeResults({
      votes: [],
      photos: [photo("lonely", { situation_id: "s1" })],
      situations: [{ id: "s1" }],
      participants: PARTICIPANTS,
    });

    expect(situationWinners[0].photo?.id).toBe("lonely");
    expect(situationWinners[0].voteCount).toBe(0);
  });

  it("returns no winners when the party has no situations", () => {
    const { situationWinners } = computeResults({
      votes: [],
      photos: [photo("orphan")],
      situations: [],
      participants: PARTICIPANTS,
    });

    expect(situationWinners).toEqual([]);
  });
});

// ─── Purity ──────────────────────────────────────────────────────────────────

describe("computeResults — purity", () => {
  it("does not mutate the photos array it is given", () => {
    // `Results.tsx` renders the same array as "all photos" after passing it in.
    // An in-place sort here would silently reorder that grid.
    const photos = [
      photo("b", { captured_at: "2026-01-01T11:00:00.000Z" }),
      photo("a", { captured_at: "2026-01-01T10:00:00.000Z" }),
    ];
    const order = photos.map((p) => p.id);

    computeResults({
      votes: votesFor("a", "a"),
      photos,
      situations: SITUATIONS,
      participants: PARTICIPANTS,
    });

    expect(photos.map((p) => p.id)).toEqual(order);
  });

  it("is deterministic across repeated calls with the same input", () => {
    const photos = [
      photo("a", { captured_at: "2026-01-01T10:00:00.000Z" }),
      photo("b", { captured_at: "2026-01-01T10:00:00.000Z" }),
      photo("c", { captured_at: "2026-01-01T10:00:00.000Z" }),
    ];
    const input = {
      votes: votesFor("a", "b", "c"),
      photos,
      situations: SITUATIONS,
      participants: PARTICIPANTS,
    };

    const first = computeResults(input).podium.map((e) => e.photo.id);
    const second = computeResults(input).podium.map((e) => e.photo.id);

    expect(second).toEqual(first);
  });
});
