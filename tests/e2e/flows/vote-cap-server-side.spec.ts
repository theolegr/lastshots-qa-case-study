// @covers VT-002
// Flow — the database enforces the vote cap (VT-002)
//
// This file used to assert the opposite. Until 2026-09-10 it was an executable
// demonstration of an open hole: it inserted `max_votes + 1` votes under real
// RLS, every one was accepted, and it passed *because* the database had no
// count. Its own comment said it was written to fail loudly the day enforcement
// landed. `20260910005500_enforce_vote_cap.sql` landed, it failed, and this is
// the regression guard it was always meant to become. The history is worth
// keeping in view: the test came first, and the migration had to make it fail.
//
// What guards `votes` now:
//
//   UNIQUE(photo_id, voter_id)  — a repeat vote on the *same photo*
//   the `Cast vote` RLS policy  — party membership, no self-vote, voting window
//   the `enforce_vote_quota` trigger — the voter's count against parties.max_votes
//
// `vote-cap.spec.ts` proves the *UI* honours `parties.max_votes` at a seeded
// non-default quota. That is an assertion about the client, and a client is
// exactly what an attacker replaces. This one skips the UI entirely and speaks
// to PostgREST with an ordinary participant's anonymous session — the same
// credentials the app itself holds, no service_role, no elevated key.

import "dotenv/config";
import { test, expect } from "../fixtures/test";
import { createPartyInVotingState, cleanupParty } from "../fixtures/party.fixture";
import { activateVoting } from "../helpers/db";

// Deliberately not the default 5: if the fixture's quota write were silently
// dropped, the party would fall back to 5 and the arithmetic below would be
// measuring the wrong number.
const SEEDED_QUOTA = 7;

// The trigger raises with ERRCODE 'check_violation', matching
// `enforce_party_settings_locked`. PostgREST passes the SQLSTATE through, so
// the assertion can name the rule that fired rather than accepting any failure
// — an insert rejected by RLS, or by a typo in a column name, would otherwise
// satisfy a bare "it errored".
const CHECK_VIOLATION = "23514";
const UNIQUE_VIOLATION = "23505";

test.describe("Flow — the database enforces the vote cap", () => {
  test("a participant cannot insert more votes than max_votes, under real RLS", async () => {
    // 3 participants × 4 photos = 12 photos. The voter may not vote for their
    // own 4, leaving 8 eligible — one more than the quota of 7, which is the
    // minimum needed to attempt an over-quota vote on a *distinct* photo and so
    // stay clear of UNIQUE(photo_id, voter_id).
    const fixture = await createPartyInVotingState(
      "ServerCapHost",
      ["ServerCapGuest1", "ServerCapGuest2"],
      4,
      SEEDED_QUOTA
    );

    try {
      expect(
        fixture.party.max_votes,
        "the fixture's quota must have reached the database, or this test measures nothing"
      ).toBe(SEEDED_QUOTA);

      await activateVoting(fixture._clients[0].client, fixture.party.id);

      // Guest 1, so the host's fixture client is not involved.
      const voter = fixture.participants[1];
      const voterClient = fixture._clients[1].client;

      const eligible = fixture.photos.filter((p) => p.participant_id !== voter.id);
      expect(
        eligible.length,
        "need at least max_votes + 1 photos the voter did not take"
      ).toBeGreaterThan(SEEDED_QUOTA);

      // ── Controls first, and that ordering is load-bearing. ────────────────
      // Both controls have to run *below* the quota. A BEFORE INSERT trigger
      // fires ahead of the unique index, so once the quota is spent every
      // insert fails with the quota's own error and a duplicate would look
      // rejected whether or not UNIQUE still existed. Running them here proves
      // the older rules survived the migration rather than being masked by it.
      const firstPhoto = eligible[0];
      const { error: firstError } = await voterClient
        .from("votes")
        .insert({ photo_id: firstPhoto.id, voter_id: voter.id });
      expect(firstError, `the first vote was rejected: ${firstError?.message}`).toBeNull();

      const { error: duplicateError } = await voterClient
        .from("votes")
        .insert({ photo_id: firstPhoto.id, voter_id: voter.id });
      expect(
        duplicateError?.code,
        "UNIQUE(photo_id, voter_id) must still reject a repeat vote on one photo"
      ).toBe(UNIQUE_VIOLATION);

      const ownPhoto = fixture.photos.find((p) => p.participant_id === voter.id)!;
      const { error: selfVoteError } = await voterClient
        .from("votes")
        .insert({ photo_id: ownPhoto.id, voter_id: voter.id });
      expect(
        selfVoteError,
        "the Cast vote policy must still reject a self-vote"
      ).not.toBeNull();

      // ── Spend the rest of the quota. Every one of these is legitimate. ────
      for (const photo of eligible.slice(1, SEEDED_QUOTA)) {
        const { error } = await voterClient
          .from("votes")
          .insert({ photo_id: photo.id, voter_id: voter.id });
        expect(error, `vote within quota was rejected: ${error?.message}`).toBeNull();
      }

      // ── The vote that must not be allowed. ────────────────────────────────
      // A distinct photo, so UNIQUE(photo_id, voter_id) has nothing to say; the
      // voting window is open and the photo is someone else's, so the RLS policy
      // has nothing to say either. The only rule it breaks is the quota.
      const overQuota = eligible[SEEDED_QUOTA];
      const { error: overQuotaError } = await voterClient
        .from("votes")
        .insert({ photo_id: overQuota.id, voter_id: voter.id });

      expect(
        overQuotaError?.code,
        "the database accepted a vote past max_votes — VT-002 has regressed to " +
          "client-side enforcement only"
      ).toBe(CHECK_VIOLATION);

      // Count the rows rather than trusting the error. A rejection proves the
      // insert returned an error; only the read proves nothing was written —
      // and, just as importantly, that the trigger did not also roll back the
      // seven legitimate votes that preceded it.
      const { data: persisted, error: readError } = await voterClient
        .from("votes")
        .select("id")
        .eq("voter_id", voter.id);
      expect(readError).toBeNull();
      expect(
        persisted!.length,
        "exactly the quota should have survived: the seven allowed, none of the rejected"
      ).toBe(SEEDED_QUOTA);

      // ── Deleting a vote gives the slot back. ──────────────────────────────
      // The trigger counts rows at insert time rather than tracking a spent
      // total, which is what makes the app's existing un-vote work. A cap that
      // enforced a lifetime budget would pass every assertion above and break
      // the toggle the UI has always offered.
      const { error: removeError } = await voterClient
        .from("votes")
        .delete()
        .eq("photo_id", firstPhoto.id)
        .eq("voter_id", voter.id);
      expect(removeError, `un-vote was rejected: ${removeError?.message}`).toBeNull();

      const { error: reuseError } = await voterClient
        .from("votes")
        .insert({ photo_id: overQuota.id, voter_id: voter.id });
      expect(
        reuseError,
        "after removing a vote the freed slot must be usable: " + reuseError?.message
      ).toBeNull();
    } finally {
      await cleanupParty(fixture.party.id);
    }
  });

  // The check reads a count and then inserts. Between those two statements a
  // second request from the same voter can read the same count, and both are
  // then inside the quota — the cap would hold for the app's sequential client
  // and leak for a parallel one, which is the only kind that would be attacking
  // it. `pg_advisory_xact_lock` on the voter closes that window by construction.
  //
  // What this test is, precisely: a guard on the outcome — eight simultaneous
  // votes at a quota of three leave three rows — and not a proof that the lock
  // is what produces it. The counterfactual was not run: showing the same
  // trigger *fail* without its lock means replacing a function on a live
  // database, and how reproducible the race is through PostgREST's own pooling
  // is unknown. So this passing tells you the invariant holds; it does not tell
  // you the lock is load-bearing. If the lock is ever removed and this stays
  // green, that is not evidence it was unnecessary.
  test("parallel inserts cannot exceed the quota", async () => {
    const PARALLEL_QUOTA = 3;

    // 3 participants × 4 photos = 12; the voter did not take 8 of them, so
    // there are five more eligible photos than the quota allows. Every request
    // targets a distinct photo, so UNIQUE(photo_id, voter_id) rejects none of
    // them and the quota is the only thing standing between 8 and 3.
    const fixture = await createPartyInVotingState(
      "ParallelCapHost",
      ["ParallelCapGuest1", "ParallelCapGuest2"],
      4,
      PARALLEL_QUOTA
    );

    try {
      expect(fixture.party.max_votes).toBe(PARALLEL_QUOTA);
      await activateVoting(fixture._clients[0].client, fixture.party.id);

      const voter = fixture.participants[1];
      const voterClient = fixture._clients[1].client;
      const eligible = fixture.photos.filter((p) => p.participant_id !== voter.id);
      expect(eligible.length).toBeGreaterThan(PARALLEL_QUOTA);

      // Fired together, not awaited in turn: `Promise.all` over already-started
      // requests is what puts them in flight at once.
      const results = await Promise.all(
        eligible.map((photo) =>
          voterClient.from("votes").insert({ photo_id: photo.id, voter_id: voter.id })
        )
      );

      const accepted = results.filter((r) => r.error === null).length;
      const rejected = results.filter((r) => r.error?.code === CHECK_VIOLATION).length;
      expect(
        accepted + rejected,
        "every request should have either succeeded or been refused by the quota"
      ).toBe(eligible.length);

      // The row count is the assertion that matters. `accepted` describes what
      // the requests were told; only this describes what the table holds.
      const { data: persisted, error: readError } = await voterClient
        .from("votes")
        .select("id")
        .eq("voter_id", voter.id);
      expect(readError).toBeNull();
      expect(
        persisted!.length,
        `${eligible.length} simultaneous votes at a quota of ${PARALLEL_QUOTA} must ` +
          "leave exactly the quota — more means the count-then-insert window is open"
      ).toBe(PARALLEL_QUOTA);
    } finally {
      await cleanupParty(fixture.party.id);
    }
  });
});
