/**
 * The suite's three fixed delays, and why each one is not a synchronisation
 * sleep. Everything the app *will* produce is awaited with an auto-retrying
 * `expect` on that signal instead — see TEST_STRATEGY.md, "No wait in the suite is a
 * wait for something to happen".
 */

/**
 * Pause duration: 1500ms in headed mode, 0 in headless.
 * Usage: HEADED=1 npx playwright test --headed
 */
export const PAUSE = process.env.HEADED ? 1500 : 0;

/**
 * Visual pacing for a headed run, and nothing at all in CI.
 *
 * Call this instead of `page.waitForTimeout(PAUSE)`. The two are identical in
 * effect; the difference is what a reader finds when they grep.
 *
 * `waitForTimeout` is the single most reliable smell in a Playwright suite, and
 * rightly so — it is almost always a synchronisation sleep papering over a
 * missing signal. This suite had ~70 of them and not one was that: every one
 * evaluated to `waitForTimeout(0)` under CI, because `PAUSE` is 0 unless
 * `HEADED` is set. The defence was true, written down, and four files away from
 * the thing that provoked the question.
 *
 * So the call sites say what they mean. After this rename, `grep -rn
 * waitForTimeout tests/` returns this file and the two constants below — each
 * of which is a real fixed delay with a real reason — and the reader's first
 * question is answered by the name before they have to go looking for the
 * paragraph that answers it.
 *
 * The pacing itself is kept rather than deleted: it is what makes `HEADED=1`
 * watchable, and a suite you can watch run is worth more than six saved lines.
 */
export async function pace(page: { waitForTimeout(ms: number): Promise<void> }): Promise<void> {
  await page.waitForTimeout(PAUSE);
}

/** Wait past the double-tap detection threshold so single taps aren't swallowed.
 *  This is an *input-timing* constraint, not a synchronisation wait: the photo
 *  cards treat two taps within 300ms as a double-tap, so a tap must age out of
 *  that window before the next one is sent. */
export const DOUBLE_TAP_THRESHOLD = 400;

/**
 * Bounded observation window for negative assertions — "this input changes
 * nothing".
 *
 * Every other wait in the suite is an auto-retrying `expect` on a signal that
 * the app *will* produce. A non-event has no such signal: at the vote cap the
 * UI is genuinely silent (`PhotoFullscreen.handleDoubleTap` short-circuits on
 * `canVote === false`, so no handler runs, no toast fires, no DOM node
 * changes). Proving nothing happened therefore requires giving the app a real
 * chance to react and then asserting the invariants still hold.
 *
 * Use this only for that case. If an assertion is waiting for something to
 * appear, it belongs in `expect(...)` instead.
 */
export const NEGATIVE_ASSERTION_WINDOW = 500;
