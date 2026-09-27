import { useCallback, useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Camera, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface QRScannerProps {
  open: boolean;
  onClose: () => void;
  onScan: (code: string) => void;
}

export const QRScanner = ({ open, onClose, onScan }: QRScannerProps) => {
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanSuccess, setScanSuccess] = useState(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const isMountedRef = useRef(false);

  // `onScan` / `onClose` are read through refs rather than closed over, so that
  // `startScanner` can have a stable identity and sit in the effect's
  // dependency list honestly.
  //
  // The alternative — depending on the props directly — would restart the
  // camera every time the parent re-renders, since `JoinParty` passes inline
  // arrow functions whose identity changes on each render. Refs keep the
  // effect keyed on `open` alone (its actual trigger) while the callback still
  // invokes the *latest* props rather than the ones captured when the scanner
  // started.
  const onScanRef = useRef(onScan);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onScanRef.current = onScan;
    onCloseRef.current = onClose;
  });

  const stopScanner = useCallback(async () => {
    if (scannerRef.current) {
      try {
        const state = scannerRef.current.getState();
        if (state === 2) { // SCANNING state
          await scannerRef.current.stop();
        }
        scannerRef.current.clear();
      } catch (err) {
        // Ignore stop errors
      }
      scannerRef.current = null;
    }
    setIsScanning(false);
  }, []);

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      stopScanner();
    };
  }, [stopScanner]);

  const startScanner = useCallback(async () => {
    const container = document.getElementById("qr-reader");
    if (!container) {
      console.error("QR reader container not found");
      setError("Scanner initialization failed");
      return;
    }

    // Clear any previous content
    container.innerHTML = "";

    try {
      setError(null);

      const scanner = new Html5Qrcode("qr-reader");
      scannerRef.current = scanner;

      await scanner.start(
        { facingMode: "environment" },
        {
          fps: 10,
          qrbox: { width: 250, height: 250 },
        },
        (decodedText) => {
          // Check if it's a valid Last Shots QR code
          if (decodedText.startsWith("LASTSHOTS:")) {
            const code = decodedText.replace("LASTSHOTS:", "");
            if (/^\d{6}$/.test(code)) {
              stopScanner();
              setScanSuccess(true);
              
              // 1 second delay before closing
              setTimeout(() => {
                if (isMountedRef.current) {
                  onScanRef.current(code);
                  onCloseRef.current();
                  toast.success("QR Code scanned! 📸");
                }
              }, 1000);
            }
          } else {
            // Not a valid Last Shots QR code
            toast.error("Invalid QR code. Please scan a Last Shots code.");
          }
        },
        () => {
          // Ignore errors during scanning (no QR found yet)
        }
      );
      
      if (isMountedRef.current) {
        setIsScanning(true);
      }
    } catch (err) {
      console.error("Failed to start scanner:", err);
      if (isMountedRef.current) {
        setError("Camera access denied or not available. Please allow camera access.");
        setIsScanning(false);
      }
    }
  }, [stopScanner]);

  // Declared after `startScanner` on purpose: naming it in the dependency array
  // evaluates during render, so an effect placed above the `const` would hit the
  // temporal dead zone.
  useEffect(() => {
    if (open) {
      setScanSuccess(false);
      // Delay to ensure DOM is ready after dialog animation
      const timer = setTimeout(() => {
        if (isMountedRef.current) {
          startScanner();
        }
      }, 500);

      return () => clearTimeout(timer);
    } else {
      stopScanner();
    }
  }, [open, startScanner, stopScanner]);

  const handleClose = () => {
    stopScanner();
    onClose();
  };

  const handleRetry = () => {
    setError(null);
    startScanner();
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
      <DialogContent className="sm:max-w-md p-0 overflow-hidden">
        <DialogHeader className="p-4 pb-0">
          <DialogTitle>Scan QR Code</DialogTitle>
        </DialogHeader>
        
        <div className="relative">
          <div 
            id="qr-reader" 
            className="w-full aspect-square bg-black"
          />
          
          {scanSuccess && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/40">
              <Loader2 className="w-10 h-10 text-white animate-spin" />
            </div>
          )}
          
          {error && !scanSuccess && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-muted/90 p-6">
              <Camera className="w-12 h-12 text-muted-foreground mb-4" />
              <p className="text-center text-muted-foreground mb-4">{error}</p>
              <Button
                variant="outline"
                onClick={handleRetry}
                data-testid="qr-scanner-retry-btn"
              >
                Try Again
              </Button>
            </div>
          )}
          
          {!isScanning && !error && !scanSuccess && (
            <div className="absolute inset-0 flex items-center justify-center bg-muted/90">
              <div className="animate-pulse text-muted-foreground">
                Starting camera...
              </div>
            </div>
          )}
        </div>
        
        <div className="p-4 text-center">
          <p className="text-sm text-muted-foreground">
            Point your camera at a Last Shots QR code
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
};