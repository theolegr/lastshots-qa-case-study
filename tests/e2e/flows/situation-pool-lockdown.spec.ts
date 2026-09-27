// @covers IA-004, MO-002
// Flow — situation_pool is fully locked to the anon key (no UI)
//
// situation_pool is the shared master list of challenge prompts that
// sync_party_situations() draws from to seed/reroll each party's situations.
// It's not party-scoped data, so it has no RLS policies at all — access only
// ever happens inside that SECURITY DEFINER RPC, which bypasses RLS.
//
// Regression test for a real incident: Supabase flagged this table as
// rls_disabled_in_public (anyone with the project URL could read/edit/delete
// every row). Fixed by enabling RLS with zero policies. This test proves the
// lockdown holds for every write path a client could attempt, matching the
// exact behavior observed live:
//   SELECT          → 200, empty array (RLS filters silently)
//   INSERT          → error (no WITH CHECK policy grants it)
//   UPDATE / DELETE → 200, empty array (no USING policy matches any row)
//
// Cost: 0 anonymous sign-ins — uses the anon key directly, unauthenticated,
// which is also the exact threat model from the original alert ("anyone with
// your project URL").

import "dotenv/config";
import { test, expect } from "../fixtures/test";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SUPABASE_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY!;

test.describe("Flow — situation_pool RLS lockdown", () => {
  test("anon key cannot read, insert, update, or delete situation_pool rows", async () => {
    const anon = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false },
    });

    // READ — RLS filters to zero rows, not an error
    const { data: selected, error: selectErr } = await anon.from("situation_pool").select();
    expect(selectErr).toBeNull();
    expect(selected ?? []).toHaveLength(0);

    // INSERT — no WITH CHECK policy grants this; hard rejection
    const { data: inserted, error: insertErr } = await anon
      .from("situation_pool")
      .insert({ text: "attempted injection via test" })
      .select();
    expect(insertErr).not.toBeNull();
    expect(inserted ?? []).toHaveLength(0);

    // UPDATE — no USING policy matches any row; silent no-op
    const { data: updated, error: updateErr } = await anon
      .from("situation_pool")
      .update({ is_active: false })
      .neq("id", "00000000-0000-0000-0000-000000000000")
      .select();
    expect(updateErr).toBeNull();
    expect(updated ?? []).toHaveLength(0);

    // DELETE — same as UPDATE: silent no-op
    const { data: deleted, error: deleteErr } = await anon
      .from("situation_pool")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000")
      .select();
    expect(deleteErr).toBeNull();
    expect(deleted ?? []).toHaveLength(0);
  });
});
