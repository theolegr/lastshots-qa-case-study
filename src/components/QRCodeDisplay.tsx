import { QRCodeSVG } from "qrcode.react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { QrCode } from "lucide-react";

interface QRCodeDisplayProps {
  partyCode: string;
}

export const QRCodeDisplay = ({ partyCode }: QRCodeDisplayProps) => {
  // Create a unique URL/value that includes the party code
  const qrValue = `LASTSHOTS:${partyCode}`;

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button className="w-12 h-12 rounded-xl bg-muted hover:bg-muted/80 flex items-center justify-center transition-colors" data-testid="qr-code-display-btn" aria-label="Show QR code to join">
          <QrCode className="w-5 h-5 text-muted-foreground" />
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-center">Scan to Join</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col items-center gap-6 py-6">
          <div className="p-4 bg-white rounded-2xl">
            <QRCodeSVG
              value={qrValue}
              size={200}
              level="H"
              includeMargin={false}
            />
          </div>
          <div className="text-center">
            <p className="text-sm text-muted-foreground mb-2">Or enter the code manually:</p>
            <p className="font-mono text-2xl tracking-[0.3em] font-bold text-primary">
              {partyCode}
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};