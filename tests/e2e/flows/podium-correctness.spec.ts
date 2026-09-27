// @covers RS-002, RS-004
// Flow — Podium displays correct ranking

import { test, expect } from "../fixtures/test";
import { createPartyInCapturingState, cleanupParty } from "../fixtures/party.fixture";
import { addBrowserObserver , closeOpenContexts } from "../helpers/party-setup";
import { insertPhoto, pushToVoting, pushToResults } from "../helpers/db";

test.describe("Flow — Podium displays correct ranking", () => {
  // Runs even when the test fails, so a leaked context cannot destabilise the
  // specs that follow it.
  test.afterEach(closeOpenContexts);

  test("ranks photos by vote count in descending order", async ({ browser }) => {
    const fixture = await createPartyInCapturingState("FixtureHost", [
      "FixtureGuest1",
      "FixtureGuest2",
    ]);
    const situation = fixture.situations[0];
    const now = Date.now();

    // One photo per participant with explicit capture timestamps. The host's
    // photo is inserted for its side effect only — it has to exist for the
    // podium to have a third entry — so, like the tie-break test below, the
    // returned row is not bound.
    await insertPhoto(
      fixture._clients[0].client,
      fixture.party.id,
      fixture.participants[0].id,
      situation.id,
      new Date(now - 30_000).toISOString()
    );
    const guest1Photo = await insertPhoto(
      fixture._clients[1].client,
      fixture.party.id,
      fixture.participants[1].id,
      situation.id,
      new Date(now - 20_000).toISOString()
    );
    const guest2Photo = await insertPhoto(
      fixture._clients[2].client,
      fixture.party.id,
      fixture.participants[2].id,
      situation.id,
      new Date(now - 10_000).toISOString()
    );

    // Move to voting phase so all party photos become visible (photos RLS: ends_at <= now()).
    // Votes cannot reference photos that are invisible to the voter under the current session.
    await pushToVoting(fixture._clients[0].client, fixture.party.id);

    // Vote distribution: Guest1=2 votes, Guest2=1 vote, Host=0 votes
    const { error: v1 } = await fixture._clients[0].client
      .from("votes")
      .insert({ photo_id: guest1Photo.id, voter_id: fixture.participants[0].id });
    expect(v1).toBeNull();
    const { error: v2 } = await fixture._clients[2].client
      .from("votes")
      .insert({ photo_id: guest1Photo.id, voter_id: fixture.participants[2].id });
    expect(v2).toBeNull();
    const { error: v3 } = await fixture._clients[0].client
      .from("votes")
      .insert({ photo_id: guest2Photo.id, voter_id: fixture.participants[0].id });
    expect(v3).toBeNull();

    await pushToResults(fixture._clients[0].client, fixture.party.id);

    const { page, context } = await addBrowserObserver(browser, fixture.party);
    await page.goto(`/results/${fixture.code}`);
    await expect(page.getByText("Results")).toBeVisible({ timeout: 10_000 });

    await expect(page.getByTestId("podium-entry-1")).toContainText("FixtureGuest1");
    await expect(page.getByTestId("podium-entry-2")).toContainText("FixtureGuest2");
    await expect(page.getByTestId("podium-entry-3")).toContainText("FixtureHost");

    await context.close();
    await cleanupParty(fixture.party.id);
  });

  test("breaks ties by earliest captured photo", async ({ browser }) => {
    const fixture = await createPartyInCapturingState("FixtureHost", [
      "FixtureGuest1",
      "FixtureGuest2",
    ]);
    const situation = fixture.situations[0];
    const now = Date.now();

    await insertPhoto(
      fixture._clients[0].client,
      fixture.party.id,
      fixture.participants[0].id,
      situation.id,
      new Date(now - 30_000).toISOString()
    );
    // Guest1 captured 10 min before Guest2 — earlier capture wins the tie
    const guest1Photo = await insertPhoto(
      fixture._clients[1].client,
      fixture.party.id,
      fixture.participants[1].id,
      situation.id,
      new Date(now - 10 * 60_000).toISOString()
    );
    const guest2Photo = await insertPhoto(
      fixture._clients[2].client,
      fixture.party.id,
      fixture.participants[2].id,
      situation.id,
      new Date(now - 5 * 60_000).toISOString()
    );

    // Move to voting phase so all party photos become visible (photos RLS: ends_at <= now()).
    await pushToVoting(fixture._clients[0].client, fixture.party.id);

    // Both Guest1 and Guest2 receive exactly 1 vote → tied on vote count
    const { error: v1 } = await fixture._clients[0].client
      .from("votes")
      .insert({ photo_id: guest1Photo.id, voter_id: fixture.participants[0].id });
    expect(v1).toBeNull();
    const { error: v2 } = await fixture._clients[1].client
      .from("votes")
      .insert({ photo_id: guest2Photo.id, voter_id: fixture.participants[1].id });
    expect(v2).toBeNull();

    await pushToResults(fixture._clients[0].client, fixture.party.id);

    const { page, context } = await addBrowserObserver(browser, fixture.party);
    await page.goto(`/results/${fixture.code}`);
    await expect(page.getByText("Results")).toBeVisible({ timeout: 10_000 });

    // Guest1 (earlier capture) wins the tie over Guest2 (later capture)
    await expect(page.getByTestId("podium-entry-1")).toContainText("FixtureGuest1");
    await expect(page.getByTestId("podium-entry-2")).toContainText("FixtureGuest2");
    await expect(page.getByTestId("podium-entry-3")).toContainText("FixtureHost");

    await context.close();
    await cleanupParty(fixture.party.id);
  });
});
