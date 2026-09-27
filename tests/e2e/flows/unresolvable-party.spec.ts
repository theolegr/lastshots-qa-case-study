// @covers MO-005
// @regression BUG-008
// Flow — A party route whose party cannot be resolved
//
// The hypothesis comes from a roadmap item, "party expiry mid-session", which
// had been parked as untestable: `cleanup-old-parties` deletes parties older
// than 72h, and what an already-connected client does when its party vanishes
// was undefined. Reading the RLS policies explains why nobody could test it —
// there is **no DELETE policy on `parties`, `participants`, `photos` or
// `situations`** (only `votes` has one), so no client session can make a party
// disappear. Deletion is reachable only by `service_role`, which this suite
// deliberately does not hold.
//
// But the *state* a deletion leaves behind does not need a deletion to reach.
// After the row is gone, `get_party_by_code` returns zero rows — exactly what
// it returns for a code that never existed. So the post-expiry client state is
// reachable today, by URL, with no privileged access at all: navigate to a
// party route whose code resolves to nothing.
//
// Hypothesis: a route referencing a party that cannot be resolved surfaces an
// error and returns the user to a usable screen (MO-005).
//
// Predicted to FAIL on /capture. `CaptureMode.refetchParty` is written as
// `if (partyData) { ... }` with no else, and it is also the initial loader, so
// an unresolvable code leaves `partyId` null forever. `usePartyGuard(null)`
// short-circuits on the null id and never redirects, so the page renders its
// full shell with an empty situation list — an indefinite "Loading
// challenges..." spinner. That failure confirms BUG-008.
//
// /vote and /results are the control: both check `if (!partyData) navigate("/")`
// on their initial load, so the same input should be handled there. Asserting
// all three in one test is what makes the finding specific — it is one page's
// missing branch, not a missing convention.

import { test, expect } from "../fixtures/test";
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { pace } from "../helpers/timing";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SUPABASE_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY!;

/** Probe Supabase via the public RPC for a 6-digit code that resolves to nothing. */
async function findUnusedCode(): Promise<string> {
  const client = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
  await client.auth.signInAnonymously();
  for (let i = 0; i < 20; i++) {
    const candidate = Math.floor(Math.random() * 1_000_000)
      .toString()
      .padStart(6, "0");
    const { data } = await client.rpc("get_party_by_code", { _code: candidate });
    if (!data || data.length === 0) return candidate;
  }
  throw new Error("Could not find an unused 6-digit code after 20 attempts");
}

test.describe("Flow — unresolvable party route (MO-005)", { tag: "@smoke" }, () => {
  test("every party route leaves a usable screen when the code resolves to nothing", async ({
    page,
  }) => {
    const code = await findUnusedCode();

    // Establish the anonymous session first, so each navigation below is a
    // signed-in client hitting an unresolvable code — the post-deletion state —
    // rather than a cold boot racing its own sign-in.
    await page.goto("/");
    await expect(page.getByTestId("home-create-party-btn")).toBeVisible({ timeout: 10_000 });

    for (const route of ["/vote", "/results", "/capture"]) {
      await page.goto(`${route}/${code}`);
      await pace(page);

      // The user must end up somewhere they can act from. Any of the app's own
      // recovery surfaces counts — being returned Home is what /vote and
      // /results already do — so the assertion is on the outcome, not on one
      // particular redirect target.
      await expect(
        page.getByTestId("home-create-party-btn"),
        `${route}/:code with an unresolvable code left the user on ${page.url()} with no way out`
      ).toBeVisible({ timeout: 10_000 });
    }
  });
});
