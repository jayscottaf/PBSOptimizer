import { Package, ShieldCheck, TrendingUp, MoonStar } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Term } from '@/components/ui/term';
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
  label: React.ReactNode;
  context: string;
}

function KpiCard({ icon: Icon, value, label, context }: KpiCardProps) {
  return (
    <Card>
      <CardContent className="flex items-start gap-3 p-3">
        <div className="mt-0.5 hidden sm:flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="text-xl font-semibold tabular-nums leading-tight">
            {value}
          </div>
          <div className="text-xs sm:text-sm font-medium">{label}</div>
          <div className="hidden sm:block text-xs leading-relaxed text-muted-foreground">
            {context}
          </div>
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
  const withoutHistory = pairings.some(p =>
    p.holdProbabilityReasoning?.some((reason: string) =>
      reason.includes('No award history imported')
    )
  );

  return (
    <section aria-label="Package summary" className="space-y-2">
      {withoutHistory && (
        <p className="rounded-lg border border-info/30 bg-info/10 px-3 py-2 text-sm">
          Hold estimates use seniority only. Add Reasons Reports for{' '}
          {bidPackage?.base} {bidPackage?.aircraft} to include award history.
        </p>
      )}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          icon={Package}
          value={String(total)}
          label={<Term term="pairing">Pairings</Term>}
          context={
            bidPackage
              ? `${bidPackage.month} ${bidPackage.year} · ${bidPackage.base} ${bidPackage.aircraft}`
              : 'No package selected'
          }
        />
        <KpiCard
          icon={ShieldCheck}
          value={String(hold)}
          label={<Term term="hold probability">Est. 70%+ hold</Term>}
          context={
            seniorityPercentile !== null && seniorityPercentile !== undefined
              ? `${pct(hold, total)} of results · seniority ${seniorityPercentile}%`
              : 'Set your seniority to personalize'
          }
        />
        <KpiCard
          icon={TrendingUp}
          value={String(highCredit)}
          label={<Term term="credit">High credit</Term>}
          context={`${pct(highCredit, total)} pay 18h+ credit`}
        />
        <KpiCard
          icon={MoonStar}
          value={String(longLayovers)}
          label={<Term term="layover">Long layovers</Term>}
          context={`${pct(longLayovers, total)} include a 20h+ overnight`}
        />
      </div>
    </section>
  );
}
