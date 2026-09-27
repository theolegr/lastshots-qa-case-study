import { Heart, Clock, Bug } from "lucide-react";
import { CountdownTimer } from "@/components/CountdownTimer";
import { Button } from "@/components/ui/button";

interface VotingHeaderProps {
  votesUsed: number;
  maxVotes: number;
  votingEndsAt: Date;
  onVotingEnd: () => void;
  onDebugTimer?: () => void;
}

export const VotingHeader = ({
  votesUsed,
  maxVotes,
  votingEndsAt,
  onVotingEnd,
  onDebugTimer,
}: VotingHeaderProps) => {
  return (
    <div className="glass p-4 rounded-xl mb-6">
      <div className="flex items-center justify-between">
        {/* Vote counter */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 bg-red-500/20 text-red-400 px-3 py-1.5 rounded-full">
            <Heart className="w-4 h-4 fill-current" />
            <span className="font-medium">{votesUsed}/{maxVotes}</span>
          </div>
          <span className="text-sm text-muted-foreground">votes</span>
        </div>

        {/* Countdown + debug button */}
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-muted-foreground" />
          <div className="text-sm">
            <CountdownTimer 
              targetDate={votingEndsAt} 
              onComplete={onVotingEnd}
              compact
            />
          </div>
          {onDebugTimer && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-orange-500 hover:text-orange-400 hover:bg-orange-500/10"
              onClick={onDebugTimer}
            >
              <Bug className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};