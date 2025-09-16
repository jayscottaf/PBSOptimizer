import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { X, Heart, Calendar } from "lucide-react";
import { api } from "@/lib/api";
import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";
import { Checkbox } from "@/components/ui/checkbox";
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

  // Check if this pairing is already in user's favorites
  const { data: userFavorites = [] } = useQuery({
    queryKey: ["favorites"],
    queryFn: async () => {
      try {
        const seniorityNumber = localStorage.getItem('seniorityNumber') || "15860";
        const base = localStorage.getItem('base') || "NYC";
        const aircraft = localStorage.getItem('aircraft') || "A220";
        const user = await api.createOrUpdateUser({ seniorityNumber: parseInt(seniorityNumber), base, aircraft });
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
      const isAlreadyFavorited = userFavorites.some((fav: any) => fav.id === pairingId);
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
      console.log('Mutation function called with:', { userId, pairingId, startDate, endDate });
      const result = await api.addToCalendar(userId, pairingId, startDate, endDate);
      console.log('Mutation result:', result);
      return result;
    },
    onSuccess: data => {
      console.log('Calendar mutation success:', data);
      toast({ title: 'Success', description: 'Pairing added to calendar successfully' });
      queryClient.invalidateQueries({ queryKey: ['calendar'] });
      queryClient.refetchQueries({ queryKey: ['calendar'] });
      setIsAddedToCalendar(true);
    },
    onError: (error: any) => {
      console.error('Calendar mutation error:', error);
      const errorMessage = error?.message || 'Unknown error occurred while adding to calendar';
      toast({ title: 'Error', description: `Failed to add to calendar: ${errorMessage}`, variant: 'destructive' });
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
          <Button variant="outline" size="sm" className="w-full sm:w-auto">Export Details</Button>
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
                // Parse effective dates to get possible start dates
                const effectiveDateStr = pairing.effectiveDates;
                console.log('Parsing effective dates:', effectiveDateStr);

                const currentYear = new Date().getFullYear(); // Use the current year
                const monthMap: { [key: string]: number } = {
                  JAN: 0,
                  FEB: 1,
                  MAR: 2,
                  APR: 3,
                  MAY: 4,
                  JUN: 5,
                  JUL: 6,
                  AUG: 7,
                  SEP: 8,
                  OCT: 9,
                  NOV: 10,
                  DEC: 11,
                };
                const weekdayMap: Record<string, number> = {
                  SU: 0,
                  MO: 1,
                  TU: 2,
                  WE: 3,
                  TH: 4,
                  FR: 5,
                  SA: 6,
                };

                // Function to parse a single date like "SEP10" or "31AUG" or "10SEP"
                const parseSingleDate = (dateStr: string) => {
                  console.log('Parsing single date:', dateStr);

                  // Try different patterns
                  const patterns = [
                    /(\d{1,2})([A-Z]{3})/,  // "10SEP"
                    /([A-Z]{3})(\d{1,2})/,  // "SEP10"
                    /(\d{1,2})\s*([A-Z]{3})/,  // "10 SEP"
                    /([A-Z]{3})\s*(\d{1,2})/   // "SEP 10"
                  ];

                  for (const pattern of patterns) {
                    const match = dateStr.match(pattern);
                    if (match) {
                      const [, first, second] = match;
                      let day, month;

                      // Determine if first part is day or month
                      if (first in monthMap) {
                        month = first;
                        day = second;
                      } else if (second in monthMap) {
                        day = first;
                        month = second;
                      }

                      if (month && day && month in monthMap) {
                        const parsedDate = new Date(currentYear, monthMap[month], parseInt(day));
                        console.log('Parsed date:', parsedDate);
                        return parsedDate;
                      }
                    }
                  }
                  return null;
                };

                const possibleStartDates: Date[] = [];

                // Check for date range format "01SEP-30SEP" or "SEP01-SEP30"
                const rangePatterns = [
                  /(\d{1,2})([A-Z]{3})-(\d{1,2})([A-Z]{3})/,  // "01SEP-30SEP"
                  /([A-Z]{3})(\d{1,2})-([A-Z]{3})(\d{1,2})/   // "SEP01-SEP30"
                ];

                let rangeMatch = null;
                for (const pattern of rangePatterns) {
                  rangeMatch = effectiveDateStr.match(pattern);
                  if (rangeMatch) break;
                }

                if (rangeMatch) {
                  console.log('Found range match:', rangeMatch);
                  const [, first, second, third, fourth] = rangeMatch;
                  let startDay, startMonth, endDay, endMonth;

                  // Determine format
                  if (first in monthMap) {
                    // Format: SEP01-SEP30
                    startMonth = first;
                    startDay = second;
                    endMonth = third;
                    endDay = fourth;
                  } else {
                    // Format: 01SEP-30SEP
                    startDay = first;
                    startMonth = second;
                    endDay = third;
                    endMonth = fourth;
                  }

                  if (startMonth in monthMap && endMonth in monthMap) {
                    const startDate = new Date(currentYear, monthMap[startMonth], parseInt(startDay));
                    const endDate = new Date(currentYear, monthMap[endMonth], parseInt(endDay));

                    console.log('Parsed range:', startDate, 'to', endDate);

                    // For range, just use the start date as the primary option
                    possibleStartDates.push(startDate);
                  }
                } else {
                  // Try parsing as single date
                  const singleDate = parseSingleDate(effectiveDateStr);
                  if (singleDate) {
                    possibleStartDates.push(singleDate);
                  } else {
                    // Fallback: try to extract any date-like pattern
                    const fallbackMatch = effectiveDateStr.match(/(\d{1,2})|([A-Z]{3})/g);
                    if (fallbackMatch && fallbackMatch.length >= 2) {
                      const day = fallbackMatch.find(m => /^\d{1,2}$/.test(m));
                      const month = fallbackMatch.find(m => /^[A-Z]{3}$/.test(m));

                      if (day && month && month in monthMap) {
                        const fallbackDate = new Date(currentYear, monthMap[month], parseInt(day));
                        console.log('Fallback parsed date:', fallbackDate);
                        possibleStartDates.push(fallbackDate);
                      }
                    }
                  }
                }
                console.log('Possible start dates found:', possibleStartDates.length, possibleStartDates.map(d => d.toLocaleDateString()));

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
                  const init: Record<number, boolean> = {};
                  possibleStartDates.forEach(d => {
                    init[d.getTime()] = true;
                  });
                  setSelectedDates(init);
                  console.log(
                    'Opening date chooser with options:',
                    possibleStartDates.map(d => d.toDateString())
                  );
                  setShowDateChooser(true);
                  return;
                }

                // Single date
                const startDate = possibleStartDates[0];
                const pairingDays = pairing.pairingDays || 4;
                const endDate = new Date(startDate);
                endDate.setDate(endDate.getDate() + pairingDays - 1);
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
              if (isFavorited) return; // Prevent double-adding

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
                queryClient.invalidateQueries({ queryKey: ["favorites", user.id] });
                queryClient.invalidateQueries({ queryKey: ["favorites"] }); // Also invalidate the modal's favorites query
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
                      for (const startDate of starts) {
                        const pairingDays = pairing.pairingDays || 4;
                        const endDate = new Date(startDate);
                        endDate.setDate(endDate.getDate() + pairingDays - 1);
                        await api.addToCalendar(
                          user.id,
                          pairing.id,
                          startDate,
                          endDate
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
