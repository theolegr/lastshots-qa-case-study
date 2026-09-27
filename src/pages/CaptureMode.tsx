import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { ShotIndicator } from "@/components/ShotIndicator";
import { SituationCard } from "@/components/SituationCard";
import { LobbyDrawer } from "@/components/LobbyDrawer";
import { CountdownTimer } from "@/components/CountdownTimer";
import { Camera, X, Check, RefreshCw, Loader2, StopCircle, ArrowLeft, Clock, Bug } from "lucide-react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { cn, validatePhotoBlob } from "@/lib/utils";
import { getPartyPhase, canPerformAction } from "@/lib/stateMachine";
import { SHOW_DEBUG_TOOLS } from "@/lib/devTools";
import { useCamera } from "@/hooks/useCamera";
import { usePartyGuard } from "@/hooks/usePartyGuard";
import { getPartyByCode, getPartySituations, getPartyPhotos, uploadPhoto, endParty, debugSetRevealTime, type Situation, type Photo, type Party } from "@/lib/api";
import { partyFromRealtime } from "@/lib/dbContracts";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger } from
"@/components/ui/alert-dialog";

const CaptureMode = () => {
  const navigate = useNavigate();
  const { code } = useParams();
  const location = useLocation();
  const { partyId: statePartyId } = location.state || {};

  const [party, setParty] = useState<Party | null>(null);
  const [partyId, setPartyId] = useState<string | null>(statePartyId || null);

  // Use hook to get current participant (based on auth)
  const { participant, isHost, loading: participantLoading } = usePartyGuard(partyId);

  const [situations, setSituations] = useState<Situation[]>([]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [selectedSituation, setSelectedSituation] = useState<Situation | null>(null);
  const [showCamera, setShowCamera] = useState(false);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isEndingParty, setIsEndingParty] = useState(false);

  const { videoRef, isActive, error, cameraFacing, startCamera, stopCamera, switchCamera, capturePhoto } = useCamera();

  // Refetch party data function
  const refetchParty = useCallback(async () => {
    if (!code) return;
    try {
      const partyData = await getPartyByCode(code);

      // The party does not resolve (MO-005). Two ways to get here: the code was
      // never valid and was reached by URL, or the party was deleted under an
      // active session — `cleanup-old-parties` removing it past the 72h
      // retention window. Both leave `get_party_by_code` returning zero rows.
      //
      // This branch used to be absent, and its absence was BUG-008: refetch is
      // also this page's initial loader, so a null party left `partyId` null
      // forever, `usePartyGuard` short-circuited on the null id, and the page
      // rendered its shell around an empty situation list — an indefinite
      // "Loading challenges..." spinner with no way out. `/vote` and
      // `/results` already handled the same input.
      if (!partyData) {
        toast.error("This party is no longer available");
        navigate("/", { replace: true });
        return;
      }

      setParty(partyData);
      setPartyId(partyData.id);

      // If capture time is over (ends_at passed), redirect to vote
      if (partyData.ends_at) {
        const endsAt = new Date(partyData.ends_at);
        if (new Date() >= endsAt) {
          toast.info("Capture time is over! 📸");
          navigate(`/vote/${code}`, { state: { partyId: partyData.id } });
          return;
        }
      }
    } catch (error) {
      console.error("Failed to refetch party:", error);
    }
  }, [code, navigate]);

  // Load party data
  useEffect(() => {
    refetchParty();
  }, [refetchParty]);

  // Real-time subscription for party updates
  useEffect(() => {
    if (!partyId) return;


    const channel = supabase.
    channel(`party-capture-${partyId}`).
    on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'parties',
        filter: `id=eq.${partyId}`
      },
      (payload) => {
        const updatedParty = partyFromRealtime(payload.new);
        if (!updatedParty) {
          console.error("CaptureMode: unusable realtime party payload", payload.new);
          return;
        }
        setParty(updatedParty);

        // If capture time is over (host ended or timer expired), redirect to vote
        if (updatedParty.ends_at && new Date() >= new Date(updatedParty.ends_at)) {
          toast.info("Capture time is over! 📸");
          navigate(`/vote/${code}`, { state: { partyId } });
        }
      }
    ).
    subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [partyId, code, navigate]);

  // Visibility/focus fallback for re-syncing
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refetchParty();
      }
    };

    const handleFocus = () => {
      refetchParty();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, [refetchParty]);

  // Auto-redirect when reveal timer ends
  useEffect(() => {
    if (!party?.ends_at || !code) return;

    const endsAt = new Date(party.ends_at);
    const now = new Date();

    // If timer already passed, redirect immediately
    if (now >= endsAt) {
      toast.info("Capture time is over! 📸");
      navigate(`/vote/${code}`, { state: { partyId: party.id } });
      return;
    }

    // Schedule redirect when timer ends
    const timeUntilEnd = endsAt.getTime() - now.getTime();

    const timer = setTimeout(() => {
      toast.info("Capture time is over! 📸");
      navigate(`/vote/${code}`, { state: { partyId: party.id } });
    }, timeUntilEnd);

    return () => clearTimeout(timer);
  }, [party?.ends_at, party?.id, code, navigate]);

  // Load situations and photos when partyId is available
  useEffect(() => {
    const loadCaptureData = async () => {
      if (!partyId) return;

      try {
        const [situationsData, photosData] = await Promise.all([
        getPartySituations(partyId),
        getPartyPhotos(partyId)]
        );
        setSituations(situationsData);
        setPhotos(photosData);
      } catch (error) {
        console.error("Failed to load data:", error);
      }
    };

    loadCaptureData();
  }, [partyId]);

  // Get completed situations for current participant
  const participantId = participant?.id;
  const myPhotos = photos.filter((p) => p.participant_id === participantId);
  const completedSituationIds = myPhotos.map((p) => p.situation_id);
  const usedShots = myPhotos.length;
  const maxShots = 5;
  const maxSituations: number = party?.max_situations ?? 5;
  const visibleSituations = situations.slice(0, maxSituations);

  const handleSituationSelect = async (situation: Situation) => {
    if (completedSituationIds.includes(situation.id) || usedShots >= maxShots) return;

    setSelectedSituation(situation);
    setShowCamera(true);
    setCapturedImage(null);
    setCapturedBlob(null);

    // Start camera
    await startCamera();
  };

  const handleCapture = () => {
    const blob = capturePhoto();
    if (blob) {
      const url = URL.createObjectURL(blob);
      setCapturedImage(url);
      setCapturedBlob(blob);
      stopCamera();
    }
  };

  const handleRetake = async () => {
    setCapturedImage(null);
    setCapturedBlob(null);
    await startCamera();
  };

  const handleSavePhoto = async () => {
    if (!capturedBlob || !partyId || !participantId || !selectedSituation) return;

    if (!party || !canPerformAction(getPartyPhase(party), "submit")) {
      toast.error("Photo capture is no longer available.");
      return;
    }

    if (validatePhotoBlob(capturedBlob) === "too_large") {
      toast.error("Photo is too large (max 15MB). Please try again.");
      return;
    }

    setIsUploading(true);
    try {
      const photo = await uploadPhoto(partyId, participantId, selectedSituation.id, capturedBlob);
      setPhotos((prev) => [...prev, photo]);
      setShowCamera(false);
      setSelectedSituation(null);
      setCapturedImage(null);
      setCapturedBlob(null);
      toast.success("Photo captured! 📸");
    } catch (error) {
      console.error("Failed to upload photo:", error);
      toast.error("Failed to save photo. Please try again.");
    } finally {
      setIsUploading(false);
    }
  };

  const handleCloseCamera = () => {
    stopCamera();
    setShowCamera(false);
    setSelectedSituation(null);
    setCapturedImage(null);
    setCapturedBlob(null);
  };

  const handleDebugSetRevealTimer = async () => {
    if (!partyId) return;
    try {
      const updatedParty = await debugSetRevealTime(partyId, 3);
      setParty(updatedParty);
      toast.success("🐛 Debug: Timer set to 3s!");
    } catch (error) {
      console.error("Failed to set timer:", error);
      toast.error("Failed to set timer");
    }
  };

  const handleTimerComplete = () => {
    if (!code || !partyId) return;
    navigate(`/vote/${code}`, { state: { partyId } });
  };

  const handleEndParty = async () => {
    if (!partyId) return;

    setIsEndingParty(true);
    try {
      await endParty(partyId);
      toast.success("Party ended! 🎉 Photos are now locked.");
      navigate(`/vote/${code}`, { state: { partyId } });
    } catch (error) {
      console.error("Failed to end party:", error);
      toast.error("Failed to end the party");
    } finally {
      setIsEndingParty(false);
    }
  };

  if (participantLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>);

  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Camera View Overlay */}
      {showCamera &&
      <div className="fixed inset-0 bg-black z-50 flex flex-col">
          {/* Camera preview or captured image */}
          <div className="flex-1 relative">
            <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-black/60 z-10 pointer-events-none" />
            
            {/* Video feed */}
            {!capturedImage &&
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={cn(
              "absolute inset-0 w-full h-full object-cover",
              cameraFacing === "user" && "scale-x-[-1]"
            )} />

          }

            {/* Captured image preview */}
            {capturedImage &&
          <img
            src={capturedImage}
            alt="Captured"
            className="absolute inset-0 w-full h-full object-cover" />

          }

            {/* Error message */}
            {error && !capturedImage &&
          <div className="absolute inset-0 flex items-center justify-center z-20">
                <div className="text-center text-white p-6">
                  <Camera className="w-16 h-16 mx-auto mb-4 opacity-50" />
                  <p className="text-sm">{error}</p>
                </div>
              </div>
          }
            
            {/* Top bar */}
            <div className="absolute top-0 left-0 right-0 p-6 flex items-center justify-between z-20">
              <button
              onClick={handleCloseCamera}
              className="w-12 h-12 rounded-full bg-white/10 backdrop-blur flex items-center justify-center"
              data-testid="capture-close-camera-btn">

                <X className="w-6 h-6 text-white" />
              </button>
              <div className="bg-card/80 backdrop-blur border border-border px-4 py-2 rounded-full">
                <span className="text-white font-medium text-sm">
                  {selectedSituation?.title}
                </span>
              </div>
            </div>
            
            {/* Bottom bar */}
            <div className="absolute bottom-0 left-0 right-0 p-8 flex flex-col items-center gap-6 z-20">
              <ShotIndicator totalShots={maxShots} usedShots={usedShots} />
              
              {!capturedImage ?
            // Camera controls
            <div className="flex items-center gap-8">
                  <button
                onClick={switchCamera}
                className="w-14 h-14 rounded-full bg-white/10 backdrop-blur flex items-center justify-center"
                disabled={!isActive}
                data-testid="capture-switch-camera-btn">

                    <RefreshCw className="w-6 h-6 text-white" />
                  </button>
                  
                  <button
                onClick={handleCapture}
                className="w-20 h-20 rounded-full bg-white flex items-center justify-center"
                disabled={!isActive}
                data-testid="capture-shutter-btn">

                    <div className="w-16 h-16 rounded-full bg-primary flex items-center justify-center">
                      <Camera className="w-8 h-8 text-white" />
                    </div>
                  </button>
                  
                  <div className="w-14 h-14" /> {/* Spacer for symmetry */}
                </div> :

            // Preview controls
            <div className="flex items-center gap-4 w-full max-w-xs">
                  <Button
                variant="outline"
                size="lg"
                className="flex-1 bg-white/10 border-white/20 text-white hover:bg-white/20"
                onClick={handleRetake}
                disabled={isUploading}
                data-testid="capture-retake-btn">

                    Retake
                  </Button>
                  <Button
                variant="default"
                size="lg"
                className="flex-1"
                onClick={handleSavePhoto}
                disabled={isUploading}
                data-testid="capture-save-btn">

                    {isUploading ?
                <Loader2 className="w-5 h-5 animate-spin" /> :

                <>
                        <Check className="w-5 h-5" />
                        Save
                      </>
                }
                  </Button>
                </div>
            }
            </div>
          </div>
        </div>
      }

      {/* Main Content */}
      <div className="flex-1 px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
            data-testid="capture-back-btn">

            <ArrowLeft className="w-5 h-5" />
            <span>Home</span>
          </button>
          <LobbyDrawer
            partyId={partyId}
            partyCode={code || ""}
            partyName={party?.name} />

        </div>

        {/* Title */}
        <div className="text-center mb-4">
          <h1 className="text-2xl font-bold uppercase tracking-tight text-foreground">
            Capture the chaos
          </h1>
        </div>

        {/* Shot counter + Timer */}
        <div className="glass p-3 rounded-xl mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 bg-primary/20 text-primary px-3 py-1.5 rounded-full">
              <Camera className="w-4 h-4" />
              <span className="font-medium">{usedShots}/{maxShots}</span>
            </div>
            
          </div>
          {party?.ends_at &&
          <div className="flex items-center gap-2">
              {SHOW_DEBUG_TOOLS && isHost &&
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-orange-500 hover:text-orange-400 hover:bg-orange-500/10"
              onClick={handleDebugSetRevealTimer}
              data-testid="capture-debug-timer-btn">
                  <Bug className="w-4 h-4" />
                </Button>
            }
              <Clock className="w-4 h-4 text-muted-foreground" />
              <div className="text-base font-medium">
                <CountdownTimer
                targetDate={new Date(party.ends_at)}
                onComplete={handleTimerComplete}
                compact />
              </div>
            </div>
          }
        </div>

        {/* Situations */}
        <div className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4">
            Your Challenges
          </h2>
          {situations.length === 0 ?
          <div className="text-center py-8 text-muted-foreground">
              <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2" />
              <p>Loading challenges...</p>
            </div> :

          visibleSituations.map((situation, index) =>
          <SituationCard
            key={situation.id}
            title={situation.title}
            situationNumber={index + 1}
            isCompleted={completedSituationIds.includes(situation.id)}
            isLocked={usedShots >= maxShots && !completedSituationIds.includes(situation.id)}
            onClick={() => handleSituationSelect(situation)} />

          )
          }
        </div>
      </div>

      {/* Bottom action */}
      <div className="px-6 pb-8 space-y-4">
        















        

        {/* End Party Button - Host only */}
        {isHost &&
        <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
              variant="outline"
              className="w-full border-destructive/50 text-destructive hover:bg-destructive/10"
              data-testid="capture-end-party-btn">

                <StopCircle className="w-4 h-4 mr-2" />
                End Party
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>End the party?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will stop photo captures. Photos will remain locked until the reveal.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel data-testid="capture-end-party-cancel-btn">Cancel</AlertDialogCancel>
                <AlertDialogAction
                onClick={handleEndParty}
                disabled={isEndingParty}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                data-testid="capture-end-party-confirm-btn">

                  {isEndingParty ? "Ending..." : "End Party"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        }
      </div>
    </div>);

};

export default CaptureMode;