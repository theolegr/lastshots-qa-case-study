import { useState, useEffect } from "react";
import { Copy, Check, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { QRCodeDisplay } from "@/components/QRCodeDisplay";
import { ParticipantAvatar } from "@/components/ParticipantAvatar";
import { getPartyParticipants, type Participant } from "@/lib/api";
import { participantFromRealtime } from "@/lib/dbContracts";
import { supabase } from "@/integrations/supabase/client";

interface LobbyDrawerProps {
  partyId: string | null;
  partyCode: string;
  partyName?: string;
}

export const LobbyDrawer = ({ partyId, partyCode, partyName }: LobbyDrawerProps) => {
  const [copied, setCopied] = useState(false);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [open, setOpen] = useState(false);

  // Load participants on mount (for count display)
  useEffect(() => {
    if (!partyId) return;

    const loadParticipants = async () => {
      try {
        const data = await getPartyParticipants(partyId);
        setParticipants(data);
      } catch (error) {
        console.error("Failed to load participants:", error);
      }
    };

    loadParticipants();

    // Subscribe to realtime participant updates
    const channel = supabase
      .channel(`lobby-drawer-participants-${partyId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "participants",
          filter: `party_id=eq.${partyId}`,
        },
        (payload) => {
          const incoming = participantFromRealtime(payload.new);
          if (!incoming) {
            console.error("LobbyDrawer: unusable realtime participant payload", payload.new);
            return;
          }
          setParticipants((prev) => [...prev, incoming]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [partyId]);

  const handleCopy = () => {
    navigator.clipboard.writeText(partyCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        <button className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors" data-testid="lobby-drawer-trigger-btn">
          <Users className="w-4 h-4" />
          <span className="text-sm">{participants.length || "..."} players</span>
        </button>
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle className="text-center">
            {partyName || "Party Lobby"}
          </DrawerTitle>
        </DrawerHeader>
        
        <div className="px-6 pb-8 space-y-6">
          {/* Code display */}
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={handleCopy}
              className={cn(
                "inline-flex items-center gap-3 px-6 py-3 rounded-xl transition-all",
                "bg-muted hover:bg-muted/80",
                copied && "bg-secondary/20"
              )}
              data-testid="lobby-drawer-copy-code-btn"
            >
              <span className="font-mono text-2xl tracking-[0.3em] font-bold text-primary">
                {partyCode}
              </span>
              {copied ? (
                <Check className="w-5 h-5 text-secondary" />
              ) : (
                <Copy className="w-5 h-5 text-muted-foreground" />
              )}
            </button>
            
            <QRCodeDisplay partyCode={partyCode} />
          </div>
          <p className="text-xs text-muted-foreground text-center">
            {copied ? "Copied!" : "Tap code to copy • Tap QR to show"}
          </p>

          {/* Participants */}
          <div>
            <h3 className="text-sm font-medium text-muted-foreground mb-4">
              WHO'S IN
            </h3>
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
                <div className="w-14 h-14 rounded-full border-2 border-dashed border-muted-foreground/30 flex items-center justify-center">
                  <span className="text-muted-foreground/50 text-2xl">+</span>
                </div>
                <span className="text-xs text-muted-foreground">Invite</span>
              </div>
            </div>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
};
