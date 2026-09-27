import { useState, useRef, useCallback, useEffect } from "react";

export type CameraFacing = "user" | "environment";

interface UseCameraReturn {
  videoRef: React.RefObject<HTMLVideoElement>;
  isActive: boolean;
  error: string | null;
  cameraFacing: CameraFacing;
  startCamera: () => Promise<void>;
  stopCamera: () => void;
  switchCamera: () => Promise<void>;
  capturePhoto: () => Blob | null;
}

export function useCamera(): UseCameraReturn {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  
  const [isActive, setIsActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cameraFacing, setCameraFacing] = useState<CameraFacing>("environment");

  // Create canvas once
  useEffect(() => {
    canvasRef.current = document.createElement("canvas");
  }, []);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsActive(false);
  }, []);

  const startCamera = useCallback(async () => {
    try {
      setError(null);
      
      // Stop any existing stream
      stopCamera();

      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: cameraFacing,
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      setIsActive(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Camera error";
      if (message.includes("Permission denied") || message.includes("NotAllowedError")) {
        setError("Camera permission denied. Please allow camera access in your browser settings.");
      } else if (message.includes("NotFoundError")) {
        setError("No camera found on this device.");
      } else {
        setError(`Camera error: ${message}`);
      }
      setIsActive(false);
    }
  }, [cameraFacing, stopCamera]);

  const switchCamera = useCallback(async () => {
    const newFacing = cameraFacing === "user" ? "environment" : "user";
    setCameraFacing(newFacing);
    
    if (isActive) {
      stopCamera();
      // Small delay before restarting with new facing
      setTimeout(async () => {
        try {
          const constraints: MediaStreamConstraints = {
            video: {
              facingMode: newFacing,
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
            audio: false,
          };

          const stream = await navigator.mediaDevices.getUserMedia(constraints);
          streamRef.current = stream;

          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            await videoRef.current.play();
          }

          setIsActive(true);
        } catch (err) {
          setError("Failed to switch camera");
        }
      }, 100);
    }
  }, [cameraFacing, isActive, stopCamera]);

  const capturePhoto = useCallback((): Blob | null => {
    if (!videoRef.current || !canvasRef.current || !isActive) {
      return null;
    }

    const video = videoRef.current;
    const canvas = canvasRef.current;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    // Mirror image for front camera
    if (cameraFacing === "user") {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }

    ctx.drawImage(video, 0, 0);

    // Convert to blob
    const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
    const byteString = atob(dataUrl.split(",")[1]);
    const mimeString = dataUrl.split(",")[0].split(":")[1].split(";")[0];
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) {
      ia[i] = byteString.charCodeAt(i);
    }
    return new Blob([ab], { type: mimeString });
  }, [isActive, cameraFacing]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  return {
    videoRef,
    isActive,
    error,
    cameraFacing,
    startCamera,
    stopCamera,
    switchCamera,
    capturePhoto,
  };
}
