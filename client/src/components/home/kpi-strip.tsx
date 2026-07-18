import { Package, ShieldCheck, TrendingUp, MoonStar } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import {
  countHighCredit,
  countLikelyToHold,
  countLongLayover,
  pct,
} from '@/lib/packageStats';

interface KpiStripProps {
  pairings: any[];
  bidPackage: any | null;
  seniorityPercentile: number | string | null | undefined;
}

interface KpiCardProps {
  icon: React.ComponentType<{ className?: string }>;
  value: string;
  label: string;
  context: string;
}

function KpiCard({ icon: Icon, value, label, context }: KpiCardProps) {
  return (
    <Card>
      <CardContent className="flex items-start gap-3 p-4">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="text-display tabular-nums leading-tight">
            {value}
          </div>
          <div className="text-sm font-medium">{label}</div>
          <div className="text-caption truncate">{context}</div>
        </div>
      </CardContent>
    </Card>
  );
}

/** One-row answer to "what's in this package for me?" */
export function KpiStrip({
  pairings,
  bidPackage,
  seniorityPercentile,
}: KpiStripProps) {
  const total = pairings.length;
  const hold = countLikelyToHold(pairings);
  const highCredit = countHighCredit(pairings);
  const longLayovers = countLongLayover(pairings);

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <KpiCard
        icon={Package}
        value={String(total)}
        label="Pairings"
        context={
          bidPackage
            ? `${bidPackage.month} ${bidPackage.year} · ${bidPackage.base} ${bidPackage.aircraft}`
            : 'No package selected'
        }
      />
      <KpiCard
        icon={ShieldCheck}
        value={String(hold)}
        label="Likely to hold"
        context={
          seniorityPercentile !== null && seniorityPercentile !== undefined
            ? `${pct(hold, total)} of package at your seniority (${seniorityPercentile}%)`
            : 'Set your seniority to personalize'
        }
      />
      <KpiCard
        icon={TrendingUp}
        value={String(highCredit)}
        label="High credit"
        context={`${pct(highCredit, total)} pay 18h+ credit`}
      />
      <KpiCard
        icon={MoonStar}
        value={String(longLayovers)}
        label="Long layovers"
        context={`${pct(longLayovers, total)} include a 20h+ overnight`}
      />
    </div>
  );
}
