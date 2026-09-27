// @covers MB-007
// Flow — QR scanner on /join
//
// Code observation (not a confirmed bug, so deliberately unnumbered):
// handleQRCodeScanned in JoinParty.tsx calls setCode(scannedCode) without the
// digit filter that the text input's onChange applies
// (replace(/\D/g, "").slice(0, 6)). A 6-character non-digit string like
// "abc123" would pass the submit-button length check and allow a join attempt
// with malformed data.
//
// Mitigating factor: QRScanner.tsx validates decoded text with /^\d{6}$/ before
// calling onScan — only clean 6-digit codes reach the handler. The defense is
// in the child component; the handler itself has no secondary guard.
//
// What these tests cover:
//   A. The QR scan button opens the scanner dialog (UI integration).
//   B. Dismissing the dialog without a scan leaves the code input unchanged —
//      no phantom state is written on open/close.
//
// What these tests cannot cover:
//   The full scan path (Html5Qrcode → onScan → setCode) requires a real QR
//   image in the camera feed. The fake-device harness supplies a blank video
//   stream — the success callback never fires. Injecting a raw or malformed
//   payload would require mocking html5-qrcode at the module level, which is
//   out of scope for the current harness.

import { test, expect } from "../fixtures/test";
import { pace } from "../helpers/timing";

test.describe("Flow — QR scanner on /join", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/join");
    await pace(page);
  });

  test("Scan QR Code button opens the scanner dialog", async ({ page }) => {
    await page.getByTestId("join-party-qr-scan-btn").click();
    await pace(page);

    // Dialog is visible
    await expect(page.locator('[role="dialog"]')).toBeVisible();

    // Html5Qrcode mounts into this container — presence confirms scanner init
    await expect(page.locator("#qr-reader")).toBeVisible();

    // Opening the dialog alone must not populate the code input
    await expect(page.getByTestId("join-party-code-input")).toHaveValue("");
    await expect(page.getByTestId("join-party-submit-btn")).toBeDisabled();
  });

  test("dismissing the scanner dialog does not alter the code input", async ({ page }) => {
    // Pre-fill a partial code to detect any phantom state mutation on open/close
    await page.getByTestId("join-party-code-input").fill("123");

    await page.getByTestId("join-party-qr-scan-btn").click();
    await pace(page);
    await expect(page.locator('[role="dialog"]')).toBeVisible();

    await page.keyboard.press("Escape");
    await pace(page);

    // Code input must be exactly what the user typed before — not empty, not extended
    await expect(page.getByTestId("join-party-code-input")).toHaveValue("123");
    // Submit stays disabled (length < 6)
    await expect(page.getByTestId("join-party-submit-btn")).toBeDisabled();
  });
});
