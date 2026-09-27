// @covers NT-004, PM-006, VT-002, VT-004
// Flow — the vote cap is the host's setting, and the UI enforces it
//
// Seeds a party with max_votes = 7 rather than the default 5, deliberately.
// The quota used to be `const MAX_VOTES = 5` in Vote.tsx, so a test that
// asserted "5/5" passed whether the number came from the party or from a
// hard-coded constant — it could not tell the two apart. Seeding a non-default
// value is what makes this a real assertion: against the old code it fails on
// the very first counter check.
//
// What this does NOT prove, and it matters: nothing here asks whether the
// server would have accepted the vote the client declined to send. Since
// 2026-09-10 it would not — `enforce_vote_quota` counts against
// `parties.max_votes` — but that is a different assertion, made against
// PostgREST with no browser involved, and it lives in
// `vote-cap-server-side.spec.ts`.

import { test, expect } from "../fixtures/test";
import { createPartyInVotingState, cleanupParty } from "../fixtures/party.fixture";
import { addBrowserObserver , closeOpenContexts } from "../helpers/party-setup";
import { activateVoting } from "../helpers/db";
import { DOUBLE_TAP_THRESHOLD, NEGATIVE_ASSERTION_WINDOW } from "../helpers/timing";
import { castVotes } from "../helpers/voting";

const SEEDED_QUOTA = 7;

// In `@smoke` since 2026-09-01. `party-settings` was already there, guarding
// that `max_situations` survives the trip through `get_party_by_code` to the
// screen; `max_votes` had no equivalent, and that asymmetry is precisely how a
// broken setting reached `main`. The structural guard is
// `rpc-column-contract.spec.ts`; this is the end-to-end half.
test.describe("Flow — the vote cap is the host's setting", { tag: "@smoke" }, () => {
  // Runs even when the test fails, so a leaked context cannot destabilise the
  // specs that follow it.
  test.afterEach(closeOpenContexts);

  test("the host's quota is honoured, blocks the next vote, and survives a reload", async ({
    browser,
  }) => {
    // Seed: 3 participants × 3 photos = 9 photos, comfortably above the quota
    // so there is always an unvoted photo left to attempt the 8th vote on.
    const fixture = await createPartyInVotingState(
      "FixtureHost",
      ["FixtureGuest1", "FixtureGuest2"],
      3,
      SEEDED_QUOTA
    );

    // The quota must have reached the database — a fixture that silently failed
    // to set it would leave the party at the default 5 and the assertions below
    // would then be testing the old hard-coded behaviour under a new name.
    expect(fixture.party.max_votes).toBe(SEEDED_QUOTA);

    // voting_ends_at is null after createPartyInVotingState — set it to +2h to activate the vote UI
    await activateVoting(fixture._clients[0].client, fixture.party.id);

    // Browser observer has no photos of their own, so all 9 are visible and voteable
    const { page, context } = await addBrowserObserver(browser, fixture.party);

    await page.goto(`/vote/${fixture.code}`);
    await expect(page.getByText("Vote for your favorites")).toBeVisible({ timeout: 10_000 });

    // Cast the full quota
    await castVotes(page, SEEDED_QUOTA, 0, SEEDED_QUOTA);
    await expect(page.getByText(`${SEEDED_QUOTA}/${SEEDED_QUOTA}`)).toBeVisible();
    await expect(page.getByText(/0 votes left/)).toBeVisible();

    // Reload — votes must persist (resilience) and accordion state resets (clean slate for cap test)
    await page.reload();
    await expect(page.getByText("Vote for your favorites")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(`${SEEDED_QUOTA}/${SEEDED_QUOTA}`)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/0 votes left/)).toBeVisible({ timeout: 10_000 });

    // Find an unvoted photo and confirm the cap silently blocks the double-tap.
    //
    // "Silently" is literal and load-bearing here: at the cap `PhotoFullscreen`
    // computes `canVote = false`, and `handleDoubleTap` short-circuits before
    // calling `onToggleVote`. No handler runs, so there is no toast, no badge
    // change and no counter change to await — which is why the assertion below
    // is framed as an invariant held over a bounded window rather than as a
    // wait for a signal.
    let foundUnvotedAndTested = false;
    const accordions = page.getByTestId("situation-accordion");
    const accordionCount = await accordions.count();

    for (let a = 0; a < accordionCount && !foundUnvotedAndTested; a++) {
      const accordion = accordions.nth(a);
      const photoButtons = accordion.getByTestId("situation-accordion-photo-btn");

      // The header toggles, so open only when the grid isn't already mounted.
      if ((await photoButtons.count()) === 0) {
        await accordion.getByTestId("situation-accordion-header-btn").click();
        await expect(photoButtons.first()).toBeVisible({ timeout: 5_000 });
      }
      const photoCount = await photoButtons.count();

      const voteArea = page.getByTestId("photo-fullscreen-vote-area");

      for (let p = 0; p < photoCount && !foundUnvotedAndTested; p++) {
        await photoButtons.nth(p).click();
        await page.waitForTimeout(DOUBLE_TAP_THRESHOLD);
        await expect(voteArea).toBeVisible({ timeout: 5_000 });

        const isAlreadyVoted = await page
          .getByText("Favorited")
          .isVisible()
          .catch(() => false);
        if (isAlreadyVoted) {
          await page.getByTestId("photo-fullscreen-close-btn").click();
          await expect(voteArea).toBeHidden({ timeout: 5_000 });
          continue;
        }

        // Unvoted photo — double-tap must be rejected at the cap.
        await expect(page.getByText("Double-tap to vote")).toBeVisible();
        await page.getByTestId("photo-fullscreen-vote-area").dblclick();
        await page.waitForTimeout(NEGATIVE_ASSERTION_WINDOW);

        // Badge unchanged (never flips to "Favorited"), counter unchanged.
        await expect(page.getByText("Double-tap to vote")).toBeVisible();
        await expect(page.getByText(`${SEEDED_QUOTA}/${SEEDED_QUOTA}`)).toBeVisible();
        await page.getByTestId("photo-fullscreen-close-btn").click();
        foundUnvotedAndTested = true;
      }
    }

    expect(foundUnvotedAndTested).toBe(true);
    await expect(page.getByText(`${SEEDED_QUOTA}/${SEEDED_QUOTA}`)).toBeVisible();

    await context.close();
    await cleanupParty(fixture.party.id);
  });
});
