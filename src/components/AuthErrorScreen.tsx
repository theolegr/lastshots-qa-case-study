import { WifiOff, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface AuthErrorScreenProps {
  onRetry: () => void;
}

/**
 * What a player sees when anonymous sign-in cannot be provisioned (IA-007).
 *
 * Before this existed, `AuthProvider` fell through to `PageSkeleton` whenever
 * `user` was null — including when sign-in had already failed for good. The
 * result was an indefinite loading state with no text, no error and no control:
 * BUG-010, the same shape as BUG-008 one layer lower.
 */
export function AuthErrorScreen({ onRetry }: AuthErrorScreenProps) {
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-6 py-8 text-center"
      data-testid="auth-error-screen"
    >
      <div className="glass w-16 h-16 rounded-full flex items-center justify-center mb-6">
        <WifiOff className="w-7 h-7 text-primary" />
      </div>

      <h1 className="text-2xl font-black italic uppercase tracking-tight text-foreground">
        Couldn't sign you in
      </h1>

      <p className="text-sm text-muted-foreground mt-3 max-w-xs">
        Last Shots needs an anonymous session before you can create or join a party.
        We tried three times and the server kept refusing — usually that clears within
        a minute.
      </p>

      <Button
        size="lg"
        className="w-full max-w-xs rounded-full bg-gradient-to-r from-primary to-accent shadow-lg shadow-primary/25 mt-8"
        onClick={onRetry}
        data-testid="auth-error-retry-btn"
      >
        Try again
        <RotateCw className="w-5 h-5" />
      </Button>
    </div>
  );
}
