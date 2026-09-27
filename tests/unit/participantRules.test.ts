// @covers MB-002
// @regression BUG-005
import { describe, it, expect } from "vitest";
import { mergeParticipant } from "@/lib/participantRules";

// Regression guard for BUG-005: the lobby rendered a participant twice when the
// realtime INSERT for someone already returned by the initial fetch arrived
// after that fetch resolved. The bug itself is a race — which source wins is
// pure timing, which is why it reproduced in CI and effectively never locally.
// A race cannot be asserted deterministically end-to-end, but the *rule* that
// makes the race harmless can: merging must be idempotent by id.

const p = (id: string, name = "Someone") => ({ id, name });

describe("mergeParticipant", () => {
  it("appends a participant the roster has not seen", () => {
    const prev = [p("a")];
    expect(mergeParticipant(prev, p("b")).map((x) => x.id)).toEqual(["a", "b"]);
  });

  it("ignores a participant whose id is already present", () => {
    // The exact BUG-005 shape: the host is in the fetched roster, then arrives
    // again as an INSERT event.
    const host = p("host-1", "TestHost");
    expect(mergeParticipant([host], host).map((x) => x.id)).toEqual(["host-1"]);
  });

  it("matches on id, not on object identity", () => {
    // Realtime delivers a fresh object decoded from the payload, never the same
    // reference the fetch produced — so a `!prev.includes(incoming)` check would
    // have looked correct and fixed nothing.
    const fromFetch = p("host-1", "TestHost");
    const fromRealtime = { ...fromFetch };
    expect(mergeParticipant([fromFetch], fromRealtime)).toHaveLength(1);
  });

  it("stays stable when the same event is delivered repeatedly", () => {
    // Realtime redelivery after a reconnect must not grow the roster.
    const host = p("host-1");
    let roster = [host];
    for (let i = 0; i < 5; i++) roster = mergeParticipant(roster, { ...host });
    expect(roster).toHaveLength(1);
  });

  it("returns the previous array unchanged on a duplicate", () => {
    // Reference stability matters: returning a new array of identical contents
    // would re-render the roster on every redelivered event.
    const prev = [p("a")];
    expect(mergeParticipant(prev, p("a"))).toBe(prev);
  });

  it("appends to an empty roster", () => {
    expect(mergeParticipant([], p("a"))).toHaveLength(1);
  });

  it("does not mutate the array it is given", () => {
    const prev = [p("a")];
    mergeParticipant(prev, p("b"));
    expect(prev).toHaveLength(1);
  });

  it("preserves arrival order for distinct participants", () => {
    let roster = [p("a")];
    roster = mergeParticipant(roster, p("b"));
    roster = mergeParticipant(roster, p("c"));
    expect(roster.map((x) => x.id)).toEqual(["a", "b", "c"]);
  });
});
