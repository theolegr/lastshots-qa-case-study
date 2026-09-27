import { Settings, Clock, Heart, Sparkles } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export interface PartySettings {
  captureHours: number;
  votingHours: number;
  maxSituations: number;
  maxVotes: number;
}

export const DEFAULT_PARTY_SETTINGS: PartySettings = {
  captureHours: 12,
  votingHours: 2,
  maxSituations: 5,
  maxVotes: 5,
};

const CAPTURE_OPTIONS = [
  { value: 3, label: "3h" },
  { value: 6, label: "6h" },
  { value: 12, label: "12h" },
  { value: 24, label: "24h" },
];

const VOTING_OPTIONS = [
  { value: 0.5, label: "30m" },
  { value: 1, label: "1h" },
  { value: 2, label: "2h" },
  { value: 6, label: "6h" },
];

const SITUATION_OPTIONS = [
  { value: 5, label: "5" },
  { value: 7, label: "7" },
  { value: 10, label: "10" },
];

// Deliberately independent of SITUATION_OPTIONS: a quota above the situation
// count is a legitimate configuration (several votes inside one situation), so
// the two settings are not constrained against each other. The DB agrees — the
// only bound is `max_votes > 0`.
const VOTE_OPTIONS = [
  { value: 5, label: "5" },
  { value: 7, label: "7" },
  { value: 10, label: "10" },
];

interface SegmentedProps<T extends number> {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  /**
   * Scopes this control for tests. Required rather than optional: two settings
   * now offer the same labels (situations and votes are both 5 / 7 / 10), so a
   * locator matching visible text alone resolves to two buttons across the
   * dialog. `party-settings.spec.ts` failed exactly that way when the votes
   * control was added.
   */
  testId: string;
}

const Segmented = <T extends number>({ options, value, onChange, testId }: SegmentedProps<T>) => (
  <div className="flex gap-1.5 p-1 rounded-full glass" data-testid={testId}>
    {options.map((opt) => {
      const isSelected = opt.value === value;
      return (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={cn(
            "flex-1 h-10 rounded-full text-sm font-semibold transition-all touch-target",
            "flex items-center justify-center min-w-[44px]",
            isSelected
              ? "bg-primary text-primary-foreground glow-primary"
              : "text-muted-foreground hover:text-foreground active:scale-95"
          )}
        >
          {opt.label}
        </button>
      );
    })}
  </div>
);

interface SettingBlockProps {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}

const SettingBlock = ({ icon, label, children }: SettingBlockProps) => (
  <div className="space-y-3">
    <div className="flex items-center gap-3">
      <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-primary">
        {icon}
      </div>
      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
    </div>
    {children}
  </div>
);

interface PartySettingsDrawerProps {
  settings: PartySettings;
  onChange: (settings: PartySettings) => void;
}

const PartySettingsDrawer = ({ settings, onChange }: PartySettingsDrawerProps) => {
  const set = <K extends keyof PartySettings>(key: K, value: PartySettings[K]) =>
    onChange({ ...settings, [key]: value });

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          className="flex items-center justify-center w-9 h-9 rounded-full text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
          data-testid="lobby-settings-btn"
          aria-label="Party settings"
        >
          <Settings className="w-5 h-5" />
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-sm w-[92vw] p-0 border-white/10 bg-card rounded-2xl overflow-hidden">
        <div className="p-6">
          <DialogHeader className="mb-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center glow-primary">
                <Settings className="w-5 h-5 text-primary" />
              </div>
              <DialogTitle className="text-lg font-bold uppercase tracking-tight">
                Settings
              </DialogTitle>
            </div>
          </DialogHeader>

          <div className="space-y-6">
            <SettingBlock icon={<Clock className="w-4 h-4" />} label="Capture window">
              <Segmented
                options={CAPTURE_OPTIONS}
                testId="settings-capture-hours"
                value={settings.captureHours}
                onChange={(v) => set("captureHours", v)}
              />
            </SettingBlock>

            <SettingBlock icon={<Heart className="w-4 h-4" />} label="Voting window">
              <Segmented
                options={VOTING_OPTIONS}
                testId="settings-voting-hours"
                value={settings.votingHours}
                onChange={(v) => set("votingHours", v)}
              />
            </SettingBlock>

            <SettingBlock icon={<Sparkles className="w-4 h-4" />} label="Situations">
              <Segmented
                options={SITUATION_OPTIONS}
                testId="settings-max-situations"
                value={settings.maxSituations}
                onChange={(v) => set("maxSituations", v)}
              />
            </SettingBlock>

            <SettingBlock icon={<Heart className="w-4 h-4" />} label="Votes per player">
              <Segmented
                options={VOTE_OPTIONS}
                testId="settings-max-votes"
                value={settings.maxVotes}
                onChange={(v) => set("maxVotes", v)}
              />
            </SettingBlock>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default PartySettingsDrawer;
