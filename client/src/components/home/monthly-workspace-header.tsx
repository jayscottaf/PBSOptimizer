import {
  ArrowRight,
  Check,
  CircleDashed,
  CloudUpload,
  Database,
  FileCheck2,
  Radar,
} from 'lucide-react';
import { formatBidPeriod } from '@shared/pbsFilterLabels';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useWideScheduleValidation } from '@/hooks/use-wide-schedule-validation';
import { cn } from '@/lib/utils';

interface MonthlyWorkspaceHeaderProps {
  bidPackage: any;
  seniorityNumber?: number;
  seniorityPercentile?: number;
  position: 'A' | 'B';
  pairingCount: number;
  hasReasonsEvidence: boolean;
  onBuildBid: () => void;
  onUpload: () => void;
}

interface StatusPillProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  detail: string;
  state: 'ready' | 'attention' | 'missing';
}

function StatusPill({ icon: Icon, label, detail, state }: StatusPillProps) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-lg border border-border/70 bg-background/65 px-3 py-2 backdrop-blur-sm">
      <div
        className={cn(
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
          state === 'ready' && 'bg-success/15 text-success',
          state === 'attention' && 'bg-warning/15 text-warning',
          state === 'missing' && 'bg-muted text-muted-foreground'
        )}
      >
        {state === 'ready' ? (
          <Check className="h-3.5 w-3.5" />
        ) : state === 'attention' ? (
          <Radar className="h-3.5 w-3.5" />
        ) : (
          <Icon className="h-3.5 w-3.5" />
        )}
      </div>
      <div className="min-w-0">
        <div className="text-xs font-medium text-foreground">{label}</div>
        <div className="truncate text-xs text-muted-foreground">{detail}</div>
      </div>
    </div>
  );
}

export function MonthlyWorkspaceHeader({
  bidPackage,
  seniorityNumber,
  seniorityPercentile,
  position,
  pairingCount,
  hasReasonsEvidence,
  onBuildBid,
  onUpload,
}: MonthlyWorkspaceHeaderProps) {
  const { data: awardEvidence } = useWideScheduleValidation(
    bidPackage?.id,
    seniorityNumber,
    position
  );
  const period = formatBidPeriod(
    bidPackage?.bidPeriodStart,
    bidPackage?.bidPeriodEnd
  );
  const category = [bidPackage?.base, bidPackage?.aircraft]
    .filter(Boolean)
    .join(' ');
  const wideReady = awardEvidence?.available === true;
  const exactPeriod = wideReady && awardEvidence.periodMatchesPackage;
  const wideDetail = !wideReady
    ? 'Add published awards'
    : exactPeriod
      ? `${awardEvidence.month} awards matched`
      : `${awardEvidence.month} ${awardEvidence.year} latest evidence`;

  return (
    <section
      aria-labelledby="monthly-workspace-title"
      className="relative overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/[0.12] via-card to-card p-4 shadow-sm sm:p-6"
    >
      <div className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-primary/10 blur-3xl" />
      <div className="relative flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="border-primary/30 bg-primary/10 text-primary hover:bg-primary/10">
              Monthly workspace
            </Badge>
            {period && (
              <span className="text-xs text-muted-foreground">{period}</span>
            )}
          </div>
          <div>
            <h2
              id="monthly-workspace-title"
              className="text-2xl font-semibold tracking-tight sm:text-3xl"
            >
              {bidPackage?.month} {bidPackage?.year}
              <span className="text-muted-foreground">
                {' '}
                · {category} · {position === 'A' ? 'Captain' : 'First Officer'}
              </span>
            </h2>
            <p className="mt-1 text-sm text-muted-foreground sm:text-base">
              {seniorityNumber ? (
                <>
                  Seniority #{seniorityNumber.toLocaleString()}
                  {seniorityPercentile !== undefined
                    ? ` · ${seniorityPercentile.toFixed(1)}% in this category`
                    : ''}
                </>
              ) : (
                'Complete your profile to personalize this month.'
              )}
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <StatusPill
              icon={CircleDashed}
              label="Bid package"
              detail={
                bidPackage?.status === 'completed'
                  ? `${pairingCount.toLocaleString()} pairings ready`
                  : bidPackage?.status || 'Not ready'
              }
              state={bidPackage?.status === 'completed' ? 'ready' : 'attention'}
            />
            <StatusPill
              icon={Database}
              label="Reasons history"
              detail={
                hasReasonsEvidence
                  ? 'Used in hold estimates'
                  : 'Add history for evidence'
              }
              state={hasReasonsEvidence ? 'ready' : 'missing'}
            />
            <StatusPill
              icon={FileCheck2}
              label="Award evidence"
              detail={wideDetail}
              state={
                exactPeriod ? 'ready' : wideReady ? 'attention' : 'missing'
              }
            />
          </div>
        </div>
        <div className="flex shrink-0 flex-col gap-2 sm:flex-row xl:flex-col">
          <Button onClick={onBuildBid} className="gap-2 sm:min-w-40">
            Build my bid
            <ArrowRight className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            onClick={onUpload}
            className="gap-2 sm:min-w-40"
          >
            <CloudUpload className="h-4 w-4" />
            Update data
          </Button>
        </div>
      </div>
    </section>
  );
}
