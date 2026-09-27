import { useEffect, useState, useRef } from "react";
import { Lock } from "lucide-react";

interface CountdownTimerProps {
  targetDate: Date;
  onComplete?: () => void;
  compact?: boolean;
}

export const CountdownTimer = ({ targetDate, onComplete, compact = false }: CountdownTimerProps) => {
  const [timeLeft, setTimeLeft] = useState({
    hours: 0,
    minutes: 0,
    seconds: 0,
  });
  
  const hasCompletedRef = useRef(false);

  useEffect(() => {
    hasCompletedRef.current = false;
    
    const calculateTimeLeft = () => {
      const difference = targetDate.getTime() - new Date().getTime();
      
      if (difference <= 0) {
        if (!hasCompletedRef.current && onComplete) {
          hasCompletedRef.current = true;
          onComplete();
        }
        return { hours: 0, minutes: 0, seconds: 0 };
      }

      return {
        hours: Math.floor(difference / (1000 * 60 * 60)),
        minutes: Math.floor((difference / (1000 * 60)) % 60),
        seconds: Math.floor((difference / 1000) % 60),
      };
    };

    setTimeLeft(calculateTimeLeft());
    
    const timer = setInterval(() => {
      setTimeLeft(calculateTimeLeft());
    }, 1000);

    return () => clearInterval(timer);
  }, [targetDate, onComplete]);

  const formatNumber = (num: number) => num.toString().padStart(2, "0");

  if (compact) {
    return (
      <span className="font-mono text-foreground" data-testid="countdown-timer">
        {formatNumber(timeLeft.hours)}:{formatNumber(timeLeft.minutes)}:{formatNumber(timeLeft.seconds)}
      </span>
    );
  }

  const progress = Math.max(0, Math.min(100, 
    ((24 * 60 * 60 * 1000 - (targetDate.getTime() - new Date().getTime())) / (24 * 60 * 60 * 1000)) * 100
  ));

  return (
    <div className="flex flex-col items-center gap-6" data-testid="countdown-timer">
      <div className="relative w-48 h-48">
        <svg className="w-full h-full" viewBox="0 0 100 100">
          <circle
            cx="50"
            cy="50"
            r="45"
            fill="none"
            stroke="hsl(var(--muted))"
            strokeWidth="6"
          />
          <circle
            cx="50"
            cy="50"
            r="45"
            fill="none"
            stroke="url(#gradient)"
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray="283"
            strokeDashoffset={283 - (283 * progress) / 100}
            className="countdown-ring"
          />
          <defs>
            <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="hsl(var(--primary))" />
              <stop offset="100%" stopColor="hsl(var(--accent))" />
            </linearGradient>
          </defs>
        </svg>
        
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <Lock className="w-8 h-8 text-primary mb-2" />
          <span className="text-xs text-muted-foreground uppercase tracking-wider">
            Unlocks in
          </span>
        </div>
      </div>

      {/* Time display - glass style */}
      <div className="flex gap-4 text-center">
        {[
          { value: formatNumber(timeLeft.hours), label: "HRS" },
          { value: formatNumber(timeLeft.minutes), label: "MIN" },
          { value: formatNumber(timeLeft.seconds), label: "SEC" },
        ].map(({ value, label }) => (
          <div key={label} className="glass px-5 py-3 rounded-xl min-w-[70px]">
            <span className="text-3xl font-bold text-primary">
              {value}
            </span>
            <p className="text-xs text-muted-foreground mt-1">{label}</p>
          </div>
        ))}
      </div>
    </div>
  );
};
