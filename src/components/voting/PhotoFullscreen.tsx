import { useEffect, useState, useRef } from "react";
import { X, Heart } from "lucide-react";
import { cn } from "@/lib/utils";
import { Photo } from "@/lib/api";

interface PhotoFullscreenProps {
  photo: Photo;
  participantName: string;
  isVoted: boolean;
  canVote: boolean;
  onClose: () => void;
  onToggleVote: () => void;
}

export const PhotoFullscreen = ({
  photo,
  participantName,
  isVoted,
  canVote,
  onClose,
  onToggleVote,
}: PhotoFullscreenProps) => {
  const [showHeartAnimation, setShowHeartAnimation] = useState(false);
  const lastTapRef = useRef<number>(0);
  const startYRef = useRef<number>(0);
  const currentYRef = useRef<number>(0);
  const [translateY, setTranslateY] = useState(0);

  const handleDoubleTap = () => {
    const now = Date.now();
    const DOUBLE_TAP_DELAY = 300;

    if (now - lastTapRef.current < DOUBLE_TAP_DELAY) {
      // Double tap detected
      if (canVote || isVoted) {
        onToggleVote();
        if (!isVoted) {
          // Only show animation when adding a vote
          setShowHeartAnimation(true);
          setTimeout(() => setShowHeartAnimation(false), 800);
        }
      }
      lastTapRef.current = 0;
    } else {
      lastTapRef.current = now;
    }
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    startYRef.current = e.touches[0].clientY;
    currentYRef.current = e.touches[0].clientY;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    currentYRef.current = e.touches[0].clientY;
    const diff = currentYRef.current - startYRef.current;
    if (diff > 0) {
      setTranslateY(diff);
    }
  };

  const handleTouchEnd = () => {
    const diff = currentYRef.current - startYRef.current;
    if (diff > 100) {
      // Swipe down threshold reached
      onClose();
    } else {
      setTranslateY(0);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const captureTime = new Date(photo.captured_at).toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div 
      className="fixed inset-0 z-50 bg-black/95 flex flex-col"
      style={{ transform: `translateY(${translateY}px)`, opacity: 1 - translateY / 400 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4">
        <button
          onClick={onClose}
          className="p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
          data-testid="photo-fullscreen-close-btn"
        >
          <X className="w-6 h-6 text-white" />
        </button>
        
        <div className={cn(
          "flex items-center gap-2 px-3 py-1.5 rounded-full transition-colors",
          isVoted ? "bg-red-500/20 text-red-400" : "bg-white/10 text-white/60"
        )}>
          <Heart className={cn("w-4 h-4", isVoted && "fill-current")} />
          <span className="text-sm">{isVoted ? "Favorited" : "Double-tap to vote"}</span>
        </div>
      </div>

      {/* Photo */}
      <div
        className="flex-1 flex items-center justify-center p-4 relative"
        onClick={handleDoubleTap}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        data-testid="photo-fullscreen-vote-area"
      >
        <img
          src={photo.image_url}
          alt="Party photo"
          className="max-w-full max-h-full object-contain rounded-lg"
          draggable={false}
        />

        {/* Heart animation */}
        {showHeartAnimation && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <Heart className="w-24 h-24 text-red-500 fill-red-500 animate-ping" />
          </div>
        )}
      </div>

      {/* Footer info */}
      <div className="p-4 text-center">
        <p className="text-white font-medium">{participantName}</p>
        <p className="text-white/60 text-sm">{captureTime}</p>
      </div>

      {/* Swipe hint */}
      <div className="pb-8 text-center">
        <p className="text-white/40 text-xs">Swipe down to close</p>
      </div>
    </div>
  );
};
