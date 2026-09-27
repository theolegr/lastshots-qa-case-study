import { useRef, useState, useEffect } from "react";
import { Heart, Medal, Trophy, Download, Share2 } from "lucide-react";
import { PodiumResult } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import html2canvas from "html2canvas";
import {
  Sheet,
  SheetContent,
} from "@/components/ui/sheet";

interface PodiumShareableProps {
  results: PodiumResult[];
  partyName?: string;
}

const MEDAL_STYLES = {
  1: "text-yellow-500",
  2: "text-gray-400",
  3: "text-amber-600",
};

export const PodiumShareable = ({ results, partyName }: PodiumShareableProps) => {
  const podiumRef = useRef<HTMLDivElement>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedBlob, setGeneratedBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [showSharePreview, setShowSharePreview] = useState(false);

  // Cleanup preview URL on unmount
  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  if (results.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <p>No votes were cast</p>
      </div>
    );
  }

  // Reorder for visual podium: 2nd, 1st, 3rd
  const orderedResults = results.length >= 3 
    ? [results[1], results[0], results[2]] 
    : results;

  const generateImage = async (): Promise<Blob | null> => {
    if (!podiumRef.current) return null;
    
    try {
      const canvas = await html2canvas(podiumRef.current, {
        backgroundColor: "#000000",
        scale: 2,
        useCORS: true,
        allowTaint: true,
      });
      
      return new Promise((resolve) => {
        canvas.toBlob((blob) => {
          resolve(blob);
        }, "image/png");
      });
    } catch (error) {
      console.error("Failed to generate image:", error);
      return null;
    }
  };

  const downloadBlob = (blob: Blob) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `lastshots-podium-${Date.now()}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success("Podium downloaded!");
  };

  const handleDownload = async () => {
    setIsGenerating(true);
    try {
      const blob = await generateImage();
      if (blob) {
        downloadBlob(blob);
      }
    } catch (error) {
      console.error("Download failed:", error);
      toast.error("Failed to download podium");
    } finally {
      setIsGenerating(false);
    }
  };

  const handlePrepareShare = async () => {
    setIsGenerating(true);
    try {
      const blob = await generateImage();
      if (blob) {
        // Cleanup previous preview URL
        if (previewUrl) {
          URL.revokeObjectURL(previewUrl);
        }
        const url = URL.createObjectURL(blob);
        setGeneratedBlob(blob);
        setPreviewUrl(url);
        setShowSharePreview(true);
      }
    } catch (error) {
      console.error("Failed to generate image:", error);
      toast.error("Failed to generate image");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleConfirmShare = async () => {
    if (!generatedBlob) return;

    try {
      const file = new File([generatedBlob], "lastshots-podium.png", { type: "image/png" });
      const shareData = { files: [file], title: partyName ? `${partyName} - Podium` : "LastShots Podium" };

      if (navigator.share && navigator.canShare?.(shareData)) {
        await navigator.share(shareData);
        toast.success("Shared!");
      } else {
        // Fallback: download
        downloadBlob(generatedBlob);
      }
    } catch (error) {
      if ((error as Error).name !== "AbortError") {
        // If sharing fails, fallback to download
        downloadBlob(generatedBlob);
      }
    }
    setShowSharePreview(false);
    setGeneratedBlob(null);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
  };

  const handleClosePreview = () => {
    setShowSharePreview(false);
    setGeneratedBlob(null);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
  };

  return (
    <div className="mb-8">
      {/* Share buttons */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
          <Trophy className="w-5 h-5 text-yellow-500" />
          Podium
        </h2>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDownload}
            disabled={isGenerating}
            className="text-muted-foreground hover:text-foreground"
            data-testid="podium-save-btn"
          >
            <Download className="w-4 h-4 mr-1" />
            Save
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handlePrepareShare}
            disabled={isGenerating}
            className="text-muted-foreground hover:text-foreground"
            data-testid="podium-share-btn"
          >
            <Share2 className="w-4 h-4 mr-1" />
            Share
          </Button>
        </div>

        {/* Share Preview Sheet */}
        <Sheet open={showSharePreview} onOpenChange={handleClosePreview}>
          <SheetContent side="bottom" className="bg-card border-border">
            <div className="text-center py-4">
              <p className="text-sm text-muted-foreground mb-4">Image ready to share</p>
              {previewUrl && (
                <img 
                  src={previewUrl} 
                  alt="Preview" 
                  className="max-h-48 mx-auto rounded-lg mb-4 border border-border"
                />
              )}
              <div className="flex gap-2 justify-center">
                <Button variant="outline" onClick={handleClosePreview} data-testid="podium-share-cancel-btn">
                  Cancel
                </Button>
                <Button onClick={handleConfirmShare} data-testid="podium-share-now-btn">
                  <Share2 className="w-4 h-4 mr-2" />
                  Share Now
                </Button>
              </div>
            </div>
          </SheetContent>
        </Sheet>
      </div>
      
      {/* Shareable podium card */}
      <div 
        ref={podiumRef}
        className="bg-card border border-border rounded-xl p-6"
      >
        {/* Party name */}
        {partyName && (
          <p className="text-center text-muted-foreground text-sm mb-4">
            {partyName}
          </p>
        )}
        
        <div className={cn(
          "flex items-end justify-center gap-3",
          results.length === 1 && "justify-center",
          results.length === 2 && "justify-center"
        )}>
          {orderedResults.map((result, visualIndex) => {
            const heights: Record<number, string> = { 
              1: "h-40",
              2: "h-32",
              3: "h-24"
            };
            
            return (
              <div
                key={result.photo.id}
                data-testid={`podium-entry-${result.position}`}
                className={cn(
                  "flex flex-col items-center",
                  results.length >= 3 && visualIndex === 1 && "order-2",
                  results.length >= 3 && visualIndex === 0 && "order-1",
                  results.length >= 3 && visualIndex === 2 && "order-3",
                )}
              >
                {/* Medal and photo */}
                <div className="relative mb-2">
                  <div className={cn(
                    "absolute -top-2 -right-2 z-10 w-7 h-7 rounded-full bg-card border border-border flex items-center justify-center",
                    MEDAL_STYLES[result.position as keyof typeof MEDAL_STYLES]
                  )}>
                    <Medal className="w-4 h-4" />
                  </div>
                  <img
                    src={result.photo.image_url}
                    alt={`${result.position} place`}
                    className={cn(
                      "w-24 object-cover rounded-lg border border-border",
                      heights[result.position]
                    )}
                    crossOrigin="anonymous"
                  />
                </div>
                
                {/* Info */}
                <div className="text-center">
                  <p className="font-medium text-foreground text-sm truncate max-w-24">
                    {result.participantName}
                  </p>
                  <div className="flex items-center justify-center gap-1 text-muted-foreground">
                    <Heart className="w-3 h-3" />
                    <span className="text-xs">{result.voteCount}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        
        {/* Branding — a wordmark, not a URL. The Lovable deployment this used
            to point at is being decommissioned, and a dead link baked into an
            image players share is worse than no link at all.

            The opacity modifier that used to sit here (`/50`) put this at
            #474747 on #0d0d0d — a contrast ratio of 2.09:1 against the 4.5:1
            WCAG AA floor, caught by `a11y-phases.spec.ts`. It was reaching for
            "discreet" and landing on "illegible", and not only for low-vision
            users: at that ratio the wordmark disappears on a phone in daylight,
            which is the one place this image is ever looked at. The base muted
            foreground is discreet enough and clears the floor. */}
        <p className="text-center text-muted-foreground text-xs mt-4">
          LastShots
        </p>
      </div>
    </div>
  );
};
