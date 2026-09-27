/**
 * Counts the anonymous sign-ins a run actually spends.
 *
 * **Why this exists.** Anonymous sign-ins are the binding resource of this suite
 * — 200/hour per IP, shared with anyone running it locally — and every figure
 * `TEST_STRATEGY.md` advertised for them was derived by hand, at one sign-in per browser
 * page load. It was two: `AuthContext` signed in twice on every cold load
 * (BUG-009). A full run cost ~106 against an advertised ~77, so the standing
 * advice that "two runs in an hour are comfortable" described ~212 against a cap
 * of 200. The 2026-09-09 exhaustion was arithmetic nobody had done.
 *
 * The fix removed the double sign-in. It did not remove the method that hid it,
 * which was counting rather than measuring — so this module measures.
 *
 * **Two sources, because there are two.** Fixtures create Supabase clients in
 * Node; browser contexts sign in through the app. Neither can see the other, so
 * both report into one file and `global-teardown` prints the total.
 *
 * Reported, never asserted. A threshold here would turn a measurement into a
 * gate, which is the trade this repository has argued against for the mutation
 * score and the k6 baselines alike — and a run that legitimately grows the suite
 * would fail on a number rather than on a defect.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { BrowserContext } from "@playwright/test";

export const BUDGET_FILE = "reports/signin-budget.json";

/** The Supabase endpoint an anonymous sign-in hits. Both sources match on it. */
const SIGNUP_PATH = "/auth/v1/signup";

export interface SignInBudget {
  /** Sign-ins by fixture clients, in the Playwright worker process. */
  node: number;
  /** Sign-ins by the app, inside a browser context. */
  browser: number;
}

const EMPTY: SignInBudget = { node: 0, browser: 0 };

export function readBudget(): SignInBudget {
  if (!existsSync(BUDGET_FILE)) return { ...EMPTY };
  try {
    return { ...EMPTY, ...JSON.parse(readFileSync(BUDGET_FILE, "utf8")) };
  } catch {
    // A truncated file means a killed run, not a reason to fail the next one.
    return { ...EMPTY };
  }
}

export function resetBudget(): void {
  mkdirSync(dirname(BUDGET_FILE), { recursive: true });
  writeFileSync(BUDGET_FILE, JSON.stringify(EMPTY));
}

/**
 * Read-modify-write is safe here only because `workers: 1` — one process, and
 * Node runs this synchronously between awaits. If the suite ever goes parallel
 * this needs one file per worker, summed at teardown.
 */
function bump(source: keyof SignInBudget): void {
  const budget = readBudget();
  budget[source] += 1;
  mkdirSync(dirname(BUDGET_FILE), { recursive: true });
  writeFileSync(BUDGET_FILE, JSON.stringify(budget));
}

const INSTALLED = Symbol.for("lastshots.signin-budget.installed");

/**
 * Count sign-ins made by fixture clients.
 *
 * supabase-js resolves `fetch` off `globalThis` per request in Node, so wrapping
 * it here catches every client the fixtures build without any fixture knowing
 * this module exists. Guarded by a global symbol: the module is imported by
 * every spec, and wrapping a wrapper would double every count.
 */
export function installNodeCounter(): void {
  const g = globalThis as typeof globalThis & { [INSTALLED]?: boolean };
  if (g[INSTALLED]) return;
  g[INSTALLED] = true;

  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes(SIGNUP_PATH)) bump("node");
    return original(input, init);
  };
}

/**
 * Count sign-ins made by the app inside one browser context.
 *
 * Called from the `context` fixture for specs using the built-in one, and from
 * `newPlayer` / `addBrowserObserver` for the contexts those hand out — a context
 * created by `browser.newContext()` does not inherit fixture behaviour, so every
 * place that opens one has to opt in. Requests are counted, not responses: a
 * sign-in refused by the rate limit still spent the attempt.
 */
export function countBrowserSignIns(context: BrowserContext): void {
  context.on("request", (request) => {
    if (request.url().includes(SIGNUP_PATH)) bump("browser");
  });
}
