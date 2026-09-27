// @covers PM-003, PM-006
// Flow: Party settings are applied to the running party
//
// Angle: prove that the host's configuration choices in the lobby actually
// reach CaptureMode. Since the BUG-001 fix the path is DB-backed:
//   PartyLobby settings → startParty() writes parties.max_situations
//                       → CaptureMode reads it off the fetched party row
//
// If that write or read breaks, CaptureMode falls back to the default (5) with
// no error — a silent downgrade that only a non-default value can expose.
//
// This is the single-client half of the guard: it covers the write/read pair
// for the client that set the value. The cross-client half — that a *guest*,
// who never touched the settings dialog, sees the same count — is J2, and that
// is the half BUG-001 actually broke. Both are needed: this test would still
// pass under the old per-client nav-state implementation.

import { test, expect } from "../fixtures/test";
import { pace } from "../helpers/timing";

test.describe("Flow: Party settings applied to capture mode", { tag: "@smoke" }, () => {
  test("selecting 7 situations in settings results in 7 cards in capture mode", async ({ page }) => {
    await page.goto("/");

    // Create party
    await page.getByTestId("home-create-party-btn").click();
    await expect(page).toHaveURL(/\/create/);
    await page.getByTestId("create-party-name-input").fill("Settings Flow Party");
    await page.getByTestId("create-party-nickname-input").fill("Host");
    await page.getByTestId("create-party-submit-btn").click();
    await expect(page).toHaveURL(/\/lobby\/\d{6}/, { timeout: 10_000 });
    await pace(page);

    // Open settings and select 7 situations
    await page.getByTestId("lobby-settings-btn").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Settings")).toBeVisible();
    await pace(page);
    // Scoped to the situations control by testid, not by visible label. The
    // votes control offers the same 5 / 7 / 10 labels, so `getByRole("button",
    // { name: "7" })` over the whole dialog resolves to two elements — which is
    // how this spec failed when that control was added.
    await dialog.getByTestId("settings-max-situations").getByRole("button", { name: "7" }).click();
    await pace(page);
    await page.keyboard.press("Escape");
    await pace(page);

    // Start the party
    await page.getByTestId("lobby-start-party-btn").click();
    await expect(page).toHaveURL(/\/capture\//, { timeout: 10_000 });

    // Wait for situation cards to load
    await expect(page.getByTestId("situation-card-btn").first()).toBeVisible({ timeout: 10_000 });

    // Exactly 7 situation cards must be rendered — not 5 (default) or 12 (DB total)
    const cardCount = await page.getByTestId("situation-card-btn").count();
    expect(cardCount).toBe(7);
  });
});
