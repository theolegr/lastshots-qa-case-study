// @covers RS-006
// Flow — Results page renders correctly with fixture data

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { test, expect } from "../fixtures/test";
import { createPartyInResultsState, cleanupParty } from "../fixtures/party.fixture";
import { countBrowserSignIns } from "../helpers/signin-budget";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SUPABASE_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY!;

test.describe("Flow — Results page renders correctly with fixture data", () => {
  test("results page shows correct photo count, player count, and closing message", async ({
    browser,
  }) => {
    const PHOTOS_PER_PARTICIPANT = 3;

    // Seed: 3 participants, 3 photos each, 3 votes each — party already in results state
    const fixture = await createPartyInResultsState(
      "FixtureHost",
      ["FixtureGuest1", "FixtureGuest2"],
      PHOTOS_PER_PARTICIPANT,
      3
    );

    // Create a fresh browser context and load the app (triggers anonymous sign-in)
    const context = await browser.newContext();
    countBrowserSignIns(context);
    const page = await context.newPage();
    await page.goto("/");
    await expect(page.getByTestId("home-create-party-btn")).toBeVisible({ timeout: 10_000 });

    // Extract the browser user's auth session from localStorage
    const sessionData = await page.evaluate(() => {
      const key = Object.keys(localStorage).find(
        (k) => k.startsWith("sb-") && k.endsWith("-auth-token")
      );
      return key ? JSON.parse(localStorage.getItem(key)!) : null;
    });
    expect(sessionData?.user?.id).toBeTruthy();

    // Authenticate a Node-side client as the browser user, then insert them as a party participant.
    // This satisfies RLS (auth.uid() = user_id) without needing a service role key.
    const browserUserClient = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false },
    });
    await browserUserClient.auth.setSession({
      access_token: sessionData.access_token,
      refresh_token: sessionData.refresh_token,
    });
    const { error: joinError } = await browserUserClient.from("participants").insert({
      party_id: fixture.party.id,
      user_id: sessionData.user.id,
      name: "Observer",
      avatar_emoji: "👀",
      is_host: false,
    });
    expect(joinError).toBeNull();

    // Navigate directly to the results page
    await page.goto(`/results/${fixture.code}`);
    await expect(page.getByText("Results")).toBeVisible({ timeout: 10_000 });

    // 3 fixture participants + 1 browser observer = 4 players
    await expect(page.getByText("4 players")).toBeVisible({ timeout: 10_000 });

    // All 4 participants appear by name in the "Who was there" grid
    const participantsGrid = page.getByTestId("results-participants-grid");
    await expect(participantsGrid.getByText("FixtureHost")).toBeVisible();
    await expect(participantsGrid.getByText("FixtureGuest1")).toBeVisible();
    await expect(participantsGrid.getByText("FixtureGuest2")).toBeVisible();
    await expect(participantsGrid.getByText("Observer")).toBeVisible();

    // 3 fixture participants × 3 photos each = 9 photo items in the grid
    await expect(page.getByText("All Photos")).toBeVisible();
    await expect(page.getByTestId("results-photo-item")).toHaveCount(
      3 * PHOTOS_PER_PARTICIPANT,
      { timeout: 10_000 }
    );

    await expect(page.getByText("Thanks for participating!")).toBeVisible();

    await context.close();
    await cleanupParty(fixture.party.id);
  });
});
