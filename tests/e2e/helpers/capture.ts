import { expect, Page } from "@playwright/test";
import { pace } from "./timing";

/** Take N photos on randomly selected available situation cards.
 *  @param startFrom — number of photos already taken (offsets the counter assertion). */
export async function takePhotos(page: Page, count: number, startFrom = 0) {
  for (let i = 0; i < count; i++) {
    // Wait for situation cards to load, then collect available ones
    const cards = page.getByTestId("situation-card-btn");
    await expect(cards.first()).toBeVisible({ timeout: 10_000 });
    const total = await cards.count();
    const available: number[] = [];
    for (let j = 0; j < total; j++) {
      const text = await cards.nth(j).textContent();
      if (text && !text.includes("Done") && !text.includes("Locked")) {
        available.push(j);
      }
    }
    if (available.length === 0) throw new Error("No available situation cards to capture");

    // Pick a random available card
    const pick = available[Math.floor(Math.random() * available.length)];
    await cards.nth(pick).click();

    // Camera -> shutter -> save
    const shutter = page.getByTestId("capture-shutter-btn");
    await expect(shutter).toBeVisible({ timeout: 5_000 });
    await expect(shutter).toBeEnabled({ timeout: 5_000 });
    await pace(page);
    await shutter.click();

    await expect(page.getByTestId("capture-save-btn")).toBeVisible({ timeout: 5_000 });
    await pace(page);
    await page.getByTestId("capture-save-btn").click();

    // Wait for upload to complete (camera overlay closes)
    await expect(page.getByTestId("capture-save-btn")).not.toBeVisible({ timeout: 15_000 });
    // Wait for any success toast to clear — it intercepts pointer events on the shutter
    await page.locator("[data-sonner-toast]").waitFor({ state: "hidden", timeout: 5_000 }).catch(() => {});
    await pace(page);

    // Assert counter incremented
    await expect(page.getByText(`${startFrom + i + 1}/5`)).toBeVisible({ timeout: 5_000 });
  }
}
