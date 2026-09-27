import { useEffect, useState } from "react";
import { ArrowLeft, Users, Loader2 } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { ResultsPhotoFullscreen } from "@/components/voting/ResultsPhotoFullscreen";
import { PodiumShareable } from "@/components/voting/PodiumShareable";
import { SituationWinners } from "@/components/voting/SituationWinners";
import { ParticipantAvatar } from "@/components/ParticipantAvatar";
import { usePartyGuard } from "@/hooks/usePartyGuard";
import {
  getPartyByCode,
  getPartyPhotos,
  getPartySituations,
  getPartyParticipants,
  getVoteResults,
  Party,
  Photo,
  Situation,
  Participant,
  PodiumResult,
  SituationWinner,
} from "@/lib/api";

const Results = () => {
  const navigate = useNavigate();
  const { code } = useParams();

  const [party, setParty] = useState<Party | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [situations, setSituations] = useState<Situation[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [loading, setLoading] = useState(true);

  const [podium, setPodium] = useState<PodiumResult[]>([]);
  const [situationWinners, setSituationWinners] = useState<SituationWinner[]>([]);
  const [selectedResultPhoto, setSelectedResultPhoto] = useState<{
    photo: Photo;
    situationTitle: string;
  } | null>(null);

  const { loading: participantLoading } = usePartyGuard(party?.id || null);

  // Get participant name by ID
  const getParticipantName = (participantId: string): string => {
    const participant = participants.find((p) => p.id === participantId);
    return participant?.name || "Unknown";
  };

  useEffect(() => {
    if (!code) return;

    const loadData = async () => {
      try {
        const partyData = await getPartyByCode(code);
        if (!partyData) {
          navigate("/");
          return;
        }

        // If voting hasn't ended yet, redirect back to vote page
        if (!partyData.voting_ends_at || new Date() < new Date(partyData.voting_ends_at)) {
          navigate(`/vote/${code}`);
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

        const results = await getVoteResults(
          partyData.id,
          photosData,
          situationsData,
          participantsData
        );
        setPodium(results.podium);
        setSituationWinners(results.situationWinners);
      } catch (error) {
        console.error("Failed to load results data:", error);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [code, navigate]);

  if (loading || participantLoading) {
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
          data-testid="results-back-btn"
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
        <h1 className="text-2xl font-bold uppercase tracking-tight text-foreground">Results</h1>
      </div>

      <PodiumShareable results={podium} partyName={party?.name || "Party"} />

      <SituationWinners winners={situationWinners} />

      {/* Who was there */}
      <div className="mt-8">
        <h2 className="text-sm font-medium text-muted-foreground mb-4">WHO WAS THERE</h2>
        <div className="grid grid-cols-4 gap-4" data-testid="results-participants-grid">
          {participants.map((participant) => (
            <ParticipantAvatar
              key={participant.id}
              name={participant.name}
              isHost={participant.is_host}
              size="md"
            />
          ))}
        </div>
      </div>

      {/* All photos grid */}
      <div className="mt-8">
        <h2 className="text-lg font-bold text-foreground mb-4">All Photos</h2>
        <div className="grid grid-cols-2 gap-3">
          {photos.map((photo) => (
            <div
              key={photo.id}
              className="aspect-square rounded-xl overflow-hidden cursor-pointer"
              onClick={() =>
                setSelectedResultPhoto({
                  photo,
                  situationTitle:
                    situations.find((s) => s.id === photo.situation_id)?.title || "",
                })
              }
              data-testid="results-photo-item"
            >
              <img src={photo.image_url} alt="" className="w-full h-full object-cover" />
            </div>
          ))}
        </div>
      </div>

      {selectedResultPhoto && (
        <ResultsPhotoFullscreen
          photo={selectedResultPhoto.photo}
          situationTitle={selectedResultPhoto.situationTitle}
          participantName={getParticipantName(selectedResultPhoto.photo.participant_id)}
          onClose={() => setSelectedResultPhoto(null)}
        />
      )}

      {/* Info card */}
      <div className="glass-card p-4 rounded-xl mt-8">
        <p className="text-sm text-muted-foreground text-center">
          Thanks for participating! See you at the next party!
        </p>
      </div>
    </div>
  );
};

export default Results;
