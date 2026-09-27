import { ReactNode } from "react";
import { useAuth } from "@/hooks/useAuth";
import { PageSkeleton } from "@/components/PageSkeleton";
import { AuthErrorScreen } from "@/components/AuthErrorScreen";

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const { loading, user, error, retry } = useAuth();

  // Ordered before the skeleton on purpose. `user` is null in both states, so a
  // `loading || !user` check alone cannot tell "still signing in" from "sign-in
  // failed" — and rendered the skeleton forever for the second (IA-007,
  // BUG-010).
  if (error && !user) {
    return <AuthErrorScreen onRetry={retry} />;
  }

  if (loading || !user) {
    return <PageSkeleton />;
  }

  return <>{children}</>;
}
