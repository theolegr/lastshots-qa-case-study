// @covers IA-006, MB-004, NT-001, PM-001, PM-007, PS-002, RS-006
// @regression BUG-001
// Journey 2 — Resilience: Guest state survives page reloads + settings propagate
//
// Angle: prove that a guest's in-progress state is never lost across hard reloads,
// AND that the host's party configuration reaches every player.
// Three checkpoints are validated:
//   1. Host-set settings (7 situations) appear on the guest's capture screen.
//   2. Capture counter (2/5) persists after reload mid-capture phase.
//   3. Vote counter (2/5) persists after reload mid-voting phase.
//
// The guest also receives real-time phase transitions triggered by the host
// while the guest tab has been reloaded — verifying that Supabase Realtime
// re-subscribes correctly after a fresh page load.

import { test, expect } from "../fixtures/test";
import { pace } from "../helpers/timing";
import { takePhotos } from "../helpers/capture";
import { castVotes } from "../helpers/voting";
import { hostCreatesAndStartsParty, newPlayer , closeOpenContexts } from "../helpers/party-setup";

test.describe("Journey 2 — Resilience: Guest state survives page reloads", () => {
  // Runs even when the test fails, so a leaked context cannot destabilise the
  // specs that follow it.
  test.afterEach(closeOpenContexts);

  test("settings propagate to guest, capture counter and vote counter both persist after a hard reload", async ({ browser }) => {
    // Host creates and starts the party off-screen with 7 situations (non-default).
    // Takes 2 initial photos so the guest has content to vote on.
    const { hostPage, code } = await hostCreatesAndStartsParty(browser, {
      initialPhotos: 2,
      situations: 7,
    });

    // ── Guest joins ─────────────────────────────────────────────────────

    const guestPage = await newPlayer(browser);
    await guestPage.goto("/join");
    await pace(guestPage);

    await guestPage.getByTestId("join-party-code-input").fill(code);
    await pace(guestPage);
    await guestPage.getByTestId("join-party-nickname-input").fill("Guest");
    await pace(guestPage);
    await guestPage.getByTestId("join-party-submit-btn").click();

    await expect(guestPage).toHaveURL(/\/capture\//, { timeout: 10_000 });
    await pace(guestPage);

    // Checkpoint 1: host-set situation count must reach the guest.
    // Host picked 7 in settings — guest must see 7 cards in CaptureMode, not the default 5.
    await expect(guestPage.getByTestId("situation-card-btn").first()).toBeVisible({ timeout: 10_000 });
    const guestSituationCount = await guestPage.getByTestId("situation-card-btn").count();
    expect(guestSituationCount).toBe(7);

    // ── Capture phase ───────────────────────────────────────────────────

    await takePhotos(guestPage, 1);
    await pace(guestPage);
    await takePhotos(guestPage, 1, 1);
    await pace(guestPage);

    // Resilience checkpoint 1: hard reload — counter must still read 2/5
    await guestPage.reload();
    await expect(guestPage.getByText("2/5")).toBeVisible({ timeout: 10_000 });
    await pace(guestPage);

    // ── Transition to voting ────────────────────────────────────────────

    // Host triggers the phase transition while the guest tab was reloaded.
    // Realtime must re-subscribe after reload and deliver the redirect.
    await hostPage.getByTestId("capture-debug-timer-btn").click();
    await pace(hostPage);

    await expect(hostPage).toHaveURL(/\/vote\//, { timeout: 15_000 });
    await expect(guestPage).toHaveURL(/\/vote\//, { timeout: 15_000 });
    await pace(guestPage);

    await expect(guestPage.getByText("Vote for your favorites")).toBeVisible({ timeout: 15_000 });
    await pace(guestPage);

    // ── Voting phase ────────────────────────────────────────────────────

    await castVotes(guestPage, 1);
    await pace(guestPage);
    await castVotes(guestPage, 1, 1);
    await pace(guestPage);

    // Resilience checkpoint 2: hard reload — vote counter must still read 2/5
    await guestPage.reload();
    await expect(guestPage.getByText("Vote for your favorites")).toBeVisible({ timeout: 15_000 });
    await expect(guestPage.getByText("2/5")).toBeVisible({ timeout: 15_000 });
    await pace(guestPage);

    // ── Transition to results ───────────────────────────────────────────

    await hostPage.getByTestId("vote-debug-timer-btn").click();
    await pace(hostPage);

    await expect(guestPage).toHaveURL(/\/results\//, { timeout: 15_000 });
    await pace(guestPage);

    await expect(guestPage.getByText("Results")).toBeVisible({ timeout: 10_000 });

    await guestPage.context().close();
    await hostPage.context().close();
  });
});
