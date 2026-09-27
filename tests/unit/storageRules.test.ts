// @covers MO-004
import { describe, it, expect } from "vitest";
import { SIGNED_URL_TTL_SECONDS, buildPhotoPath } from "@/lib/storageRules";
import { RETENTION_HOURS } from "../../supabase/functions/_shared/retention";

// ─── SIGNED_URL_TTL_SECONDS ──────────────────────────────────────────────────
//
// The policy half of MO-004. That storage *enforces* expiry is proven in
// `tests/e2e/flows/storage-privacy.spec.ts` with a short TTL; what that test
// cannot assert is which TTL production actually ships, since waiting out the
// real one would take a week. This does that half.

describe("SIGNED_URL_TTL_SECONDS", () => {
  it("is 7 days, expressed in seconds", () => {
    expect(SIGNED_URL_TTL_SECONDS).toBe(604_800);
  });

  it("outlives the 72h party retention window", () => {
    // Parties are deleted after 72h (`cleanup-old-parties`). A signed URL that
    // expired sooner would break photos in a party that is still alive — the
    // ordering between these two constants is the actual requirement, and it is
    // the thing that would silently break if either were tuned in isolation.
    // Read from the retention module rather than restated here: a hand-copied
    // 72 would keep this test green if the policy were ever retuned, which is
    // the drift the assertion is supposed to catch.
    const RETENTION_SECONDS = RETENTION_HOURS * 60 * 60;
    expect(SIGNED_URL_TTL_SECONDS).toBeGreaterThan(RETENTION_SECONDS);
  });
});

// ─── buildPhotoPath ──────────────────────────────────────────────────────────

describe("buildPhotoPath", () => {
  const PARTY = "11111111-1111-1111-1111-111111111111";
  const PARTICIPANT = "22222222-2222-2222-2222-222222222222";
  const SITUATION = "33333333-3333-3333-3333-333333333333";
  const RANDOM = "44444444-4444-4444-4444-444444444444";

  it("builds the documented {partyId}/{participantId}/{uuid}_{situationId}.jpg key", () => {
    expect(buildPhotoPath(PARTY, PARTICIPANT, SITUATION, RANDOM)).toBe(
      `${PARTY}/${PARTICIPANT}/${RANDOM}_${SITUATION}.jpg`
    );
  });

  it("puts partyId and participantId in the first two segments", () => {
    // Storage RLS matches on these segments to authorise the write. If the
    // order were ever swapped, uploads would be authorised against the wrong
    // id — a security regression that no UI test would surface, because the
    // happy path would keep working for the party's own members.
    const [first, second] = buildPhotoPath(PARTY, PARTICIPANT, SITUATION, RANDOM).split("/");
    expect(first).toBe(PARTY);
    expect(second).toBe(PARTICIPANT);
  });

  it("produces exactly three path segments", () => {
    expect(buildPhotoPath(PARTY, PARTICIPANT, SITUATION, RANDOM).split("/")).toHaveLength(3);
  });

  it("varies the key when only the random component changes", () => {
    // The anti-enumeration guarantee: party, participant and situation ids are
    // all known to fellow party members, so the random component is the only
    // thing standing between them and a guessable object key.
    const a = buildPhotoPath(PARTY, PARTICIPANT, SITUATION, "aaaa");
    const b = buildPhotoPath(PARTY, PARTICIPANT, SITUATION, "bbbb");
    expect(a).not.toBe(b);
  });

  it("keeps the .jpg extension that the bucket's content type assumes", () => {
    expect(buildPhotoPath(PARTY, PARTICIPANT, SITUATION, RANDOM).endsWith(".jpg")).toBe(true);
  });
});
