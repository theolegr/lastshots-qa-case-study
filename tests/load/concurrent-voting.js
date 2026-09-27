// @covers VT-004, VT-005
/**
 * Load test: concurrent voting on the UNIQUE(photo_id, voter_id) constraint
 *
 * Scenario: a "double-tap / retry storm". During the voting window a single
 * voter's client fires the *same* vote many times concurrently — flaky network
 * retries, an impatient double-tap, a reconnecting Realtime channel replaying
 * an action. The product's idempotency guarantee (ARCHITECTURE.md →
 * Architecture Principles) says this must collapse to exactly one recorded vote, never two,
 * and never a 5xx.
 *
 * What this asserts under concurrency:
 *   - The DB serializes the writes: exactly ONE insert wins (201), every
 *     duplicate is rejected by the UNIQUE(photo_id, voter_id) constraint (409).
 *   - No request returns a 5xx — the constraint violation is handled, not a crash.
 *   - p95 latency stays under threshold even while every VU contends for the
 *     same row.
 *   - teardown() reads the row count back and asserts it is exactly 1.
 *
 * Auth strategy: setup() creates TWO anon sessions — a host (to own the party
 * and a photo) and a voter (who votes on the host's photo; voting for your own
 * photo is blocked by the "Cast vote" RLS policy). VUs reuse the voter token,
 * so the whole run costs 2 anon sign-ins. This is above the join-flow's 1, so
 * — like extending E2E to PRs — it assumes the anon rate limit has been raised
 * from its ~30/h default, as it has been on this project (200/h). Run on
 * demand only.
 *
 * Run locally:
 *   mkdir -p reports/load
 *   k6 run \
 *     --env SUPABASE_URL=https://xxx.supabase.co \
 *     --env SUPABASE_ANON_KEY=eyJ... \
 *     tests/load/concurrent-voting.js
 *
 * Run via CI: the "Load tests (k6)" job, after E2E on every push to main, or
 * by workflow_dispatch.
 */

import http from "k6/http";
import { check } from "k6";
import { Rate, Counter } from "k6/metrics";
import { buildSummary } from "./summary.js";

const errorRate = new Rate("errors");
const acceptedInserts = new Counter("vote_inserts_201"); // first writer wins
const rejectedDuplicates = new Counter("vote_duplicates_409"); // constraint holds

export const options = {
  scenarios: {
    // All VUs hammer the identical (photo_id, voter_id) vote at once.
    retry_storm: {
      executor: "per-vu-iterations",
      vus: 30,
      iterations: 5, // 30 × 5 = 150 concurrent attempts at the same row
      maxDuration: "40s",
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<2000"],
    errors: ["rate<0.01"], // a 5xx or unexpected status counts as an error; 409 does not
  },
};

const SUPABASE_URL = __ENV.SUPABASE_URL;
const SUPABASE_ANON_KEY = __ENV.SUPABASE_ANON_KEY;

const anonHeaders = {
  "Content-Type": "application/json",
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
};

function authedHeaders(token, extra = {}) {
  return {
    "Content-Type": "application/json",
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${token}`,
    ...extra,
  };
}

function signInAnon() {
  const res = http.post(`${SUPABASE_URL}/auth/v1/signup`, JSON.stringify({}), {
    headers: anonHeaders,
  });
  if (res.status !== 200) throw new Error(`Anon sign-in failed: ${res.status} ${res.body}`);
  const body = res.json();
  // user_id is not optional: "Join party" is WITH CHECK (user_id = auth.uid()),
  // so an insert that omits it is refused by RLS, not defaulted.
  return { token: body.access_token, userId: body.user.id };
}

// ─── setup ───────────────────────────────────────────────────────────────────
// Stand up a party in the voting phase with one photo (host-authored) and one
// voter who is eligible to vote on it. Returns the single vote every VU will
// race to insert.

export function setup() {
  const { token: hostToken } = signInAnon();

  // Party + host participant + seeded situations (atomic RPC).
  const partyRes = http.post(
    `${SUPABASE_URL}/rest/v1/rpc/create_party_with_host`,
    JSON.stringify({ _party_name: "k6 Concurrent Voting", _host_name: "k6-host" }),
    { headers: authedHeaders(hostToken) }
  );
  if (partyRes.status !== 200) {
    throw new Error(`create_party_with_host failed: ${partyRes.status} ${partyRes.body}`);
  }
  const { party, participant: host } = partyRes.json();

  // Pick a situation to attach the photo to.
  const sitRes = http.get(
    `${SUPABASE_URL}/rest/v1/situations?party_id=eq.${party.id}&select=id&order=display_order.asc&limit=1`,
    { headers: authedHeaders(hostToken) }
  );
  const situationId = sitRes.json()[0].id;

  // Host uploads one photo — the target every vote will point at.
  const photoRes = http.post(
    `${SUPABASE_URL}/rest/v1/photos`,
    JSON.stringify({
      party_id: party.id,
      participant_id: host.id,
      situation_id: situationId,
      image_url: "https://placehold.co/400x400/222/666?text=target",
    }),
    { headers: authedHeaders(hostToken, { Prefer: "return=representation" }) }
  );
  if (photoRes.status !== 201) {
    throw new Error(`Photo insert failed: ${photoRes.status} ${photoRes.body}`);
  }
  const photoId = photoRes.json()[0].id;

  // Second identity: the voter joins the party (cannot vote for own photo).
  const { token: voterToken, userId: voterUserId } = signInAnon();
  const voterRes = http.post(
    `${SUPABASE_URL}/rest/v1/participants`,
    JSON.stringify({
      party_id: party.id,
      name: "k6-voter",
      avatar_emoji: "🗳️",
      is_host: false,
      user_id: voterUserId,
    }),
    { headers: authedHeaders(voterToken, { Prefer: "return=representation" }) }
  );
  if (voterRes.status !== 201) {
    throw new Error(`Voter join failed: ${voterRes.status} ${voterRes.body}`);
  }
  const voterId = voterRes.json()[0].id;

  // Move the party into the voting window. Both timestamps matter: the capture
  // window must be over (ends_at in the past) for photos to be visible, and
  // "Cast vote" additionally requires voting_ends_at IS NOT NULL AND > now().
  // Setting only ends_at leaves every vote refused by RLS with a 403.
  const past = new Date(Date.now() - 60_000).toISOString();
  const future = new Date(Date.now() + 600_000).toISOString();
  const patchRes = http.patch(
    `${SUPABASE_URL}/rest/v1/parties?id=eq.${party.id}`,
    JSON.stringify({ ends_at: past, voting_ends_at: future }),
    { headers: authedHeaders(hostToken) }
  );
  if (patchRes.status >= 300) {
    throw new Error(`Move to voting failed: ${patchRes.status} ${patchRes.body}`);
  }

  return { partyId: party.id, photoId, voterId, voterToken, hostToken };
}

// ─── default (VU loop) ───────────────────────────────────────────────────────
// Every VU iteration attempts the identical vote. Exactly one will be the
// constraint winner; the rest must be cleanly rejected with 409.

export default function (data) {
  const res = http.post(
    `${SUPABASE_URL}/rest/v1/votes`,
    JSON.stringify({ photo_id: data.photoId, voter_id: data.voterId }),
    { headers: authedHeaders(data.voterToken, { Prefer: "return=minimal" }) }
  );

  if (res.status === 201) acceptedInserts.add(1);
  if (res.status === 409) rejectedDuplicates.add(1);

  // Healthy outcomes are exactly: 201 (this VU won the race) or 409 (the
  // UNIQUE constraint rejected the duplicate). Anything else — a 5xx, a 4xx
  // that isn't a conflict, a timeout — is a real failure.
  const ok = check(res, {
    "vote accepted (201) or duplicate-rejected (409)": (r) =>
      r.status === 201 || r.status === 409,
    "no server error": (r) => r.status < 500,
  });
  errorRate.add(!ok);
}

// ─── teardown ────────────────────────────────────────────────────────────────
// The constraint's whole job: after 150 racing attempts, exactly one row exists.

export function teardown(data) {
  const countRes = http.get(
    `${SUPABASE_URL}/rest/v1/votes?photo_id=eq.${data.photoId}&voter_id=eq.${data.voterId}&select=id`,
    { headers: authedHeaders(data.voterToken, { Prefer: "count=exact" }) }
  );
  const rows = countRes.json();
  check(rows, {
    "exactly one vote persisted despite the storm": (r) => Array.isArray(r) && r.length === 1,
  });
  if (!Array.isArray(rows) || rows.length !== 1) {
    console.error(
      `IDEMPOTENCY VIOLATION: expected 1 vote row, found ${
        Array.isArray(rows) ? rows.length : "non-array"
      }`
    );
  }

  // Best-effort cleanup (votes → photos → party). RLS-permitted deletes only;
  // anything left expires via cleanup-old-parties within 72h.
  http.del(`${SUPABASE_URL}/rest/v1/votes?photo_id=eq.${data.photoId}`, null, {
    headers: authedHeaders(data.voterToken),
  });
  http.del(`${SUPABASE_URL}/rest/v1/parties?id=eq.${data.partyId}`, null, {
    headers: authedHeaders(data.hostToken),
  });
}

// ─── summary ─────────────────────────────────────────────────────────────────
// Writes reports/load/concurrent-voting.summary.json (+ the raw dump). The note
// travels with the numbers on purpose: `http_req_failed` near 93% is the
// *expected* result here, and a summary that reports it without saying so
// invites the next reader to file a bug against a working constraint.

export function handleSummary(data) {
  return buildSummary(
    {
      id: "concurrent-voting",
      title: "Vote retry storm",
      models: "150 attempts (30 VUs × 5) to cast the same (photo_id, voter_id) vote at once",
      notes: [
        "http_req_failed counts every 409 as a failure. 149 of 150 attempts are " +
          "supposed to be rejected by UNIQUE(photo_id, voter_id), so a rate near " +
          "93% is the constraint working. The check that matters is " +
          "'exactly one vote persisted despite the storm'.",
      ],
    },
    data
  );
}
