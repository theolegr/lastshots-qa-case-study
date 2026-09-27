// @covers PS-001, RS-001, VT-001
import { describe, it, expect, afterEach, vi } from "vitest";
import { getPartyPhase, transition, canPerformAction } from "@/lib/stateMachine";
import type { Party } from "@/lib/api";

// ─── getPartyPhase ────────────────────────────────────────────────────────────

const makeParty = (overrides: Partial<Party>): Party =>
  ({ status: "playing", ends_at: null, voting_ends_at: null, ...overrides } as Party);

const past = new Date(Date.now() - 10_000).toISOString();
const future = new Date(Date.now() + 10_000).toISOString();

// The exact-deadline boundary.
//
// `getPartyPhase` compares against `new Date()`, so these are the only tests
// here that need control of the clock. They exist because mutation testing
// found `now > endsAt` and `now > votingEndsAt` could both become `>=` with the
// whole suite still green: every other test sits comfortably on
// one side of the deadline, and a boundary nobody pins is a boundary that can
// move silently.
//
// The behaviour being pinned: **at the deadline you are still in the earlier
// phase.** A party whose `ends_at` is exactly now is `playing`, not `voting`.
// That matters beyond this function — every phase in this product is a
// timestamp comparison, and BUG-007 was a defect on the same boundary.
describe("getPartyPhase — at the exact deadline", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const freezeAt = (iso: string) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(iso));
  };

  const deadline = "2026-01-01T12:00:00.000Z";

  it("stays playing when ends_at is exactly now", () => {
    freezeAt(deadline);
    expect(getPartyPhase(makeParty({ ends_at: deadline }))).toBe("playing");
  });

  it("moves to voting one millisecond after ends_at", () => {
    freezeAt("2026-01-01T12:00:00.001Z");
    expect(getPartyPhase(makeParty({ ends_at: deadline }))).toBe("voting");
  });

  it("stays voting when voting_ends_at is exactly now", () => {
    freezeAt(deadline);
    expect(
      getPartyPhase(makeParty({ ends_at: "2026-01-01T11:00:00.000Z", voting_ends_at: deadline }))
    ).toBe("voting");
  });

  it("moves to results one millisecond after voting_ends_at", () => {
    freezeAt("2026-01-01T12:00:00.001Z");
    expect(
      getPartyPhase(makeParty({ ends_at: "2026-01-01T11:00:00.000Z", voting_ends_at: deadline }))
    ).toBe("results");
  });
});

describe("getPartyPhase", () => {
  it("returns waiting when status is waiting", () => {
    expect(getPartyPhase(makeParty({ status: "waiting" }))).toBe("waiting");
  });

  it("returns waiting even if ends_at is set (status takes priority)", () => {
    expect(getPartyPhase(makeParty({ status: "waiting", ends_at: past }))).toBe("waiting");
  });

  it("returns playing when ends_at is in the future", () => {
    expect(getPartyPhase(makeParty({ ends_at: future }))).toBe("playing");
  });

  it("returns playing when ends_at is null", () => {
    expect(getPartyPhase(makeParty({ ends_at: null }))).toBe("playing");
  });

  it("returns voting when ends_at has passed but voting_ends_at has not", () => {
    expect(getPartyPhase(makeParty({ ends_at: past, voting_ends_at: future }))).toBe("voting");
  });

  it("returns voting when ends_at has passed and voting_ends_at is null", () => {
    expect(getPartyPhase(makeParty({ ends_at: past, voting_ends_at: null }))).toBe("voting");
  });

  it("returns results when voting_ends_at has passed", () => {
    expect(getPartyPhase(makeParty({ ends_at: past, voting_ends_at: past }))).toBe("results");
  });

  it("results takes priority over voting (votingEndsAt checked first)", () => {
    // Both timestamps in the past — should be results, not voting
    expect(getPartyPhase(makeParty({ ends_at: past, voting_ends_at: past }))).toBe("results");
  });
});

// ─── Valid transitions (derived from real party state) ────────────────────────

describe("valid transitions", () => {
  it("waiting → playing: host starts the party", () => {
    const phase = getPartyPhase(makeParty({ status: "waiting" }));
    expect(transition(phase, "playing")).toBe("playing");
  });

  it("playing → voting: capture window expires", () => {
    // Party is currently in playing (ends_at in the future) — transition to voting
    const phase = getPartyPhase(makeParty({ ends_at: future }));
    expect(transition(phase, "voting")).toBe("voting");
  });

  it("voting → results: voting window expires", () => {
    // Party is currently in voting (ends_at past, voting_ends_at future) — transition to results
    const phase = getPartyPhase(makeParty({ ends_at: past, voting_ends_at: future }));
    expect(transition(phase, "results")).toBe("results");
  });
});

// ─── Invalid transitions (derived from real party state) ─────────────────────

describe("invalid transitions", () => {
  it("waiting → voting is not allowed, and the error names both phases", () => {
    const phase = getPartyPhase(makeParty({ status: "waiting" }));
    // The message, not just the throw. Blanking it left every `.toThrow()` here
    // green under mutation testing, and this string is the only
    // thing that tells a developer *which* transition was refused.
    expect(() => transition(phase, "voting")).toThrow("Invalid transition: waiting → voting");
  });

  it("waiting → results is not allowed", () => {
    const phase = getPartyPhase(makeParty({ status: "waiting" }));
    expect(() => transition(phase, "results")).toThrow();
  });

  it("playing → results skips voting — not allowed", () => {
    const phase = getPartyPhase(makeParty({ ends_at: future }));
    expect(() => transition(phase, "results")).toThrow();
  });

  it("playing → waiting is not allowed (no going back)", () => {
    const phase = getPartyPhase(makeParty({ ends_at: future }));
    expect(() => transition(phase, "waiting")).toThrow();
  });

  it("voting → playing is not allowed (no going back)", () => {
    const phase = getPartyPhase(makeParty({ ends_at: past, voting_ends_at: future }));
    expect(() => transition(phase, "playing")).toThrow();
  });

  it("voting → waiting is not allowed (no going back)", () => {
    const phase = getPartyPhase(makeParty({ ends_at: past, voting_ends_at: future }));
    expect(() => transition(phase, "waiting")).toThrow();
  });

  it("results → playing is not allowed (party is over)", () => {
    const phase = getPartyPhase(makeParty({ ends_at: past, voting_ends_at: past }));
    expect(() => transition(phase, "playing")).toThrow();
  });

  it("results → voting is not allowed (party is over)", () => {
    const phase = getPartyPhase(makeParty({ ends_at: past, voting_ends_at: past }));
    expect(() => transition(phase, "voting")).toThrow();
  });

  it("results → waiting is not allowed (party is over)", () => {
    const phase = getPartyPhase(makeParty({ ends_at: past, voting_ends_at: past }));
    expect(() => transition(phase, "waiting")).toThrow();
  });
});

// ─── Action gating (derived from real party state) ────────────────────────────

describe("action: join", () => {
  it("allowed while party is in lobby", () => {
    const phase = getPartyPhase(makeParty({ status: "waiting" }));
    expect(canPerformAction(phase, "join")).toBe(true);
  });

  it("allowed while capture is ongoing", () => {
    const phase = getPartyPhase(makeParty({ ends_at: future }));
    expect(canPerformAction(phase, "join")).toBe(true);
  });

  it("rejected once voting has started", () => {
    const phase = getPartyPhase(makeParty({ ends_at: past, voting_ends_at: future }));
    expect(canPerformAction(phase, "join")).toBe(false);
  });

  it("rejected once results are shown", () => {
    const phase = getPartyPhase(makeParty({ ends_at: past, voting_ends_at: past }));
    expect(canPerformAction(phase, "join")).toBe(false);
  });
});

describe("action: submit (photo upload)", () => {
  it("allowed during capture window", () => {
    const phase = getPartyPhase(makeParty({ ends_at: future }));
    expect(canPerformAction(phase, "submit")).toBe(true);
  });

  it("rejected in lobby before party starts", () => {
    const phase = getPartyPhase(makeParty({ status: "waiting" }));
    expect(canPerformAction(phase, "submit")).toBe(false);
  });

  it("rejected once capture window has expired", () => {
    const phase = getPartyPhase(makeParty({ ends_at: past, voting_ends_at: future }));
    expect(canPerformAction(phase, "submit")).toBe(false);
  });

  it("rejected in results", () => {
    const phase = getPartyPhase(makeParty({ ends_at: past, voting_ends_at: past }));
    expect(canPerformAction(phase, "submit")).toBe(false);
  });
});

describe("action: vote", () => {
  it("allowed during voting window", () => {
    const phase = getPartyPhase(makeParty({ ends_at: past, voting_ends_at: future }));
    expect(canPerformAction(phase, "vote")).toBe(true);
  });

  it("rejected in lobby", () => {
    const phase = getPartyPhase(makeParty({ status: "waiting" }));
    expect(canPerformAction(phase, "vote")).toBe(false);
  });

  it("rejected during capture", () => {
    const phase = getPartyPhase(makeParty({ ends_at: future }));
    expect(canPerformAction(phase, "vote")).toBe(false);
  });

  it("rejected once voting has ended", () => {
    const phase = getPartyPhase(makeParty({ ends_at: past, voting_ends_at: past }));
    expect(canPerformAction(phase, "vote")).toBe(false);
  });
});

describe("action: viewResults", () => {
  it("allowed once voting has ended", () => {
    const phase = getPartyPhase(makeParty({ ends_at: past, voting_ends_at: past }));
    expect(canPerformAction(phase, "viewResults")).toBe(true);
  });

  it("rejected in lobby", () => {
    const phase = getPartyPhase(makeParty({ status: "waiting" }));
    expect(canPerformAction(phase, "viewResults")).toBe(false);
  });

  it("rejected during capture", () => {
    const phase = getPartyPhase(makeParty({ ends_at: future }));
    expect(canPerformAction(phase, "viewResults")).toBe(false);
  });

  it("rejected during voting", () => {
    const phase = getPartyPhase(makeParty({ ends_at: past, voting_ends_at: future }));
    expect(canPerformAction(phase, "viewResults")).toBe(false);
  });
});
