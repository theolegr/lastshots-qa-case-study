import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import type { Participant } from "@/lib/api";

export function useCurrentParticipant(partyId: string | null) {
  const { user, loading: authLoading } = useAuth();
  const [participant, setParticipant] = useState<Participant | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchedForPartyId, setFetchedForPartyId] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) {
      setLoading(true);
      return;
    }

    const fetchParticipant = async () => {
      if (!partyId || !user) {
        setParticipant(null);
        setLoading(false);
        setFetchedForPartyId(partyId);
        return;
      }

      try {
        const { data, error } = await supabase
          .from("participants")
          .select("*")
          .eq("party_id", partyId)
          .eq("user_id", user.id)
          .maybeSingle();

        if (error) throw error;
        setParticipant(data);
      } catch (error) {
        console.error("Failed to fetch participant:", error);
        setParticipant(null);
      } finally {
        setLoading(false);
        setFetchedForPartyId(partyId);
      }
    };

    fetchParticipant();
  }, [partyId, user, authLoading]);

  const isStale = partyId !== null && partyId !== fetchedForPartyId;
  return { participant, loading: loading || isStale, isHost: participant?.is_host ?? false };
}
