import { useState, useRef } from "react";
import { ChevronDown, ChevronRight, Heart } from "lucide-react";
import { Photo, Situation } from "@/lib/api";
import { cn } from "@/lib/utils";

interface SituationAccordionProps {
  situation: Situation;
  situationNumber: number;
  photos: Photo[];
  currentParticipantId: string;
  votedPhotoIds: Set<string>;
  canVote: boolean;
  onPhotoClick: (photo: Photo) => void;
  onToggleVote: (photo: Photo) => void;
  getParticipantName: (participantId: string) => string;
}

const DOUBLE_TAP_DELAY = 300;

export const SituationAccordion = ({
  situation,
  situationNumber,
  photos,
  currentParticipantId,
  votedPhotoIds,
  canVote,
  onPhotoClick,
  onToggleVote,
  getParticipantName,
}: SituationAccordionProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [animatingPhotoId, setAnimatingPhotoId] = useState<string | null>(null);
  
  // Track last tap time per photo for double-tap detection
  const lastTapRef = useRef<Map<string, number>>(new Map());
  const tapTimeoutRef = useRef<Map<string, NodeJS.Timeout>>(new Map());

  // Filter out the current user's photos - no self-voting allowed
  const votablePhotos = photos.filter(p => p.participant_id !== currentParticipantId);

  // Don't render the accordion if there are no votable photos for this user
  if (votablePhotos.length === 0) {
    return null;
  }

  const handlePhotoTap = (photo: Photo) => {
    const now = Date.now();
    const lastTap = lastTapRef.current.get(photo.id) || 0;
    const isVoted = votedPhotoIds.has(photo.id);

    // Clear any pending single-tap timeout for this photo
    const existingTimeout = tapTimeoutRef.current.get(photo.id);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
      tapTimeoutRef.current.delete(photo.id);
    }

    if (now - lastTap < DOUBLE_TAP_DELAY) {
      // Double tap detected → toggle vote
      if (canVote || isVoted) {
        onToggleVote(photo);
        
        // Show heart animation only when adding vote
        if (!isVoted) {
          setAnimatingPhotoId(photo.id);
          setTimeout(() => setAnimatingPhotoId(null), 800);
        }
      }
      // Reset tap tracking
      lastTapRef.current.set(photo.id, 0);
    } else {
      // First tap → wait for possible second tap
      lastTapRef.current.set(photo.id, now);
      
      const timeout = setTimeout(() => {
        // No second tap → open fullscreen
        if (lastTapRef.current.get(photo.id) === now) {
          onPhotoClick(photo);
        }
        tapTimeoutRef.current.delete(photo.id);
      }, DOUBLE_TAP_DELAY);
      
      tapTimeoutRef.current.set(photo.id, timeout);
    }
  };

  return (
    <div
      className="border border-border rounded-lg overflow-hidden bg-card"
      data-testid="situation-accordion"
    >
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-4 hover:bg-muted transition-colors"
        data-testid="situation-accordion-header-btn"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <span className="text-sm font-semibold text-primary">{situationNumber}</span>
          </div>
          <div className="text-left">
            <h3 className="font-medium text-foreground text-sm">{situation.title}</h3>
            <p className="text-xs text-muted-foreground">{votablePhotos.length} photos</p>
          </div>
        </div>
        {isOpen ? (
          <ChevronDown className="w-4 h-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
        )}
      </button>

      {isOpen && (
        <div className="p-3 pt-0">
          <div className="grid grid-cols-2 gap-2">
            {votablePhotos.map((photo) => {
              const isVoted = votedPhotoIds.has(photo.id);
              const isAnimating = animatingPhotoId === photo.id;
              
              return (
                <button
                  key={photo.id}
                  onClick={() => handlePhotoTap(photo)}
                  className="relative aspect-square rounded-lg overflow-hidden group"
                  data-testid="situation-accordion-photo-btn"
                >
                  <img
                    src={photo.image_url}
                    alt="Party photo"
                    className="w-full h-full object-cover"
                  />
                  
                  {/* Voted indicator */}
                  {isVoted && (
                    <div className="absolute top-2 right-2 bg-primary text-primary-foreground rounded-full p-1">
                      <Heart className="w-3 h-3 fill-current" />
                    </div>
                  )}
                  
                  {/* Heart animation on double-tap */}
                  {isAnimating && (
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <Heart className={cn(
                        "w-16 h-16 text-primary fill-primary animate-ping"
                      )} />
                    </div>
                  )}
                  
                  {/* Photographer name overlay */}
                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent py-2 px-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <span className="text-xs text-white">
                      {getParticipantName(photo.participant_id)}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
