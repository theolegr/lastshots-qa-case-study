import { cn } from "@/lib/utils";
import { Camera } from "lucide-react";

interface ShotIndicatorProps {
  totalShots: number;
  usedShots: number;
}

export const ShotIndicator = ({ totalShots, usedShots }: ShotIndicatorProps) => {
  const remainingShots = totalShots - usedShots;
  
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex gap-2">
        {Array.from({ length: totalShots }).map((_, index) => {
          const isUsed = index < usedShots;
          return (
            <div
              key={index}
              className={cn(
                "w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300",
                isUsed
                  ? "bg-muted opacity-40 scale-90"
                  : "bg-primary glow-primary"
              )}
            >
              <Camera 
                className={cn(
                  "w-5 h-5 transition-all",
                  isUsed ? "text-muted-foreground" : "text-primary-foreground"
                )} 
              />
            </div>
          );
        })}
      </div>
      <p className="text-sm font-medium text-muted-foreground">
        <span className="text-primary font-bold text-lg">{remainingShots}</span> shots remaining
      </p>
    </div>
  );
};
