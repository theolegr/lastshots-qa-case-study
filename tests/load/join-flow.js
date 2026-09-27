// @covers none — a latency baseline; recorded, not gated
/**
 * Load test: party join flow
 *
 * Simulates the "party link shared in group chat" burst: N users looking up
 * the same party code and loading the lobby participants list simultaneously.
 *
 * Auth strategy: setup() creates one anon session to seed a test party.
 * VUs reuse that token for the authenticated participants call and use the
 * raw anon key for the SECURITY DEFINER code-lookup (no per-VU sign-in).
 * This costs exactly 1 anon sign-in total — well within the ~30/hour limit.
 *
 * Run locally:
 *   mkdir -p reports/load
 *   k6 run \
 *     --env SUPABASE_URL=https://xxx.supabase.co \
 *     --env SUPABASE_ANON_KEY=eyJ... \
 *     tests/load/join-flow.js
 *
 * Run via CI: the "Load tests (k6)" job, after E2E on every push to main, or
 * by workflow_dispatch.
 */

import http from "k6/http";
import { check, group, sleep } from "k6";
import { Rate } from "k6/metrics";
import { buildSummary } from "./summary.js";

const errorRate = new Rate("errors");

export const options = {
  stages: [
    { duration: "10s", target: 20 }, // ramp up — friends tap the link
    { duration: "30s", target: 20 }, // hold — sustained lobby activity
    { duration: "10s", target: 0 },  // ramp down
  ],
  thresholds: {
    // 95th-percentile response under 2 seconds
    http_req_duration: ["p(95)<2000"],
    // Less than 1% of check() assertions fail
    errors: ["rate<0.01"],
  },
};

const SUPABASE_URL = __ENV.SUPABASE_URL;
const SUPABASE_ANON_KEY = __ENV.SUPABASE_ANON_KEY;

// Used for SECURITY DEFINER endpoints — no user session required
const anonHeaders = {
  "Content-Type": "application/json",
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
};

function authedHeaders(token) {
  return {
    "Content-Type": "application/json",
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${token}`,
  };
}

// ─── setup ───────────────────────────────────────────────────────────────────
// Runs once before any VU starts. Creates one anon session + one test party.
// Return value is passed as-is to every VU and to teardown().

export function setup() {
  const authRes = http.post(
    `${SUPABASE_URL}/auth/v1/signup`,
    JSON.stringify({}),
    { headers: anonHeaders }
  );
  if (authRes.status !== 200) {
    throw new Error(`Anon sign-in failed: ${authRes.status} ${authRes.body}`);
  }
  const { access_token: hostToken } = authRes.json();

  const partyRes = http.post(
    `${SUPABASE_URL}/rest/v1/rpc/create_party_with_host`,
    JSON.stringify({ _party_name: "k6 Load Test", _host_name: "k6-runner" }),
    { headers: authedHeaders(hostToken) }
  );
  if (partyRes.status !== 200) {
    throw new Error(
      `create_party_with_host failed: ${partyRes.status} ${partyRes.body}`
    );
  }
  const { party } = partyRes.json();
  return { partyCode: party.code, partyId: party.id, hostToken };
}

// ─── default (VU loop) ───────────────────────────────────────────────────────

export default function (data) {
  // Scenario 1: user enters the party code on the /join screen.
  // get_party_by_code is SECURITY DEFINER — anon key alone is sufficient.
  group("code lookup", () => {
    const res = http.post(
      `${SUPABASE_URL}/rest/v1/rpc/get_party_by_code`,
      JSON.stringify({ _code: data.partyCode }),
      { headers: anonHeaders }
    );
    const ok = check(res, {
      "status 200": (r) => r.status === 200,
      "returns correct party": (r) => {
        try {
          // get_party_by_code is RETURNS TABLE, so PostgREST sends a JSON
          // array, not an object — the same shape api.ts reads as [0].
          const rows = r.json();
          return (
            Array.isArray(rows) && rows.length === 1 && rows[0].code === data.partyCode
          );
        } catch {
          return false;
        }
      },
    });
    errorRate.add(!ok);
  });

  // Scenario 2: joined participant loads the lobby participants list.
  // RLS-scoped: requires a real user token from a party member.
  group("participants list", () => {
    const res = http.get(
      `${SUPABASE_URL}/rest/v1/participants?party_id=eq.${data.partyId}` +
        `&select=id,name,avatar_emoji,is_host,joined_at`,
      { headers: authedHeaders(data.hostToken) }
    );
    const ok = check(res, {
      "status 200": (r) => r.status === 200,
      "returns array": (r) => {
        try {
          return Array.isArray(r.json());
        } catch {
          return false;
        }
      },
    });
    errorRate.add(!ok);
  });

  sleep(1);
}

// ─── teardown ────────────────────────────────────────────────────────────────
// Best-effort cleanup. If RLS blocks the delete, the party expires naturally
// via the cleanup-old-parties edge function within 72 hours.

export function teardown(data) {
  http.del(
    `${SUPABASE_URL}/rest/v1/parties?id=eq.${data.partyId}`,
    null,
    { headers: authedHeaders(data.hostToken) }
  );
}

// ─── summary ─────────────────────────────────────────────────────────────────
// Writes reports/load/join-flow.summary.json (+ the raw dump) and replaces k6's
// default console block. `mkdir -p reports/load` first — k6 writes the files but
// not their directory.

export function handleSummary(data) {
  return buildSummary(
    {
      id: "join-flow",
      title: "Join burst",
      models: "20 VUs looking up the same party code and loading the lobby at once",
    },
    data
  );
}
