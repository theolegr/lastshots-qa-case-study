import { useEffect, useState, useRef } from "react";
import { X, Download, Share2, Check } from "lucide-react";
import { Photo } from "@/lib/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

interface ResultsPhotoFullscreenProps {
  photo: Photo;
  participantName: string;
  situationTitle?: string;
  onClose: () => void;
}

export const ResultsPhotoFullscreen = ({
  photo,
  participantName,
  situationTitle,
  onClose,
}: ResultsPhotoFullscreenProps) => {
  const [isDownloading, setIsDownloading] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const startYRef = useRef<number>(0);
  const currentYRef = useRef<number>(0);
  const [translateY, setTranslateY] = useState(0);

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

  const handleDownload = async () => {
    setIsDownloading(true);
    try {
      const response = await fetch(photo.image_url);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `lastshots-${participantName.replace(/\s+/g, "-")}-${Date.now()}.jpg`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast.success("Photo downloaded!");
    } catch (error) {
      console.error("Download failed:", error);
      toast.error("Failed to download photo");
    } finally {
      setIsDownloading(false);
    }
  };

  const handleShare = async () => {
    setIsSharing(true);
    try {
      const response = await fetch(photo.image_url);
      const blob = await response.blob();
      const file = new File([blob], `lastshots-${participantName}.jpg`, { type: "image/jpeg" });
      const shareData = { files: [file], title: `Photo by ${participantName}` };

      // Check if file sharing is supported
      if (navigator.share && navigator.canShare?.(shareData)) {
        await navigator.share(shareData);
        toast.success("Shared!");
      } else if (navigator.share) {
        // Try sharing without file
        await navigator.share({
          title: `Photo by ${participantName}`,
          text: situationTitle ? `${situationTitle} - Photo by ${participantName}` : `Photo by ${participantName}`,
          url: photo.image_url,
        });
        toast.success("Shared!");
      } else {
        // Fallback: download directly
        toast.info("Sharing not available, downloading instead...");
        await handleDownload();
      }
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        // User cancelled - no action needed
      } else if ((error as Error).name === "NotAllowedError") {
        // Permission issue - fallback to download silently
        toast.info("Sharing not available, downloading instead...");
        await handleDownload();
      } else {
        console.error("Share failed:", error);
        toast.info("Sharing not available, downloading instead...");
        await handleDownload();
      }
    } finally {
      setIsSharing(false);
    }
  };

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
        >
          <X className="w-6 h-6 text-white" />
        </button>
        
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleDownload}
            disabled={isDownloading}
            className="text-white hover:bg-white/10"
          >
            {isDownloading ? (
              <Check className="w-5 h-5" />
            ) : (
              <Download className="w-5 h-5" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleShare}
            disabled={isSharing}
            className="text-white hover:bg-white/10"
          >
            <Share2 className="w-5 h-5" />
          </Button>
        </div>
      </div>

      {/* Photo */}
      <div 
        className="flex-1 flex items-center justify-center p-4 relative"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <img
          src={photo.image_url}
          alt="Party photo"
          className="max-w-full max-h-full object-contain rounded-lg"
          draggable={false}
        />
      </div>

      {/* Footer info */}
      <div className="p-4 text-center">
        {situationTitle && (
          <p className="text-white/60 text-sm mb-1">{situationTitle}</p>
        )}
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
