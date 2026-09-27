// @covers NT-002
// Flow — NT-002: users see the time-left countdown during playing and voting.

import { test, expect } from "../fixtures/test";
import {
  createPartyInCapturingState,
  createPartyInVotingState,
  cleanupParty,
} from "../fixtures/party.fixture";
import { addBrowserObserver , closeOpenContexts } from "../helpers/party-setup";
import { activateVoting } from "../helpers/db";

test.describe("Flow — Countdown timer is visible in playing and voting phases", () => {
  // Runs even when the test fails, so a leaked context cannot destabilise the
  // specs that follow it.
  test.afterEach(closeOpenContexts);

  test("countdown is rendered in CaptureMode while the party is in playing state", async ({
    browser,
  }) => {
    const fixture = await createPartyInCapturingState("FixtureHost", ["G1"]);

    const { page, context } = await addBrowserObserver(browser, fixture.party);

    await page.goto(`/capture/${fixture.code}`);
    await expect(page.getByTestId("countdown-timer")).toBeVisible({ timeout: 10_000 });

    await context.close();
    await cleanupParty(fixture.party.id);
  });

  test("countdown is rendered in Vote while the party is in voting state", async ({
    browser,
  }) => {
    const fixture = await createPartyInVotingState("FixtureHost", ["G1", "G2"], 2);
    await activateVoting(fixture._clients[0].client, fixture.party.id);

    const { page, context } = await addBrowserObserver(browser, fixture.party);

    await page.goto(`/vote/${fixture.code}`);
    await expect(page.getByText("Vote for your favorites")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("countdown-timer")).toBeVisible({ timeout: 5_000 });

    await context.close();
    await cleanupParty(fixture.party.id);
  });
});
