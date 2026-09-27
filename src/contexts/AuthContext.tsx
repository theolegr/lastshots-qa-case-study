import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  /** Non-null once anonymous sign-in has failed every attempt. See IA-007. */
  error: Error | null;
  /** Discard the failed bootstrap and start a fresh one. */
  retry: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/**
 * Sign-in retry budget, deliberately the same shape as `createAnonClient` in
 * `tests/e2e/fixtures/party.fixture.ts`: three attempts, backoff `attempt × 2s`,
 * then a named failure. The fixture adopted it because Supabase rate-limits
 * anonymous sign-ins under load; a player behind a shared IP hits the same wall,
 * so the app should not be less patient than its own test harness.
 */
const SIGN_IN_ATTEMPTS = 3;
const SIGN_IN_BACKOFF_MS = 2_000;

/**
 * The in-flight bootstrap, shared by every caller.
 *
 * Module-scoped rather than a ref, because the callers that race here are two
 * *different* invocations of the same effect: React StrictMode mounts, runs the
 * effect, cleans up and runs it again, and in a development build both runs are
 * live at once. Without this, each one saw `getSession()` return null and each
 * called `signInAnonymously()` — two anonymous identities minted per cold page
 * load, with `localStorage` keeping whichever settled last. That is IA-002
 * ("each session shall be associated with exactly one user identity") violated
 * on every cold load, and it is BUG-009.
 *
 * Invisible in production, where StrictMode does not double-invoke effects — but
 * the E2E suite is served the development build, so the system under test broke
 * the requirement its own `auth-flow.spec.ts` verifies. The failures were read
 * as CI flakiness for three weeks, and filed with the infrastructure noise.
 *
 * Cleared on failure so `retry()` — and any later mount — starts a fresh attempt
 * rather than inheriting a rejected promise for the life of the tab.
 */
let authBootstrap: Promise<Session | null> | null = null;

function bootstrapAuth(): Promise<Session | null> {
  authBootstrap ??= (async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) return session;

    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= SIGN_IN_ATTEMPTS; attempt++) {
      const { data, error } = await supabase.auth.signInAnonymously();
      if (!error) return data.session;

      lastError = error;
      if (attempt < SIGN_IN_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, attempt * SIGN_IN_BACKOFF_MS));
      }
    }

    throw lastError ?? new Error("Anonymous sign-in failed");
  })().catch((error: Error) => {
    authBootstrap = null;
    throw error;
  });

  return authBootstrap;
}

export function AuthContextProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  // Bumped by `retry()`; re-runs the effect below against a cleared bootstrap.
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        if (session || event === 'SIGNED_OUT') {
          setLoading(false);
        }
      }
    );

    let cancelled = false;
    setError(null);
    setLoading(true);

    bootstrapAuth()
      .then((session) => {
        if (cancelled) return;
        if (session) {
          setSession(session);
          setUser(session.user);
        }
        setLoading(false);
      })
      .catch((bootstrapError: Error) => {
        if (cancelled) return;
        // Surfaced through the context rather than only logged: a player whose
        // sign-in is refused used to sit on an indefinite skeleton with nothing
        // to read and nothing to press (IA-007, BUG-010).
        console.error("Anonymous sign-in failed:", bootstrapError);
        setError(bootstrapError);
        setLoading(false);
      });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [attempt]);

  return (
    <AuthContext.Provider value={{ user, session, loading, error, retry }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuthContext() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuthContext must be used within an AuthContextProvider");
  }
  return context;
}
