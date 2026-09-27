import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { ArrowLeft, Users, Bug, Loader2, Heart, Clock } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { CountdownTimer } from "@/components/CountdownTimer";
import { SituationAccordion } from "@/components/voting/SituationAccordion";
import { PhotoFullscreen } from "@/components/voting/PhotoFullscreen";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { usePartyGuard } from "@/hooks/usePartyGuard";
import {
  getPartyByCode,
  getPartyPhotos,
  getPartySituations,
  getPartyParticipants,
  debugSetVotingEndTime,
  startVotingPhase,
  submitVote,
  removeVote,
  getParticipantVotes,
  Party,
  Photo,
  Situation,
  Participant,
  Vote,
} from "@/lib/api";
import { partyFromRealtime } from "@/lib/dbContracts";
import { getPartyPhase, canPerformAction } from "@/lib/stateMachine";
import { SHOW_DEBUG_TOOLS } from "@/lib/devTools";

type Phase = "locked" | "voting";

const VotePage = () => {
  const navigate = useNavigate();
  const { code } = useParams();

  const [party, setParty] = useState<Party | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [situations, setSituations] = useState<Situation[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [votes, setVotes] = useState<Vote[]>([]);
  const [loading, setLoading] = useState(true);

  // The vote quota is a party setting the host picks before starting, frozen by
  // a DB trigger once status leaves 'waiting'. The `?? 5` covers the window
  // before `party` has loaded, and mirrors the column default — same convention
  // as `max_situations` in CaptureMode. It is NOT a second source of truth: the
  // server value wins the moment it arrives.
  const maxVotes: number = party?.max_votes ?? 5;

  // Voting state
  const [selectedPhoto, setSelectedPhoto] = useState<Photo | null>(null);

  // Force phase recalculation state.
  //
  // The `phase` memo below reads wall-clock time, which React cannot track:
  // nothing re-renders this page at the moment a deadline passes. Incrementing
  // this counter is what wakes the memo up. The locked-phase effect further down
  // schedules that for `ends_at`.
  //
  // It shipped without its setter, and that was BUG-007: the mechanism the memo's
  // comment described as its safety net had no caller, so a player sitting on
  // this page when the capture window closed stayed on "Capture time isn't over
  // yet…" until they navigated away.
  const [phaseRecalcTrigger, setPhaseRecalcTrigger] = useState(0);

  // Use hook to get current participant (based on auth)
  const { participant: currentParticipant, loading: participantLoading } = usePartyGuard(party?.id || null);
  const currentParticipantId = currentParticipant?.id || "";

  // Determine current phase
  const phase: Phase = useMemo(() => {

    if (!party?.ends_at) return "locked";

    const now = new Date();
    const endsAt = new Date(party.ends_at);

    if (now < endsAt) return "locked";

    // If voting has ended, redirect to results (handled in useEffect below)
    return "voting";
    // `phaseRecalcTrigger` is deliberately a dependency even though the body
    // never reads it. The memo's real input is `new Date()` — wall-clock time,
    // which React cannot track and which changes without any state changing.
    // When a countdown reaches zero, incrementing the counter is what forces
    // this to re-evaluate. Removing it (as the rule suggests) would leave the
    // page stuck on "locked" until some unrelated state change happened to
    // re-render it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [party?.ends_at, phaseRecalcTrigger]);

  // Voted photo IDs set for quick lookup
  const votedPhotoIds = useMemo(() => new Set(votes.map((v) => v.photo_id)), [votes]);

  // Redirect to results page if voting has ended
  useEffect(() => {
    if (!party?.voting_ends_at) return;
    const votingEndsAt = new Date(party.voting_ends_at);
    if (new Date() >= votingEndsAt) {
      navigate(`/results/${code}`, { replace: true });
    }
  }, [party?.voting_ends_at, code, navigate]);

  // Schedule redirect to results when voting timer ends
  useEffect(() => {
    if (!party?.voting_ends_at || phase !== "voting") return;

    const votingEndsAt = new Date(party.voting_ends_at);
    const now = new Date();
    const diff = votingEndsAt.getTime() - now.getTime();

    if (diff <= 0) return; // Already handled above

    const timer = setTimeout(() => {
      navigate(`/results/${code}`, { replace: true });
    }, diff);

    return () => clearTimeout(timer);
  }, [party?.voting_ends_at, phase, code, navigate]);

  // Refetch party data function
  const refetchParty = useCallback(async () => {
    if (!code) return;
    try {
      const partyData = await getPartyByCode(code);
      if (partyData) {
        setParty(partyData);
      }
    } catch (error) {
      console.error("Failed to refetch party:", error);
    }
  }, [code]);

  // Refetch photos function
  const refetchPhotos = useCallback(async () => {
    if (!party?.id) return;
    try {
      const photosData = await getPartyPhotos(party.id);
      setPhotos(photosData);
    } catch (error) {
      console.error("Failed to refetch photos:", error);
    }
  }, [party?.id]);

  useEffect(() => {
    if (!code) return;

    const loadData = async () => {
      try {
        const partyData = await getPartyByCode(code);
        if (!partyData) {
          navigate("/");
          return;
        }

        // If voting already ended, go straight to results
        if (partyData.voting_ends_at && new Date() >= new Date(partyData.voting_ends_at)) {
          navigate(`/results/${code}`, { replace: true });
          return;
        }

        setParty(partyData);

        const [photosData, situationsData, participantsData] = await Promise.all([
          getPartyPhotos(partyData.id),
          getPartySituations(partyData.id),
          getPartyParticipants(partyData.id),
        ]);

        setPhotos(photosData);
        setSituations(situationsData);
        setParticipants(participantsData);
      } catch (error) {
        console.error("Failed to load party data:", error);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [code, navigate]);

  // Refetch photos when phase changes to voting
  useEffect(() => {
    if (phase === "voting" && party?.id) {
      refetchPhotos();
    }
  }, [phase, party?.id, refetchPhotos]);

  // Load participant votes when participant is available
  useEffect(() => {
    const loadVotes = async () => {
      if (!currentParticipantId) return;
      try {
        const votesData = await getParticipantVotes(currentParticipantId);
        setVotes(votesData);
      } catch (error) {
        console.error("Failed to load votes:", error);
      }
    };
    loadVotes();
  }, [currentParticipantId]);

  // Latest `ends_at`, readable from inside the realtime callback without making
  // the subscription depend on it.
  //
  // The callback below compares the incoming row against the previous
  // `ends_at`. Reading `party.ends_at` directly captured the value from the
  // render that opened the subscription, and the effect only re-runs on
  // `party.id` — so after the first timer change the comparison kept using the
  // original value and the toast fired on *every* later party UPDATE, including
  // ones that never touched `ends_at` (`startVotingPhase` sets only
  // `voting_ends_at`). Adding `party.ends_at` to the effect deps would fix the
  // staleness but tear down and reopen the channel on every timer change, which
  // is exactly the window where a transition event would be missed.
  const lastEndsAtRef = useRef(party?.ends_at ?? null);
  useEffect(() => {
    lastEndsAtRef.current = party?.ends_at ?? null;
  }, [party?.ends_at]);

  // Real-time subscription for party updates
  useEffect(() => {
    if (!party?.id) return;

    const channel = supabase
      .channel(`party-vote-${party.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'parties',
          filter: `id=eq.${party.id}`,
        },
        (payload) => {
          const updatedParty = partyFromRealtime(payload.new);
          if (!updatedParty) {
            // Drop the event, keep the subscription. See `partyFromRealtime`.
            console.error("Vote: unusable realtime party payload", payload.new);
            return;
          }
          setParty(updatedParty);

          if (updatedParty.ends_at && updatedParty.ends_at !== lastEndsAtRef.current) {
            toast.info("⏱️ Timer has been updated!");
          }
          lastEndsAtRef.current = updatedParty.ends_at ?? null;
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [party?.id]);

  // Visibility/focus fallback for re-syncing
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refetchParty();
        refetchPhotos();
      }
    };

    const handleFocus = () => {
      refetchParty();
      refetchPhotos();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, [refetchParty, refetchPhotos]);

  // Handle voting end - redirect to results
  const handleVotingEnd = () => {
    if (!code) return;
    navigate(`/results/${code}`, { replace: true });
  };

  // AUTO-START VOTING
  useEffect(() => {
    const autoStartVoting = async () => {
      if (
        phase === "voting" &&
        party &&
        !party.voting_ends_at &&
        currentParticipant?.is_host
      ) {
        try {
          const updatedParty = await startVotingPhase(party.id, party.voting_hours);
          setParty(updatedParty);
        } catch (error) {
          console.error("Failed to auto-start voting:", error);
        }
      }
    };
    autoStartVoting();
  }, [phase, party, currentParticipant?.is_host]);

  // LOCKED PHASE: leave it when `ends_at` passes (BUG-007)
  //
  // Two cases, and only one of them used to be handled.
  //
  //   diff <= 0  the deadline is already behind us but this page still says
  //              locked, so the row we hold must be stale. Poll for a fresher
  //              one. This was the only branch that existed.
  //
  //   diff  > 0  the deadline is ahead — the ordinary case, and the one that
  //              stranded people. Nothing will re-render this page when it
  //              arrives: `ends_at` does not change by passing, the locked phase
  //              renders no countdown, and Realtime fires on writes, not on
  //              deadlines. So schedule the wake-up ourselves.
  //
  // `CaptureMode.tsx` had the second branch right the whole time (redirect now
  // if passed, otherwise `setTimeout(redirect, timeUntilEnd)`); this is that
  // shape aimed at the phase memo instead of at a redirect. Cheaper than a
  // permanent interval, and self-cancelling: the effect re-runs whenever
  // `ends_at` moves, so a host who extends the window reschedules it.
  useEffect(() => {
    if (!party?.ends_at || phase !== "locked") return;

    const diff = new Date(party.ends_at).getTime() - Date.now();

    if (diff <= 0) {
      const pollInterval = setInterval(() => {
        refetchParty();
      }, 2000);
      return () => clearInterval(pollInterval);
    }

    // Small buffer past the deadline. The phase comparison is strict
    // (`now < endsAt` is locked), so a timer that fires a millisecond early —
    // which setTimeout is allowed to do — would re-evaluate to "locked" and
    // schedule nothing further, putting us back in the bug it fixes.
    const timer = setTimeout(() => setPhaseRecalcTrigger((n) => n + 1), diff + 250);
    return () => clearTimeout(timer);
  }, [party?.ends_at, phase, refetchParty]);

  // POLLING FALLBACK: reconcile `voting_ends_at` while voting (BUG-006)
  //
  // This used to bail out whenever `voting_ends_at` held any value
  // (`if (phase !== "voting" || party?.voting_ends_at) return`), which treats
  // "set" as "correct". It is not: the host can move the deadline at any time,
  // and a client that misses that Realtime UPDATE keeps a stale timestamp —
  // non-null, so the fallback disengaged exactly when it was needed. The
  // redirect to results is scheduled from that stale value, so the client sits
  // on the voting screen indefinitely while everyone else has moved on.
  //
  // Observed in CI on Journey 3: the host wrote the new deadline and reached
  // results through its own local path, while neither guest issued a single
  // request afterwards — they never learned the party had moved.
  //
  // Two cadences, because the two cases differ in urgency: with no deadline at
  // all a transition is imminent, so poll fast; with one already known this is
  // pure reconciliation against a dropped message, and 15s keeps the cost
  // negligible over a multi-hour voting window.
  useEffect(() => {
    if (phase !== "voting") return;

    const intervalMs = party?.voting_ends_at ? 15_000 : 2_000;
    const pollInterval = setInterval(refetchParty, intervalMs);

    return () => clearInterval(pollInterval);
  }, [phase, party?.voting_ends_at, refetchParty]);

  // Debug: Set voting timer to 3 seconds
  const handleDebugSetVotingTimer = async () => {
    if (!party) return;
    try {
      const updatedParty = await debugSetVotingEndTime(party.id, 3);
      setParty(updatedParty);
      toast.success("🐛 Debug: Voting ends in 3 seconds!");
    } catch (error) {
      console.error("Failed to set voting timer:", error);
      toast.error("Failed to set voting timer");
    }
  };

  // Get participant name by ID
  const getParticipantName = (participantId: string): string => {
    const participant = participants.find((p) => p.id === participantId);
    return participant?.name || "Unknown";
  };

  // Handle vote toggle
  const handleToggleVote = async (photo: Photo) => {
    if (!currentParticipantId) {
      toast.error("You need to be a participant to vote");
      return;
    }

    if (!party || !canPerformAction(getPartyPhase(party), "vote")) {
      toast.error("Voting is not open yet.");
      return;
    }

    const isVoted = votedPhotoIds.has(photo.id);

    try {
      if (isVoted) {
        await removeVote(photo.id, currentParticipantId);
        setVotes((prev) => prev.filter((v) => v.photo_id !== photo.id));
        toast.success("Vote removed");
      } else {
        if (votes.length >= maxVotes) {
          toast.error(`You've already used your ${maxVotes} votes!`);
          return;
        }
        const newVote = await submitVote(photo.id, currentParticipantId);
        setVotes((prev) => [...prev, newVote]);
        toast.success("❤️ Vote added!");
      }
    } catch (error) {
      console.error("Failed to toggle vote:", error);
      toast.error("Failed to vote");
    }
  };

  // Group photos by situation
  const photosBySituation = situations
    .map((situation) => ({
      situation,
      photos: photos.filter((p) => p.situation_id === situation.id),
    }))
    .filter((group) => group.photos.length > 0);

  if (loading || participantLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const votingEndsAt = party?.voting_ends_at ? new Date(party.voting_ends_at) : null;

  return (
    <div className="min-h-screen flex flex-col px-6 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <button
          onClick={() => navigate("/")}
          className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
          data-testid="vote-back-btn"
        >
          <ArrowLeft className="w-5 h-5" />
          <span>Home</span>
        </button>
        <div className="flex items-center gap-2 text-muted-foreground">
          <Users className="w-4 h-4" />
          <span className="text-sm">{participants.length} players</span>
        </div>
      </div>

      {/* Title */}
      <div className="text-center mb-4">
        <h1 className="text-2xl font-bold uppercase tracking-tight text-foreground">
          {phase === "locked" && "Photos Locked"}
          {phase === "voting" && "Vote for your favorites"}
        </h1>
      </div>

      {/* Vote counter + Timer (voting phase) */}
      {phase === "voting" && votingEndsAt && (
        <div className="glass p-3 rounded-xl mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 bg-red-500/20 text-red-400 px-3 py-1.5 rounded-full">
              <Heart className="w-4 h-4 fill-current" />
              <span className="font-medium">
                {votes.length}/{maxVotes}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {SHOW_DEBUG_TOOLS && currentParticipant?.is_host && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-orange-500 hover:text-orange-400 hover:bg-orange-500/10"
                onClick={handleDebugSetVotingTimer}
                data-testid="vote-debug-timer-btn"
              >
                <Bug className="w-4 h-4" />
              </Button>
            )}
            <Clock className="w-4 h-4 text-muted-foreground" />
            <div className="text-base font-medium">
              <CountdownTimer targetDate={votingEndsAt} onComplete={handleVotingEnd} compact />
            </div>
          </div>
        </div>
      )}

      {/* LOCKED PHASE - redirect back to capture */}
      {phase === "locked" && (
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Capture time isn't over yet...</p>
          <Button variant="outline" onClick={() => navigate(`/capture/${code}`)} data-testid="vote-back-to-capture-btn">
            Back to capture
          </Button>
        </div>
      )}

      {/* VOTING PHASE */}
      {phase === "voting" && (
        <>
          {/* Waiting for host to start voting (no timer yet) */}
          {!votingEndsAt && (
            <div className="flex flex-col items-center gap-4 mb-8">
              <div className="text-center">
                <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto mb-3" />
                <p className="text-muted-foreground">
                  {currentParticipant?.is_host
                    ? "Starting the vote..."
                    : "Waiting for the host to start voting..."}
                </p>
              </div>
            </div>
          )}

          <div className="flex-1 space-y-3">
            {photosBySituation.map(({ situation, photos: situationPhotos }, index) => (
              <SituationAccordion
                key={situation.id}
                situation={situation}
                situationNumber={index + 1}
                photos={situationPhotos}
                currentParticipantId={currentParticipantId}
                votedPhotoIds={votedPhotoIds}
                canVote={votes.length < maxVotes}
                onToggleVote={handleToggleVote}
                onPhotoClick={setSelectedPhoto}
                getParticipantName={getParticipantName}
              />
            ))}
          </div>

          {/* Fullscreen photo viewer */}
          {selectedPhoto && (
            <PhotoFullscreen
              photo={selectedPhoto}
              isVoted={votedPhotoIds.has(selectedPhoto.id)}
              canVote={votes.length < maxVotes || votedPhotoIds.has(selectedPhoto.id)}
              onToggleVote={() => handleToggleVote(selectedPhoto)}
              onClose={() => setSelectedPhoto(null)}
              participantName={getParticipantName(selectedPhoto.participant_id)}
            />
          )}
        </>
      )}

      {/* Info card */}
      <div className="glass-card p-4 rounded-xl mt-8">
        <p className="text-sm text-muted-foreground text-center">
          {phase === "locked" &&
            "All photos will be revealed to everyone at the same time. Then the voting begins!"}
          {phase === "voting" &&
            `You have ${maxVotes - votes.length} votes left. Vote for your favorite photos!`}
        </p>
      </div>
    </div>
  );
};

export default VotePage;
