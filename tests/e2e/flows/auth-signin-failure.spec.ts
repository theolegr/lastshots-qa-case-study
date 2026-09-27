// @covers IA-007
// @regression BUG-010
// Flow — a refused anonymous sign-in leaves a screen the player can act from
//
// Regression guard for BUG-010, verifying IA-007 ("when anonymous identity
// cannot be provisioned, the client shall surface the failure and offer a retry,
// never an indefinite loading state").
//
// `AuthProvider` used to gate on `loading || !user` alone. Both are true while
// sign-in is in flight *and* after it has failed for good, so a player whose
// sign-in was refused — a shared IP that has spent the 200/hour anonymous quota
// is the realistic trigger — sat on `PageSkeleton` indefinitely: no text, no
// error, no control. The console carried the reason and nothing else did.
//
// This is BUG-008 one layer lower. That one was a party that stopped resolving;
// this one is an identity that never resolved at all, and MO-005 does not reach
// it because there is no party involved yet.
//
// Why the failure is injected rather than provoked: exhausting the real quota
// would take ~200 sign-ins, cost every other spec in the run, and prove nothing
// the fulfilled response does not. The response body is the one Supabase
// actually returns — `over_request_rate_limit`, copied from a real 429 observed
// on 2026-09-09.

import { test, expect } from "../fixtures/test";

const RATE_LIMITED = {
  status: 429,
  contentType: "application/json",
  body: JSON.stringify({
    code: 429,
    error_code: "over_request_rate_limit",
    msg: "Request rate limit reached",
  }),
};

/**
 * Three attempts with `attempt × 2s` backoff, so the last one resolves at ~6s.
 * The window below is comfortably past that without being so wide that a hung
 * page would pass as a slow one.
 */
const SIGN_IN_GIVES_UP_BY = 20_000;

test.describe("Flow — a refused sign-in is surfaced, not swallowed", { tag: "@smoke" }, () => {
  test("a rate-limited sign-in shows an error and a working retry (IA-007, BUG-010)", async ({
    page,
  }) => {
    let refuse = true;
    await page.route("**/auth/v1/signup**", async (route) => {
      if (refuse) return route.fulfill(RATE_LIMITED);
      return route.continue();
    });

    await page.goto("/");

    // The requirement has two halves and the first is "surface the failure".
    const errorScreen = page.getByTestId("auth-error-screen");
    await expect(errorScreen).toBeVisible({ timeout: SIGN_IN_GIVES_UP_BY });
    await expect(errorScreen).toContainText(/sign you in/i);

    // Proving the *absence* of the old behaviour needs the old behaviour to be
    // named: the skeleton must be gone, not merely covered.
    await expect(page.getByTestId("home-create-party-btn")).toBeHidden();

    // The second half is "offer a retry", and a retry that cannot recover is not
    // one. Letting the next sign-in through turns this from a screenshot test
    // into a proof that the failure state is exit-able.
    refuse = false;
    await page.getByTestId("auth-error-retry-btn").click();

    await expect(page.getByTestId("home-create-party-btn")).toBeVisible({ timeout: 15_000 });
    await expect(errorScreen).toBeHidden();
  });
});
