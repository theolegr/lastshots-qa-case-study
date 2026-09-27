// @covers NT-001
// @regression BUG-004
// Flow — the "Timer has been updated" toast fires once per actual change (BUG-004)
//
// Regression guard for a stale-closure bug in `Vote.tsx`. The realtime handler
// decided whether to toast by comparing the incoming row against
// `party.ends_at`, but the effect that opened the subscription depended only on
// `party.id`. So `party` stayed frozen at the render that opened the channel,
// and after the first timer change the comparison kept measuring against the
// *original* value — making every later party UPDATE look like a timer change,
// including `startVotingPhase`, which writes only `voting_ends_at`.
//
// The sequence below is the smallest one that can tell the two versions apart.
// A single update cannot: the stale value and the live value are still equal, so
// both the broken and the fixed build stay silent. The bug only becomes
// observable on the *second* update, once the two have diverged:
//
//   1. subscribe            stale = E1, live = E1
//   2. set ends_at = E2     toast — correct, and identical in both builds
//   3. touch only           broken: E2 !== E1 (stale) -> toast again
//      voting_ends_at       fixed:  E2 !== E2         -> silent
//
// Proving a *non*-event needs proof that the event that should have triggered it
// actually arrived — otherwise a dropped realtime message would pass as a green
// test. Step 3 therefore asserts the countdown re-renders: in the voting phase it
// targets `voting_ends_at`, so its text changing is delivery confirmation. That
// replaces "wait a while and hope" with a real signal.

import "dotenv/config";
import { test, expect } from "../fixtures/test";
import { createPartyInVotingState, cleanupParty } from "../fixtures/party.fixture";
import { addBrowserObserver , closeOpenContexts } from "../helpers/party-setup";
import { activateVoting, updateParty } from "../helpers/db";

const TIMER_TOAST = /Timer has been updated/;

/**
 * How long to watch for a toast that must never appear. Comfortably longer than
 * the observed realtime round-trip (~1s) plus sonner's ~4s display duration, so
 * a toast raised by a regression cannot slip through between samples.
 */
const TOAST_OBSERVATION_WINDOW = 6_000;

/**
 * Gap between samples inside that window. Short enough that a toast which
 * mounts and unmounts inside ~4s cannot pass unseen between two reads, long
 * enough that the loop is not itself the reason the page is busy.
 */
const TOAST_SAMPLE_INTERVAL = 200;

test.describe("Flow — timer toast does not fire on unrelated party updates", { tag: "@smoke" }, () => {
  // Runs even when the test fails, so a leaked context cannot destabilise the
  // specs that follow it.
  test.afterEach(closeOpenContexts);

  test("a second update that leaves ends_at alone raises no timer toast", async ({ browser }) => {
    const fixture = await createPartyInVotingState("ToastStalenessHost", ["G1", "G2"], 2);
    const hostClient = fixture._clients[0].client;
    await activateVoting(hostClient, fixture.party.id);

    const { page, context } = await addBrowserObserver(browser, fixture.party);

    try {
      await page.goto(`/vote/${fixture.code}`);
      await expect(page.getByText("Vote for your favorites")).toBeVisible({ timeout: 10_000 });

      const countdown = page.getByTestId("countdown-timer");
      await expect(countdown).toBeVisible({ timeout: 10_000 });

      // ── Step 2: a real ends_at change. Both builds toast here. ─────────────
      // Kept in the past so the party stays in the voting phase rather than
      // redirecting mid-test.
      const newEndsAt = new Date(Date.now() - 30_000).toISOString();
      await updateParty(hostClient, fixture.party.id, { ends_at: newEndsAt }, "step 2: real ends_at change");

      await expect(page.getByText(TIMER_TOAST)).toBeVisible({ timeout: 15_000 });

      // Let it auto-dismiss, so a leftover toast can't be mistaken for a new one.
      await expect(page.getByText(TIMER_TOAST)).toBeHidden({ timeout: 20_000 });

      // ── Step 3: touch only voting_ends_at. ends_at is untouched. ───────────
      // The fixture opened the voting window at +2h, so the countdown reads
      // `01:59:xx`. Moving it to +10 minutes makes it read `00:09:xx` — a value
      // it cannot reach by counting down on its own during this test.
      //
      // That distinction matters: the countdown re-renders once per second by
      // itself, so "its text changed" proves nothing. An earlier version of this
      // test used exactly that as its delivery signal and passed against the
      // broken build, because the tick satisfied the assertion about a second
      // before the spurious toast rendered. Matching a specific value the clock
      // cannot produce is what makes this a real arrival signal.
      // `updateParty`, not a bare update: this step feeds a *negative* assertion,
      // and an UPDATE that RLS refuses returns no error while changing nothing.
      // That would raise no Realtime event, no toast would appear, and the
      // "no spurious toast" check below would go green having tested nothing —
      // the precise false-green this spec's other comments were written to
      // prevent. The helper fails loudly on a 0-row write instead.
      const newVotingEndsAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      await updateParty(
        hostClient,
        fixture.party.id,
        { voting_ends_at: newVotingEndsAt },
        "step 3: voting_ends_at only"
      );

      // Sample continuously instead of checking once at the end. A toast is a
      // *transient*: sonner mounts it ~1s after the update and unmounts it ~4s
      // later, so any single snapshot can fall before it appears or after it is
      // gone. Two earlier versions of this test did exactly that and went green
      // against the broken build while the spurious toast was demonstrably
      // being raised. Polling across the whole window is what makes the
      // negative assertion trustworthy.
      const spuriousToasts: string[] = [];
      const deadline = Date.now() + TOAST_OBSERVATION_WINDOW;
      while (Date.now() < deadline) {
        const texts = await page.locator("[data-sonner-toast]").allTextContents();
        spuriousToasts.push(...texts.filter((t) => TIMER_TOAST.test(t)));
        await page.waitForTimeout(TOAST_SAMPLE_INTERVAL);
      }

      // Delivery confirmation. By now the payload has long since been applied,
      // so this documents *why* silence counts as evidence: the handler ran.
      await expect(countdown).toHaveText(/^00:09:/, { timeout: 15_000 });

      // The actual regression assertion.
      expect(spuriousToasts).toEqual([]);
    } finally {
      await context.close();
      await cleanupParty(fixture.party.id);
    }
  });
});
