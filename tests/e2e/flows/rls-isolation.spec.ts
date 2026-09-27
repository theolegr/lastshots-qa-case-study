// @covers IA-004, MB-003, MO-002
// Flow — Row Level Security tenant isolation (no UI)
//
// The whole test strategy rests on one claim: "every E2E test runs under real
// RLS, no service-role bypass." That claim is only worth making if a test
// actually proves RLS *denies* cross-tenant access — otherwise the permissive
// and the locked-down database are indistinguishable from green tests.
//
// This test stands up two unrelated parties (A and B), each with its own
// anonymous host, and asserts that party A's host — who is NOT a participant
// of party B — is fenced off from party B's data:
//
//   READ  (SELECT under `is_party_participant`): returns zero rows, not an error.
//         Postgres RLS filters silently on SELECT, so "denied" means "empty".
//   WRITE (INSERT under a WITH CHECK policy): rejected with an error.
//
// Covers SPECS: IA-004 (unauthorized actions rejected), MB-003 (only members
// may read/act), MO-002 (access enforced by RLS tied to auth identity).
//
// Cost: exactly 2 anonymous sign-ins (one host per party) — deliberately lean
// to stay within the Supabase anon rate limit.

import "dotenv/config";
import { test, expect } from "../fixtures/test";
import {
  createPartyInWaitingState,
  cleanupParty,
  type FixtureSituation,
} from "../fixtures/party.fixture";

test.describe("Flow — RLS tenant isolation", { tag: "@smoke" }, () => {
  test("a host of one party cannot read or write another party's rows", async () => {
    // ── Arrange: two unrelated parties, each with its own anon host ──────────
    const a = await createPartyInWaitingState("IsolationHostA");
    const b = await createPartyInWaitingState("IsolationHostB");

    const hostAClient = a._hostClient.client; // authed as host A (member of A only)

    // Seed one photo into party B, authored by host B (a legitimate B member),
    // so there is real cross-tenant data for host A to (fail to) reach.
    const { data: bSituations, error: bSitErr } = await b._hostClient.client
      .from("situations")
      .select()
      .eq("party_id", b.party.id)
      .order("display_order", { ascending: true });
    expect(bSitErr).toBeNull();
    const firstSituation = (bSituations as FixtureSituation[])[0];
    expect(firstSituation?.id).toBeTruthy();

    const { error: seedPhotoErr } = await b._hostClient.client.from("photos").insert({
      party_id: b.party.id,
      participant_id: b.hostParticipant.id,
      situation_id: firstSituation.id,
      image_url: "https://placehold.co/400x400/222/666?text=B",
    });
    expect(seedPhotoErr).toBeNull();

    try {
      // ── Assert READ isolation: host A sees zero rows of party B ────────────
      // RLS filters SELECTs to rows the caller is a participant of, so a
      // non-member's query returns an empty set (no error, no leak).

      const { data: bParticipantsSeenByA, error: pErr } = await hostAClient
        .from("participants")
        .select()
        .eq("party_id", b.party.id);
      expect(pErr).toBeNull();
      expect(bParticipantsSeenByA ?? []).toHaveLength(0);

      const { data: bSituationsSeenByA, error: sErr } = await hostAClient
        .from("situations")
        .select()
        .eq("party_id", b.party.id);
      expect(sErr).toBeNull();
      expect(bSituationsSeenByA ?? []).toHaveLength(0);

      const { data: bPhotosSeenByA, error: phErr } = await hostAClient
        .from("photos")
        .select()
        .eq("party_id", b.party.id);
      expect(phErr).toBeNull();
      expect(bPhotosSeenByA ?? []).toHaveLength(0);

      // Sanity check: host A is NOT blind to its own party — proves the empty
      // results above are RLS isolation, not a broken query.
      const { data: ownSituations } = await hostAClient
        .from("situations")
        .select()
        .eq("party_id", a.party.id);
      expect((ownSituations ?? []).length).toBeGreaterThan(0);

      // ── Assert WRITE isolation: host A cannot inject a photo into party B ──
      // The photos INSERT policy is WITH CHECK is_party_participant(party_id,
      // auth.uid()); host A fails the check and the write is rejected.
      const { data: smuggled, error: writeErr } = await hostAClient
        .from("photos")
        .insert({
          party_id: b.party.id,
          participant_id: b.hostParticipant.id,
          situation_id: firstSituation.id,
          image_url: "https://placehold.co/400x400/900/fff?text=intruder",
        })
        .select();
      expect(writeErr).not.toBeNull(); // RLS WITH CHECK violation
      expect(smuggled ?? []).toHaveLength(0);

      // Confirm nothing landed: party B still has exactly its one seeded photo,
      // read back through a legitimate B member.
      const { data: bPhotosAfter } = await b._hostClient.client
        .from("photos")
        .select()
        .eq("party_id", b.party.id);
      expect(bPhotosAfter ?? []).toHaveLength(1);
    } finally {
      await cleanupParty(a.party.id);
      await cleanupParty(b.party.id);
    }
  });
});
