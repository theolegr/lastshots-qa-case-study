import { Heart, Trophy } from "lucide-react";
import { SituationWinner } from "@/lib/api";

interface SituationWinnersProps {
  winners: SituationWinner[];
}

export const SituationWinners = ({ winners }: SituationWinnersProps) => {
  const winnersWithPhotos = winners.filter(w => w.photo !== null);

  if (winnersWithPhotos.length === 0) {
    return null;
  }

  return (
    <div className="mt-8">
      <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
        <Trophy className="w-5 h-5 text-yellow-500" />
        Winners by Situation
      </h2>
      
      <div className="space-y-2">
        {winnersWithPhotos.map((winner, index) => (
          <div 
            key={winner.situation.id}
            className="flex items-center gap-3 bg-card border border-border rounded-lg p-3"
          >
            {/* Photo thumbnail */}
            {winner.photo && (
              <img
                src={winner.photo.image_url}
                alt={winner.situation.title}
                className="w-14 h-14 object-cover rounded-md"
              />
            )}
            
            {/* Situation info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="w-6 h-6 rounded bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary">
                  {index + 1}
                </span>
                <span className="font-medium text-foreground text-sm truncate">
                  {winner.situation.title}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                by <span className="text-foreground">{winner.participantName}</span>
              </p>
            </div>
            
            {/* Vote count */}
            <div className="flex items-center gap-1 text-muted-foreground">
              <Heart className="w-4 h-4" />
              <span className="text-sm font-medium">{winner.voteCount}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
