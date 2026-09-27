// @covers PM-001, PM-003, PM-005, PM-006
// Journey 1 — Smoke: Host creates a party
//
// Angle: fast smoke test for the creation path.
// Verifies that the core host flow (create → lobby) works end-to-end:
// the party is persisted, a 6-digit code is generated, the host appears
// in the participant list, and the Start button is available.

import { test, expect } from "../fixtures/test";
import { pace } from "../helpers/timing";

test.describe("Journey 1 — Smoke: Host creates a party", { tag: "@smoke" }, () => {
  test("host creates a party and lands in the waiting lobby", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByTestId("home-create-party-btn")).toBeVisible();
    await pace(page);

    await page.getByTestId("home-create-party-btn").click();
    await expect(page).toHaveURL(/\/create/);
    await pace(page);

    await page.getByTestId("create-party-name-input").fill("E2E Test Party");
    await pace(page);
    await page.getByTestId("create-party-nickname-input").fill("TestHost");
    await pace(page);

    await page.getByTestId("create-party-submit-btn").click();
    await expect(page).toHaveURL(/\/lobby\/\d{6}/, { timeout: 10_000 });
    await pace(page);

    // Party code is generated server-side and exposed to the host
    const codeButton = page.getByTestId("lobby-copy-code-btn");
    await expect(codeButton).toBeVisible();
    const codeText = await codeButton.getByTestId("lobby-party-code").textContent();
    expect(codeText).toMatch(/^\d{6}$/);
    await pace(page);

    // Host is listed as a participant
    await expect(page.getByText("TestHost")).toBeVisible();
    await pace(page);

    // Host-only controls are visible
    await expect(page.getByTestId("lobby-start-party-btn")).toBeVisible();
    await expect(page.getByTestId("lobby-settings-btn")).toBeVisible();
    await pace(page);

    // Settings dialog opens with all four controls
    await page.getByTestId("lobby-settings-btn").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Settings")).toBeVisible();
    await expect(dialog.getByText("Capture window")).toBeVisible();
    await expect(dialog.getByText("Voting window")).toBeVisible();
    await expect(dialog.getByText("Situations")).toBeVisible();
    await expect(dialog.getByText("Votes per player")).toBeVisible();
    await page.keyboard.press("Escape");
  });
});
