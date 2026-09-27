// @covers PM-004
// Flow — PM-004: party settings are immutable after the host starts the party.

import { test, expect } from "../fixtures/test";
import { hostCreatesAndStartsParty, closeOpenContexts } from "../helpers/party-setup";
import { createPartyInCapturingState, cleanupParty } from "../fixtures/party.fixture";
import { updateParty } from "../helpers/db";

test.describe("Flow — Party settings are immutable after start", { tag: "@smoke" }, () => {
  // This spec opens a context through `hostCreatesAndStartsParty` and never
  // closed it — the one file the e3052e7 cleanup missed. The leaked page kept a
  // Supabase session, a realtime subscription and a 1s countdown interval alive
  // for the rest of the worker, on a party whose `ends_at` is 12h out, so it
  // never went quiet on its own.
  test.afterEach(closeOpenContexts);

  test("settings UI is no longer reachable once status transitions to playing", async ({
    browser,
  }) => {
    const { hostPage, code } = await hostCreatesAndStartsParty(browser);

    // hostCreatesAndStartsParty leaves the host on /capture/CODE.
    // From there, the settings button must not exist anywhere.
    await expect(hostPage).toHaveURL(/\/capture\//);
    await expect(hostPage.getByTestId("lobby-settings-btn")).toHaveCount(0);

    // Forcing a navigation back to the lobby must redirect away — the host has no
    // path to re-open the settings dialog.
    await hostPage.goto(`/lobby/${code}`);
    await expect(hostPage).toHaveURL(/\/capture\//, { timeout: 10_000 });
    await expect(hostPage.getByTestId("lobby-settings-btn")).toHaveCount(0);
  });

  // The test above proves the *UI* offers no path back to the settings. It says
  // nothing about the database, which is the layer that actually has to hold —
  // a crafted client does not go through the dialog. That distinction is not
  // hypothetical: `max_votes` was added to `parties` on 2026-08-27, and the
  // `party_settings_locked` trigger enumerates its columns explicitly, so the
  // new setting would have stayed mutable for the whole party while the other
  // three froze. Nothing above would have noticed.
  //
  // Cost: no browser, ~3 anon sign-ins for the fixture.
  test("the database refuses a settings change once status leaves waiting", async () => {
    const fixture = await createPartyInCapturingState("LockHost", ["LockGuest"]);
    const hostClient = fixture._clients[0].client;

    try {
      // The party is in `playing`, so every settings column must be frozen.
      for (const patch of [
        { max_votes: 10 },
        { max_situations: 10 },
        { capture_hours: 24 },
        { voting_hours: 6 },
      ]) {
        await expect(
          updateParty(hostClient, fixture.party.id, patch, `locked ${Object.keys(patch)[0]}`),
          `${Object.keys(patch)[0]} must be refused after start`
        ).rejects.toThrow(/settings cannot change/i);
      }

      // Control probe: a column the trigger does not guard is still writable.
      // Without this the test would also pass against a trigger that refused
      // every UPDATE for any reason — including one that had broken outright.
      const renamed = await updateParty(
        hostClient,
        fixture.party.id,
        { name: "Renamed after start" },
        "control: non-settings column"
      );
      expect(renamed.status).toBe("playing");
    } finally {
      await cleanupParty(fixture.party.id);
    }
  });
});
