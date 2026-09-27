// Direct Supabase helpers for seeding DB state in flow tests.

import "dotenv/config";
import { SupabaseClient } from "@supabase/supabase-js";

const PLACEHOLDER_IMG = "https://placehold.co/400x400/222/666?text=test";

/** Insert a photo row as the given participant. captured_at must be explicit for deterministic tie-break tests. */
export async function insertPhoto(
  client: SupabaseClient,
  partyId: string,
  participantId: string,
  situationId: string,
  capturedAt: string
): Promise<{ id: string }> {
  const { data, error } = await client
    .from("photos")
    .insert({
      party_id: partyId,
      participant_id: participantId,
      situation_id: situationId,
      image_url: PLACEHOLDER_IMG,
      captured_at: capturedAt,
    })
    .select()
    .single();
  if (error) throw new Error(`insertPhoto failed: ${error.message}`);
  return data as { id: string };
}

/**
 * The one way this suite writes to `parties`.
 *
 * Why it exists: **an UPDATE matching zero rows is not an error in supabase-js.**
 * RLS refusing the write, or a client holding no session, both return
 * `error: null` and update nothing. A fixture that only checks `error` therefore
 * reports success for a party it never moved, and the test fails later against a
 * DOM that is correct for the state the party is actually in — which is how two
 * separate CI investigations were spent reading the wrong layer.
 *
 * So every write selects its rows back and fails loudly on zero.
 *
 * Note the array form rather than `.single()`. PostgREST answers `.single()` on
 * zero rows with a PGRST116 *error*, so a `!data` branch after it is unreachable
 * and the caller gets "JSON object requested, multiple (or no) rows returned"
 * instead of a message naming the refused write. `pushToVoting` had exactly that
 * dead branch before this helper existed.
 *
 * Returns the row **as the database now holds it**, never the values the caller
 * intended to write.
 */
export async function updateParty(
  client: SupabaseClient,
  partyId: string,
  patch: Record<string, unknown>,
  label: string
): Promise<PartyTimestamps> {
  const { data, error } = await client
    .from("parties")
    .update(patch)
    .eq("id", partyId)
    .select("id, status, ends_at, voting_ends_at, max_votes");

  if (error) throw new Error(`${label} failed: ${error.message}`);
  if (!data || data.length === 0) {
    throw new Error(
      `${label}: the UPDATE matched 0 rows for party ${partyId} — RLS refused the write ` +
        `(or the client holds no session). The party was NOT moved; any later assertion ` +
        `about its phase is reading a party still in its previous state. ` +
        `Patch: ${JSON.stringify(patch)}`
    );
  }
  return data[0] as PartyTimestamps;
}

export interface PartyTimestamps {
  id: string;
  status: string;
  ends_at: string | null;
  voting_ends_at: string | null;
  max_votes: number;
}

/**
 * Move a party into voting state: ends_at → 60s ago (unlocks photos), voting_ends_at → +2h (opens
 * voting window). Both are required by the votes INSERT RLS:
 *   - ends_at <= now()          makes other participants' photos visible (photos SELECT RLS)
 *   - voting_ends_at > now()    satisfies the votes WITH CHECK gate
 */
export async function pushToVoting(hostClient: SupabaseClient, partyId: string): Promise<PartyTimestamps> {
  const past = new Date(Date.now() - 60_000).toISOString();
  const futureVoting = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  const row = await updateParty(
    hostClient,
    partyId,
    { ends_at: past, voting_ends_at: futureVoting },
    "pushToVoting"
  );
  if (!row.ends_at || new Date(row.ends_at) > new Date())
    throw new Error(`pushToVoting: ends_at ${row.ends_at} is still in the future`);
  if (!row.voting_ends_at || new Date(row.voting_ends_at) <= new Date())
    throw new Error(`pushToVoting: voting_ends_at ${row.voting_ends_at} is in the past`);
  return row;
}

/** Set ends_at and voting_ends_at to 60s in the past, moving the party into results state. */
export async function pushToResults(hostClient: SupabaseClient, partyId: string): Promise<PartyTimestamps> {
  const past = new Date(Date.now() - 60_000).toISOString();
  const row = await updateParty(
    hostClient,
    partyId,
    { ends_at: past, voting_ends_at: past },
    "pushToResults"
  );
  if (!row.voting_ends_at || new Date(row.voting_ends_at) > new Date())
    throw new Error(`pushToResults: voting_ends_at ${row.voting_ends_at} is still in the future`);
  return row;
}

/** Set voting_ends_at to the given future offset (ms), activating the voting UI. */
export async function activateVoting(
  hostClient: SupabaseClient,
  partyId: string,
  durationMs = 2 * 60 * 60 * 1000
): Promise<PartyTimestamps> {
  const votingEndsAt = new Date(Date.now() + durationMs).toISOString();
  const row = await updateParty(
    hostClient,
    partyId,
    { voting_ends_at: votingEndsAt },
    "activateVoting"
  );
  if (!row.voting_ends_at || new Date(row.voting_ends_at) <= new Date())
    throw new Error(`activateVoting: voting_ends_at ${row.voting_ends_at} is not in the future`);
  return row;
}
