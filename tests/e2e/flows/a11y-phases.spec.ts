// @covers AC-001, AC-002
// Flow — Accessibility on the four pages that need party state
//
// The other half of the axe smoke. `a11y-smoke.spec.ts` covers every route
// reachable without seeding anything; this covers the four that are not —
// lobby, capture, vote, results — which is to say the pages a player actually
// spends the party on.
//
// **Why this was missing, and it is worth naming.** The smoke's scope had been
// "the pages that need no fixture", which reads like a boundary and was really
// a cost. Those two pages were not chosen for being the important ones; they
// were the ones that were free. A coverage claim shaped by what was cheap is
// the failure mode this repo has hit before — MO-003 and MO-004 sat in the gap
// list for months on the assumption that testing them needed infrastructure
// that did not exist, and neither did.
//
// **One fixture per phase, not one party walked forward.** Cheaper would be to
// create a single party and mutate it through the states. It would also scan a
// results page with no photos and a vote page with nothing to vote on — pages
// that render, but not the pages under test. The guiding rule here is explicit:
// do not shrink a test's scope to make it faster. Four fixtures, ~40s.
//
// Not tagged `@smoke`: the PR tier is kept to what one anonymous sign-in buys,
// and this spends several. It runs in the full suite on pushes to `main`.
//
// Assertion, rule set and impact threshold are shared with the smoke spec via
// `helpers/a11y.ts` — see that module for why `moderate` findings are not gated
// and which one is currently outstanding.
//
// **Verified in both directions** (guiding rule 4). Against the pre-fix build
// this spec was red on exactly two findings, and they are the reason it exists:
//   - `/lobby` — `button-name` × 2, *critical*. `lobby-back-btn` and
//     `qr-code-display-btn` each wrap a bare lucide `<svg>`, so a screen reader
//     announced "button" and nothing else, and voice control had no name to
//     target. Fixed with `aria-label` on both.
//   - `/results` — `color-contrast` × 1, *serious*. The footer wordmark sat at
//     `text-muted-foreground/50` — #474747 on #0d0d0d, a ratio of 2.09:1
//     against the 4.5:1 AA floor. Fixed by dropping the opacity modifier.
// Green after. `/capture` and `/vote` were clean throughout and are here as
// regression cover, not because they were broken.

import { test, expect } from "../fixtures/test";
import {
  createPartyInWaitingState,
  createPartyInCapturingState,
  createPartyInVotingState,
  createPartyInResultsState,
  cleanupParty,
} from "../fixtures/party.fixture";
import { addBrowserObserver, closeOpenContexts } from "../helpers/party-setup";
import { activateVoting } from "../helpers/db";
import { expectNoViolations } from "../helpers/a11y";
import { pace } from "../helpers/timing";

test.describe("Flow — a11y on the seeded phase pages", () => {
  // Runs even when the test fails, so a leaked context cannot destabilise the
  // specs that follow it.
  test.afterEach(closeOpenContexts);

  test("lobby, capture, vote and results have no serious or critical axe violations", async ({
    browser,
  }) => {
    // **Sized against the suite's binding resource, which is anonymous sign-ins,
    // not time.** Supabase rate-limits them, and the full suite already spends
    // ~60; this test adds one party per phase and each party costs a sign-in per
    // participant plus one for the observer. One guest is therefore the number
    // used wherever the page still renders populated: with a host, one guest and
    // two photos each, the vote page has photos to vote on and the results page
    // has a podium, participants and photo items. That is not shrinking the
    // scope — the scope is which pages get scanned and whether they are drawn,
    // and neither changes. Adding a second guest would buy a wider participants
    // grid and cost two more sign-ins across the two fixtures.
    //
    // Each phase: seed → observe → scan → close → delete. The context is closed
    // here rather than left to `afterEach`, which is the backstop for a failure
    // path, not the routine one. Four phases run inside this one test, and a
    // page kept open past its block holds a Supabase session, a realtime
    // subscription and a 1s countdown interval for the rest of the run —
    // against a party `cleanupParty` is about to delete. A leaked context like
    // that has already been traced as the cause of a later test's
    // `element(s) not found`, and it is cheaper to not cause it.

    // ─── Lobby (waiting) ────────────────────────────────────────────────────
    const waiting = await createPartyInWaitingState("A11yHost");
    const lobby = await addBrowserObserver(browser, waiting.party);
    try {
      await lobby.page.goto(`/lobby/${waiting.code}`);
      await expect(lobby.page.getByTestId("lobby-party-code")).toBeVisible({ timeout: 10_000 });
      await pace(lobby.page);
      await expectNoViolations(lobby.page, "/lobby");
    } finally {
      await lobby.context.close();
      await cleanupParty(waiting.party.id);
    }

    // ─── Capture (playing) ──────────────────────────────────────────────────
    const capturing = await createPartyInCapturingState("A11yHost", ["G1"]);
    const capture = await addBrowserObserver(browser, capturing.party);
    try {
      await capture.page.goto(`/capture/${capturing.code}`);
      // The situation list is fetched after the party resolves; scanning before
      // it lands would scan a spinner and call the page clean.
      await expect(capture.page.getByTestId("countdown-timer")).toBeVisible({ timeout: 10_000 });
      await pace(capture.page);
      await expectNoViolations(capture.page, "/capture");
    } finally {
      await capture.context.close();
      await cleanupParty(capturing.party.id);
    }

    // ─── Vote (voting) ──────────────────────────────────────────────────────
    const voting = await createPartyInVotingState("A11yHost", ["G1"], 2);
    await activateVoting(voting._clients[0].client, voting.party.id);
    const vote = await addBrowserObserver(browser, voting.party);
    try {
      await vote.page.goto(`/vote/${voting.code}`);
      await expect(vote.page.getByText("Vote for your favorites")).toBeVisible({ timeout: 10_000 });
      await pace(vote.page);
      await expectNoViolations(vote.page, "/vote");
    } finally {
      await vote.context.close();
      await cleanupParty(voting.party.id);
    }

    // ─── Results ────────────────────────────────────────────────────────────
    const finished = await createPartyInResultsState("A11yHost", ["G1"], 2, 1);
    const results = await addBrowserObserver(browser, finished.party);
    try {
      await results.page.goto(`/results/${finished.code}`);
      // The participants grid renders after `computeResults` resolves; the
      // wordmark whose contrast this caught sits below it, so the wait is
      // load-bearing — scanning earlier would scan a half-drawn page.
      await expect(results.page.getByTestId("results-participants-grid")).toBeVisible({
        timeout: 15_000,
      });
      await pace(results.page);
      await expectNoViolations(results.page, "/results");
    } finally {
      await results.context.close();
      await cleanupParty(finished.party.id);
    }
  });
});
