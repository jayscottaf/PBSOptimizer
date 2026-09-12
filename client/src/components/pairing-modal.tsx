import { TripTimeline } from '@/components/trip-timeline';
import { formatLayoverMinutes, layoverDurationToMinutes } from '@/lib/layover';
import {
  decimalHoursToMinutes,
  formatDuration,
  printedDurationMinutes,
} from '@shared/durations';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { X, Heart, Calendar, ChevronDown, ChevronUp } from 'lucide-react';
import { api } from '@/lib/api';
import { useState, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from '@/hooks/use-toast';
import { Checkbox } from '@/components/ui/checkbox';
import { calculateValidStartDates } from '@/lib/pairingDates';
import {
  calculateDutyStartTime,
  calculateDutyEndTime,
} from '@shared/dutyTimeCalculator';
interface PairingModalProps {
  pairingId: number;
  onClose: () => void;
  currentUser?: {
    id: number;
    base: string;
    aircraft: string;
  };
}

export function PairingModal({
  pairingId,
  onClose,
  currentUser,
}: PairingModalProps) {
  const [isAddingFavorite, setIsAddingFavorite] = useState(false);
  const [isFavorited, setIsFavorited] = useState(false);
  const [isAddedToCalendar, setIsAddedToCalendar] = useState(false);
  const [showDateChooser, setShowDateChooser] = useState(false);
  const [dateOptions, setDateOptions] = useState<Date[]>([]);
  const [selectedDates, setSelectedDates] = useState<Record<number, boolean>>(
    {}
  );
  const [expandedMatches, setExpandedMatches] = useState<
    Record<number, boolean>
  >({});
  const queryClient = useQueryClient();

  const toggleMatchExpanded = (index: number) => {
    setExpandedMatches(prev => ({ ...prev, [index]: !prev[index] }));
  };

  const {
    data: pairing,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['/api/pairings', pairingId],
    queryFn: () => api.getPairing(pairingId),
    staleTime: 0, // Always fetch fresh data
    refetchOnMount: true,
  });

  // Get user's base and aircraft for filtering
  const userBase = currentUser?.base || 'NYC';
  const userAircraft = currentUser?.aircraft || 'A220';

  // Use fingerprint-based matching instead of pairing number
  const { data: similarHistoryData } = useQuery({
    queryKey: ['/api/history/similar', pairingId, userBase, userAircraft],
    queryFn: () => api.getSimilarBidHistory(pairingId, userBase, userAircraft),
    enabled: !!pairingId,
  });

  // Fetch bid packages to get the correct year for calendar dates
  const { data: bidPackages = [] } = useQuery({
    queryKey: ['bidPackages'],
    queryFn: async () => {
      const response = await fetch('/api/bid-packages');
      if (!response.ok) {
        throw new Error('Failed to fetch bid packages');
      }
      return response.json();
    },
    staleTime: 15 * 60 * 1000,
  });

  // Get the latest completed bid package year
  const bidPackageYear = (() => {
    if (!bidPackages || bidPackages.length === 0) {
      return new Date().getFullYear();
    }
    const packagesArray = (bidPackages as any[]).slice();
    packagesArray.sort(
      (a, b) =>
        new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()
    );
    const mostRecentCompleted = packagesArray.find(
      (pkg: any) => pkg.status === 'completed'
    );
    return mostRecentCompleted?.year || new Date().getFullYear();
  })();

  // Check if this pairing is already in user's favorites
  const { data: userFavorites = [] } = useQuery({
    queryKey: ['favorites', currentUser?.id],
    queryFn: async () => {
      if (!currentUser) return [];
      try {
        return await api.getFavorites(currentUser.id);
      } catch (error) {
        return [];
      }
    },
    enabled: !!pairingId && !!currentUser,
  });

  // Update isFavorited state when favorites data changes
  useEffect(() => {
    if (userFavorites && pairingId) {
      const isAlreadyFavorited = userFavorites.some(
        (fav: any) => fav.id === pairingId
      );
      setIsFavorited(isAlreadyFavorited);
    }
  }, [userFavorites, pairingId]);

  // Add to calendar mutation
  const addToCalendarMutation = useMutation({
    mutationFn: async ({
      userId,
      pairingId,
      startDate,
      endDate,
    }: {
      userId: number;
      pairingId: number;
      startDate: Date;
      endDate: Date;
    }) => {
      console.log('Mutation function called with:', {
        userId,
        pairingId,
        startDate,
        endDate,
      });
      const result = await api.addToCalendar(
        userId,
        pairingId,
        startDate,
        endDate
      );
      console.log('Mutation result:', result);
      return result;
    },
    onSuccess: data => {
      console.log('Calendar mutation success:', data);
      toast({
        title: 'Success',
        description: 'Pairing added to calendar successfully',
      });
      queryClient.invalidateQueries({ queryKey: ['calendar'] });
      queryClient.invalidateQueries({ queryKey: ['calendarEvents'] });
      queryClient.refetchQueries({ queryKey: ['calendar'] });
      queryClient.refetchQueries({ queryKey: ['calendarEvents'] });
      setIsAddedToCalendar(true);
    },
    onError: (error: any) => {
      console.error('Calendar mutation error:', error);
      const errorMessage =
        error?.message || 'Unknown error occurred while adding to calendar';
      toast({
        title: 'Error',
        description: `Failed to add to calendar: ${errorMessage}`,
        variant: 'destructive',
      });
    },
  });

  if (isError)
    return (
      <Dialog open onOpenChange={onClose}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pairing unavailable</DialogTitle>
            <DialogDescription>
              We could not load this trip. Check your connection and try again.
            </DialogDescription>
          </DialogHeader>
          <Button onClick={() => void refetch()}>Retry</Button>
        </DialogContent>
      </Dialog>
    );

  if (isLoading || !pairing) {
    return (
      <Dialog open={true} onOpenChange={onClose}>
        <DialogContent className="max-w-4xl max-h-screen overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Loading Pairing</DialogTitle>
            <DialogDescription>
              Please wait while we fetch pairing details...
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-center h-64">
            <div className="text-muted-foreground" role="status">
              Loading pairing details...
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  const flightSegments = pairing.flightSegments || [];

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90svh] overflow-y-auto w-[calc(100vw-1.5rem)] sm:w-full">
        <DialogHeader>
          <DialogTitle className="text-lg sm:text-xl">
            Pairing {pairing.pairingNumber}
          </DialogTitle>
          <DialogDescription className="text-sm">
            {pairing.route} · {pairing.pairingDays}{' '}
            {pairing.pairingDays === 1 ? 'day' : 'days'} · Times shown as
            hours:minutes.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 sm:space-y-6">
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              [
                'Credit',
                formatDuration(decimalHoursToMinutes(pairing.creditHours), ':'),
              ],
              [
                'Block',
                formatDuration(decimalHoursToMinutes(pairing.blockHours), ':'),
              ],
              [
                'Time away',
                formatDuration(printedDurationMinutes(pairing.tafb), ':'),
              ],
              [
                'Estimated hold',
                pairing.holdProbability === null ||
                pairing.holdProbability === undefined
                  ? '—'
                  : `${pairing.holdProbability}%`,
              ],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border bg-muted/40 p-3">
                <dt className="text-sm text-muted-foreground">{label}</dt>
                <dd className="mt-1 text-xl font-semibold tabular-nums">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
          <p className="text-sm">
            <span className="text-muted-foreground">Operating dates:</span>{' '}
            {pairing.effectiveDates || 'See original report'}
          </p>
          {(pairing.holdProbabilityReasoning?.length ?? 0) > 0 && (
            <details className="rounded-lg border px-3 py-2 text-sm">
              <summary className="cursor-pointer font-medium">
                About this hold estimate
              </summary>
              <ul className="mt-2 space-y-1 text-muted-foreground">
                {pairing.holdProbabilityReasoning?.map(
                  (reason: string, index: number) => (
                    <li key={index}>{reason}</li>
                  )
                )}
              </ul>
            </details>
          )}
          <div className="grid gap-6 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
            <section aria-label="Flight itinerary">
              <h3 className="mb-4 text-base font-semibold">Your trip</h3>
              <TripTimeline segments={flightSegments} />
            </section>
            <section aria-label="Layovers" className="space-y-3">
              <h3 className="text-base font-semibold">Layovers & trip notes</h3>
              {Array.isArray(pairing.layovers) && pairing.layovers.length ? (
                pairing.layovers.map((layover: any, index: number) => (
                  <div
                    key={index}
                    className="rounded-lg border bg-accent/30 p-3"
                  >
                    <p className="font-semibold">
                      {layover.city || layover.airport || 'Layover'}
                    </p>
                    <p className="mt-1 text-sm">
                      {formatLayoverMinutes(
                        layoverDurationToMinutes(layover.duration)
                      )}
                    </p>
                    {layover.hotel && (
                      <p className="mt-1 text-sm text-muted-foreground">
                        {layover.hotel}
                      </p>
                    )}
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">
                  No layover details listed.
                </p>
              )}
              <dl className="space-y-2 text-sm">
                {pairing.payHours && (
                  <div>
                    <dt className="text-muted-foreground">Total pay</dt>
                    <dd>
                      {formatDuration(
                        printedDurationMinutes(pairing.payHours),
                        ':'
                      )}
                    </dd>
                  </div>
                )}
                {pairing.fdp && (
                  <div>
                    <dt className="text-muted-foreground">
                      Flight duty period
                    </dt>
                    <dd>
                      {formatDuration(printedDurationMinutes(pairing.fdp), ':')}
                    </dd>
                  </div>
                )}
                {pairing.deadheads > 0 && (
                  <div>
                    <dt className="text-muted-foreground">Deadhead segments</dt>
                    <dd>{pairing.deadheads}</dd>
                  </div>
                )}
              </dl>
            </section>
          </div>
          <details className="rounded-xl border bg-muted/20">
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
              Original pairing report{' '}
              <span className="ml-2 font-normal text-muted-foreground">
                Source text
              </span>
            </summary>
            <pre className="mx-3 mb-3 max-h-80 overflow-auto rounded-lg bg-muted p-3 text-xs leading-relaxed">
              {pairing.fullTextBlock || 'No source text available'}
            </pre>
          </details>

          {/* Historical Awards - Fingerprint Matching */}
          <div className="space-y-2 sm:space-y-4">
            <h4 className="font-semibold text-foreground text-sm sm:text-base">
              Similar Historical Pairings
            </h4>
            <Card>
              <CardContent className="p-2 sm:p-4">
                {similarHistoryData?.similarMatches?.length > 0 ? (
                  <div className="space-y-4">
                    {/* Current pairing reference */}
                    <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
                      <div className="text-xs text-blue-600 dark:text-blue-400 font-medium mb-1">
                        Current Pairing #
                        {similarHistoryData.currentPairing?.pairingNumber}
                      </div>
                      <div className="text-xs text-blue-800 dark:text-blue-300 font-mono">
                        Layovers:{' '}
                        {similarHistoryData.currentPairing?.layovers || 'None'}{' '}
                        | Days: {similarHistoryData.currentPairing?.days} |
                        Credit:{' '}
                        {formatDuration(
                          decimalHoursToMinutes(
                            similarHistoryData.currentPairing?.credit
                          ),
                          ':'
                        )}
                      </div>
                    </div>

                    {/* Similar matches */}
                    <div className="space-y-3">
                      {similarHistoryData.similarMatches.map(
                        (match: any, index: number) => (
                          <div
                            key={index}
                            className={`rounded-lg p-3 border ${
                              match.isExactPairing
                                ? 'bg-purple-50 dark:bg-purple-900/20 border-purple-300 dark:border-purple-700'
                                : match.confidence === 'exact'
                                  ? 'bg-green-50 dark:bg-green-900/20 border-green-300 dark:border-green-700'
                                  : match.confidence === 'high'
                                    ? 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-300 dark:border-yellow-700'
                                    : 'bg-muted border-gray-300 dark:border-gray-600'
                            }`}
                          >
                            <div className="flex justify-between items-start mb-2">
                              <div>
                                <span className="font-medium text-sm">
                                  #{match.pairingNumber} - {match.month}{' '}
                                  {match.year}
                                </span>
                                {match.isExactPairing && (
                                  <Badge
                                    variant="outline"
                                    className="ml-2 text-xs bg-purple-100 text-purple-800 dark:bg-purple-800 dark:text-purple-100"
                                  >
                                    This Pairing
                                  </Badge>
                                )}
                                <Badge
                                  variant="outline"
                                  className={`ml-2 text-xs ${
                                    match.confidence === 'exact'
                                      ? 'bg-green-100 text-green-800 dark:bg-green-800 dark:text-green-100'
                                      : match.confidence === 'high'
                                        ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-800 dark:text-yellow-100'
                                        : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-100'
                                  }`}
                                >
                                  {match.similarity}% {match.confidence}
                                </Badge>
                                {match.awardCount > 1 && (
                                  <Badge
                                    variant="outline"
                                    className="ml-2 text-xs bg-blue-100 text-blue-800 dark:bg-blue-800 dark:text-blue-100"
                                  >
                                    {match.awardCount}x awarded
                                  </Badge>
                                )}
                              </div>
                            </div>

                            {/* Individual awards list - each date with seniority */}
                            <div className="mb-2 space-y-1">
                              {(() => {
                                const awards = match.awards || [];
                                const isExpanded = expandedMatches[index];
                                const maxVisible = 3;
                                const displayAwards = isExpanded
                                  ? awards
                                  : awards.slice(0, maxVisible);
                                const hasMore = awards.length > maxVisible;

                                return (
                                  <>
                                    {displayAwards.map(
                                      (award: any, awardIndex: number) => (
                                        <div
                                          key={awardIndex}
                                          data-testid={`row-award-${match.pairingNumber}-${awardIndex}`}
                                          className="flex items-center text-sm font-mono bg-gray-100 dark:bg-gray-700/50 rounded px-2 py-1"
                                        >
                                          <span className="text-gray-600 dark:text-gray-300 w-24">
                                            {award.date} {award.dayOfWeek}
                                          </span>
                                          <span className="text-muted-foreground mx-2">
                                            —
                                          </span>
                                          <span className="font-semibold text-foreground">
                                            Seniority #{award.seniority}
                                          </span>
                                        </div>
                                      )
                                    )}
                                    {hasMore && (
                                      <button
                                        onClick={() =>
                                          toggleMatchExpanded(index)
                                        }
                                        data-testid={`button-toggle-awards-${match.pairingNumber}-${index}`}
                                        className="flex items-center text-xs text-blue-600 dark:text-blue-400 hover:underline mt-1"
                                      >
                                        {isExpanded ? (
                                          <>
                                            <ChevronUp className="w-3 h-3 mr-1" />
                                            Show less
                                          </>
                                        ) : (
                                          <>
                                            <ChevronDown className="w-3 h-3 mr-1" />
                                            Show {awards.length - maxVisible}{' '}
                                            more
                                          </>
                                        )}
                                      </button>
                                    )}
                                  </>
                                );
                              })()}
                            </div>

                            {/* Historical pairing details */}
                            <div className="text-xs text-muted-foreground font-mono mb-2">
                              Layovers: {match.historicalLayovers || 'None'} |
                              Days: {match.historicalDays} | Credit:{' '}
                              {formatDuration(
                                decimalHoursToMinutes(match.historicalCredit),
                                ':'
                              )}
                            </div>

                            {/* Match breakdown */}
                            <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 text-xs">
                              <div className="text-center">
                                <div
                                  className={`font-semibold ${match.breakdown.layoverMatch >= 80 ? 'text-green-600' : match.breakdown.layoverMatch >= 50 ? 'text-yellow-600' : 'text-red-600'}`}
                                >
                                  {Math.round(match.breakdown.layoverMatch)}%
                                </div>
                                <div className="text-muted-foreground">
                                  Layovers
                                </div>
                              </div>
                              <div className="text-center">
                                <div
                                  className={`font-semibold ${match.breakdown.daysMatch >= 80 ? 'text-green-600' : match.breakdown.daysMatch >= 50 ? 'text-yellow-600' : 'text-red-600'}`}
                                >
                                  {Math.round(match.breakdown.daysMatch)}%
                                </div>
                                <div className="text-muted-foreground">
                                  Days
                                </div>
                              </div>
                              <div className="text-center">
                                <div
                                  className={`font-semibold ${(match.breakdown.seasonMatch ?? 0) >= 80 ? 'text-green-600' : (match.breakdown.seasonMatch ?? 0) >= 50 ? 'text-yellow-600' : 'text-red-600'}`}
                                >
                                  {Math.round(match.breakdown.seasonMatch ?? 0)}
                                  %
                                </div>
                                <div className="text-muted-foreground">
                                  Season
                                </div>
                              </div>
                              <div className="text-center">
                                <div
                                  className={`font-semibold ${match.breakdown.creditMatch >= 80 ? 'text-green-600' : match.breakdown.creditMatch >= 50 ? 'text-yellow-600' : 'text-red-600'}`}
                                >
                                  {Math.round(match.breakdown.creditMatch)}%
                                </div>
                                <div className="text-muted-foreground">
                                  Credit
                                </div>
                              </div>
                              <div className="text-center">
                                <div
                                  className={`font-semibold ${match.breakdown.timeMatch >= 80 ? 'text-green-600' : match.breakdown.timeMatch >= 50 ? 'text-yellow-600' : 'text-red-600'}`}
                                >
                                  {Math.round(match.breakdown.timeMatch)}%
                                </div>
                                <div className="text-muted-foreground">
                                  Times
                                </div>
                              </div>
                              <div className="text-center">
                                <div
                                  className={`font-semibold ${match.breakdown.efficiencyMatch >= 80 ? 'text-green-600' : match.breakdown.efficiencyMatch >= 50 ? 'text-yellow-600' : 'text-red-600'}`}
                                >
                                  {Math.round(match.breakdown.efficiencyMatch)}%
                                </div>
                                <div className="text-muted-foreground">
                                  Efficiency
                                </div>
                              </div>
                            </div>
                          </div>
                        )
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="text-muted-foreground text-sm">
                    No similar historical pairings found (60%+ match required)
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row justify-end space-y-2 sm:space-y-0 sm:space-x-3 sticky -bottom-6 bg-background py-4 border-t border-border">
          <Button variant="outline" size="sm" className="w-full sm:w-auto">
            Export Details
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="w-full sm:w-auto"
            disabled={addToCalendarMutation.isPending}
            onClick={async () => {
              try {
                console.log('Add to Calendar button clicked');
                if (!pairing) {
                  toast({
                    title: 'Error',
                    description: 'No pairing data available',
                    variant: 'destructive',
                  });
                  return;
                }

                if (!currentUser) {
                  toast({
                    title: 'Profile Required',
                    description:
                      'Please complete your profile before adding pairings to your calendar.',
                    variant: 'destructive',
                  });
                  return;
                }

                // Extract effective dates from fullTextBlock if available
                let effectiveDates = pairing.effectiveDates || '';
                const pairingDays = pairing.pairingDays || 1;

                if (pairing.fullTextBlock) {
                  // Multi-pass parsing to capture all exception types
                  let dateRange = '';
                  let dayOfWeekExceptions = '';
                  let specificDateExceptions = '';

                  // Extract the base date range
                  const effectiveMatch = pairing.fullTextBlock.match(
                    /EFFECTIVE\s+([A-Z]{3}\d{1,2}(?:-[A-Z]{3}\.?\s*\d{1,2})?)/i
                  );
                  if (effectiveMatch) {
                    dateRange = effectiveMatch[1].trim();
                  }

                  // Extract day-of-week exceptions (can appear as "EXCPT MO SA SU" before EFFECTIVE)
                  const dayOfWeekMatch = pairing.fullTextBlock.match(
                    /(?:EXCPT|EXCEPT)\s+([A-Z]{2}(?:\s+[A-Z]{2})*)\s+EFFECTIVE/i
                  );
                  if (dayOfWeekMatch) {
                    dayOfWeekExceptions = dayOfWeekMatch[1].trim();
                  }

                  // Extract specific date exceptions (can appear anywhere in fullTextBlock as "EXCEPT OCT 16 OCT 21")
                  const specificDateMatch = pairing.fullTextBlock.match(
                    /EXCEPT\s+((?:[A-Z]{3}\s+\d{1,2}\s*)+)/i
                  );
                  if (specificDateMatch) {
                    specificDateExceptions = specificDateMatch[1].trim();
                  }

                  // Combine all parts
                  if (dateRange) {
                    effectiveDates = dateRange;
                    if (dayOfWeekExceptions || specificDateExceptions) {
                      const allExceptions = [
                        dayOfWeekExceptions,
                        specificDateExceptions,
                      ]
                        .filter(Boolean)
                        .join(' ');
                      effectiveDates = `${dateRange} EXCEPT ${allExceptions}`;
                    }
                  }
                }

                console.log('Parsing effective dates:', effectiveDates);

                // Use the utility function to calculate all valid start dates
                const possibleStartDates = calculateValidStartDates(
                  effectiveDates,
                  bidPackageYear,
                  pairingDays,
                  {
                    operatingDows: (pairing as any).operatingDows,
                    exceptDates: (pairing as any).exceptDates,
                  }
                );

                console.log(
                  'Possible start dates found:',
                  possibleStartDates.length,
                  possibleStartDates.map(d => d.toLocaleDateString())
                );

                if (possibleStartDates.length === 0) {
                  toast({
                    title: 'Error',
                    description: 'Could not parse any valid dates from pairing',
                    variant: 'destructive',
                  });
                  return;
                }

                // Multiple dates: open selection dialog
                if (possibleStartDates.length > 1) {
                  setDateOptions(possibleStartDates);
                  setSelectedDates({});
                  console.log(
                    'Opening date chooser with options:',
                    possibleStartDates.map(d => d.toDateString())
                  );
                  setShowDateChooser(true);
                  return;
                }

                // Single date - calculate actual duty times
                const baseDate = possibleStartDates[0];
                const segments = pairing.flightSegments || [];
                const startDate =
                  segments.length > 0
                    ? calculateDutyStartTime(baseDate, segments[0])
                    : baseDate;
                const endDate =
                  segments.length > 0
                    ? calculateDutyEndTime(
                        baseDate,
                        segments[segments.length - 1]
                      )
                    : new Date(
                        baseDate.getTime() +
                          (pairingDays - 1) * 24 * 60 * 60 * 1000
                      );

                addToCalendarMutation.mutate({
                  userId: currentUser.id,
                  pairingId: pairing.id,
                  startDate,
                  endDate,
                });
              } catch (error) {
                const errorMessage =
                  error instanceof Error
                    ? error.message
                    : 'Unknown error occurred';
                toast({
                  title: 'Error',
                  description: `Failed to add pairing to calendar: ${errorMessage}`,
                  variant: 'destructive',
                });
              }
            }}
          >
            <Calendar
              className={`h-4 w-4 mr-2 ${isAddedToCalendar ? 'text-green-500' : ''}`}
            />
            {addToCalendarMutation.isPending
              ? 'Adding...'
              : isAddedToCalendar
                ? 'Added to Calendar'
                : 'Add to Calendar'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="w-full sm:w-auto"
            disabled={isAddingFavorite || isFavorited}
            onClick={async () => {
              if (isFavorited) {
                return;
              } // Prevent double-adding

              if (!currentUser) {
                toast({
                  title: 'Profile Required',
                  description:
                    'Please complete your profile before adding favorites.',
                  variant: 'destructive',
                });
                return;
              }

              try {
                setIsAddingFavorite(true);
                await api.addFavorite(currentUser.id, pairingId);
                setIsFavorited(true);
                queryClient.invalidateQueries({
                  queryKey: ['favorites', currentUser.id],
                });
                queryClient.invalidateQueries({ queryKey: ['favorites'] }); // Also invalidate the modal's favorites query
              } catch (error) {
                console.error('Error adding favorite:', error);
                setIsFavorited(false);
              } finally {
                setIsAddingFavorite(false);
              }
            }}
          >
            <Heart
              className={`h-4 w-4 mr-2 ${isFavorited ? 'fill-red-500 text-red-500' : ''}`}
            />
            {isAddingFavorite
              ? 'Adding...'
              : isFavorited
                ? 'Added to Favorites'
                : 'Add to Favorites'}
          </Button>
        </div>

        {/* Multi-date chooser dialog */}
        {showDateChooser && (
          <Dialog open={showDateChooser} onOpenChange={setShowDateChooser}>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Select start dates</DialogTitle>
                <DialogDescription>
                  This pairing appears on multiple start dates. Choose which
                  dates to add to your calendar.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2">
                {dateOptions.map(d => (
                  <label key={d.getTime()} className="flex items-center gap-2">
                    <Checkbox
                      checked={!!selectedDates[d.getTime()]}
                      onCheckedChange={(val: boolean) =>
                        setSelectedDates(prev => ({
                          ...prev,
                          [d.getTime()]: !!val,
                        }))
                      }
                    />
                    <span className="text-sm">
                      {d.toLocaleDateString('en-US', {
                        weekday: 'short',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </span>
                  </label>
                ))}
              </div>
              <div className="pt-3 flex justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowDateChooser(false)}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={async () => {
                    try {
                      setShowDateChooser(false);

                      if (!currentUser) {
                        toast({
                          title: 'Profile Required',
                          description:
                            'Please complete your profile before adding pairings to your calendar.',
                          variant: 'destructive',
                        });
                        return;
                      }

                      const starts = dateOptions.filter(
                        d => selectedDates[d.getTime()]
                      );
                      if (starts.length === 0) {
                        toast({
                          title: 'No dates selected',
                          description: 'Please choose at least one date.',
                        });
                        return;
                      }
                      for (const baseDate of starts) {
                        const pairingDays = pairing.pairingDays || 1;
                        const segments = pairing.flightSegments || [];
                        const dutyStart =
                          segments.length > 0
                            ? calculateDutyStartTime(baseDate, segments[0])
                            : baseDate;
                        const dutyEnd =
                          segments.length > 0
                            ? calculateDutyEndTime(
                                baseDate,
                                segments[segments.length - 1]
                              )
                            : new Date(
                                baseDate.getTime() +
                                  (pairingDays - 1) * 24 * 60 * 60 * 1000
                              );

                        await api.addToCalendar(
                          currentUser.id,
                          pairing.id,
                          dutyStart,
                          dutyEnd
                        );
                      }
                      toast({
                        title: 'Success',
                        description: `Added ${starts.length} date${starts.length > 1 ? 's' : ''} to calendar.`,
                      });
                      queryClient.invalidateQueries({ queryKey: ['calendar'] });
                      queryClient.invalidateQueries({
                        queryKey: ['calendarEvents'],
                      });
                      queryClient.refetchQueries({ queryKey: ['calendar'] });
                      queryClient.refetchQueries({
                        queryKey: ['calendarEvents'],
                      });
                      setIsAddedToCalendar(true);
                    } catch (err) {
                      toast({
                        title: 'Error',
                        description: 'Failed to add selected dates.',
                        variant: 'destructive',
                      });
                    }
                  }}
                >
                  Add Selected
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </DialogContent>
    </Dialog>
  );
}
