import { supabase } from "@/integrations/supabase/client";
import { PartySchema, JoinSchema } from "@/lib/partyRules";
import { SIGNED_URL_TTL_SECONDS, buildPhotoPath } from "@/lib/storageRules";
import {
  computeResults,
  type PodiumEntry,
  type SituationWinnerEntry,
} from "@/lib/resultsRules";
import {
  parseCreatePartyPayload,
  toParty,
  type Participant,
  type Party,
  type Photo,
  type Situation,
  type Vote,
} from "@/lib/dbContracts";
import type { TablesUpdate } from "@/integrations/supabase/types";

// Row types are derived from the generated schema in `dbContracts.ts` — that
// module explains why the hand-written interfaces that used to live here, and
// the `as` casts that propped them up, are gone. They are re-exported from this
// module so the seventeen files importing them from `@/lib/api` keep working.
export type {
  Participant,
  Party,
  PartyStatus,
  Photo,
  Situation,
  Vote,
} from "@/lib/dbContracts";

// Random emoji for avatars
const AVATAR_EMOJIS = ["😀", "😎", "🥳", "🤩", "😊", "🤗", "😜", "🤓", "🥸", "😈", "👻", "🤖", "👽", "🦄", "🐱", "🐶"];

function getRandomEmoji(): string {
  return AVATAR_EMOJIS[Math.floor(Math.random() * AVATAR_EMOJIS.length)];
}

/** Settings the host picks before starting. An input DTO, not a table row. */
export interface PartyStartSettings {
  captureHours: number;
  votingHours: number;
  maxSituations: number;
  maxVotes: number;
}

// Get current user ID helper
async function getCurrentUserId(): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  return user.id;
}

// Get last used nickname for current user
export async function getRecentNickname(): Promise<string | null> {
  try {
    const userId = await getCurrentUserId();
    
    const { data: participant, error } = await supabase
      .from("participants")
      .select("name")
      .eq("user_id", userId)
      .order("joined_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !participant) return null;
    return participant.name;
  } catch {
    return null;
  }
}

// Create a new party (uses secure RPC function)
export async function createParty(
  partyName: string,
  hostName: string
): Promise<{ party: Party; participant: Participant }> {
  // Validate inputs
  const validated = PartySchema.parse({ name: partyName, hostName });
  
  // Use RPC function that handles everything atomically
  const { data, error } = await supabase
    .rpc("create_party_with_host", { 
      _party_name: validated.name, 
      _host_name: validated.hostName 
    });

  if (error) throw error;
  if (!data) throw new Error("Failed to create party");

  // The RPC returns `jsonb`, so the generated types can only call it `Json`.
  // This is the one boundary a derived type cannot cover, and it is checked at
  // runtime rather than asserted — see `dbContracts.ts`. Note the return type:
  // this RPC does not build `max_votes` into its payload, so the party it
  // hands back genuinely has no quota on it.
  return parseCreatePartyPayload(data);
}

// Join an existing party
export async function joinParty(code: string, userName: string): Promise<{ party: Party; participant: Participant }> {
  // Validate inputs
  const validated = JoinSchema.parse({ name: userName, code });
  const userId = await getCurrentUserId();
  
  // Find the party using RPC (bypasses RLS for non-participants)
  const { data: partyData, error: partyError } = await supabase
    .rpc("get_party_by_code", { _code: validated.code });

  if (partyError) throw partyError;
  if (!partyData || partyData.length === 0) throw new Error("Party not found");
  
  const party = partyData[0];

  // Check if user is already in this party
  const { data: existingParticipant } = await supabase
    .from("participants")
    .select()
    .eq("party_id", party.id)
    .eq("user_id", userId)
    .maybeSingle();

  if (existingParticipant) {
    // Return existing participant
    return { party: toParty(party), participant: existingParticipant };
  }

  // Create the participant with user_id
  const { data: participant, error: participantError } = await supabase
    .from("participants")
    .insert({
      party_id: party.id,
      name: validated.name,
      avatar_emoji: getRandomEmoji(),
      is_host: false,
      user_id: userId,
    })
    .select()
    .single();

  if (participantError) throw participantError;

  return { party: toParty(party), participant };
}

// Get current participant for a party
export async function getCurrentParticipant(partyId: string): Promise<Participant | null> {
  const userId = await getCurrentUserId();
  
  const { data, error } = await supabase
    .from("participants")
    .select()
    .eq("party_id", partyId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

// Get party by code (uses secure RPC function)
export async function getPartyByCode(code: string): Promise<Party | null> {
  const { data, error } = await supabase
    .rpc("get_party_by_code", { _code: code });

  if (error) throw error;
  
  // RPC returns an array, get first result
  if (!data || data.length === 0) return null;
  return toParty(data[0]);
}

// Get participants for a party
export async function getPartyParticipants(partyId: string): Promise<Participant[]> {
  const { data, error } = await supabase
    .from("participants")
    .select()
    .eq("party_id", partyId)
    .order("joined_at", { ascending: true });

  if (error) throw error;
  return data;
}

// Get situations for a party
export async function getPartySituations(partyId: string): Promise<Situation[]> {
  const { data, error } = await supabase
    .from("situations")
    .select()
    .eq("party_id", partyId)
    .order("display_order", { ascending: true });

  if (error) throw error;
  return data;
}

// Start the party - persists all settings server-side so every client reads the same source of truth.
export async function startParty(partyId: string, settings?: PartyStartSettings): Promise<Party> {
  const captureHours = settings?.captureHours ?? 12;
  const endsAt = new Date();
  endsAt.setTime(endsAt.getTime() + captureHours * 60 * 60 * 1000);

  const update: TablesUpdate<"parties"> = {
    status: "playing",
    ends_at: endsAt.toISOString(),
  };

  if (settings) {
    update.capture_hours = settings.captureHours;
    update.voting_hours = settings.votingHours;
    update.max_situations = settings.maxSituations;
    update.max_votes = settings.maxVotes;
  }

  const { data, error } = await supabase
    .from("parties")
    .update(update)
    .eq("id", partyId)
    .select()
    .single();

  if (error) throw error;
  return toParty(data);
}

// End the party early (moves ends_at to now, triggering the voting phase via timestamps)
export async function endParty(partyId: string): Promise<Party> {
  const { data, error } = await supabase
    .from("parties")
    .update({ ends_at: new Date().toISOString() })
    .eq("id", partyId)
    .select()
    .single();

  if (error) throw error;
  return toParty(data);
}

// Set reveal timer to a specific time (for debug)
export async function debugSetRevealTime(partyId: string, secondsFromNow: number): Promise<Party> {
  const endsAt = new Date();
  endsAt.setSeconds(endsAt.getSeconds() + secondsFromNow);

  const { data, error } = await supabase
    .from("parties")
    .update({ ends_at: endsAt.toISOString() })
    .eq("id", partyId)
    .select()
    .single();

  if (error) throw error;
  return toParty(data);
}

// Set voting end timer to a specific time (for debug)
export async function debugSetVotingEndTime(partyId: string, secondsFromNow: number): Promise<Party> {
  const votingEndsAt = new Date();
  votingEndsAt.setSeconds(votingEndsAt.getSeconds() + secondsFromNow);

  const { data, error } = await supabase
    .from("parties")
    .update({ voting_ends_at: votingEndsAt.toISOString() })
    .eq("id", partyId)
    .select()
    .single();

  if (error) throw error;
  return toParty(data);
}

// Upload a photo
export async function uploadPhoto(
  partyId: string,
  participantId: string,
  situationId: string,
  imageBlob: Blob
): Promise<Photo> {
  // Add random component to filename to prevent enumeration
  const fileName = buildPhotoPath(partyId, participantId, situationId, crypto.randomUUID());

  // Upload to storage
  const { error: uploadError } = await supabase.storage
    .from("party-photos")
    .upload(fileName, imageBlob, {
      contentType: "image/jpeg",
    });

  if (uploadError) throw uploadError;

  // Get signed URL (bucket is now private)
  const { data: signedUrlData, error: signError } = await supabase.storage
    .from("party-photos")
    .createSignedUrl(fileName, SIGNED_URL_TTL_SECONDS);

  if (signError) throw signError;

  // Save photo record with signed URL
  const { data: photo, error: photoError } = await supabase
    .from("photos")
    .insert({
      party_id: partyId,
      participant_id: participantId,
      situation_id: situationId,
      image_url: signedUrlData.signedUrl,
    })
    .select()
    .single();

  if (photoError) throw photoError;

  return photo;
}

// Get photos for a party (with refreshed signed URLs)
export async function getPartyPhotos(partyId: string): Promise<Photo[]> {
  const { data, error } = await supabase
    .from("photos")
    .select()
    .eq("party_id", partyId)
    .order("captured_at", { ascending: true });

  if (error) throw error;
  return data;
}

// ============= VOTING SYSTEM =============

// Start the voting phase (called when reveal happens). If votingHours not provided,
// it must already be set on the party (server-side default of 2h).
export async function startVotingPhase(partyId: string, votingHours: number): Promise<Party> {
  const votingEndsAt = new Date();
  votingEndsAt.setTime(votingEndsAt.getTime() + votingHours * 60 * 60 * 1000);

  const { data, error } = await supabase
    .from("parties")
    .update({ voting_ends_at: votingEndsAt.toISOString() })
    .eq("id", partyId)
    .select()
    .single();

  if (error) throw error;
  return toParty(data);
}

// Submit a vote for a photo
export async function submitVote(photoId: string, voterId: string): Promise<Vote> {
  const { data, error } = await supabase
    .from("votes")
    .insert({ photo_id: photoId, voter_id: voterId })
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Remove a vote
export async function removeVote(photoId: string, voterId: string): Promise<void> {
  const { error } = await supabase
    .from("votes")
    .delete()
    .eq("photo_id", photoId)
    .eq("voter_id", voterId);

  if (error) throw error;
}

// Get votes by a participant
export async function getParticipantVotes(participantId: string): Promise<Vote[]> {
  const { data, error } = await supabase
    .from("votes")
    .select()
    .eq("voter_id", participantId);

  if (error) throw error;
  return data;
}

// Get all votes for a party's photos
export async function getPartyVotes(partyId: string): Promise<Vote[]> {
  // First get all photo IDs for this party
  const { data: photos, error: photosError } = await supabase
    .from("photos")
    .select("id")
    .eq("party_id", partyId);

  if (photosError) throw photosError;
  if (!photos || photos.length === 0) return [];

  const photoIds = photos.map(p => p.id);

  const { data, error } = await supabase
    .from("votes")
    .select()
    .in("photo_id", photoIds);

  if (error) throw error;
  return data;
}

// Concrete instantiations of the generic result types, kept exported from here
// so consumers (`Results.tsx`, `Podium`, `PodiumShareable`, `SituationWinners`)
// keep importing them from `@/lib/api` unchanged.
export type PodiumResult = PodiumEntry<Photo>;
export type SituationWinner = SituationWinnerEntry<Photo, Situation>;

/**
 * Fetches the party's votes and hands them to the pure ranking logic.
 *
 * The ranking rules themselves live in `@/lib/resultsRules` (`computeResults`)
 * so they can be unit-tested — see the note at the top of that module.
 */
export async function getVoteResults(
  partyId: string,
  photos: Photo[],
  situations: Situation[],
  participants: Participant[]
): Promise<{ podium: PodiumResult[]; situationWinners: SituationWinner[] }> {
  const votes = await getPartyVotes(partyId);
  return computeResults({ votes, photos, situations, participants });
}

// ============= USER PARTIES =============

export interface UserPartyInfo {
  party: Party;
  participant: Participant;
}

// Get all parties the current user is part of
export async function getUserParties(): Promise<UserPartyInfo[]> {
  const userId = await getCurrentUserId();
  
  // Get all participants for this user
  const { data: participants, error: participantsError } = await supabase
    .from("participants")
    .select()
    .eq("user_id", userId);

  if (participantsError) throw participantsError;
  if (!participants || participants.length === 0) return [];

  // Get all party IDs
  const partyIds = participants.map(p => p.party_id);

  // Get all parties
  const { data: parties, error: partiesError } = await supabase
    .from("parties")
    .select()
    .in("id", partyIds)
    .order("created_at", { ascending: false });

  if (partiesError) throw partiesError;
  if (!parties) return [];

  // Filter to only include parties created within the last 72 hours
  const cutoffTime = new Date();
  cutoffTime.setHours(cutoffTime.getHours() - 72);

  const recentParties = parties.filter(party => {
    // Only show parties created within 72h (matches cleanup logic)
    return new Date(party.created_at) > cutoffTime;
  });

  // Map parties to UserPartyInfo
  return recentParties.map(party => {
    const participant = participants.find(p => p.party_id === party.id)!;
    return { party: toParty(party), participant };
  });
}
