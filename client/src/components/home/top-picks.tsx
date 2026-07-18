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
 * "Top picks for you" — the optimizer's highest-scoring pairings under the
 * pilot's learned/neutral profile, with its own reasons. Collapses to
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

  if (!bidPackageId || isError) return null;

  const picks = (data?.topScored ?? []).slice(0, 5);
  const byNumber = new Map(pairings.map(p => [p.pairingNumber, p]));

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-lg font-medium">
          <Sparkles className="h-5 w-5 text-primary" />
          Top picks for you
          {data?.profileSource === 'neutral' && (
            <Badge variant="outline" className="ml-1 text-xs font-normal">
              neutral profile
            </Badge>
          )}
        </CardTitle>
        <Button
          variant="outline"
          size="sm"
          onClick={onOpenBidBuilder}
          className="gap-1.5"
        >
          <ClipboardList className="h-4 w-4" />
          <span className="hidden sm:inline">Build this bid</span>
        </Button>
      </CardHeader>
      <CardContent className="pt-0">
        {isLoading ? (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-lg" />
            ))}
          </div>
        ) : picks.length === 0 ? (
          <p className="text-caption py-2">
            No scored pairings yet — upload a package or set up your profile.
          </p>
        ) : (
          <>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
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
                          ? `${pick.holdProbability}%`
                          : '—'}
                      </span>
                    </div>
                    <div className="text-caption mt-1 tabular-nums">
                      {pick.pairingDays}-day · {pick.creditHours.toFixed(2)}{' '}
                      cr
                    </div>
                    <div className="text-caption mt-1 line-clamp-2">
                      {pick.reasons.slice(0, 2).join(' · ') || 'Strong fit'}
                    </div>
                    <div className="mt-1 hidden items-center gap-1 text-xs text-primary group-hover:flex">
                      Details <ArrowRight className="h-3 w-3" />
                    </div>
                  </button>
                );
              })}
            </div>
            {data?.profileSource === 'neutral' && (
              <p className="text-caption mt-3">
                Ranked with a neutral profile. Learn your profile in Bid
                Builder (from your bid history) for personal picks.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
