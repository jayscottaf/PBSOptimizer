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
import { X, Heart, Calendar } from 'lucide-react';
import { api } from '@/lib/api';
import { useState, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from '@/hooks/use-toast';
import { Checkbox } from '@/components/ui/checkbox';
import { calculateValidStartDates } from '@/lib/pairingDates';
import { calculateDutyStartTime, calculateDutyEndTime } from '@shared/dutyTimeCalculator';
interface PairingModalProps {
  pairingId: number;
  onClose: () => void;
}

export function PairingModal({ pairingId, onClose }: PairingModalProps) {
  const [isAddingFavorite, setIsAddingFavorite] = useState(false);
  const [isFavorited, setIsFavorited] = useState(false);
  const [isAddedToCalendar, setIsAddedToCalendar] = useState(false);
  const [showDateChooser, setShowDateChooser] = useState(false);
  const [dateOptions, setDateOptions] = useState<Date[]>([]);
  const [selectedDates, setSelectedDates] = useState<Record<number, boolean>>(
    {}
  );
  const queryClient = useQueryClient();

  const { data: pairing, isLoading } = useQuery({
    queryKey: ['/api/pairings', pairingId],
    queryFn: () => api.getPairing(pairingId),
    staleTime: 0, // Always fetch fresh data
    refetchOnMount: true,
  });

  const { data: bidHistory = [] } = useQuery({
    queryKey: ['/api/history', pairing?.pairingNumber],
    queryFn: () =>
      pairing ? api.getBidHistory(pairing.pairingNumber) : Promise.resolve([]),
    enabled: !!pairing,
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
    queryKey: ['favorites'],
    queryFn: async () => {
      try {
        const seniorityNumber =
          localStorage.getItem('seniorityNumber') || '15860';
        const base = localStorage.getItem('base') || 'NYC';
        const aircraft = localStorage.getItem('aircraft') || 'A220';
        const user = await api.createOrUpdateUser({
          seniorityNumber: parseInt(seniorityNumber),
          base,
          aircraft,
        });
        return await api.getFavorites(user.id);
      } catch (error) {
        return [];
      }
    },
    enabled: !!pairingId,
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
      queryClient.refetchQueries({ queryKey: ['calendar'] });
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
            <div className="text-gray-500">Loading pairing details...</div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  const flightSegments = pairing.flightSegments || [];

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-screen overflow-y-auto w-[95vw] sm:w-full">
        <DialogHeader>
          <DialogTitle className="text-lg sm:text-xl">
            Pairing Details - {pairing.pairingNumber}
          </DialogTitle>
          <DialogDescription className="text-sm">
            Detailed view of pairing {pairing.pairingNumber} with flight
            segments, layovers, and bid history.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 sm:space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
            {/* Pairing Overview */}
            <div className="space-y-2 sm:space-y-4">
              <h4 className="font-semibold text-gray-900 text-sm sm:text-base">
                Overview
              </h4>
              <Card>
                <CardContent className="p-3 sm:p-4 bg-gray-50 font-mono text-xs sm:text-sm space-y-1">
                  <div>
                    <span className="text-gray-600">Pairing:</span>{' '}
                    {pairing.pairingNumber}
                  </div>
                  <div>
                    <span className="text-gray-600">Effective:</span>{' '}
                    {pairing.effectiveDates}
                  </div>
                  {pairing.payHours && (
                    <div>
                      <span className="text-gray-600">Total Pay:</span>{' '}
                      {pairing.payHours}
                    </div>
                  )}
                  <div>
                    <span className="text-gray-600">Credit:</span>{' '}
                    {pairing.creditHours}
                  </div>
                  <div>
                    <span className="text-gray-600">Block:</span>{' '}
                    {pairing.blockHours}
                  </div>
                  <div>
                    <span className="text-gray-600">TAFB:</span> {pairing.tafb}{' '}
                    hours
                  </div>
                  <div>
                    <span className="text-gray-600">Days:</span>{' '}
                    {pairing.pairingDays || 'N/A'}
                  </div>
                  {pairing.fdp && (
                    <div>
                      <span className="text-gray-600">FDP:</span> {pairing.fdp}
                    </div>
                  )}
                  {pairing.deadheads > 0 && (
                    <div>
                      <span className="text-gray-600">Deadheads:</span>{' '}
                      {pairing.deadheads}
                    </div>
                  )}
                  {pairing.holdProbability !== undefined && (
                    <div>
                      <span className="text-gray-600">Hold Probability:</span>{' '}
                      <span className={
                        pairing.holdProbability >= 70 ? 'text-green-600 font-medium' :
                        pairing.holdProbability >= 50 ? 'text-yellow-600 font-medium' :
                        'text-red-600 font-medium'
                      }>
                        {pairing.holdProbability}%
                      </span>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Flight Segments */}
            <div className="space-y-2 sm:space-y-4">
              <h4 className="font-semibold text-gray-900 text-sm sm:text-base">
                Flight Segments
              </h4>
              <div className="space-y-2 max-h-48 sm:max-h-64 overflow-y-auto">
                {flightSegments.length > 0 ? (
                  (() => {
                    // Group flights by day letter (A, B, C, etc.)
                    const groupedByDay = flightSegments.reduce(
                      (acc: any, segment: any) => {
                        const dayLetter = segment.date || 'A';
                        if (!acc[dayLetter]) {
                          acc[dayLetter] = [];
                        }
                        acc[dayLetter].push(segment);
                        return acc;
                      },
                      {}
                    );

                    const dayOrder = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
                    const sortedDays = dayOrder.filter(
                      day => groupedByDay[day]
                    );

                    return sortedDays.map((dayLetter, dayIndex) => (
                      <Card key={dayLetter}>
                        <CardContent className="p-2 sm:p-3 bg-blue-50 border border-blue-200 font-mono text-xs sm:text-sm">
                          <div className="font-medium text-blue-900 mb-2 text-xs sm:text-sm">
                            Day {dayIndex + 1} - {dayLetter}
                          </div>
                          {groupedByDay[dayLetter].map(
                            (segment: any, segIndex: number) => (
                              <div
                                key={segIndex}
                                className="text-blue-800 mb-1 text-xs sm:text-sm break-all sm:break-normal"
                              >
                                {segment.flightNumber} {segment.departure}{' '}
                                {segment.departureTime} {segment.arrival}{' '}
                                {segment.arrivalTime} ({segment.blockTime})
                                {segment.isDeadhead && (
                                  <span className="text-orange-600 ml-2">
                                    [DH]
                                  </span>
                                )}
                              </div>
                            )
                          )}
                        </CardContent>
                      </Card>
                    ));
                  })()
                ) : (
                  <div className="text-gray-500 text-sm">
                    No flight segment details available
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Full Text Block */}
          <div className="space-y-2 sm:space-y-4">
            <h4 className="font-semibold text-gray-900 text-sm sm:text-base">
              Full Pairing Text
            </h4>
            <Card>
              <CardContent className="p-2 sm:p-4">
                <pre className="text-xs font-mono whitespace-pre-wrap bg-gray-50 p-2 sm:p-4 rounded border overflow-x-auto max-h-32 sm:max-h-none overflow-y-auto sm:overflow-y-visible">
                  {pairing.fullTextBlock || 'No full text block available'}
                </pre>
              </CardContent>
            </Card>
          </div>

          {/* Historical Awards */}
          <div className="space-y-2 sm:space-y-4">
            <h4 className="font-semibold text-gray-900 text-sm sm:text-base">
              Historical Awards
            </h4>
            <Card>
              <CardContent className="p-2 sm:p-4">
                {bidHistory.length > 0 ? (
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                    <div className="text-sm text-yellow-800">
                      <div className="font-medium mb-2">
                        Recent awards for similar pairings:
                      </div>
                      <div className="space-y-1 font-mono">
                        {bidHistory
                          .slice(0, 3)
                          .map((award: any, index: number) => (
                            <div key={index}>
                              • {award.month} {award.year}: Junior holder #
                              {award.juniorHolderSeniority}
                            </div>
                          ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-gray-500 text-sm">
                    No historical award data available
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row justify-end space-y-2 sm:space-y-0 sm:space-x-3 pt-4 border-t border-gray-200">
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

                const seniorityNumber =
                  localStorage.getItem('seniorityNumber') || '15860';
                const base = localStorage.getItem('base') || 'NYC';
                const aircraft = localStorage.getItem('aircraft') || 'A220';

                const user = await api.createOrUpdateUser({
                  seniorityNumber: parseInt(seniorityNumber),
                  base,
                  aircraft,
                });

                // Extract effective dates from fullTextBlock if available
                let effectiveDates = pairing.effectiveDates || '';
                const pairingDays = pairing.pairingDays || 1;

                if (pairing.fullTextBlock) {
                  // Multi-pass parsing to capture all exception types
                  let dateRange = '';
                  let dayOfWeekExceptions = '';
                  let specificDateExceptions = '';

                  // Extract the base date range
                  const effectiveMatch = pairing.fullTextBlock.match(/EFFECTIVE\s+([A-Z]{3}\d{1,2}(?:-[A-Z]{3}\.?\s*\d{1,2})?)/i);
                  if (effectiveMatch) {
                    dateRange = effectiveMatch[1].trim();
                  }

                  // Extract day-of-week exceptions (can appear as "EXCPT MO SA SU" before EFFECTIVE)
                  const dayOfWeekMatch = pairing.fullTextBlock.match(/(?:EXCPT|EXCEPT)\s+([A-Z]{2}(?:\s+[A-Z]{2})*)\s+EFFECTIVE/i);
                  if (dayOfWeekMatch) {
                    dayOfWeekExceptions = dayOfWeekMatch[1].trim();
                  }

                  // Extract specific date exceptions (can appear anywhere in fullTextBlock as "EXCEPT OCT 16 OCT 21")
                  const specificDateMatch = pairing.fullTextBlock.match(/EXCEPT\s+((?:[A-Z]{3}\s+\d{1,2}\s*)+)/i);
                  if (specificDateMatch) {
                    specificDateExceptions = specificDateMatch[1].trim();
                  }

                  // Combine all parts
                  if (dateRange) {
                    effectiveDates = dateRange;
                    if (dayOfWeekExceptions || specificDateExceptions) {
                      const allExceptions = [dayOfWeekExceptions, specificDateExceptions]
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
                  pairingDays
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
                const startDate = segments.length > 0
                  ? calculateDutyStartTime(baseDate, segments[0])
                  : baseDate;
                const endDate = segments.length > 0
                  ? calculateDutyEndTime(baseDate, segments[segments.length - 1])
                  : new Date(baseDate.getTime() + (pairingDays - 1) * 24 * 60 * 60 * 1000);

                addToCalendarMutation.mutate({
                  userId: user.id,
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

              try {
                setIsAddingFavorite(true);
                const seniorityNumber =
                  localStorage.getItem('seniorityNumber') || '15860';
                const base = localStorage.getItem('base') || 'NYC';
                const aircraft = localStorage.getItem('aircraft') || 'A220';
                const user = await api.createOrUpdateUser({
                  seniorityNumber: parseInt(seniorityNumber),
                  base,
                  aircraft,
                });
                await api.addFavorite(user.id, pairingId);
                setIsFavorited(true);
                queryClient.invalidateQueries({
                  queryKey: ['favorites', user.id],
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
                      const seniorityNumber =
                        localStorage.getItem('seniorityNumber') || '15860';
                      const base = localStorage.getItem('base') || 'NYC';
                      const aircraft =
                        localStorage.getItem('aircraft') || 'A220';
                      const user = await api.createOrUpdateUser({
                        seniorityNumber: parseInt(seniorityNumber),
                        base,
                        aircraft,
                      });

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
                        const dutyStart = segments.length > 0
                          ? calculateDutyStartTime(baseDate, segments[0])
                          : baseDate;
                        const dutyEnd = segments.length > 0
                          ? calculateDutyEndTime(baseDate, segments[segments.length - 1])
                          : new Date(baseDate.getTime() + (pairingDays - 1) * 24 * 60 * 60 * 1000);

                        await api.addToCalendar(
                          user.id,
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
                      queryClient.refetchQueries({ queryKey: ['calendar'] });
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
