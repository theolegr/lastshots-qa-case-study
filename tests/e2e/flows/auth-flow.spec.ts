// @covers IA-001, IA-002, IA-005, IA-006
// @regression BUG-009
// Flow — Anonymous auth session persists after refresh
//
// This file owns IA-002 ("each session shall be associated with exactly one user
// identity"), IA-005 and IA-006. The second test is the regression guard for
// BUG-009, and it exists because the first one was catching that bug for three
// weeks without anybody believing it.
//
// The first test asserts the *consequence* — the id is stable across a reload —
// which is what a player would notice. It failed in CI on 2026-09-01 and
// 2026-09-09 with two valid, different UUIDs, and both times the failure was
// filed as infrastructure flakiness. It was not: React StrictMode
// double-invokes effects in a development build, both invocations of
// `AuthContext`'s bootstrap saw a null session, and each called
// `signInAnonymously()`. Two identities per cold load; `localStorage` kept
// whichever settled last; the test read whichever had landed when the button
// appeared.
//
// The second test asserts the *cause* — exactly one identity is ever minted —
// which is IA-002 read literally. It is the assertion that would have named the
// bug on the first failure instead of the twentieth, and the reason it is worth
// having both is that they fail differently: a stable-id failure says "something
// changed the session", a mint-count failure says what.

import { test, expect } from "../fixtures/test";

test.describe("Flow — Anonymous auth session persists after refresh", { tag: "@smoke" }, () => {
  /** Read the anonymous user id out of the supabase-js storage entry. */
  const getSupabaseUserId = (page: import("@playwright/test").Page) =>
    page.evaluate(() => {
      const key = Object.keys(localStorage).find(
        (k) => k.startsWith("sb-") && k.endsWith("-auth-token")
      );
      if (!key) return null;
      try {
        return (JSON.parse(localStorage.getItem(key)!).user?.id as string) ?? null;
      } catch {
        return null;
      }
    });

  test("user ID is the same before and after a hard reload", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("home-create-party-btn")).toBeVisible({ timeout: 10_000 });

    const userIdBefore = await getSupabaseUserId(page);
    expect(userIdBefore).not.toBeNull();

    await page.reload();
    await expect(page.getByTestId("home-create-party-btn")).toBeVisible({ timeout: 10_000 });

    const userIdAfter = await getSupabaseUserId(page);
    expect(userIdAfter).toBe(userIdBefore);
  });

  test("a cold load provisions exactly one identity (IA-002, BUG-009)", async ({ page }) => {
    // Every anonymous sign-in the page performs, with the identity it returned.
    // Counted at the network layer rather than inferred from storage: storage
    // only ever shows the *winner*, which is precisely why the extra identity
    // went unnoticed for so long.
    const identities: string[] = [];
    page.on("response", async (response) => {
      if (!response.url().includes("/auth/v1/signup")) return;
      try {
        const body = await response.json();
        if (body?.user?.id) identities.push(body.user.id as string);
      } catch {
        /* a non-JSON body is not a successful sign-in; nothing to record */
      }
    });

    await page.goto("/");
    await expect(page.getByTestId("home-create-party-btn")).toBeVisible({ timeout: 10_000 });

    // The reload is the boundary, not a sleep. A second sign-in raced by the
    // first page load has settled by the time the reloaded page has rendered —
    // and the reload itself must add none of its own, because the session it
    // restores is already valid. Measured on the broken build, this sequence
    // reported 2 sign-ins on every run; on the fixed build, 1.
    await page.reload();
    await expect(page.getByTestId("home-create-party-btn")).toBeVisible({ timeout: 10_000 });

    expect(
      new Set(identities).size,
      `IA-002: one session must hold exactly one identity. This page provisioned ` +
        `${new Set(identities).size} (${[...new Set(identities)].join(", ")}) across ` +
        `${identities.length} sign-in call(s). More than one means the auth bootstrap ` +
        `is running twice and racing itself — see BUG-009.`
    ).toBe(1);
  });
});
