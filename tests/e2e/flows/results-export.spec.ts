// @covers RS-005
// Flow — Results export entry point is available after result generation (RS-005)
//
// SPECS RS-005 ("Results export shall be available after result generation")
// was the one requirement with no automated coverage. The export surface is the
// shareable podium (`PodiumShareable`): a Save button (html2canvas → PNG
// download) and a Share button that opens a preview sheet wired to the OS share
// sheet.
//
// This test asserts the export *entry points* are present and interactive once
// the party reaches the results state — it does not drive html2canvas to
// produce a real PNG (canvas rasterization is slow and environment-dependent;
// asserting the rendered image belongs in a dedicated visual test, noted as a
// gap). Verifying the controls exist and the share flow opens/closes is enough
// to close RS-005 from "no test" to "covered".

import { test, expect } from "../fixtures/test";
import { createPartyInResultsState, cleanupParty } from "../fixtures/party.fixture";
import { addBrowserObserver , closeOpenContexts } from "../helpers/party-setup";

test.describe("Flow — Results export entry point (RS-005)", () => {
  // Runs even when the test fails, so a leaked context cannot destabilise the
  // specs that follow it.
  test.afterEach(closeOpenContexts);

  test("Save and Share controls are available and the share preview opens once results exist", async ({
    browser,
  }) => {
    // Seed a finished party with a real podium (votes → ranking).
    const fixture = await createPartyInResultsState(
      "ExportHost",
      ["ExportGuest1", "ExportGuest2"],
      3,
      3
    );

    const { page, context } = await addBrowserObserver(browser, fixture.party);

    try {
      await page.goto(`/results/${fixture.code}`);
      await expect(page.getByText("Results")).toBeVisible({ timeout: 10_000 });

      // Export entry points are rendered and enabled.
      const saveBtn = page.getByTestId("podium-save-btn");
      const shareBtn = page.getByTestId("podium-share-btn");
      await expect(saveBtn).toBeVisible({ timeout: 10_000 });
      await expect(saveBtn).toBeEnabled();
      await expect(shareBtn).toBeVisible();
      await expect(shareBtn).toBeEnabled();

      // Share opens the preview sheet (the export-confirmation surface).
      await shareBtn.click();
      const shareNow = page.getByTestId("podium-share-now-btn");
      await expect(shareNow).toBeVisible({ timeout: 10_000 });

      // Dismissing the sheet returns to results without exporting.
      await page.getByTestId("podium-share-cancel-btn").click();
      await expect(shareNow).toBeHidden();
      await expect(saveBtn).toBeVisible();
    } finally {
      await context.close();
      await cleanupParty(fixture.party.id);
    }
  });
});
