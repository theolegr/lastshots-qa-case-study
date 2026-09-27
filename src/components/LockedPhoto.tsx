import { Lock, ImageOff } from "lucide-react";
import { cn } from "@/lib/utils";

interface LockedPhotoProps {
  situation: string;
  situationNumber: number;
  photoCount?: number;
  isEmpty?: boolean;
}

export const LockedPhoto = ({ situation, situationNumber, photoCount, isEmpty }: LockedPhotoProps) => {
  return (
    <div className={cn(
      "aspect-square rounded-lg overflow-hidden relative",
      "bg-card border border-border",
      isEmpty && "opacity-50"
    )}>
      {/* Photo count badge */}
      {photoCount && photoCount > 1 && (
        <div className="absolute top-2 right-2 bg-background/80 backdrop-blur-sm px-2 py-1 rounded-md">
          <span className="text-xs text-foreground font-medium">+{photoCount - 1}</span>
        </div>
      )}
      
      {/* Content */}
      <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center">
        <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center mb-3">
          {isEmpty ? (
            <ImageOff className="w-4 h-4 text-muted-foreground" />
          ) : (
            <Lock className="w-4 h-4 text-muted-foreground" />
          )}
        </div>
        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center mb-2">
          <span className="text-sm font-semibold text-primary">{situationNumber}</span>
        </div>
        <p className="text-xs text-muted-foreground line-clamp-2">
          {isEmpty ? "No photo yet" : situation}
        </p>
      </div>
    </div>
  );
};
