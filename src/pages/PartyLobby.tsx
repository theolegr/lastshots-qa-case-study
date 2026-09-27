import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { ParticipantAvatar } from "@/components/ParticipantAvatar";
import { QRCodeDisplay } from "@/components/QRCodeDisplay";
import { ArrowLeft, Copy, Check, Users, Play, Loader2 } from "lucide-react";
import PartySettingsDrawer, { type PartySettings, DEFAULT_PARTY_SETTINGS } from "@/components/PartySettingsDrawer";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { getPartyByCode, getPartyParticipants, startParty, type Participant as ParticipantType, type Party } from "@/lib/api";
import { participantFromRealtime, partyFromRealtime } from "@/lib/dbContracts";
import { mergeParticipant } from "@/lib/participantRules";
import { usePartyGuard } from "@/hooks/usePartyGuard";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const PartyLobby = () => {
  const navigate = useNavigate();
  const { code } = useParams();
  const location = useLocation();
  
  const stateData = location.state || {};
  const partyId = stateData.partyId;
  const partyName = stateData.partyName;
  
  const [copied, setCopied] = useState(false);
  const [participants, setParticipants] = useState<ParticipantType[]>([]);
  const [isStarting, setIsStarting] = useState(false);
  const [currentPartyId, setCurrentPartyId] = useState<string | null>(partyId || null);
  const [currentPartyName, setCurrentPartyName] = useState<string>(partyName || "Loading...");
  const [settings, setSettings] = useState<PartySettings>(DEFAULT_PARTY_SETTINGS);

  // Use hook to get current participant (based on auth)
  const { isHost, loading: participantLoading } = usePartyGuard(currentPartyId);

  // Navigate to capture or locked based on party status.
  // Takes the timestamp fields too: phase is derived from `status` *and*
  // `ends_at` (see stateMachine.getPartyPhase), so narrowing the parameter to
  // `{ id, status }` made the ends_at branch unreachable to the type checker.
  const redirectByStatus = useCallback((party: Pick<Party, "id" | "status" | "ends_at">) => {
    if (party.status === "playing") {
      navigate(`/capture/${code}`, {
        state: {
          partyId: party.id,
        },
      });
      return true;
    } else if (party.ends_at && new Date() >= new Date(party.ends_at)) {
      navigate(`/vote/${code}`, {
        state: {
          partyId: party.id,
        },
      });
      return true;
    }
    return false;
  }, [code, navigate]);

  // Check party status (used on load and on tab focus)
  const syncPartyStatus = useCallback(async () => {
    if (!code) return;
    const party = await getPartyByCode(code);
    if (party) {
      setCurrentPartyId(party.id);
      setCurrentPartyName(party.name);
      redirectByStatus(party);
    }
  }, [code, redirectByStatus]);

  // Load party data if not in state + check status on initial load
  useEffect(() => {
    const loadPartyData = async () => {
      if (!code) return;
      
      if (!currentPartyId) {
        await syncPartyStatus();
      } else {
        // If we have partyId, still check status in case party started
        const party = await getPartyByCode(code);
        if (party) {
          redirectByStatus(party);
        }
      }
    };
    
    loadPartyData();
  }, [code, currentPartyId, syncPartyStatus, redirectByStatus]);

  // Re-check party status when tab becomes visible or focused
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        syncPartyStatus();
      }
    };
    
    const handleFocus = () => {
      syncPartyStatus();
    };
    
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleFocus);
    
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleFocus);
    };
  }, [syncPartyStatus]);

  // Load participants
  useEffect(() => {
    const loadParticipants = async () => {
      if (!currentPartyId) return;
      
      try {
        const data = await getPartyParticipants(currentPartyId);
        setParticipants(data);
      } catch (error) {
        console.error("Failed to load participants:", error);
      }
    };

    loadParticipants();

    // Subscribe to realtime participant updates
    const participantsChannel = supabase
      .channel(`participants-changes-${currentPartyId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "participants",
          filter: `party_id=eq.${currentPartyId}`,
        },
        (payload) => {
          // Append only if this participant isn't already known (BUG-005).
          //
          // The initial fetch above and this subscription race: a participant
          // already present in `loadParticipants()` also arrives as an INSERT
          // event whenever the event lands after the fetch resolves. Appending
          // blindly rendered that person twice — reliably in CI, almost never
          // locally, because the outcome depends purely on which of the two
          // wins. Keying on `id` makes the handler idempotent, which is what
          // the architecture principles already require of realtime writes.
          const incoming = participantFromRealtime(payload.new);
          if (!incoming) {
            console.error("PartyLobby: unusable realtime participant payload", payload.new);
            return;
          }
          setParticipants((prev) => mergeParticipant(prev, incoming));
        }
      )
      .subscribe();

    // Subscribe to realtime party status updates (for non-host players)
    const partyChannel = supabase
      .channel(`party-status-changes-${currentPartyId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "parties",
          filter: `id=eq.${currentPartyId}`,
        },
        (payload) => {
          // postgres_changes delivers the whole updated row, ends_at included —
          // the previous narrower cast hid the field the vote redirect reads.
          const updatedParty = partyFromRealtime(payload.new);
          if (!updatedParty) {
            console.error("PartyLobby: unusable realtime party payload", payload.new);
            return;
          }
          redirectByStatus(updatedParty);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(participantsChannel);
      supabase.removeChannel(partyChannel);
    };
  }, [currentPartyId, redirectByStatus]);

  const handleCopy = () => {
    navigator.clipboard.writeText(code || "");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleStart = async () => {
    if (!currentPartyId) return;

    setIsStarting(true);
    try {
      await startParty(currentPartyId, {
        captureHours: settings.captureHours,
        votingHours: settings.votingHours,
        maxSituations: settings.maxSituations,
        maxVotes: settings.maxVotes,
      });
      navigate(`/capture/${code}`, {
        state: { partyId: currentPartyId },
      });
    } catch (error) {
      console.error("Failed to start party:", error);
      toast.error("Failed to start party. Please try again.");
    } finally {
      setIsStarting(false);
    }
  };

  if (participantLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col px-6 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <button
          onClick={() => navigate("/")}
          className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
          data-testid="lobby-back-btn"
          aria-label="Go back"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Users className="w-4 h-4" />
            <span>{participants.length} joined</span>
          </div>
          {isHost && (
            <PartySettingsDrawer settings={settings} onChange={setSettings} />
          )}
        </div>
      </div>

      {/* Party Info */}
      <div className="text-center mb-8">
        <h1 className="text-2xl font-bold uppercase tracking-tight text-foreground mb-2">
          {currentPartyName}
        </h1>
        
        {/* Code display */}
        <div className="flex items-center justify-center gap-3 mt-3">
          <button
            onClick={handleCopy}
            className={cn(
              "inline-flex items-center gap-3 px-6 py-3 rounded-xl transition-all glass glow-primary",
              copied && "bg-primary/10"
            )}
            data-testid="lobby-copy-code-btn"
          >
            <span className="font-mono text-2xl tracking-[0.3em] font-bold text-primary" data-testid="lobby-party-code">
              {code}
            </span>
            {copied ? (
              <Check className="w-5 h-5 text-primary" />
            ) : (
              <Copy className="w-5 h-5 text-muted-foreground" />
            )}
          </button>
          
          {/* QR Code button */}
          <QRCodeDisplay partyCode={code || ""} />
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          {copied ? "Copied!" : "Tap code to copy • Tap QR to show"}
        </p>
      </div>

      {/* Participants */}
      <div className="flex-1">
        <h2 className="text-sm font-medium text-muted-foreground mb-4">
          WHO'S IN
        </h2>
        <div className="grid grid-cols-4 gap-4">
          {participants.map((participant) => (
            <ParticipantAvatar
              key={participant.id}
              name={participant.name}
              isHost={participant.is_host}
              size="md"
            />
          ))}
          {/* Waiting indicator */}
          <div className="flex flex-col items-center gap-2">
            <div className="w-14 h-14 rounded-full border-2 border-dashed border-white/10 flex items-center justify-center animate-pulse">
              <span className="text-muted-foreground/50 text-2xl">+</span>
            </div>
            <span className="text-xs text-muted-foreground">Waiting...</span>
          </div>
        </div>
      </div>

      {/* Waiting message */}
      <div className="glass-card p-4 rounded-xl mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
            <div className="w-3 h-3 rounded-full bg-primary animate-pulse" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">
              {isHost ? "Ready to start?" : "Waiting for host to start..."}
            </p>
            <p className="text-xs text-muted-foreground">
              {isHost 
                ? "Start when everyone's ready" 
                : "The party will begin soon"
              }
            </p>
          </div>
        </div>
      </div>

      {/* Start button (host only) */}
      {isHost && (
        <Button
          variant="default"
          size="xl"
          className="w-full"
          onClick={handleStart}
          disabled={isStarting}
          data-testid="lobby-start-party-btn"
        >
          {isStarting ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              Starting...
            </>
          ) : (
            <>
              <Play className="w-5 h-5" />
              Start the Party!
            </>
          )}
        </Button>
      )}
    </div>
  );
};

export default PartyLobby;
