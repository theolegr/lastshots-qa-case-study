import { expect, Page } from "@playwright/test";
import { pace, DOUBLE_TAP_THRESHOLD } from "./timing";

/** Cast N votes on available photos (opens accordions, double-taps).
 *  Single pass through accordions — each photo is opened at most once.
 *  @param startFrom — number of votes already cast (offsets the counter assertion).
 *  @param quota — the party's `max_votes`, which the counter renders as `n/quota`.
 *    Defaults to 5, the column default. This is a parameter rather than a
 *    constant because the quota became a host setting on 2026-08-27: a helper
 *    that asserts `n/5` silently contradicts any party configured otherwise,
 *    and did — `vote-cap.spec.ts` seeds 7 and this line failed on CI while the
 *    local `@smoke` tier stayed green, because vote-cap is not in that tier. */
export async function castVotes(page: Page, count: number, startFrom = 0, quota = 5) {
  let voted = 0;
  const accordions = page.getByTestId("situation-accordion");
  const accordionCount = await accordions.count();

  for (let a = 0; a < accordionCount && voted < count; a++) {
    const accordion = accordions.nth(a);

    // Scoping the photos to this accordion is what makes the pass single:
    // accordions keep independent open state, so a page-wide locator would
    // keep re-listing every photo left open behind us.
    const photos = accordion.getByTestId("situation-accordion-photo-btn");

    // Open only if it isn't already. The header is a toggle and this helper can
    // run more than once against the same page (J2 votes in two batches), which
    // leaves earlier accordions open — a blind click would shut one instead.
    if ((await photos.count()) === 0) {
      await accordion.getByTestId("situation-accordion-header-btn").click();
      // The grid is mounted only while open, so the first photo becoming
      // visible *is* the expanded signal — no fixed wait needed.
      await expect(photos.first()).toBeVisible({ timeout: 5_000 });
    }

    const photoCount = await photos.count();

    for (let p = 0; p < photoCount && voted < count; p++) {
      await photos.nth(p).click();
      // Input timing, not synchronisation: the opening tap must age out of the
      // card's 300ms double-tap window before the vote double-click is sent.
      await page.waitForTimeout(DOUBLE_TAP_THRESHOLD);

      const voteArea = page.getByTestId("photo-fullscreen-vote-area");
      await expect(voteArea).toBeVisible({ timeout: 5_000 });

      const alreadyVoted = await page.getByText("Favorited").isVisible().catch(() => false);
      if (!alreadyVoted) {
        await voteArea.dblclick();
        voted++;
        await expect(page.getByText(`${startFrom + voted}/${quota}`)).toBeVisible({ timeout: 5_000 });
      }

      await page.getByTestId("photo-fullscreen-close-btn").click();
      await expect(voteArea).toBeHidden({ timeout: 5_000 });
      await pace(page);
    }
  }
}

/**
 * Read the rendered podium as an ordered list of entry signatures
 * (participant name + vote count), position 1 first.
 *
 * Reads `podium-entry-N` rather than the photo grid. An earlier version read
 * `results-photo-item`, whose elements wrap nothing but an `<img>` — every one
 * of them stringified to `""`, so comparing two sessions' podiums could only
 * ever detect a difference in the *number* of photos, never a divergent
 * ranking. That is the exact assertion Journey 3 exists to make, so it is read
 * from the elements that actually carry the ranking.
 *
 * Entries are addressed by their `position` testid, not by DOM order:
 * `PodiumShareable` reorders the three entries visually (1st in the middle) via
 * CSS `order`, so DOM order is not rank order.
 */
export async function readPodium(page: Page): Promise<string[]> {
  await expect(page.getByText("Results")).toBeVisible({ timeout: 10_000 });

  // The podium only mounts once getVoteResults has resolved, so the first entry
  // becoming visible is the signal that ranking is complete.
  await expect(page.getByTestId("podium-entry-1")).toBeVisible({ timeout: 10_000 });

  const signatures: string[] = [];
  for (const position of [1, 2, 3]) {
    const entry = page.getByTestId(`podium-entry-${position}`);
    // Fewer than 3 photos is a legitimate podium — stop at the first gap.
    if ((await entry.count()) === 0) break;
    signatures.push(((await entry.textContent()) ?? "").replace(/\s+/g, " ").trim());
  }
  return signatures;
}
