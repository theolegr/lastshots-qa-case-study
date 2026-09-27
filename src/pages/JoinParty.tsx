import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { QRScanner } from "@/components/QRScanner";
import { ArrowLeft, QrCode, Hash, Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { joinParty, getRecentNickname, getPartyByCode } from "@/lib/api";
import { getPartyPhase, canPerformAction } from "@/lib/stateMachine";
import { toast } from "sonner";

const JoinParty = () => {
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [nickname, setNickname] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showScanner, setShowScanner] = useState(false);

  useEffect(() => {
    const loadLastNickname = async () => {
      const lastNickname = await getRecentNickname();
      if (lastNickname) {
        setNickname(lastNickname);
      }
    };
    loadLastNickname();
  }, []);

  const handleQRCodeScanned = (scannedCode: string) => {
    setCode(scannedCode);
  };

  const handleJoin = async () => {
    if (!code.trim() || !nickname.trim()) return;

    setIsLoading(true);
    try {
      const partyData = await getPartyByCode(code.trim());
      if (!partyData) {
        toast.error("Party not found. Check the code and try again.");
        return;
      }
      if (!canPerformAction(getPartyPhase(partyData), "join")) {
        toast.error("This party is no longer accepting new players.");
        return;
      }

      const { party, participant } = await joinParty(code.trim(), nickname.trim());
      
      navigate(`/lobby/${party.code}`, { 
        state: { 
          partyId: party.id,
          partyName: party.name,
          nickname: participant.name,
          participantId: participant.id,
          isHost: participant.is_host 
        } 
      });
    } catch (error) {
      console.error("Failed to join party:", error);
      if (error instanceof Error && error.message === "Party not found") {
        toast.error("Party not found. Check the code and try again.");
      } else if (error instanceof Error) {
        toast.error(error.message);
      } else {
        toast.error("Failed to join party. Please try again.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col px-6 py-8">
      {/* Header */}
      <button
        onClick={() => navigate("/")}
        className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors mb-8"
        data-testid="join-party-back-btn"
      >
        <ArrowLeft className="w-5 h-5" />
        <span>Back</span>
      </button>

      <div className="flex-1">
        {/* Title */}
        <div className="mb-10 flex flex-col items-center text-center">
          <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mb-4 glow-primary">
            <Hash className="w-7 h-7 text-primary" />
          </div>
          <h1 className="text-2xl font-bold uppercase tracking-tight text-foreground">
            Join a Party
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Enter the party code to join
          </p>
        </div>

        {/* Form */}
        <div className="space-y-6">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              Party Code
            </label>
            <Input
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              maxLength={6}
              className="h-16 bg-muted border-white/5 text-2xl text-center font-mono tracking-[0.5em] placeholder:text-muted-foreground/50 placeholder:tracking-normal focus-visible:ring-primary/50"
              disabled={isLoading}
              data-testid="join-party-code-input"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              Your Nickname
            </label>
            <Input
              placeholder="e.g. NightOwl42"
              value={nickname}
              onChange={(e) => setNickname(e.target.value.slice(0, 50))}
              maxLength={50}
              className="h-14 bg-muted border-white/5 text-lg placeholder:text-muted-foreground/50 focus-visible:ring-primary/50"
              disabled={isLoading}
              data-testid="join-party-nickname-input"
            />
          </div>

          {/* QR Scanner option */}
          <button
            className="w-full glass p-4 rounded-xl flex items-center justify-center gap-3 text-muted-foreground hover:text-foreground transition-all hover:border-white/10"
            disabled={isLoading}
            onClick={() => setShowScanner(true)}
            data-testid="join-party-qr-scan-btn"
          >
            <QrCode className="w-5 h-5" />
            <span className="font-medium">Scan QR Code</span>
          </button>

          {/* QR Scanner Modal */}
          <QRScanner
            open={showScanner}
            onClose={() => setShowScanner(false)}
            onScan={handleQRCodeScanned}
          />
        </div>
      </div>

      {/* Submit */}
      <div className="pt-6">
        <Button
          variant="secondary"
          size="xl"
          className="w-full"
          onClick={handleJoin}
          disabled={code.length !== 6 || !nickname.trim() || isLoading}
          data-testid="join-party-submit-btn"
        >
          {isLoading ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              Joining...
            </>
          ) : (
            "Join Party"
          )}
        </Button>
      </div>
    </div>
  );
};

export default JoinParty;
