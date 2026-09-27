// @covers AC-001, AC-002
// Flow — Accessibility smoke on the pages that need no fixture
//
// Not a full audit (screen-reader narration and keyboard-only journeys remain
// out of scope) — an automated guardrail that catches the regressions a manual
// pass would otherwise have to re-find every release: missing form labels,
// insufficient colour contrast, controls without accessible names, broken
// landmark structure.
//
// Scope is every route reachable without seeding a party: Home, Create, Join
// and the catch-all 404, exercised in a single browser context so the whole run
// costs one anonymous sign-in. The four routes that need party state live in
// `a11y-phases.spec.ts`, which pays for fixtures and is not in the smoke tier.
//
// `/create` and the 404 were added on 2026-09-09. Their absence was not a
// decision — this file's scope had been "the pages reachable without a
// fixture", and two of those had simply never been listed. Both cost nothing:
// same context, no seeding, no extra sign-in.
//
// Assertion: zero violations at the `serious` or `critical` impact level. The
// rule set and that threshold live in `helpers/a11y.ts`, shared with the phase
// spec so the two cannot disagree about what counts as a failure.

import { test, expect } from "../fixtures/test";
import { expectNoViolations } from "../helpers/a11y";
import { pace } from "../helpers/timing";

test.describe("Flow — a11y smoke (no-fixture pages)", { tag: "@smoke" }, () => {
  test("Home, Create, Join and the 404 have no serious or critical axe violations", async ({
    page,
  }) => {
    // Home
    await page.goto("/");
    await expect(page.getByTestId("home-create-party-btn")).toBeVisible({ timeout: 10_000 });
    await pace(page);
    await expectNoViolations(page, "/");

    // Create (same context — no extra sign-in)
    await page.goto("/create");
    await expect(page.getByTestId("create-party-name-input")).toBeVisible({ timeout: 10_000 });
    await pace(page);
    await expectNoViolations(page, "/create");

    // Join
    await page.goto("/join");
    await expect(page.getByTestId("join-party-code-input")).toBeVisible({ timeout: 10_000 });
    await pace(page);
    await expectNoViolations(page, "/join");

    // The catch-all. A 404 is a page a real user lands on — a stale link, a
    // mistyped code — and it is the one route in the app nobody designs twice,
    // which is exactly why it is worth scanning.
    await page.goto("/this-route-does-not-exist");
    await expect(page.getByText("404")).toBeVisible({ timeout: 10_000 });
    await pace(page);
    await expectNoViolations(page, "/404");
  });
});
