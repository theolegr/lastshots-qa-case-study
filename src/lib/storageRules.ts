// Pure storage-path and signed-URL policy — no Supabase client, no side effects.
//
// These two rules are security-relevant and were previously inline in
// `api.ts:uploadPhoto`, where nothing could reach them: `api.ts` imports the
// Supabase client, which touches `localStorage` at module scope and therefore
// cannot be imported by a Node-environment unit test at all. Extracting them
// here is what makes them assertable.

/**
 * Lifetime of the signed URLs handed out for photos in the private
 * `party-photos` bucket (MO-004).
 *
 * This is the *policy* half of the requirement. The *enforcement* half — that
 * an expired signature is actually refused by storage — is covered end-to-end
 * in `tests/e2e/flows/storage-privacy.spec.ts` with a deliberately short TTL.
 */
export const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

/**
 * Object key for a captured photo: `{partyId}/{participantId}/{uuid}_{situationId}.jpg`.
 *
 * The leading two segments are load-bearing — the storage RLS policies match on
 * them to decide whether the caller may write. The random UUID is what stops an
 * object key from being guessable by anyone who knows the party, participant and
 * situation ids (all of which are visible to other members of the same party).
 */
export function buildPhotoPath(
  partyId: string,
  participantId: string,
  situationId: string,
  randomId: string
): string {
  return `${partyId}/${participantId}/${randomId}_${situationId}.jpg`;
}
