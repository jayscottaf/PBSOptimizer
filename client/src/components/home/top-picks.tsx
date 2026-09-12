import { decimalHoursToMinutes, formatDuration } from '@shared/durations';
import { Sparkles, ArrowRight, ClipboardList } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useTopPicks } from '@/hooks/use-top-picks';

interface TopPicksProps {
  bidPackageId: number | undefined;
  userId: number | undefined;
  pairings: any[];
  onPairingClick: (pairing: any) => void;
  onOpenBidBuilder: () => void;
}

function holdBadgeClass(hold: number | null): string {
  if (hold === null) return 'bg-muted text-muted-foreground';
  if (hold >= 70) return 'bg-success/15 text-success';
  if (hold >= 40) return 'bg-warning/15 text-warning';
  return 'bg-destructive/15 text-destructive';
}

/**
 * "Recommended for your profile" — the optimizer's highest-scoring pairings under the
 * pilot's learned/Preferences not learned, with its own reasons. Collapses to
 * nothing on error/offline so the Home never blocks on it.
 */
export function TopPicks({
  bidPackageId,
  userId,
  pairings,
  onPairingClick,
  onOpenBidBuilder,
}: TopPicksProps) {
  const { data, isLoading, isError } = useTopPicks(bidPackageId, userId);

  if (!bidPackageId) return null;

  const picks = (data?.topScored ?? []).slice(0, 3);
  const byNumber = new Map(pairings.map(p => [p.pairingNumber, p]));

  return (
    <details className="group/recommendations rounded-xl border bg-card">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium marker:text-primary">
        Recommended trips{' '}
        <span className="ml-2 hidden sm:inline font-normal text-muted-foreground">
          Explore your best matches
        </span>
      </summary>
      <Card className="border-0 shadow-none">
        <CardHeader className="flex flex-wrap flex-row items-center justify-between gap-3 space-y-0 pt-0 pb-3">
          <CardTitle className="flex items-center gap-2 text-lg font-medium">
            <Sparkles className="h-5 w-5 text-primary" />
            Recommended for your profile
            {data?.profileSource === 'neutral' && (
              <Badge variant="outline" className="ml-1 text-xs font-normal">
                Preferences not learned
              </Badge>
            )}
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={onOpenBidBuilder}
            className="gap-1.5"
            aria-label="Open bid builder"
          >
            <ClipboardList className="h-4 w-4" />
            <span className="hidden sm:inline">Open bid builder</span>
          </Button>
        </CardHeader>
        <CardContent className="pt-0">
          {isError ? (
            <p className="text-sm text-muted-foreground">
              Recommendations are unavailable right now. You can still browse
              all pairings below.
            </p>
          ) : isLoading ? (
            <div className="grid gap-2 md:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-24 rounded-lg" />
              ))}
            </div>
          ) : picks.length === 0 ? (
            <p className="text-caption py-2">
              No scored pairings yet — upload a package or set up your profile.
            </p>
          ) : (
            <>
              <div className="grid gap-2 md:grid-cols-3">
                {picks.map(pick => {
                  const pairing = byNumber.get(pick.pairingNumber);
                  return (
                    <button
                      key={pick.pairingNumber}
                      type="button"
                      onClick={() => pairing && onPairingClick(pairing)}
                      disabled={!pairing}
                      className="group rounded-lg border border-border bg-card p-3 text-left transition-colors hover:border-primary/50 hover:bg-accent/40 disabled:cursor-default"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-mono-data font-semibold">
                          #{pick.pairingNumber}
                        </span>
                        <span
                          className={`rounded px-1.5 py-0.5 text-xs font-medium tabular-nums ${holdBadgeClass(pick.holdProbability)}`}
                        >
                          {pick.holdProbability !== null
                            ? `${pick.holdProbability}% est.`
                            : '—'}
                        </span>
                      </div>
                      <p className="mt-2 truncate text-sm font-medium">
                        {pairing?.route || 'View trip itinerary'}
                      </p>
                      <div className="text-sm text-muted-foreground mt-1 tabular-nums">
                        {pick.pairingDays}-day ·{' '}
                        {formatDuration(
                          decimalHoursToMinutes(pick.creditHours),
                          ':'
                        )}{' '}
                        credit
                      </div>
                      <div className="text-caption mt-1 line-clamp-2">
                        {pick.reasons.slice(0, 2).join(' · ') ||
                          'Ranked by your current preference profile'}
                      </div>
                      <div className="mt-3 flex items-center gap-1 text-sm text-primary">
                        View trip <ArrowRight className="h-3 w-3" />
                      </div>
                    </button>
                  );
                })}
              </div>
              {data?.profileSource === 'neutral' && (
                <p className="text-caption mt-3">
                  Ranked with a Preferences not learned. Learn your profile in
                  Bid Builder (from your bid history) for personal picks.
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </details>
  );
}
