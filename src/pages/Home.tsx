import { Button } from "@/components/ui/button";
import { Sparkles, Users, PlusCircle, QrCode, Camera } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { YourParties, EndedParties } from "@/components/YourParties";
import { useUserParties } from "@/hooks/useUserParties";

const Home = () => {
  const navigate = useNavigate();
  const { parties, loading } = useUserParties();

  return (
    <div className="min-h-screen flex flex-col px-6 py-8">
      {/* Header */}
      <div className="flex-1 flex flex-col items-center justify-center text-center">
        {/* Hero Title */}
        <div className="mb-2">
          <h1 className="text-[4.5rem] leading-[0.85] font-black italic uppercase tracking-tight text-foreground">
            LAST<span className="text-primary">.</span>
            <br />
            SHOTS<span className="text-primary">.</span>
          </h1>
        </div>
        <p className="text-base text-muted-foreground tracking-widest uppercase mt-4">
          Capture the night. Reveal later.
        </p>

        {/* Features - Glass pills */}
        <div className="flex gap-3 mt-10 mb-12">
          {[
            { icon: Camera, label: "5 Shots" },
            { icon: Sparkles, label: "Challenges" },
            { icon: Users, label: "Vote" },
          ].map(({ icon: Icon, label }) => (
            <div key={label} className="glass flex items-center gap-2 px-4 py-2 rounded-full">
              <Icon className="w-4 h-4 text-primary" />
              <span className="text-xs text-foreground/80">{label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="space-y-4 pb-8 animate-slide-up-fade">
        <Button
          size="xl"
          className="w-full rounded-full bg-gradient-to-r from-primary to-accent shadow-lg shadow-primary/25"
          onClick={() => navigate("/create")}
          data-testid="home-create-party-btn"
        >
          Create a Party
          <PlusCircle className="w-5 h-5" />
        </Button>
        <Button
          variant="outline"
          size="xl"
          className="w-full rounded-full bg-foreground text-background border-0 hover:bg-foreground/90 hover:text-background"
          onClick={() => navigate("/join")}
          data-testid="home-join-party-btn"
        >
          Join with Code
          <QrCode className="w-5 h-5" />
        </Button>

        {/* Parties Section */}
        <YourParties parties={parties} loading={loading} />
        <EndedParties parties={parties} loading={loading} />
      </div>
    </div>
  );
};

export default Home;
