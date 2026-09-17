import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ClipboardCheck, Users } from 'lucide-react';
import { decimalHoursToMinutes, formatDuration } from '@shared/durations';
import type { WideScheduleValidationResult } from '@shared/wide-schedule-validation';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface AwardValidationPanelProps {
  bidPackageId?: number;
  seniorityNumber?: number;
  position: 'A' | 'B';
  pairings: Array<{ pairingNumber: string }>;
}

export function AwardValidationPanel({
  bidPackageId,
  seniorityNumber,
  position,
  pairings,
}: AwardValidationPanelProps) {
  const { data } = useQuery<WideScheduleValidationResult>({
    queryKey: [
      'wide-schedule-validation',
      bidPackageId,
      position,
      seniorityNumber,
    ],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({
        bidPackageId: String(bidPackageId),
        position,
        seniorityNumber: String(seniorityNumber),
      });
      const response = await fetch(`/api/wide-schedules/validation?${params}`, {
        signal,
      });
      if (!response.ok) throw new Error('Could not load award validation.');
      return response.json();
    },
    enabled: Boolean(bidPackageId && seniorityNumber),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const packageEvidence = useMemo(() => {
    if (!data?.available) return { observed: 0, reachable: 0 };
    const packageNumbers = new Set(
      pairings.map(pairing => pairing.pairingNumber)
    );
    let observed = 0;
    let reachable = 0;
    for (const outcome of data.pairingOutcomes) {
      if (!packageNumbers.has(outcome.pairingNumber)) continue;
      observed += 1;
      if (outcome.awardedAtOrJuniorToUser) reachable += 1;
    }
    return { observed, reachable };
  }, [data, pairings]);

  if (!data?.available) return null;

  const exactLine = data.exactLine;
  const nearby = data.nearby;
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <ClipboardCheck className="h-4 w-4 text-primary" />
              Actual award check
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              {data.month} {data.year} {data.category} wide schedule ·
              anonymized results
            </p>
          </div>
          {exactLine && (
            <Badge className="bg-success/15 text-success hover:bg-success/15">
              Exact seniority found
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {exactLine && (
          <div className="rounded-lg border border-primary/25 bg-primary/5 p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="text-sm font-medium">
                Your published line at #{exactLine.seniority.toLocaleString()}
              </div>
              <div className="text-xs text-muted-foreground capitalize">
                {exactLine.lineType} line
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm">
              <span>
                <strong>
                  {formatDuration(
                    decimalHoursToMinutes(exactLine.totalCreditHours),
                    ':'
                  )}
                </strong>{' '}
                credit
              </span>
              <span>
                <strong>{exactLine.daysOff ?? '—'}</strong> days off
              </span>
              <span>
                <strong>{exactLine.pairingNumbers.length}</strong> pairings
              </span>
            </div>
            {exactLine.pairingNumbers.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {exactLine.pairingNumbers.map(pairingNumber => (
                  <Badge
                    key={pairingNumber}
                    variant="outline"
                    className="font-mono text-[11px]"
                  >
                    #{pairingNumber}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div>
            <div className="text-lg font-semibold tabular-nums">
              {formatDuration(
                decimalHoursToMinutes(nearby.medianCreditHours),
                ':'
              )}
            </div>
            <div className="text-xs text-muted-foreground">
              Median nearby credit
            </div>
          </div>
          <div>
            <div className="text-lg font-semibold tabular-nums">
              {nearby.medianDaysOff ?? '—'}
            </div>
            <div className="text-xs text-muted-foreground">Median days off</div>
          </div>
          <div>
            <div className="text-lg font-semibold tabular-nums">
              {nearby.regularLines}/{nearby.reserveLines}
            </div>
            <div className="text-xs text-muted-foreground">
              Regular / reserve
            </div>
          </div>
          <div>
            <div className="text-lg font-semibold tabular-nums">
              {data.periodMatchesPackage
                ? `${packageEvidence.reachable}/${packageEvidence.observed}`
                : '—'}
            </div>
            <div className="text-xs text-muted-foreground">
              {data.periodMatchesPackage
                ? 'Pairings reached your seniority'
                : 'Different package period'}
            </div>
          </div>
        </div>

        <div className="flex items-start gap-2 border-t border-border pt-3 text-xs text-muted-foreground">
          <Users className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <p>
            Nearby benchmarks use the {nearby.sampleSize} closest published
            lines, seniority #{nearby.seniorityMin.toLocaleString()}–#
            {nearby.seniorityMax.toLocaleString()}.
            {data.periodMatchesPackage
              ? ' “Reached” means that pairing appeared on a line held by the same or a more junior seniority.'
              : ' Pairing-by-pairing reach is hidden because the selected bid package is from a different month.'}{' '}
            This is evidence from one award, not a guarantee for a future month.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
