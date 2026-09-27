import { cn } from "@/lib/utils";
import { Camera, Check, Lock } from "lucide-react";

interface SituationCardProps {
  title: string;
  situationNumber: number;
  isCompleted: boolean;
  isLocked: boolean;
  onClick?: () => void;
}

export const SituationCard = ({ 
  title, 
  situationNumber,
  isCompleted, 
  isLocked,
  onClick 
}: SituationCardProps) => {
  return (
    <button
      onClick={onClick}
      disabled={isCompleted || isLocked}
      data-testid="situation-card-btn"
      className={cn(
        "w-full bg-card border border-border p-4 rounded-xl transition-all duration-200 text-left group min-h-[72px]",
        "active:bg-white/[0.06] active:scale-[0.98]",
        !isCompleted && !isLocked && "border-l-2 border-l-primary",
        isCompleted && "opacity-60",
        isLocked && "opacity-40 cursor-not-allowed"
      )}
    >
      <div className="flex items-center gap-3">
        {/* Situation number */}
        <div className={cn(
          "w-10 h-10 shrink-0 rounded-lg flex items-center justify-center text-sm font-semibold",
          isCompleted 
            ? "bg-primary/20 text-primary"
            : isLocked
            ? "bg-muted text-muted-foreground"
            : "bg-primary/10 text-primary"
        )}>
          {situationNumber}
        </div>
        
        <div className="flex-1 min-w-0">
          <h3 className={cn(
            "font-medium text-sm leading-snug line-clamp-2 min-h-[2.5em]",
            isCompleted ? "text-muted-foreground line-through" : "text-foreground"
          )}>
            {title}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {isCompleted ? "Done" : isLocked ? "Locked" : "Tap to capture"}
          </p>
        </div>
        
        <div className={cn(
          "w-10 h-10 rounded-full flex items-center justify-center transition-all",
          isCompleted 
            ? "bg-primary/20 text-primary" 
            : isLocked
            ? "bg-muted text-muted-foreground"
            : "bg-secondary text-foreground group-active:bg-primary group-active:text-primary-foreground group-active:glow-primary"
        )}>
          {isCompleted ? (
            <Check className="w-5 h-5" />
          ) : isLocked ? (
            <Lock className="w-4 h-4" />
          ) : (
            <Camera className="w-5 h-5" />
          )}
        </div>
      </div>
    </button>
  );
};
