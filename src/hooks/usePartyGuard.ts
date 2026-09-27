import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useCurrentParticipant } from "./useCurrentParticipant";
import { toast } from "sonner";

export function usePartyGuard(partyId: string | null) {
  const navigate = useNavigate();
  const result = useCurrentParticipant(partyId);

  useEffect(() => {
    if (!result.loading && partyId && !result.participant) {
      toast.error("You need to join this party first");
      navigate("/", { replace: true });
    }
  }, [result.loading, result.participant, partyId, navigate]);

  return result;
}
