import { lazy, Suspense } from "react";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/components/AuthProvider";
import { AuthContextProvider } from "@/contexts/AuthContext";
import { PageSkeleton } from "@/components/PageSkeleton";
import Home from "./pages/Home";

// Lazy-loaded pages
const CreateParty = lazy(() => import("./pages/CreateParty"));
const JoinParty = lazy(() => import("./pages/JoinParty"));
const PartyLobby = lazy(() => import("./pages/PartyLobby"));
const CaptureMode = lazy(() => import("./pages/CaptureMode"));
const Vote = lazy(() => import("./pages/Vote"));
const Results = lazy(() => import("./pages/Results"));
const NotFound = lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60,
      refetchOnWindowFocus: false,
    },
  },
});

function AppContent() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <div className="max-w-[430px] mx-auto min-h-screen">
          <Suspense fallback={<PageSkeleton />}>
            <Routes>
              {/* Home is the only eagerly-loaded page: it is the landing route,
                  so lazy-loading it would only add a round trip before first paint. */}
              <Route path="/" element={<Home />} />
              <Route path="/create" element={<CreateParty />} />
              <Route path="/join" element={<JoinParty />} />
              <Route path="/lobby/:code" element={<PartyLobby />} />
              <Route path="/capture/:code" element={<CaptureMode />} />
              <Route path="/vote/:code" element={<Vote />} />
              <Route path="/results/:code" element={<Results />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </div>
      </BrowserRouter>
    </AuthProvider>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthContextProvider>
      {/* Single toast viewport for the whole app. */}
      <Sonner />
      <AppContent />
    </AuthContextProvider>
  </QueryClientProvider>
);

export default App;
