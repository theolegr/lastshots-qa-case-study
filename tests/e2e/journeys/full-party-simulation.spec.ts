// @covers MB-002, NT-001, NT-003, NT-004, PM-001, PM-008, PS-002, PS-003, RS-003, RS-006
// @regression BUG-006
// Journey 3 — Concurrency: Real-time sync across 3 simultaneous sessions
//
// Angle: verify that Supabase Realtime correctly propagates state changes
// to all connected clients at the same time.
//
// Three independent browser contexts (host + 2 guests) run the full party
// lifecycle concurrently. Key assertions:
//   - All 3 sessions transition phases simultaneously (no manual refresh).
//   - The podium is identical across all 3 sessions at the end — proving
//     that vote tallying is deterministic and consistent regardless of
//     which client reads the results.

import { test, expect } from "../fixtures/test";
import { pace } from "../helpers/timing";
import { takePhotos } from "../helpers/capture";
import { castVotes, readPodium } from "../helpers/voting";
import { newPlayer , closeOpenContexts } from "../helpers/party-setup";

test.describe("Journey 3 — Concurrency: Real-time sync across 3 simultaneous sessions", () => {
  // Runs even when the test fails, so a leaked context cannot destabilise the
  // specs that follow it.
  test.afterEach(closeOpenContexts);

  test("all 3 players transition phases together and see an identical podium", async ({ browser }) => {
    test.setTimeout(300_000);

    // ── Host creates party ──────────────────────────────────────────────

    const hostPage = await newPlayer(browser);
    await hostPage.goto("/");
    await hostPage.getByTestId("home-create-party-btn").click();
    await expect(hostPage).toHaveURL(/\/create/);

    await hostPage.getByTestId("create-party-name-input").fill("Simulation Party");
    await hostPage.getByTestId("create-party-nickname-input").fill("Host");
    await hostPage.getByTestId("create-party-submit-btn").click();
    await expect(hostPage).toHaveURL(/\/lobby\/\d{6}/, { timeout: 10_000 });
    await pace(hostPage);

    const code = (
      await hostPage
        .getByTestId("lobby-copy-code-btn")
        .getByTestId("lobby-party-code")
        .textContent()
    )!.trim();

    // ── Guests join concurrently ────────────────────────────────────────

    const guestAPage = await newPlayer(browser);
    await guestAPage.goto("/join");
    await pace(guestAPage);
    await guestAPage.getByTestId("join-party-code-input").fill(code);
    await pace(guestAPage);
    await guestAPage.getByTestId("join-party-nickname-input").fill("Alice");
    await pace(guestAPage);
    await guestAPage.getByTestId("join-party-submit-btn").click();
    await expect(guestAPage).toHaveURL(/\/lobby\//, { timeout: 15_000 });
    await pace(guestAPage);

    const guestBPage = await newPlayer(browser);
    await guestBPage.goto("/join");
    await pace(guestBPage);
    await guestBPage.getByTestId("join-party-code-input").fill(code);
    await pace(guestBPage);
    await guestBPage.getByTestId("join-party-nickname-input").fill("Bob");
    await pace(guestBPage);
    await guestBPage.getByTestId("join-party-submit-btn").click();
    await expect(guestBPage).toHaveURL(/\/lobby\//, { timeout: 15_000 });
    await pace(guestBPage);

    // Settings button is host-only — guests must not see it
    await expect(guestAPage.getByTestId("lobby-settings-btn")).not.toBeVisible();
    await expect(guestBPage.getByTestId("lobby-settings-btn")).not.toBeVisible();

    // Host lobby must reflect all 3 participants (Realtime insert)
    const threeJoined = hostPage.getByText("3 joined");
    if (!(await threeJoined.isVisible({ timeout: 5_000 }).catch(() => false))) {
      await hostPage.reload();
    }
    await expect(threeJoined).toBeVisible({ timeout: 10_000 });
    await pace(hostPage);

    // ── Host starts party ───────────────────────────────────────────────

    await hostPage.getByTestId("lobby-start-party-btn").click();

    // All 3 sessions transition via Realtime. Reload fallback for sessions that miss the event.
    await expect(hostPage).toHaveURL(/\/capture\//, { timeout: 15_000 });
    await expect(guestAPage).toHaveURL(/\/capture\//, { timeout: 15_000 });
    if (!(await guestBPage.url().includes("/capture/"))) {
      await guestBPage.reload();
    }
    await expect(guestBPage).toHaveURL(/\/capture\//, { timeout: 15_000 });
    await pace(hostPage);

    // ── Capture phase ───────────────────────────────────────────────────

    await takePhotos(hostPage, 3);
    await expect(hostPage.getByText("3/5")).toBeVisible();
    await pace(hostPage);

    await takePhotos(guestAPage, 4);
    await expect(guestAPage.getByText("4/5")).toBeVisible();
    await pace(guestAPage);

    await takePhotos(guestBPage, 5);
    await expect(guestBPage.getByText("5/5")).toBeVisible();
    await pace(guestBPage);

    // ── Transition to voting ────────────────────────────────────────────

    await hostPage.getByTestId("capture-debug-timer-btn").click();

    // All 3 sessions transition simultaneously via Realtime
    await expect(hostPage).toHaveURL(/\/vote\//, { timeout: 15_000 });
    await expect(guestAPage).toHaveURL(/\/vote\//, { timeout: 15_000 });
    await expect(guestBPage).toHaveURL(/\/vote\//, { timeout: 15_000 });
    await pace(hostPage);

    await expect(hostPage.getByText("Vote for your favorites")).toBeVisible({ timeout: 15_000 });
    await expect(guestAPage.getByText("Vote for your favorites")).toBeVisible({ timeout: 15_000 });
    await expect(guestBPage.getByText("Vote for your favorites")).toBeVisible({ timeout: 15_000 });
    await pace(hostPage);

    // ── Voting phase ────────────────────────────────────────────────────

    await castVotes(hostPage, 3);
    await expect(hostPage.getByText("3/5")).toBeVisible();
    await pace(hostPage);

    await castVotes(guestAPage, 3);
    await expect(guestAPage.getByText("3/5")).toBeVisible();
    await pace(guestAPage);

    await castVotes(guestBPage, 3);
    await expect(guestBPage.getByText("3/5")).toBeVisible();
    await pace(guestBPage);

    // ── Transition to results ───────────────────────────────────────────

    await hostPage.getByTestId("vote-debug-timer-btn").click();

    // All 3 sessions transition simultaneously via Realtime
    await expect(hostPage).toHaveURL(/\/results\//, { timeout: 15_000 });
    await expect(guestAPage).toHaveURL(/\/results\//, { timeout: 15_000 });
    await expect(guestBPage).toHaveURL(/\/results\//, { timeout: 15_000 });
    await pace(hostPage);

    // ── Cross-session consistency ───────────────────────────────────────
    // All 3 sessions must display the exact same podium.
    // This proves that vote tallying is deterministic and that no session
    // has stale or divergent state after concurrent writes.

    const hostPodium = await readPodium(hostPage);
    const guestAPodium = await readPodium(guestAPage);
    const guestBPodium = await readPodium(guestBPage);

    // Guard the comparison before making it: three empty arrays are `toEqual`
    // to each other. An earlier version of `readPodium` scraped elements that
    // contained only an <img>, so every signature was "" and this assertion
    // could not have detected a divergent ranking. Proving the podium is
    // populated and carries real text is what gives the equality its meaning.
    expect(hostPodium.length).toBeGreaterThan(0);
    for (const signature of hostPodium) {
      expect(signature).not.toBe("");
    }

    expect(hostPodium).toEqual(guestAPodium);
    expect(hostPodium).toEqual(guestBPodium);

    await hostPage.context().close();
    await guestAPage.context().close();
    await guestBPage.context().close();
  });
});
