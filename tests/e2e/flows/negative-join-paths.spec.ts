// @covers MB-001, MB-005, MB-006
// @regression BUG-002
// Flow — Negative paths on the /join page
//
// Three hypotheses about the /join error surface, each turned into an assertion:
//
//   A. Client-side validation strips non-digits at input time and keeps the
//      submit button disabled below 6 digits. No API call should be made for
//      malformed codes.
//
//   B. Submitting a 6-digit code that does not match any party should surface
//      a message identifying the cause (party not found / invalid code).
//      JoinParty.handleJoin currently maps both `!partyData` (party doesn't
//      exist) and `!canPerformAction(..., "join")` (party in voting/results)
//      to the same toast: "This party is no longer accepting new players."
//      Hypothesis B is expected to FAIL on this conflation — that failure
//      confirms BUG-002 (misleading error message).
//
//   C. Submitting the code of a party already in voting/results phase should
//      stay on /join and show the "no longer accepting" message — which is
//      semantically correct for this case.
//
// A and C are predicted to pass. B is the bug-revealing assertion: the
// failure point is the wording of the toast, not the blocking behavior.

import { test, expect } from "../fixtures/test";
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { pace } from "../helpers/timing";
import { createPartyInVotingState, cleanupParty } from "../fixtures/party.fixture";
import { countBrowserSignIns } from "../helpers/signin-budget";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SUPABASE_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY!;

/** Probe Supabase via the public RPC to find a 6-digit code that is currently unused. */
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

test.describe("Flow — Negative paths on /join", { tag: "@smoke" }, () => {
  test("client-side validation strips non-digits and keeps Submit disabled below 6 digits", async ({
    page,
  }) => {
    await page.goto("/join");
    await pace(page);

    const codeInput = page.getByTestId("join-party-code-input");
    const submit = page.getByTestId("join-party-submit-btn");

    await page.getByTestId("join-party-nickname-input").fill("FormatTest");

    // Pure non-digit input is filtered to empty
    await codeInput.fill("abc!@#");
    await expect(codeInput).toHaveValue("");
    await expect(submit).toBeDisabled();

    // Mixed input below maxLength: letters stripped, digits remain
    await codeInput.fill("1a2b3");
    await expect(codeInput).toHaveValue("123");
    await expect(submit).toBeDisabled();

    // 5 digits — still disabled
    await codeInput.fill("12345");
    await expect(codeInput).toHaveValue("12345");
    await expect(submit).toBeDisabled();

    // 6 digits — enabled
    await codeInput.fill("123456");
    await expect(codeInput).toHaveValue("123456");
    await expect(submit).toBeEnabled();

    // Beyond 6 digits — maxLength caps the input (browser-enforced)
    await codeInput.fill("1234567890");
    await expect(codeInput).toHaveValue("123456");
  });

  test("non-existent 6-digit code surfaces an error message that identifies the cause", async ({
    page,
  }) => {
    const unusedCode = await findUnusedCode();
    await page.goto("/join");
    await pace(page);

    await page.getByTestId("join-party-code-input").fill(unusedCode);
    await page.getByTestId("join-party-nickname-input").fill("Ghost");
    await pace(page);
    await page.getByTestId("join-party-submit-btn").click();

    // User remains on /join (the blocking behavior is correct).
    await expect(page).toHaveURL(/\/join/);

    // A toast must appear.
    const toast = page.locator("[data-sonner-toast]").first();
    await expect(toast).toBeVisible({ timeout: 5_000 });

    // The wording should identify the cause. JoinParty.handleJoin today maps both
    // "party does not exist" and "party is in voting/results" to the same message
    // ("This party is no longer accepting new players"). For a non-existent code,
    // that wording is misleading: it implies the party once existed and was closed.
    // This assertion is the bug-revealing one — see BUG-002.
    const toastText = await toast.textContent();
    expect(toastText?.toLowerCase()).toMatch(/not found|invalid|doesn'?t exist|does not exist/);
  });

  test("joining a party already in voting phase is blocked with the 'no longer accepting' message", async ({
    browser,
  }) => {
    // Seed a party past the capture window. fixture state: status=playing, ends_at in the past.
    const fixture = await createPartyInVotingState("LateHost", ["LateGuest"], 1);

    const context = await browser.newContext();
    countBrowserSignIns(context);
    const page = await context.newPage();
    await page.goto("/join");
    await pace(page);

    await page.getByTestId("join-party-code-input").fill(fixture.code);
    await page.getByTestId("join-party-nickname-input").fill("Latecomer");
    await pace(page);
    await page.getByTestId("join-party-submit-btn").click();

    // Must stay on /join — not routed to /lobby, /capture, /vote, or /results.
    await expect(page).toHaveURL(/\/join/);

    // The "no longer accepting" wording is semantically correct here:
    // the party exists but the join window is closed.
    const toast = page.locator("[data-sonner-toast]").first();
    await expect(toast).toBeVisible({ timeout: 5_000 });
    await expect(toast).toContainText(/no longer accepting/i);

    await context.close();
    await cleanupParty(fixture.party.id);
  });
});
