// Prints what the run actually spent. Reported, never asserted — see the header
// of `signin-budget.ts` for why a threshold here would be the wrong instrument.

import { readBudget } from "./signin-budget";

const ANON_SIGN_IN_CAP_PER_HOUR = 200;

export default function globalTeardown(): void {
  const { node, browser } = readBudget();
  const total = node + browser;
  const runsPerHour = total > 0 ? Math.floor(ANON_SIGN_IN_CAP_PER_HOUR / total) : Infinity;

  console.log(
    `\nAnon sign-ins spent: ${total} (${node} fixtures, ${browser} browser) — ` +
      `${runsPerHour} run(s) of this size fit in the ${ANON_SIGN_IN_CAP_PER_HOUR}/hour cap.`
  );
}
