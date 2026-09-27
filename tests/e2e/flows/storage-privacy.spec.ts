// @covers MO-003, MO-004
// Flow — Storage privacy: private bucket + signed-URL expiry (no UI)
//
// Two requirements were previously marked "verified by inspection only" on the
// grounds that automating them needed infrastructure that doesn't exist:
//
//   MO-003 — photos live in a private bucket, unreachable by direct URL
//   MO-004 — access is granted through signed URLs that expire
//
// Both claims turned out to be testable without any new infrastructure:
//
//   MO-003 is a plain unauthenticated `fetch()` against the object path. No
//   time-travel, no service role — if the bucket were public, the fetch would
//   return the JPEG bytes.
//
//   MO-004 does not require waiting seven days. The TTL is a *parameter* of
//   `createSignedUrl`, so the behaviour under test — "an expired signature is
//   refused" — is exercised with a 5-second TTL in under ten seconds. The
//   seven-day figure is policy, not mechanism, and is asserted separately as a
//   constant in `tests/unit/storageRules.test.ts` (SIGNED_URL_TTL_SECONDS).
//   Splitting the requirement this way is what makes it automatable at all.
//
// The negative assertions are deliberately paired with positive ones (a valid
// signed URL returns 200 and the exact bytes uploaded). Without that control, a
// bucket misconfigured so that *nothing* is readable would pass every "denied"
// assertion and look like airtight security.
//
// Cost: exactly 1 anonymous sign-in for the fixture (+1 for best-effort
// cleanup) — the storage object is removed explicitly, since `cleanupParty`
// only deletes table rows.

import "dotenv/config";
import { test, expect } from "../fixtures/test";
import { createPartyInWaitingState, cleanupParty } from "../fixtures/party.fixture";
import type { SupabaseClient } from "@supabase/supabase-js";

const BUCKET = "party-photos";

// Smallest byte sequence that is still recognisably a JPEG (SOI … EOI). The
// bucket accepts it and the content survives a round-trip, which is all the
// assertions below need — this test is about reachability, not image decoding.
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x01, 0xff, 0xd9]);

test.describe("Flow — storage privacy", { tag: "@smoke" }, () => {
  let hostClient: SupabaseClient;
  let partyId: string;
  let objectPath: string;
  let supabaseUrl: string;

  test.beforeAll(async () => {
    supabaseUrl = process.env.VITE_SUPABASE_URL!;

    const party = await createPartyInWaitingState("StoragePrivacyHost");
    hostClient = party._hostClient.client;
    partyId = party.party.id;

    // Mirror the production path convention from `uploadPhoto`:
    // {partyId}/{participantId}/{uuid}_{situationId}.jpg — the storage policies
    // key off the leading path segments, so an arbitrary path would not upload.
    objectPath = `${partyId}/${party.hostParticipant.id}/${crypto.randomUUID()}_privacy.jpg`;

    const { error } = await hostClient.storage
      .from(BUCKET)
      .upload(objectPath, JPEG_BYTES, { contentType: "image/jpeg" });
    expect(error, "fixture upload must succeed for the assertions to mean anything").toBeNull();
  });

  test.afterAll(async () => {
    await hostClient.storage.from(BUCKET).remove([objectPath]);
    await cleanupParty(partyId);
  });

  test("an uploaded photo is not reachable without a signature (MO-003)", async () => {
    // ── The two URL shapes an attacker would try ────────────────────────────
    // 1. The "public" URL Supabase will happily *construct* for any object,
    //    whether or not the bucket is public. Building it never touches the
    //    network, so this is exactly what someone guessing URLs would hit.
    const publicUrl = hostClient.storage.from(BUCKET).getPublicUrl(objectPath).data.publicUrl;
    // 2. The authenticated object route with no token and no Authorization
    //    header — the path that would leak if the storage policy were missing.
    const rawObjectUrl = `${supabaseUrl}/storage/v1/object/${BUCKET}/${objectPath}`;

    for (const [label, url] of [
      ["public URL", publicUrl],
      ["raw object path", rawObjectUrl],
    ] as const) {
      const res = await fetch(url);

      expect(res.ok, `${label} must not serve the object`).toBe(false);

      // Assert on the bytes too, not just the status. A 200-with-an-error-page
      // or a partial body would still be a leak, and `res.ok` alone wouldn't
      // catch a body that contains the image.
      const body = Buffer.from(await res.arrayBuffer());
      expect(body.equals(Buffer.from(JPEG_BYTES)), `${label} must not return the JPEG`).toBe(false);
    }
  });

  test("a valid signed URL serves the exact object (control for MO-003)", async () => {
    // Control case. Without this, a bucket that denies *everything* — including
    // legitimate access — would satisfy the test above and be mistaken for a
    // correctly locked-down one.
    const { data, error } = await hostClient.storage
      .from(BUCKET)
      .createSignedUrl(objectPath, 60);
    expect(error).toBeNull();

    const res = await fetch(data!.signedUrl);
    expect(res.status).toBe(200);

    const body = Buffer.from(await res.arrayBuffer());
    expect(body.equals(Buffer.from(JPEG_BYTES))).toBe(true);
  });

  test("a signed URL stops working once its TTL passes (MO-004)", async () => {
    // Why 5 and not 1: the token's `exp` claim has one-second granularity, so a
    // 1-second TTL leaves the "still valid" fetch below having to be issued and
    // answered inside the same wall-clock second. That held when this file ran
    // alone and failed in the full suite, right after a 2.3-minute journey left
    // the machine loaded — a real flake in the test, not in the product. Five
    // seconds gives the round-trip room while keeping the wait bounded.
    const TTL_SECONDS = 5;

    const { data, error } = await hostClient.storage
      .from(BUCKET)
      .createSignedUrl(objectPath, TTL_SECONDS);
    expect(error).toBeNull();
    const signedUrl = data!.signedUrl;

    // Inside the window: the signature is honoured. This pins the failure below
    // to expiry specifically, rather than to a URL that never worked.
    const before = await fetch(signedUrl);
    expect(before.status, "signed URL must work inside its TTL").toBe(200);

    // Past the window. The extra margin absorbs clock skew between this machine
    // and the storage node — the assertion is "expiry is enforced", and a tight
    // sleep would make that assertion flaky rather than stricter.
    await new Promise((resolve) => setTimeout(resolve, (TTL_SECONDS + 3) * 1000));

    const after = await fetch(signedUrl);
    expect(after.ok, "expired signed URL must be refused").toBe(false);

    const body = Buffer.from(await after.arrayBuffer());
    expect(body.equals(Buffer.from(JPEG_BYTES)), "expired URL must not return the JPEG").toBe(false);
  });

  test("a tampered signature is rejected (MO-004)", async () => {
    // Expiry is only meaningful if the token can't be rewritten. A forged JWT
    // with an attacker-chosen payload must fail signature verification, not
    // merely fail the `exp` check — otherwise the TTL is advisory.
    const { data, error } = await hostClient.storage
      .from(BUCKET)
      .createSignedUrl(objectPath, 60);
    expect(error).toBeNull();

    const forged = data!.signedUrl.replace(
      /token=.*$/,
      "token=eyJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJmb3JnZWQiLCJleHAiOjk5OTk5OTk5OTl9.not_a_valid_signature"
    );

    const res = await fetch(forged);
    expect(res.ok, "forged token must be refused").toBe(false);

    const body = Buffer.from(await res.arrayBuffer());
    expect(body.equals(Buffer.from(JPEG_BYTES)), "forged token must not return the JPEG").toBe(false);

    // The token above also names a different object, so a server that checked
    // the `url` claim and never the signature would refuse it too. This one is
    // the attack the TTL actually has to survive: the genuine token with only
    // `exp` pushed out, header and signature left as issued. The object, the
    // path and the claims all match — the signature is the only thing wrong.
    const token = new URL(data!.signedUrl).searchParams.get("token")!;
    const [header, payload, signature] = token.split(".");
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
    const extended = Buffer.from(JSON.stringify({ ...claims, exp: 9_999_999_999 })).toString("base64url");
    const rewritten = data!.signedUrl.replace(token, `${header}.${extended}.${signature}`);

    const genuine = await fetch(data!.signedUrl);
    expect(genuine.status, "control: the untouched token must still work").toBe(200);

    const resExtended = await fetch(rewritten);
    expect(resExtended.ok, "a token whose expiry was rewritten must be refused").toBe(false);

    const bodyExtended = Buffer.from(await resExtended.arrayBuffer());
    expect(
      bodyExtended.equals(Buffer.from(JPEG_BYTES)),
      "a token whose expiry was rewritten must not return the JPEG"
    ).toBe(false);
  });
});
