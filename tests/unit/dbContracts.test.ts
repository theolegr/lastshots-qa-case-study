// @covers PM-006
import { describe, it, expect } from "vitest";
import {
  PARTY_STATUSES,
  isPartyStatus,
  parseCreatePartyPayload,
  participantFromRealtime,
  partyFromRealtime,
  toParty,
} from "@/lib/dbContracts";

// The two runtime boundaries in `dbContracts.ts`, which exist because a derived
// type cannot cover them: a CHECK constraint the generated types widen to
// `string`, and an RPC that returns opaque `jsonb`.
//
// These are unit-testable only because `dbContracts.ts` imports nothing but zod
// and a type-only import of the generated schema. `api.ts` pulls in the
// Supabase client, which touches `localStorage` at module scope and cannot be
// imported in a Node test environment at all — the same constraint that put the
// ranking rules in `resultsRules.ts`.

// A `parties` row as the client receives it: `status` still widened to `string`.
const partyRow = (overrides: Record<string, unknown> = {}) => ({
  id: "party-1",
  code: "123456",
  name: "Test Party",
  host_name: "Host",
  status: "playing",
  created_at: "2026-09-04T10:00:00.000Z",
  ends_at: null,
  voting_ends_at: null,
  capture_hours: 12,
  voting_hours: 2,
  max_situations: 10,
  max_votes: 5,
  ...overrides,
});

// ─── toParty ─────────────────────────────────────────────────────────────────

describe("toParty", () => {
  it("accepts every status the CHECK constraint permits", () => {
    for (const status of PARTY_STATUSES) {
      expect(toParty(partyRow({ status })).status).toBe(status);
    }
  });

  // 'ended' is in the constraint and no application code writes it. The test
  // asserts the database's rule, not the app's current use of it.
  it("accepts 'ended', which the database permits and no code path writes", () => {
    expect(toParty(partyRow({ status: "ended" })).status).toBe("ended");
  });

  // Asserting the whole message, not just that it threw. Mutation testing
  // caught the weaker version: `PARTY_STATUSES.join(", ")` could become
  // `join("")` with the test still green, which is the same "message the test
  // never reads" gap the 2026-09-01 baseline found nine of. The list of valid
  // statuses is the useful half of this error — it is what tells a reader the
  // schema moved.
  it("throws on a status outside the constraint rather than widening it", () => {
    expect(() => toParty(partyRow({ status: "archived" }))).toThrow(
      'Unknown party status "archived" — expected one of waiting, playing, ended'
    );
  });

  it("carries every other column through untouched", () => {
    const row = partyRow({ ends_at: "2026-09-04T12:00:00.000Z", max_votes: 7 });
    expect(toParty(row)).toEqual(row);
  });

  it("preserves a null ends_at instead of defaulting it", () => {
    expect(toParty(partyRow({ ends_at: null })).ends_at).toBeNull();
  });
});

describe("isPartyStatus", () => {
  it("recognises exactly the constrained values", () => {
    expect(PARTY_STATUSES.every(isPartyStatus)).toBe(true);
  });

  it("rejects a value the constraint does not allow", () => {
    expect(isPartyStatus("voting")).toBe(false);
  });
});

// ─── parseCreatePartyPayload ─────────────────────────────────────────────────

// Mirrors what `create_party_with_host` actually builds, as amended by
// 20260907163000 — which added `max_votes` to the RPC's `jsonb_build_object`
// column list. Before that migration the column was absent here, and the
// creation result was typed `Omit<Party, "max_votes">` to say so; both the omit
// and this fixture's gap went when the payload converged on the full row.
const rpcPayload = () => ({
  party: {
    id: "party-1",
    code: "123456",
    name: "Test Party",
    host_name: "Host",
    status: "waiting",
    created_at: "2026-09-04T10:00:00.000Z",
    ends_at: null,
    voting_ends_at: null,
    capture_hours: 12,
    voting_hours: 2,
    max_situations: 10,
    max_votes: 5,
  },
  participant: {
    id: "participant-1",
    party_id: "party-1",
    name: "Host",
    avatar_emoji: "😀",
    is_host: true,
    joined_at: "2026-09-04T10:00:00.000Z",
    user_id: "user-1",
  },
});

describe("parseCreatePartyPayload", () => {
  it("accepts the payload the RPC really returns", () => {
    const parsed = parseCreatePartyPayload(rpcPayload());
    expect(parsed.party.code).toBe("123456");
    expect(parsed.participant.is_host).toBe(true);
  });

  // The regression this whole module exists for. `get_party_by_code` shipped
  // without `max_votes` for a full CI cycle because `as Party` laundered the
  // missing column into `undefined` (fixed in 20260901172918). Here the same
  // omission is a thrown error at the call site.
  it("throws when the RPC drops a column instead of yielding undefined", () => {
    const payload = rpcPayload();
    delete (payload.party as Record<string, unknown>).max_situations;
    expect(() => parseCreatePartyPayload(payload)).toThrow();
  });

  // `"12"` is deliberately *not* the case tested here. `capture_hours` is
  // Postgres `numeric`, and `pgNumeric` accepts a numeric string so the same
  // schema can serve the Realtime socket, whose encoding of `numeric` is a
  // different code path from jsonb's. The guard that matters is that a value
  // which is not a number in any encoding is still rejected.
  it("throws when a column comes back with the wrong type", () => {
    const payload = rpcPayload();
    (payload.party as Record<string, unknown>).capture_hours = "twelve";
    expect(() => parseCreatePartyPayload(payload)).toThrow();
  });

  it("throws when a numeric column comes back as a boolean", () => {
    const payload = rpcPayload();
    (payload.party as Record<string, unknown>).max_situations = true;
    expect(() => parseCreatePartyPayload(payload)).toThrow();
  });

  it("throws on a status the CHECK constraint does not allow", () => {
    const payload = rpcPayload();
    (payload.party as Record<string, unknown>).status = "archived";
    expect(() => parseCreatePartyPayload(payload)).toThrow();
  });

  it("throws when the participant half is missing entirely", () => {
    expect(() => parseCreatePartyPayload({ party: rpcPayload().party })).toThrow();
  });

  it("rejects a non-object payload rather than trusting the cast", () => {
    expect(() => parseCreatePartyPayload(null)).toThrow();
    expect(() => parseCreatePartyPayload("party created")).toThrow();
  });
});

// ─── partyFromRealtime / participantFromRealtime ─────────────────────────────

// The third boundary. `postgres_changes` payloads have no generated type at
// all, and these parsers return `null` rather than throwing because a realtime
// callback has no caller: a throw escapes into the Supabase client and kills
// the subscription, so one bad payload would stop the page reacting to every
// later event. The skip path is therefore load-bearing, and tested rather than
// assumed.

describe("partyFromRealtime", () => {
  it("accepts a full parties row", () => {
    const party = partyFromRealtime(partyRow());
    expect(party?.status).toBe("playing");
    expect(party?.max_votes).toBe(5);
  });

  // `capture_hours` and `voting_hours` are Postgres `numeric`. Over jsonb they
  // arrive as JSON numbers — proven in CI — but the Realtime socket is a
  // different encoder and `numeric` is the type most often handed back as a
  // string. Accepting both means the handler cannot break on the difference.
  it("accepts numeric columns encoded as strings", () => {
    const party = partyFromRealtime(
      partyRow({ capture_hours: "12", voting_hours: "2.5", max_votes: "7" })
    );
    expect(party?.capture_hours).toBe(12);
    expect(party?.voting_hours).toBe(2.5);
    expect(party?.max_votes).toBe(7);
  });

  it("rejects a numeric column that is not a number at all", () => {
    expect(partyFromRealtime(partyRow({ capture_hours: "twelve" }))).toBeNull();
  });

  // The three assertions below exist because mutation testing killed nothing
  // without them: the anchors and the fractional group in `pgNumeric`'s regex
  // could all be weakened with the suite green. A numeric string is either
  // entirely a number or it is not one — "12abc" is the shape a truncated or
  // unit-suffixed value would take, and it must not become 12.
  it("rejects a numeric column with trailing junk", () => {
    expect(partyFromRealtime(partyRow({ capture_hours: "12abc" }))).toBeNull();
  });

  it("rejects a numeric column with leading junk", () => {
    expect(partyFromRealtime(partyRow({ capture_hours: "abc12" }))).toBeNull();
  });

  it("accepts a numeric string with more than one decimal place", () => {
    expect(partyFromRealtime(partyRow({ voting_hours: "2.55" }))?.voting_hours).toBe(2.55);
  });

  // The reason this returns null instead of throwing.
  it("returns null rather than throwing on a malformed payload", () => {
    expect(partyFromRealtime({ id: "party-1" })).toBeNull();
    expect(partyFromRealtime(null)).toBeNull();
    expect(partyFromRealtime("UPDATE")).toBeNull();
  });

  it("returns null when a column the handlers read is missing", () => {
    const row = partyRow();
    delete (row as Record<string, unknown>).ends_at;
    expect(partyFromRealtime(row)).toBeNull();
  });

  it("returns null on a status outside the CHECK constraint", () => {
    expect(partyFromRealtime(partyRow({ status: "archived" }))).toBeNull();
  });
});

describe("participantFromRealtime", () => {
  const participantRow = (overrides: Record<string, unknown> = {}) => ({
    id: "participant-1",
    party_id: "party-1",
    name: "Guest",
    avatar_emoji: "😀",
    is_host: false,
    joined_at: "2026-09-07T10:00:00.000Z",
    user_id: "user-1",
    ...overrides,
  });

  it("accepts a full participants row", () => {
    expect(participantFromRealtime(participantRow())?.name).toBe("Guest");
  });

  it("returns null rather than throwing on a malformed payload", () => {
    expect(participantFromRealtime({ id: "participant-1" })).toBeNull();
    expect(participantFromRealtime(undefined)).toBeNull();
  });

  // BUG-005's merge keys on `id`; a payload without one would corrupt the
  // roster rather than fail loudly.
  it("returns null when the id is missing", () => {
    const row = participantRow();
    delete (row as Record<string, unknown>).id;
    expect(participantFromRealtime(row)).toBeNull();
  });
});
