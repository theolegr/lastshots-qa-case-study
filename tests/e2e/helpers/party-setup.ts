import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { expect, Page, Browser, BrowserContext } from "@playwright/test";
import { pace } from "./timing";
import { countBrowserSignIns } from "./signin-budget";
import { takePhotos } from "./capture";
import { FixtureParty } from "../fixtures/party.fixture";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SUPABASE_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY!;

/**
 * Every context this module hands out, so it can be closed unconditionally.
 *
 * Cleanup used to live at the end of each test body (`await
 * hostPage.context().close()`), which only runs when the test *passes*. A
 * failure anywhere above it leaked the context — and a leaked context is not
 * inert: its page keeps an anonymous Supabase session, an open realtime
 * subscription and a 1s countdown interval alive for the rest of the worker's
 * life. One red test therefore made the tests after it more likely to fail,
 * which is precisely the cascade seen in CI: a different spec failing on each
 * run, and network traffic from one test showing up in another's trace.
 *
 * Registering here and closing from `afterEach` makes cleanup independent of
 * the outcome. See TEST_STRATEGY.md, "Cleanup runs on failure, or it is not cleanup".
 */
const openContexts: BrowserContext[] = [];

/** Create a new browser context + page for one player. */
export async function newPlayer(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  // Opted into the sign-in count explicitly: a context built here does not come
  // from the `context` fixture, so it inherits none of its behaviour.
  countBrowserSignIns(context);
  openContexts.push(context);
  return context.newPage();
}

/**
 * Close every context opened by this module. Wire it into `test.afterEach` —
 * Playwright runs those even when the test fails, which is the whole point.
 * Errors are swallowed: a context already closed by the test itself is fine,
 * and a cleanup failure must never mask the real assertion failure.
 */
export async function closeOpenContexts(): Promise<void> {
  await Promise.all(openContexts.map((c) => c.close().catch(() => undefined)));
  openContexts.length = 0;
}

/** Create a party via UI, start it, and take initial photos. Returns the host page and party code.
 *  @param situations — if provided, host opens settings dialog and picks this situation count
 *                      before starting the party. */
export async function hostCreatesAndStartsParty(
  browser: Browser,
  { initialPhotos = 0, situations }: { initialPhotos?: number; situations?: number } = {}
): Promise<{ hostPage: Page; code: string }> {
  const hostPage = await newPlayer(browser);
  await hostPage.goto("/");

  await hostPage.getByTestId("home-create-party-btn").click();
  await expect(hostPage).toHaveURL(/\/create/);

  await hostPage.getByTestId("create-party-name-input").fill("Guest Journey Party");
  await hostPage.getByTestId("create-party-nickname-input").fill("Host");
  await hostPage.getByTestId("create-party-submit-btn").click();
  await expect(hostPage).toHaveURL(/\/lobby\/\d{6}/, { timeout: 10_000 });

  // Extract party code
  const codeText = await hostPage.getByTestId("lobby-copy-code-btn").getByTestId("lobby-party-code").textContent();
  const code = codeText!.trim();

  // Optionally configure situation count via settings dialog (host-only)
  if (situations !== undefined) {
    await hostPage.getByTestId("lobby-settings-btn").click();
    const dialog = hostPage.getByRole("dialog");
    await expect(dialog.getByText("Settings")).toBeVisible();
    // Scoped to the situations control. The votes control offers the same
    // 5 / 7 / 10 labels, so an unscoped role locator resolves to two buttons.
    await dialog
      .getByTestId("settings-max-situations")
      .getByRole("button", { name: String(situations) })
      .click();
    await hostPage.keyboard.press("Escape");
    await pace(hostPage);
  }

  // Start the party
  await hostPage.getByTestId("lobby-start-party-btn").click();
  await expect(hostPage).toHaveURL(/\/capture\//, { timeout: 10_000 });
  await pace(hostPage);

  // Optionally take initial photos so guests have something to vote on
  if (initialPhotos > 0) {
    await takePhotos(hostPage, initialPhotos);
    await pace(hostPage);
  }

  return { hostPage, code };
}

/**
 * Create a fresh browser context, load the app (triggers anonymous sign-in),
 * then insert the browser user as a participant of a fixture party.
 * Uses the browser's own session token to satisfy RLS (auth.uid() = user_id).
 */
export async function addBrowserObserver(
  browser: Browser,
  party: FixtureParty
): Promise<{ page: Page; context: Awaited<ReturnType<Browser["newContext"]>> }> {
  const context = await browser.newContext();
  countBrowserSignIns(context);
  // Registered too: this helper asserts before it returns, so it can throw with
  // the context already open and the caller's `finally` never reached.
  openContexts.push(context);
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.getByTestId("home-create-party-btn")).toBeVisible({ timeout: 10_000 });

  const sessionData = await page.evaluate(() => {
    const key = Object.keys(localStorage).find(
      (k) => k.startsWith("sb-") && k.endsWith("-auth-token")
    );
    return key ? JSON.parse(localStorage.getItem(key)!) : null;
  });
  expect(sessionData?.user?.id).toBeTruthy();

  const browserClient = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false },
  });
  await browserClient.auth.setSession({
    access_token: sessionData.access_token,
    refresh_token: sessionData.refresh_token,
  });
  const { error } = await browserClient.from("participants").insert({
    party_id: party.id,
    user_id: sessionData.user.id,
    name: "Observer",
    avatar_emoji: "👀",
    is_host: false,
  });
  expect(error).toBeNull();

  // Read the page's identity back and check it is still the one we just wrote a
  // participant row for — guiding rule 6, applied to the write this helper makes
  // on the page's behalf.
  //
  // The row is inserted for whatever `localStorage` held at the moment above. If
  // the page's client settles on a *different* identity, every RLS-scoped read
  // from it filters the page out of its own party and the route guard bounces it
  // to `/` — which surfaces several seconds later as `element(s) not found` on a
  // DOM that is correct for a non-participant. That is exactly how BUG-009
  // presented across 8 specs, and it cost three CI investigations.
  //
  // BUG-009 removed the only known way that identity can change after the page
  // renders, so this is a guard against the class rather than the instance. It
  // is a read-after-write, not a wait: nothing sleeps, and if it ever fires the
  // failure names the cause instead of moving it to the wrong layer.
  const settledUserId = await page.evaluate(() => {
    const key = Object.keys(localStorage).find(
      (k) => k.startsWith("sb-") && k.endsWith("-auth-token")
    );
    return key ? (JSON.parse(localStorage.getItem(key)!).user?.id as string) : null;
  });
  if (settledUserId !== sessionData.user.id) {
    throw new Error(
      `addBrowserObserver: the participant row was inserted for ${sessionData.user.id}, ` +
        `but the page's client settled on ${settledUserId}. Every RLS-scoped read from ` +
        `this page will now exclude it from its own party. See BUG-009.`
    );
  }

  return { page, context };
}
