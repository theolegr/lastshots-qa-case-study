import { cn } from "@/lib/utils";
import { Crown } from "lucide-react";

interface ParticipantAvatarProps {
  name: string;
  isHost?: boolean;
  size?: "sm" | "md" | "lg";
}

const avatarColors = [
  "bg-violet-500/20 text-violet-400",
  "bg-blue-500/20 text-blue-400",
  "bg-emerald-500/20 text-emerald-400",
  "bg-amber-500/20 text-amber-400",
  "bg-rose-500/20 text-rose-400",
];

export const ParticipantAvatar = ({ 
  name,
  isHost = false,
  size = "md" 
}: ParticipantAvatarProps) => {
  const colorIndex = name.charCodeAt(0) % avatarColors.length;
  const initials = name.slice(0, 2).toUpperCase();
  
  const sizeClasses = {
    sm: "w-10 h-10 text-sm",
    md: "w-12 h-12 text-base",
    lg: "w-16 h-16 text-xl",
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <div className={cn(
        "relative rounded-full flex items-center justify-center font-semibold",
        avatarColors[colorIndex],
        sizeClasses[size],
        isHost && "ring-2 ring-primary ring-offset-2 ring-offset-background shadow-[0_0_12px_hsl(var(--primary)/0.3)]"
      )}>
        <span>{initials}</span>
        {isHost && (
          <div className="absolute -top-1 -right-1 w-5 h-5 bg-primary rounded-full flex items-center justify-center">
            <Crown className="w-3 h-3 text-primary-foreground" />
          </div>
        )}
      </div>
      <span className={cn(
        "text-muted-foreground truncate max-w-[80px] text-center",
        size === "sm" && "text-xs",
        size === "md" && "text-sm",
        size === "lg" && "text-base"
      )}>
        {name}
      </span>
    </div>
  );
};
