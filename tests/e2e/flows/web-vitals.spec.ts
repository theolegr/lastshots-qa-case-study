// @covers none — a measurement, not a requirement. SPECS.md carries no performance family, decided 2026-09-10
// Flow — Web Vitals, recorded rather than gated
//
// The roadmap asked for load-time assertions with a threshold ("LCP < 3s").
// This is deliberately not that, for the reason TEST_STRATEGY.md already argues about
// the mutation score and the k6 baselines under "Why there is no CI gate": a
// threshold picked in advance is either so loose it passes anything or so tight
// it fails on the runner's mood. Worse here than elsewhere — LCP measured on a
// dev server against a live Supabase project varies with the network, and
// `retries: 0` is a standing commitment in this suite. A flaky red build that
// everyone learns to re-run costs more than the number is worth.
//
// So the metric is treated the way every other measurement in this repo is
// treated: **measured every run, written to the history file, watched by
// comparing runs.** `reports/vitals/vitals.json` is read by
// `scripts/lib/metrics.mjs` and lands in the metrics history (`metrics.jsonl` on
// the `metrics` branch) alongside coverage, mutation and the k6 baselines.
//
// What *is* asserted is that the measurement still works — each metric present,
// finite and positive. That guards the instrument, not the performance: if a
// future change breaks LCP collection (no contentful paint, an observer that
// never fires), this fails instead of silently recording nulls forever and
// making the history look stable because it stopped looking.
//
// **Scope is Home and Join, and that is a decision, not a budget.** It used to be
// justified here the way `a11y-smoke.spec.ts` justifies its own scope — one
// anonymous sign-in, the pages that were free — and a coverage claim shaped by
// what was cheap is the failure mode this repo has already been caught by once
// (see the header of `a11y-phases.spec.ts`, which exists because of it). The
// standing reason is different: load time changes what someone *does* only where
// they have not yet committed. Someone scanning a code in a bar abandons a page
// that hangs; someone already in a party with their friends waits. Home and Join
// are the whole of that surface, so the four pages that need a seeded party are
// deliberately out of scope and `SPECS.md` carries no performance requirement —
// decided 2026-09-10, recorded in `TEST_STRATEGY.md` under *Deliberate boundaries*.
//
// A second consequence, load-bearing for the history: `scripts/lib/metrics.mjs`
// reduces a run to the worst page per metric, so adding pages here would
// redefine `vitals.lcp_ms` mid-series without renaming it.

import { test, expect } from "../fixtures/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const OUTPUT = "reports/vitals/vitals.json";

interface PageVitals {
  route: string;
  lcp_ms: number | null;
  dom_content_loaded_ms: number | null;
  load_event_ms: number | null;
  first_contentful_paint_ms: number | null;
}

/**
 * Install the LCP observer before any of the page's own script runs.
 *
 * `buffered: true` alone is not enough: the entry can be emitted before an
 * `evaluate()` after load gets a chance to subscribe, and the buffer is only
 * replayed to an observer that exists. `addInitScript` runs at document start
 * on every navigation in the context, so the observer is always in place first.
 */
async function installLcpObserver(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    (window as unknown as { __lcp: number | null }).__lcp = null;
    new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const last = entries[entries.length - 1];
      if (last) (window as unknown as { __lcp: number | null }).__lcp = last.startTime;
    }).observe({ type: "largest-contentful-paint", buffered: true });
  });
}

/** Read the navigation-timing and paint numbers the page has settled on. */
async function collect(
  page: import("@playwright/test").Page,
  route: string
): Promise<PageVitals> {
  return page.evaluate((r) => {
    const nav = performance.getEntriesByType("navigation")[0] as
      | PerformanceNavigationTiming
      | undefined;
    const fcp = performance
      .getEntriesByType("paint")
      .find((e) => e.name === "first-contentful-paint");
    return {
      route: r,
      lcp_ms: (window as unknown as { __lcp: number | null }).__lcp,
      dom_content_loaded_ms: nav ? nav.domContentLoadedEventEnd : null,
      load_event_ms: nav ? nav.loadEventEnd : null,
      first_contentful_paint_ms: fcp ? fcp.startTime : null,
    };
  }, route);
}

test.describe("Flow — Web Vitals (recorded, not gated)", () => {
  test("load metrics are collectable on the no-auth pages", async ({ page }) => {
    await installLcpObserver(page);

    const measured: PageVitals[] = [];

    await page.goto("/");
    await expect(page.getByTestId("home-create-party-btn")).toBeVisible({ timeout: 10_000 });
    // LCP is finalised at the first user interaction or when the largest paint
    // stops changing. `networkidle` is the settle signal here rather than a
    // fixed sleep — it is a state the page reaches, not a duration guessed.
    await page.waitForLoadState("networkidle");
    measured.push(await collect(page, "/"));

    await page.goto("/join");
    await expect(page.getByTestId("join-party-code-input")).toBeVisible({ timeout: 10_000 });
    await page.waitForLoadState("networkidle");
    measured.push(await collect(page, "/join"));

    // The instrument check. Not a performance budget — a guard that the numbers
    // being written to the history are real numbers.
    for (const v of measured) {
      for (const key of [
        "lcp_ms",
        "dom_content_loaded_ms",
        "load_event_ms",
        "first_contentful_paint_ms",
      ] as const) {
        const value = v[key];
        expect(
          typeof value === "number" && Number.isFinite(value) && value > 0,
          `${v.route}: ${key} was not collectable (got ${String(value)}) — the measurement ` +
            `is broken, so the history would record a null and look stable by omission`
        ).toBe(true);
      }
    }

    mkdirSync(dirname(OUTPUT), { recursive: true });
    writeFileSync(
      OUTPUT,
      JSON.stringify(
        {
          measured_at: new Date().toISOString(),
          // The machine matters: a dev-server run on a laptop is not comparable
          // with a CI runner's, the same caveat the k6 baselines already carry.
          source: process.env.CI ? "ci" : "local",
          pages: measured,
        },
        null,
        2
      ) + "\n"
    );
    console.log(
      `Web Vitals → ${OUTPUT}\n` +
        measured
          .map(
            (v) =>
              `  ${v.route.padEnd(6)} LCP ${Math.round(v.lcp_ms!)}ms · ` +
              `FCP ${Math.round(v.first_contentful_paint_ms!)}ms · ` +
              `DCL ${Math.round(v.dom_content_loaded_ms!)}ms`
          )
          .join("\n")
    );
  });
});
