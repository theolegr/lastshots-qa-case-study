/**
 * Supabase helpers to create parties in specific states (bypassing UI).
 *
 * Each helper creates its own anonymous auth sessions so fixture participants
 * have real user_ids that satisfy RLS. Photos use placeholder URLs (no storage
 * upload needed for voting/results tests).
 */

import "dotenv/config";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { updateParty } from "../helpers/db";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SUPABASE_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY!;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY in .env");
}

// ─── Types ──────────────────────────────────────────────────────────────────
// Define types for the fixture data returned by the helpers. These are not
// necessarily the same as the database types, since some fields are omitted or
// transformed (e.g. user_id is added to participants).
export interface FixtureParty {
  id: string;
  code: string;
  name: string;
  status: string;
  ends_at: string | null;
  voting_ends_at: string | null;
  max_votes?: number;
}

export interface FixtureParticipant {
  id: string;
  party_id: string;
  user_id: string;
  name: string;
  is_host: boolean;
}

export interface FixturePhoto {
  id: string;
  party_id: string;
  participant_id: string;
  situation_id: string;
  image_url: string;
}

export interface FixtureVote {
  id: string;
  photo_id: string;
  voter_id: string;
}

export interface FixtureSituation {
  id: string;
  party_id: string;
  title: string;
  display_order: number;
}

// ─── Internal helpers ───────────────────────────────────────────────────────

const EMOJIS = ["😀", "😎", "🥳", "🤩", "😊", "🤗", "😜", "🤓"];

// Create a new Supabase client with an anonymous session. Returns the client and
// the user_id of the anonymous user. Retries up to 3 times with backoff if
// sign-in fails (Supabase rate-limits anon sign-ins under heavy test load).
async function createAnonClient(): Promise<{ client: SupabaseClient; userId: string }> {
  const client = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false },
  });
  // Retry with backoff — Supabase rate-limits anon sign-ins under heavy test load
  for (let attempt = 1; attempt <= 3; attempt++) {
    const { data, error } = await client.auth.signInAnonymously();
    if (!error && data.user) return { client, userId: data.user.id };
    if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 2_000));
    else throw new Error(`Anonymous sign-in failed after ${attempt} attempts: ${error?.message}`);
  }
  throw new Error("unreachable");
}

// ─── Fixture: Waiting state ─────────────────────────────────────────────────

export async function createPartyInWaitingState(hostName: string) {
  const host = await createAnonClient();

  const { data, error } = await host.client.rpc("create_party_with_host", {
    _party_name: `Test Party ${Date.now()}`,
    _host_name: hostName,
  });
  if (error || !data) throw new Error(`create_party_with_host failed: ${error?.message}`);

  const result = data as unknown as { party: FixtureParty; participant: FixtureParticipant };

  return {
    party: result.party,
    hostParticipant: { ...result.participant, user_id: host.userId },
    code: result.party.code,
    _hostClient: host,
  };
}

// ─── Fixture: Capturing state ───────────────────────────────────────────────

export async function createPartyInCapturingState(
  hostName: string,
  guestNames: string[],
  maxVotes?: number
) {
  const { party, hostParticipant, code, _hostClient } =
    await createPartyInWaitingState(hostName);

  // Add guests
  const participants: FixtureParticipant[] = [hostParticipant];
  const _guestClients: { client: SupabaseClient; userId: string }[] = [];

  for (let i = 0; i < guestNames.length; i++) {
    const guest = await createAnonClient();
    const { data, error } = await guest.client
      .from("participants")
      .insert({
        party_id: party.id,
        name: guestNames[i],
        avatar_emoji: EMOJIS[(i + 1) % EMOJIS.length],
        is_host: false,
        user_id: guest.userId,
      })
      .select()
      .single();
    if (error || !data) throw new Error(`Guest insert failed: ${error?.message}`);
    participants.push({ ...data, user_id: guest.userId } as FixtureParticipant);
    _guestClients.push(guest);
  }

  // Start party — set status to playing, ends_at to +24h
  const endsAt = new Date();
  endsAt.setHours(endsAt.getHours() + 24);

  // `max_votes` rides along with the status change rather than being written
  // afterwards, and that ordering is forced by the schema: the
  // `party_settings_locked` trigger refuses any settings change once
  // `OLD.status <> 'waiting'`. During this one update OLD.status is still
  // 'waiting', so the write is allowed — which is exactly what `startParty`
  // does in the app. A fixture that set the quota in a second update would be
  // rejected, and rightly so.
  const started = await updateParty(
    _hostClient.client,
    party.id,
    {
      status: "playing",
      ends_at: endsAt.toISOString(),
      ...(maxVotes !== undefined ? { max_votes: maxVotes } : {}),
    },
    "createPartyInPlayingState → playing"
  );

  // Fetch situations created by the RPC
  const { data: situations, error: sitError } = await _hostClient.client
    .from("situations")
    .select()
    .eq("party_id", party.id)
    .order("display_order", { ascending: true });
  if (sitError) throw new Error(`Fetch situations failed: ${sitError.message}`);

  return {
    party: { ...party, status: started.status, ends_at: started.ends_at, max_votes: started.max_votes },
    participants,
    situations: situations as FixtureSituation[],
    code,
    _clients: [_hostClient, ..._guestClients],
  };
}

// ─── Fixture: Voting state ──────────────────────────────────────────────────

export async function createPartyInVotingState(
  hostName: string,
  guestNames: string[],
  photosPerParticipant: number,
  maxVotes?: number
) {
  const { party, participants, situations, code, _clients } =
    await createPartyInCapturingState(hostName, guestNames, maxVotes);

  const photos: FixturePhoto[] = [];
  const placeholderUrl = "https://placehold.co/400x400/222/666?text=test";

  // Each participant submits photos to random situations
  for (let pIdx = 0; pIdx < participants.length; pIdx++) {
    const participant = participants[pIdx];
    const client = _clients[pIdx];

    // Pick random situations (no duplicates per participant)
    const shuffled = [...situations].sort(() => Math.random() - 0.5);
    const selected = shuffled.slice(0, photosPerParticipant);

    for (const situation of selected) {
      const { data, error } = await client.client
        .from("photos")
        .insert({
          party_id: party.id,
          participant_id: participant.id,
          situation_id: situation.id,
          image_url: placeholderUrl,
        })
        .select()
        .single();
      if (error || !data) throw new Error(`Photo insert failed: ${error?.message}`);
      photos.push(data as FixturePhoto);
    }
  }

  // Move to voting phase:
  //  - ends_at in past    → photos SELECT RLS allows cross-participant photo visibility
  //  - voting_ends_at +2h → votes WITH CHECK requires voting window to be open
  const pastDate = new Date(Date.now() - 60_000).toISOString();
  const futureVoting = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  const voting = await updateParty(
    _clients[0].client,
    party.id,
    { ends_at: pastDate, voting_ends_at: futureVoting },
    "createPartyInVotingState → voting"
  );

  return {
    party: { ...party, ends_at: voting.ends_at, voting_ends_at: voting.voting_ends_at, max_votes: voting.max_votes },
    participants,
    situations,
    photos,
    code,
    _clients,
  };
}

// ─── Fixture: Results state ─────────────────────────────────────────────────

export async function createPartyInResultsState(
  hostName: string,
  guestNames: string[],
  photosPerParticipant: number,
  votesPerParticipant: number
) {
  const { party, participants, situations, photos, code, _clients } =
    await createPartyInVotingState(hostName, guestNames, photosPerParticipant);

  const votes: FixtureVote[] = [];

  // Each participant votes on photos they didn't take
  for (let pIdx = 0; pIdx < participants.length; pIdx++) {
    const voter = participants[pIdx];
    const client = _clients[pIdx];

    const otherPhotos = photos.filter((p) => p.participant_id !== voter.id);
    const shuffled = [...otherPhotos].sort(() => Math.random() - 0.5);
    const selected = shuffled.slice(0, votesPerParticipant);

    for (const photo of selected) {
      const { data, error } = await client.client
        .from("votes")
        .insert({ photo_id: photo.id, voter_id: voter.id })
        .select()
        .single();
      if (error || !data) throw new Error(`Vote insert failed: ${error?.message}`);
      votes.push(data as FixtureVote);
    }
  }

  // Move to results — set voting_ends_at to the past
  const pastDate = new Date(Date.now() - 60_000).toISOString();
  const results = await updateParty(
    _clients[0].client,
    party.id,
    { voting_ends_at: pastDate },
    "createPartyInResultsState → results"
  );

  return {
    party: { ...party, voting_ends_at: results.voting_ends_at },
    participants,
    situations,
    photos,
    votes,
    code,
    _clients,
  };
}

// ─── Cleanup ────────────────────────────────────────────────────────────────

// Delete a test party and all related data. Call in afterAll if needed. 
export async function cleanupParty(partyId: string) {
  const client = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false },
  });
  await client.auth.signInAnonymously();

  // Delete in dependency order: votes → photos → participants → situations → party
  // RLS may block some of these — cleanup is best-effort
  const { data: partyPhotos } = await client.from("photos").select("id").eq("party_id", partyId);
  if (partyPhotos && partyPhotos.length > 0) {
    await client.from("votes").delete().in("photo_id", partyPhotos.map((p) => p.id));
  }
  await client.from("photos").delete().eq("party_id", partyId);
  await client.from("participants").delete().eq("party_id", partyId);
  await client.from("situations").delete().eq("party_id", partyId);
  await client.from("parties").delete().eq("id", partyId);
}
