import { formatDuration } from '@shared/durations';
import { Columns3, Eye, Moon, X } from 'lucide-react';
import { useMemo, type CSSProperties, type ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import type { Pairing } from '@/lib/api';
import {
  bestPairingIds,
  buildPairingComparison,
  type ComparisonMetric,
  type MetricPreference,
  type PairingComparison,
} from '@/lib/pairing-comparison';
import { cn } from '@/lib/utils';

interface PairingComparisonSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pairings: Pairing[];
  onRemove: (id: number) => void;
  onView: (pairing: Pairing) => void;
}

interface ComparisonRowProps {
  label: string;
  detail?: string;
  comparisons: PairingComparison[];
  renderValue: (comparison: PairingComparison) => ReactNode;
  metric?: ComparisonMetric;
  preference?: MetricPreference;
  highlightLabel?: string;
}

function displayMinutes(minutes: number | null, emptyLabel = '—'): string {
  if (minutes === null) {
    return '—';
  }
  if (minutes === 0) {
    return emptyLabel;
  }
  return formatDuration(minutes, ':');
}

function ComparisonRow({
  label,
  detail,
  comparisons,
  renderValue,
  metric,
  preference,
  highlightLabel,
}: ComparisonRowProps) {
  const highlightedIds =
    metric && preference
      ? new Set(bestPairingIds(comparisons, metric, preference))
      : new Set<number>();

  return (
    <div className="grid grid-cols-[minmax(9.5rem,0.7fr)_repeat(var(--comparison-count),minmax(14rem,1fr))] border-t border-border/70 first:border-t-0">
      <div className="sticky left-0 z-10 flex min-h-16 flex-col justify-center border-r border-border/70 bg-background px-4 py-3 sm:px-5">
        <span className="text-sm font-medium text-foreground">{label}</span>
        {detail && (
          <span className="mt-0.5 text-xs leading-4 text-muted-foreground">
            {detail}
          </span>
        )}
      </div>
      {comparisons.map(comparison => {
        const highlighted = highlightedIds.has(comparison.id);

        return (
          <div
            key={comparison.id}
            className={cn(
              'flex min-h-16 items-center border-r border-border/70 px-4 py-3 last:border-r-0',
              highlighted && 'bg-primary/[0.055]'
            )}
          >
            <div className="min-w-0">
              <div className="font-medium tabular-nums text-foreground">
                {renderValue(comparison)}
              </div>
              {highlighted && highlightLabel && (
                <Badge
                  variant="outline"
                  className="mt-1.5 border-primary/25 bg-primary/10 text-[10px] font-medium text-primary"
                >
                  {highlightLabel}
                </Badge>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function holdClass(hold: number | null): string {
  if (hold === null) {
    return 'border-border bg-muted text-muted-foreground';
  }
  if (hold >= 70) {
    return 'border-success/25 bg-success/10 text-success';
  }
  if (hold >= 40) {
    return 'border-warning/25 bg-warning/10 text-warning';
  }
  return 'border-destructive/25 bg-destructive/10 text-destructive';
}

export function PairingComparisonSheet({
  open,
  onOpenChange,
  pairings,
  onRemove,
  onView,
}: PairingComparisonSheetProps) {
  const items = useMemo(
    () =>
      pairings.slice(0, 3).map(pairing => ({
        pairing,
        comparison: buildPairingComparison(pairing),
      })),
    [pairings]
  );
  const comparisons = useMemo(
    () => items.map(item => item.comparison),
    [items]
  );

  const comparisonStyle = {
    '--comparison-count': Math.max(comparisons.length, 1),
    minWidth: `${152 + Math.max(comparisons.length, 1) * 224}px`,
  } as CSSProperties;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex h-full w-full flex-col gap-0 overflow-hidden border-l bg-background p-0 sm:max-w-[min(1120px,calc(100vw-2rem))]"
      >
        <SheetHeader className="border-b border-border/70 bg-gradient-to-r from-primary/[0.07] via-background to-background px-5 py-5 pr-14 text-left sm:px-7">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
              <Columns3 className="h-4 w-4" />
            </div>
            <SheetTitle className="text-xl">Compare pairings</SheetTitle>
            <Badge variant="secondary" className="font-normal tabular-nums">
              {comparisons.length} selected
            </Badge>
          </div>
          <SheetDescription className="max-w-3xl leading-5">
            Review the same trip details side by side. Metric highlights show a
            specific advantage, not an overall winner.
          </SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {comparisons.length === 0 ? (
            <div className="flex h-full min-h-72 flex-col items-center justify-center px-6 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                <Columns3 className="h-5 w-5" />
              </div>
              <h3 className="mt-4 font-semibold">No pairings selected</h3>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                Select two or three pairings from the trip list to compare their
                schedule, efficiency, and estimated hold.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto overscroll-x-contain">
              <div style={comparisonStyle}>
                <div className="grid grid-cols-[minmax(9.5rem,0.7fr)_repeat(var(--comparison-count),minmax(14rem,1fr))] border-b border-border/70 bg-muted/20">
                  <div className="sticky left-0 z-10 flex items-end border-r border-border/70 bg-muted/95 px-4 py-4 backdrop-blur sm:px-5">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                        Trip details
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Scroll sideways to compare
                      </p>
                    </div>
                  </div>
                  {items.map(({ pairing, comparison }) => (
                    <div
                      key={comparison.id}
                      className="relative border-r border-border/70 p-4 last:border-r-0"
                    >
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="absolute right-2 top-2 h-8 w-8 text-muted-foreground hover:text-foreground"
                        onClick={() => onRemove(comparison.id)}
                        aria-label={`Remove pairing ${comparison.pairingNumber} from comparison`}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                      <div className="pr-8">
                        <p className="text-base font-semibold tracking-tight text-foreground">
                          Pairing {comparison.pairingNumber}
                        </p>
                        <p className="mt-1 line-clamp-2 min-h-10 text-sm leading-5 text-muted-foreground">
                          {comparison.route || 'Route details unavailable'}
                        </p>
                        <p className="mt-2 text-xs text-muted-foreground">
                          {comparison.effectiveDates ||
                            'Operating dates not specified'}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="mt-3 h-8 w-full"
                        onClick={() => onView(pairing)}
                        aria-label={`View details for pairing ${comparison.pairingNumber}`}
                      >
                        <Eye className="h-3.5 w-3.5" />
                        View trip
                      </Button>
                    </div>
                  ))}
                </div>

                <div role="table" aria-label="Pairing comparison">
                  <ComparisonRow
                    label="Estimated hold"
                    detail="Historical estimate"
                    comparisons={comparisons}
                    metric="holdProbability"
                    preference="higher"
                    highlightLabel="Highest estimate"
                    renderValue={comparison => (
                      <Badge
                        variant="outline"
                        className={cn(
                          'font-semibold tabular-nums',
                          holdClass(comparison.holdProbability)
                        )}
                      >
                        {comparison.holdProbability === null
                          ? 'Unknown'
                          : `${comparison.holdProbability}%`}
                      </Badge>
                    )}
                  />
                  <ComparisonRow
                    label="Credit"
                    comparisons={comparisons}
                    metric="creditMinutes"
                    preference="higher"
                    highlightLabel="Most credit"
                    renderValue={comparison =>
                      displayMinutes(comparison.creditMinutes)
                    }
                  />
                  <ComparisonRow
                    label="Block"
                    detail="Scheduled flight time"
                    comparisons={comparisons}
                    renderValue={comparison =>
                      displayMinutes(comparison.blockMinutes)
                    }
                  />
                  <ComparisonRow
                    label="Credit / block"
                    detail="Pay efficiency"
                    comparisons={comparisons}
                    metric="creditBlockRatio"
                    preference="higher"
                    highlightLabel="Highest ratio"
                    renderValue={comparison =>
                      comparison.creditBlockRatio === null
                        ? '—'
                        : comparison.creditBlockRatio.toFixed(2)
                    }
                  />
                  <ComparisonRow
                    label="Time away"
                    detail="TAFB"
                    comparisons={comparisons}
                    metric="tafbMinutes"
                    preference="lower"
                    highlightLabel="Shortest time away"
                    renderValue={comparison =>
                      displayMinutes(comparison.tafbMinutes)
                    }
                  />
                  <ComparisonRow
                    label="Trip length"
                    comparisons={comparisons}
                    renderValue={comparison =>
                      comparison.pairingDays === null
                        ? '—'
                        : `${comparison.pairingDays} ${comparison.pairingDays === 1 ? 'day' : 'days'}`
                    }
                  />
                  <ComparisonRow
                    label="Longest layover"
                    comparisons={comparisons}
                    renderValue={comparison =>
                      displayMinutes(
                        comparison.longestLayoverMinutes,
                        'No layover'
                      )
                    }
                  />
                  <ComparisonRow
                    label="Total layover"
                    comparisons={comparisons}
                    renderValue={comparison =>
                      displayMinutes(
                        comparison.totalLayoverMinutes,
                        'No layover'
                      )
                    }
                  />
                  <ComparisonRow
                    label="Check-in"
                    comparisons={comparisons}
                    renderValue={comparison =>
                      [comparison.checkInStation, comparison.checkInTime]
                        .filter(Boolean)
                        .join(' · ') || '—'
                    }
                  />
                  <ComparisonRow
                    label="Deadheads"
                    comparisons={comparisons}
                    metric="deadheads"
                    preference="lower"
                    highlightLabel="Fewest deadheads"
                    renderValue={comparison => comparison.deadheads ?? '—'}
                  />
                  <ComparisonRow
                    label="Redeye"
                    comparisons={comparisons}
                    renderValue={comparison =>
                      comparison.hasRedeye ? (
                        <Badge
                          variant="outline"
                          className="border-warning/25 bg-warning/10 text-warning"
                        >
                          <Moon className="mr-1 h-3 w-3" />
                          Includes redeye
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="border-success/25 bg-success/10 text-success"
                        >
                          No redeye
                        </Badge>
                      )
                    }
                  />
                  <ComparisonRow
                    label="Layover cities"
                    comparisons={comparisons}
                    renderValue={comparison =>
                      comparison.layoverCities.length > 0
                        ? comparison.layoverCities.join(' · ')
                        : 'None'
                    }
                  />
                  <ComparisonRow
                    label="Why this estimate"
                    detail="Evidence from the report"
                    comparisons={comparisons}
                    renderValue={comparison =>
                      comparison.holdReasoning.length > 0 ? (
                        <ul className="space-y-1.5 text-sm font-normal leading-5 text-muted-foreground">
                          {comparison.holdReasoning.slice(0, 2).map(reason => (
                            <li key={reason} className="flex gap-2">
                              <span
                                className="mt-2 h-1 w-1 shrink-0 rounded-full bg-primary"
                                aria-hidden="true"
                              />
                              <span>{reason}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <span className="text-sm font-normal text-muted-foreground">
                          No historical explanation available.
                        </span>
                      )
                    }
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
