/**
 * The `test` every spec in this suite imports, in place of `@playwright/test`.
 *
 * It exists for one reason: to make the anon sign-in budget a measurement
 * instead of a hand count (see `helpers/signin-budget.ts`). Importing this
 * module installs the Node-side counter, and the `context` override attaches the
 * browser-side one to every context Playwright creates for a spec.
 *
 * Contexts opened directly with `browser.newContext()` bypass this — fixture
 * overrides do not reach them — so `party-setup.ts` opts those in explicitly.
 */

import { test as base, expect } from "@playwright/test";
import { countBrowserSignIns, installNodeCounter } from "../helpers/signin-budget";

installNodeCounter();

export const test = base.extend({
  // The second argument is named `run`, not Playwright's conventional `use`:
  // `eslint-plugin-react-hooks` reads a bare `use(...)` call as React's `use`
  // hook and fails the build. Renaming is cheaper than an eslint-disable, and
  // leaves the rule armed for the app code where it is actually load-bearing.
  context: async ({ context }, run) => {
    countBrowserSignIns(context);
    await run(context);
  },
});

export { expect };
