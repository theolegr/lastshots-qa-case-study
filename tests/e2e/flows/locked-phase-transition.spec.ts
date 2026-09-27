// @covers PM-008
// @regression BUG-007
// Flow — /vote/:code leaves the locked phase on its own when ends_at passes (BUG-007)
//
// Regression guard for a page that could not observe its own deadline.
//
// `Vote.tsx` derives its phase in a `useMemo` whose real input is `new Date()` —
// wall-clock time, which React cannot track and which changes without any state
// changing. In the locked phase there was nothing to make it re-evaluate:
// `ends_at` does not change when it passes, the locked phase renders no
// countdown, and no Realtime event fires at a deadline. A player sitting on
// `/vote/:code` when the capture window closed therefore stayed on "Capture time
// isn't over yet…" indefinitely. Leaving and returning fixed it; waiting never
// did.
//
// The safety net that should have covered it had the same blind spot. The locked
// polling fallback armed a 2s poll only when the deadline was *already* past —
// a state the memo cannot produce — and when the deadline was in the future,
// which is the real case, it armed nothing and scheduled nothing.
//
// `CaptureMode.tsx` had the correct version of this effect the whole time:
// deadline passed → redirect now, otherwise `setTimeout(redirect, timeUntilEnd)`.
// The fix is that shape, applied to the phase memo rather than to a redirect.
//
// ── Why this test seeds a deadline in the FUTURE ──────────────────────────────
// Every other fixture in this suite seeds `ends_at` already in the past, so the
// first render lands directly on `voting` and the transition under test never
// happens. That is exactly why 30 tests were green while this was broken. The
// deadline here must be ahead of page load and cross while the page sits open,
// untouched — no reload, no interaction, no second DB write. Those are the
// conditions, and each one is load-bearing.
//
// Verified in both directions per this suite's rule 4: against the pre-fix build
// it failed 5/5 runs, still locked ~20s past the deadline every time.

import "dotenv/config";
import { test, expect } from "../fixtures/test";
import { createPartyInCapturingState, cleanupParty } from "../fixtures/party.fixture";
import { addBrowserObserver, closeOpenContexts } from "../helpers/party-setup";
import { updateParty } from "../helpers/db";

/**
 * How far ahead of page load the capture window closes.
 *
 * Long enough that the observer is reliably rendered and asserted in the locked
 * phase before it passes; short enough to keep the test in @smoke. This is not a
 * synchronisation sleep — the assertion after it is an auto-retrying `expect` on
 * the voting screen, so the test passes as soon as the app transitions rather
 * than at a fixed offset.
 */
const WINDOW_CLOSES_IN = 6_000;

test.describe("Flow — the locked phase transitions to voting on its own", { tag: "@smoke" }, () => {
  test.afterEach(closeOpenContexts);

  test("a player waiting on /vote is moved to voting when ends_at passes", async ({ browser }) => {
    const fixture = await createPartyInCapturingState("LockedPhaseHost", ["G1"]);
    const hostClient = fixture._clients[0].client;

    // `updateParty`, not a bare update: an UPDATE that RLS refuses returns no
    // error in supabase-js, and a party whose ends_at never moved would sit in
    // the locked phase for a reason that has nothing to do with the defect —
    // a false red that would send the next reader to the wrong page.
    const endsAt = new Date(Date.now() + WINDOW_CLOSES_IN).toISOString();
    await updateParty(hostClient, fixture.party.id, { ends_at: endsAt }, "BUG-007: ends_at ahead of load");

    const { page } = await addBrowserObserver(browser, fixture.party);

    try {
      await page.goto(`/vote/${fixture.code}`);

      // Precondition, asserted rather than assumed. If the page were already in
      // the voting phase here, the transition below would prove nothing — which
      // is precisely the hole every other fixture in this suite falls into.
      await expect(page.getByText("Capture time isn't over yet")).toBeVisible({ timeout: 10_000 });
      expect(
        Date.now(),
        "the deadline must still be ahead of us, or this test asserts nothing"
      ).toBeLessThan(new Date(endsAt).getTime());

      // ── The assertion. Nothing touches the page from here. ─────────────────
      // No reload, no click, no second write. The deadline passes on its own and
      // the page has to notice by itself.
      await expect(page.getByText("Vote for your favorites")).toBeVisible({ timeout: 20_000 });

      expect(
        Date.now(),
        "sanity: the transition must have happened after the deadline, not before"
      ).toBeGreaterThan(new Date(endsAt).getTime());

      // The locked screen is gone, not merely painted over by the voting one.
      await expect(page.getByText("Capture time isn't over yet")).toBeHidden();
    } finally {
      await cleanupParty(fixture.party.id);
    }
  });
});
