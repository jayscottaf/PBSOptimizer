import { Plane, UserRound, CloudUpload, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface WelcomeIntroProps {
  onGetStarted: () => void;
}

const STEPS = [
  {
    icon: UserRound,
    title: 'Tell us where you sit',
    text: 'Seniority, base, and aircraft — everything is ranked against your real odds, not generic advice.',
  },
  {
    icon: CloudUpload,
    title: 'Upload your bid package',
    text: 'Drop in the monthly PDF and every pairing becomes searchable with hold probabilities.',
  },
  {
    icon: Sparkles,
    title: 'Get your bid',
    text: 'Auto-draft a bid from your own history, simulate what you would hold, and copy the exact text into PBS.',
  },
];

/** First-run value proposition shown inside the profile dialog before the
 *  form. Presentation only — the dialog's open/close gating is unchanged. */
export function WelcomeIntro({ onGetStarted }: WelcomeIntroProps) {
  return (
    <div className="space-y-5 py-2">
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <Plane className="h-6 w-6" />
        </div>
        <div>
          <h3 className="text-display">Bid smarter this month</h3>
          <p className="text-body mt-1 text-muted-foreground">
            PBS Optimizer learns what you like, shows what you can actually
            hold, and writes the bid for you.
          </p>
        </div>
      </div>

      <ol className="space-y-3">
        {STEPS.map((step, i) => (
          <li key={step.title} className="flex items-start gap-3">
            <div className="relative mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
              <step.icon className="h-4 w-4" />
              <span className="absolute -left-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">
                {i + 1}
              </span>
            </div>
            <div>
              <p className="text-sm font-medium">{step.title}</p>
              <p className="text-caption">{step.text}</p>
            </div>
          </li>
        ))}
      </ol>

      <Button className="w-full" onClick={onGetStarted}>
        Get started
      </Button>
      <p className="text-caption text-center">
        Already use it on another device? You can link it with your sync PIN
        on the next step.
      </p>
    </div>
  );
}
