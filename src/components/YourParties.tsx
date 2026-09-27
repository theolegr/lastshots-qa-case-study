import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Party, UserPartyInfo, getPartyByCode } from "@/lib/api";
import { Clock, Vote, Trophy, Users, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { getPartyPhase, type PartyPhase } from "@/lib/stateMachine";

export type { PartyPhase };

export function getNavigationPath(party: Party): string {
  const phase = getPartyPhase(party);
  
  switch (phase) {
    case "waiting":
      return `/lobby/${party.code}`;
    case "playing":
      return `/capture/${party.code}`;
    case "voting":
      return `/vote/${party.code}`;
    case "results":
      return `/results/${party.code}`;
    default:
      return `/lobby/${party.code}`;
  }
}

function PhaseIndicator({ phase }: { phase: PartyPhase }) {
  const config = {
    waiting: {
      label: "Waiting",
      icon: Users,
      className: "bg-white/5 text-muted-foreground border-white/10",
    },
    playing: {
      label: "Active",
      icon: Clock,
      className: "bg-primary/10 text-primary border-primary/20",
    },
    voting: {
      label: "Voting",
      icon: Vote,
      className: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    },
    results: {
      label: "Results",
      icon: Trophy,
      className: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
    },
  };

  const { label, icon: Icon, className } = config[phase];

  return (
    <Badge variant="outline" className={cn("gap-1 text-xs", className)}>
      <Icon className="w-3 h-3" />
      {label}
    </Badge>
  );
}

interface PartyCardProps {
  party: Party;
  participant: { avatar_emoji: string; is_host: boolean };
  compact?: boolean;
}

function PartyCard({ party, participant, compact = false }: PartyCardProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const phase = getPartyPhase(party);
  const path = getNavigationPath(party);
  const initials = party.name.slice(0, 2).toUpperCase();

  const handlePrefetch = () => {
    // Prefetch party data
    queryClient.prefetchQuery({
      queryKey: ["party", party.code],
      queryFn: () => getPartyByCode(party.code),
      staleTime: 1000 * 60,
    });
    // Prefetch participants
    queryClient.prefetchQuery({
      queryKey: ["participants", party.id],
      queryFn: async () => {
        const { data } = await supabase
          .from("participants")
          .select("*")
          .eq("party_id", party.id);
        return data;
      },
      staleTime: 1000 * 60,
    });
  };

  return (
    <button
      onClick={() => navigate(path, { state: { partyId: party.id } })}
      onMouseEnter={handlePrefetch}
      onTouchStart={handlePrefetch}
      className={cn(
        "w-full flex items-center gap-3 p-3 rounded-xl glass hover:border-white/10 transition-all text-left group",
        compact && "p-2"
      )}
      data-testid="your-parties-card-btn"
    >
      <div className={cn(
        "rounded-lg bg-primary/10 flex items-center justify-center shrink-0 font-semibold text-primary",
        compact ? "w-8 h-8 text-xs" : "w-10 h-10 text-sm"
      )}>
        {initials}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={cn("font-medium truncate", compact && "text-sm")}>{party.name}</span>
          <PhaseIndicator phase={phase} />
        </div>
        <span className="text-xs text-muted-foreground">
          {participant.is_host ? "Host" : "Participant"} · {party.code}
        </span>
      </div>

      <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
    </button>
  );
}

interface YourPartiesProps {
  parties: UserPartyInfo[];
  loading: boolean;
}

export function YourParties({ parties, loading }: YourPartiesProps) {
  const ongoingParties = parties.filter(({ party }) => {
    const phase = getPartyPhase(party);
    return phase !== "results";
  });

  if (loading || ongoingParties.length === 0) return null;

  return (
    <div className="mt-6">
      <h2 className="text-sm font-medium text-muted-foreground mb-3">
        Your Parties
      </h2>
      <div className="space-y-2">
        {ongoingParties.map(({ party, participant }) => (
          <PartyCard key={party.id} party={party} participant={participant} />
        ))}
      </div>
    </div>
  );
}

interface EndedPartiesProps {
  parties: UserPartyInfo[];
  loading: boolean;
}

export function EndedParties({ parties, loading }: EndedPartiesProps) {
  const endedParties = parties.filter(({ party }) => {
    const phase = getPartyPhase(party);
    return phase === "results";
  });

  if (loading || endedParties.length === 0) return null;

  return (
    <div className="mt-4">
      <h2 className="text-xs font-medium text-muted-foreground/70 mb-2">
        Past Parties
      </h2>
      <div className="space-y-1.5 opacity-70">
        {endedParties.map(({ party, participant }) => (
          <PartyCard key={party.id} party={party} participant={participant} compact />
        ))}
      </div>
    </div>
  );
}
