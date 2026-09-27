// @covers MO-001
import { describe, it, expect } from "vitest";
import {
  RETENTION_HOURS,
  retentionCutoff,
  isPastRetention,
} from "../../supabase/functions/_shared/retention";

// ─── MO-001, the half that was "verified by inspection" ──────────────────────
//
// The 72h retention window has been marked partially covered since BUG-003:
// `edge-function-deployment.spec.ts` proves `cleanup-old-parties` is deployed
// and answering, but nothing asserted the cutoff *value*, because doing it
// end-to-end needs a 72h-old party in CI. That framing treated the obstacle as
// the requirement's, when it was the code's — the arithmetic sat inline in a
// Deno handler that no test could import.
//
// It now lives in `supabase/functions/_shared/retention.ts`, which the edge
// function itself imports, so these assertions run against the deployed rule
// and not a copy of it. The E2E half still owns "the function exists and is
// reachable"; this half owns "and it computes the right boundary".

const H = 60 * 60 * 1000;

describe("RETENTION_HOURS", () => {
  it("is the 72 hours MO-001 states", () => {
    expect(RETENTION_HOURS).toBe(72);
  });
});

describe("retentionCutoff", () => {
  it("is exactly 72 hours before the given instant", () => {
    const now = new Date("2026-09-09T12:00:00.000Z");
    expect(retentionCutoff(now).toISOString()).toBe("2026-09-06T12:00:00.000Z");
  });

  it("measures 72 elapsed hours, not 72 wall-clock hours", () => {
    // The regression this file exists to hold. `setHours(getHours() - 72)` —
    // what the handler used to do — subtracts local wall-clock hours, so under
    // a DST transition it is off by one and a party is deleted an hour early or
    // kept an hour long. Asserting the elapsed-millisecond difference states
    // the rule in a way no timezone can reinterpret.
    for (const instant of [
      "2026-03-29T12:00:00.000Z", // EU spring forward
      "2026-10-25T12:00:00.000Z", // EU fall back
      "2026-11-01T12:00:00.000Z", // US fall back
    ]) {
      const now = new Date(instant);
      expect(now.getTime() - retentionCutoff(now).getTime()).toBe(72 * H);
    }
  });

  it("defaults to now when no instant is given", () => {
    const before = Date.now();
    const cutoff = retentionCutoff().getTime();
    const after = Date.now();
    expect(cutoff).toBeGreaterThanOrEqual(before - 72 * H);
    expect(cutoff).toBeLessThanOrEqual(after - 72 * H);
  });
});

describe("isPastRetention", () => {
  const now = new Date("2026-09-09T12:00:00.000Z");

  it("keeps a party created inside the window", () => {
    expect(isPastRetention(new Date(now.getTime() - 71 * H), now)).toBe(false);
  });

  it("deletes a party created beyond the window", () => {
    expect(isPastRetention(new Date(now.getTime() - 73 * H), now)).toBe(true);
  });

  it("retains a party sitting exactly on the boundary", () => {
    // Exclusive, matching the `.lt("created_at", cutoff)` the handler issues.
    // The two are only checkable against each other because the rule is stated
    // somewhere other than the query.
    expect(isPastRetention(new Date(now.getTime() - 72 * H), now)).toBe(false);
    expect(isPastRetention(new Date(now.getTime() - 72 * H - 1), now)).toBe(true);
  });

  it("accepts the ISO string Postgres returns for created_at", () => {
    expect(isPastRetention("2026-09-06T11:59:59.999Z", now)).toBe(true);
    expect(isPastRetention("2026-09-06T12:00:00.001Z", now)).toBe(false);
  });

  it("never treats an unparseable timestamp as expired", () => {
    // A NaN date compares false against everything, so a silent `return false`
    // would keep the party — but a silent `true` would delete it. Throwing is
    // the only answer that cannot quietly destroy data.
    expect(() => isPastRetention("not a date", now)).toThrow(/unparseable created_at/);
  });
});
