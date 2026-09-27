// @covers PM-006
// Flow — `get_party_by_code` exposes every column of `parties`
//
// The guard for a defect class, not a single instance.
//
// `get_party_by_code` declares an explicit `RETURNS TABLE` column list. Adding a
// column to `parties` does not widen it, nothing warns you, and the app reads
// most of its party state through this RPC — so a new column is invisible to
// every client until it is added here too. That is exactly what happened to
// `max_votes` on 2026-09-01: the host's setting was stored and never read, and
// `Vote.tsx` silently used its `?? 5` fallback (Guiding Rule 7 in
// `TEST_STRATEGY.md`).
//
// Why this spec rather than only widening `@smoke`. The end-to-end tests catch
// this one column at a time: `party-settings` covers `max_situations`,
// `vote-cap` covers `max_votes`, and the next column added would again have no
// guard until someone remembered to write one. This asserts the *contract*, so
// column number thirteen is covered the day it exists.
//
// The expected set is read from the table at runtime — a `select("*")` on the
// row the fixture just created — rather than hard-coded here. A hard-coded list
// would need the same edit the RPC needs, and would therefore be forgotten in
// the same breath. Same principle as `edge-function-deployment.spec.ts`, which
// reads `supabase/functions/` instead of naming the functions.
//
// Cost: 1 anon sign-in, no browser.

import "dotenv/config";
import { test, expect } from "../fixtures/test";
import { createPartyInWaitingState, cleanupParty } from "../fixtures/party.fixture";

test.describe("Flow — RPC column contract", { tag: "@smoke" }, () => {
  test("get_party_by_code returns every column of parties", async () => {
    const { party, code, _hostClient } = await createPartyInWaitingState("ContractHost");

    try {
      // The table's own shape, as RLS lets the host see it.
      const { data: tableRow, error: tableError } = await _hostClient.client
        .from("parties")
        .select("*")
        .eq("id", party.id)
        .single();
      expect(tableError, `reading parties failed: ${tableError?.message}`).toBeNull();
      expect(tableRow).toBeTruthy();

      // The RPC's shape, on the same row.
      const { data: rpcRows, error: rpcError } = await _hostClient.client.rpc(
        "get_party_by_code",
        { _code: code }
      );
      expect(rpcError, `get_party_by_code failed: ${rpcError?.message}`).toBeNull();
      expect(Array.isArray(rpcRows), "get_party_by_code is RETURNS TABLE — expected an array").toBe(
        true
      );
      expect(rpcRows).toHaveLength(1);

      const tableColumns = Object.keys(tableRow as Record<string, unknown>).sort();
      const rpcColumns = Object.keys(rpcRows![0] as Record<string, unknown>).sort();
      const missing = tableColumns.filter((c) => !rpcColumns.includes(c));

      expect(
        missing,
        `public.parties has column(s) that get_party_by_code does not return: ${missing.join(", ")}. ` +
          `The app reads party state through this RPC, so these are unreachable from every client ` +
          `and any client-side default will silently win. Add them to the RETURNS TABLE list and ` +
          `the SELECT (note: this needs DROP + CREATE — Postgres refuses to replace a function ` +
          `whose row type changes, SQLSTATE 42P13). If a column is withheld on purpose, say so ` +
          `here rather than deleting the assertion.`
      ).toEqual([]);
    } finally {
      await cleanupParty(party.id);
    }
  });
});
