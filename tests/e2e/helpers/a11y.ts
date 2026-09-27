/**
 * The suite's one definition of "an accessibility violation".
 *
 * Extracted when the axe scan grew past a single spec. Two specs run it —
 * `a11y-smoke` on the pages that need no fixture, `a11y-phases` on the ones
 * that do — and a second copy of the rule set or the impact filter would be a
 * second opinion on what the suite considers a failure. That is the drift
 * `scripts/check-doc-counts.mjs` documents one level up, in its own comments:
 * a check that restates the thing it verifies can only catch disagreement
 * between documents, never a shared mistake.
 */

import { expect, Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Fail on these, ignore the rest.
 *
 * `moderate` and `minor` findings are deliberately not gated. The argument is
 * the same one this repo makes about thresholds elsewhere: a gate people learn
 * to ignore protects nothing. A serious or critical finding means a control is
 * unusable or unreadable with assistive technology — that is worth stopping a
 * build for. "The heading order skips a level" is not, and mixing the two would
 * bury the first in the second.
 *
 * One live consequence, recorded rather than hidden: every page in this app
 * currently reports `meta-viewport` (*moderate*) — the viewport disables pinch
 * zoom. It is a real WCAG 1.4.4 finding and this filter is why no test fails on
 * it. That is now a decision rather than an omission: `user-scalable=no` stays,
 * because an accidental pinch during a timed capture costs the shot (decided
 * 2026-09-10, `TEST_STRATEGY.md` → *Deliberate boundaries*). Should the product ever
 * reverse it, this filter is where the reversal gets enforced.
 */
const BLOCKING_IMPACTS = ["serious", "critical"];

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/** Run axe on the current page and return only serious/critical violations. */
export async function blockingViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  return results.violations.filter((v) => BLOCKING_IMPACTS.includes(v.impact ?? ""));
}

/**
 * Scan one page and assert it is clean, naming the page in the failure.
 *
 * The label matters more than it looks. These specs walk several routes in one
 * test — the alternative, one test per page, multiplies the anonymous sign-ins
 * this suite is careful about — so a bare "expected [] to equal [...]" would
 * not say *which* page regressed. The message carries the route, the rule, the
 * impact and the offending node count, which is enough to act on without
 * opening the trace.
 */
export async function expectNoViolations(page: Page, label: string) {
  const violations = await blockingViolations(page);

  // Asserted on a compact projection rather than on axe's own objects. An
  // `expect(violations).toEqual([])` is correct and unreadable: each violation
  // carries its full rule metadata — every standard it maps to, every node's
  // ancestry — so a single missing `aria-label` prints eighty lines of diff and
  // buries the one line naming it. The projection keeps rule, impact, count and
  // the offending markup, which is what a person needs to act.
  const found = violations.map(
    (v) =>
      `${v.id} (${v.impact}) × ${v.nodes.length} — ${v.help}` +
      v.nodes.map((n) => `\n      ${n.html.slice(0, 160)}`).join("")
  );

  expect(found, `${label} — serious/critical axe violations`).toEqual([]);
}
