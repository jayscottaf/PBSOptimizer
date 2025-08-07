import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { X, Heart, Calendar } from "lucide-react";
import { api } from "@/lib/api";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";

interface PairingModalProps {
  pairingId: number;
  onClose: () => void;
}

export function PairingModal({ pairingId, onClose }: PairingModalProps) {
  const [isAddingFavorite, setIsAddingFavorite] = useState(false);
  const [isFavorited, setIsFavorited] = useState(false);
  const [isAddedToCalendar, setIsAddedToCalendar] = useState(false);
  const queryClient = useQueryClient();

  const { data: pairing, isLoading } = useQuery({
    queryKey: ["/api/pairings", pairingId],
    queryFn: () => api.getPairing(pairingId),
    staleTime: 0, // Always fetch fresh data
    refetchOnMount: true,
  });

  const { data: bidHistory = [] } = useQuery({
    queryKey: ["/api/history", pairing?.pairingNumber],
    queryFn: () => pairing ? api.getBidHistory(pairing.pairingNumber) : Promise.resolve([]),
    enabled: !!pairing,
  });

  // Add to calendar mutation
  const addToCalendarMutation = useMutation({
    mutationFn: async ({ userId, pairingId, startDate, endDate }: {
      userId: number;
      pairingId: number;
      startDate: Date;
      endDate: Date;
    }) => {
      return api.addToCalendar(userId, pairingId, startDate, endDate);
    },
    onSuccess: (data) => {
      console.log('Calendar mutation success:', data);
      setIsAddedToCalendar(true);
      // Invalidate all calendar queries to refresh the view
      queryClient.invalidateQueries({ queryKey: ['calendar'] });
      queryClient.refetchQueries({ queryKey: ['calendar'] });
      toast({ title: 'Success', description: 'Pairing added to calendar successfully!' });
    },
    onError: (error: any) => {
      console.error('Calendar mutation error:', error);
      toast({ title: 'Error', description: error.message || 'Failed to add pairing to calendar', variant: 'destructive' });
    },
  });

  if (isLoading || !pairing) {
    return (
      <Dialog open={true} onOpenChange={onClose}>
        <DialogContent className="max-w-4xl max-h-screen overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Loading Pairing</DialogTitle>
            <DialogDescription>Please wait while we fetch pairing details...</DialogDescription>
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
            Detailed view of pairing {pairing.pairingNumber} with flight segments, layovers, and bid history.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 sm:space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
            {/* Pairing Overview */}
            <div className="space-y-2 sm:space-y-4">
              <h4 className="font-semibold text-gray-900 text-sm sm:text-base">Overview</h4>
              <Card>
                <CardContent className="p-3 sm:p-4 bg-gray-50 font-mono text-xs sm:text-sm space-y-1">
                  <div><span className="text-gray-600">Pairing:</span> {pairing.pairingNumber}</div>
                  <div><span className="text-gray-600">Effective:</span> {pairing.effectiveDates}</div>
                  {pairing.payHours && <div><span className="text-gray-600">Total Pay:</span> {pairing.payHours}</div>}
                  <div><span className="text-gray-600">Credit:</span> {pairing.creditHours}</div>
                  <div><span className="text-gray-600">Block:</span> {pairing.blockHours}</div>
                  <div><span className="text-gray-600">TAFB:</span> {pairing.tafb} hours</div>
                  <div><span className="text-gray-600">Days:</span> {pairing.pairingDays || 'N/A'}</div>
                  {pairing.fdp && <div><span className="text-gray-600">FDP:</span> {pairing.fdp}</div>}
                  {pairing.deadheads > 0 && <div><span className="text-gray-600">Deadheads:</span> {pairing.deadheads}</div>}
                </CardContent>
              </Card>
            </div>

            {/* Flight Segments */}
            <div className="space-y-2 sm:space-y-4">
              <h4 className="font-semibold text-gray-900 text-sm sm:text-base">Flight Segments</h4>
              <div className="space-y-2 max-h-48 sm:max-h-64 overflow-y-auto">
                {flightSegments.length > 0 ? (
                  (() => {
                    // Group flights by day letter (A, B, C, etc.)
                    const groupedByDay = flightSegments.reduce((acc: any, segment: any) => {
                      const dayLetter = segment.date || 'A';
                      if (!acc[dayLetter]) acc[dayLetter] = [];
                      acc[dayLetter].push(segment);
                      return acc;
                    }, {});

                    const dayOrder = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
                    const sortedDays = dayOrder.filter(day => groupedByDay[day]);

                    return sortedDays.map((dayLetter, dayIndex) => (
                      <Card key={dayLetter}>
                        <CardContent className="p-2 sm:p-3 bg-blue-50 border border-blue-200 font-mono text-xs sm:text-sm">
                          <div className="font-medium text-blue-900 mb-2 text-xs sm:text-sm">
                            Day {dayIndex + 1} - {dayLetter}
                          </div>
                          {groupedByDay[dayLetter].map((segment: any, segIndex: number) => (
                            <div key={segIndex} className="text-blue-800 mb-1 text-xs sm:text-sm break-all sm:break-normal">
                              {segment.flightNumber} {segment.departure} {segment.departureTime} {segment.arrival} {segment.arrivalTime} ({segment.blockTime})
                              {segment.isDeadhead && <span className="text-orange-600 ml-2">[DH]</span>}
                            </div>
                          ))}
                        </CardContent>
                      </Card>
                    ));
                  })()
                ) : (
                  <div className="text-gray-500 text-sm">No flight segment details available</div>
                )}
              </div>
            </div>
          </div>

          {/* Full Text Block */}
          <div className="space-y-2 sm:space-y-4">
            <h4 className="font-semibold text-gray-900 text-sm sm:text-base">Full Pairing Text</h4>
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
            <h4 className="font-semibold text-gray-900 text-sm sm:text-base">Historical Awards</h4>
            <Card>
              <CardContent className="p-2 sm:p-4">
                {bidHistory.length > 0 ? (
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                    <div className="text-sm text-yellow-800">
                      <div className="font-medium mb-2">Recent awards for similar pairings:</div>
                      <div className="space-y-1 font-mono">
                        {bidHistory.slice(0, 3).map((award: any, index: number) => (
                          <div key={index}>
                            • {award.month} {award.year}: Junior holder #{award.juniorHolderSeniority}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-gray-500 text-sm">No historical award data available</div>
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
                  console.error('No pairing data available');
                  toast({ title: 'Error', description: 'No pairing data available', variant: 'destructive' });
                  return;
                }

                const seniorityNumber = localStorage.getItem('seniorityNumber') || "15860";
                const base = localStorage.getItem('base') || "NYC";
                const aircraft = localStorage.getItem('aircraft') || "A220";

                console.log('Adding to calendar - pairing:', pairing.pairingNumber, 'effective dates:', pairing.effectiveDates);

                // Create or update user first
                const user = await api.createOrUpdateUser({
                  seniorityNumber: parseInt(seniorityNumber),
                  base,
                  aircraft
                });

                console.log('User created/updated:', user);

                // Parse effective dates - can be formats like "SEP10", "31AUG,03SEP", "01SEP-30SEP"
                const effectiveDateStr = pairing.effectiveDates;
                const currentYear = new Date().getFullYear();

                console.log('Parsing date string:', effectiveDateStr);

                const monthMap: { [key: string]: number } = {
                  'JAN': 0, 'FEB': 1, 'MAR': 2, 'APR': 3, 'MAY': 4, 'JUN': 5,
                  'JUL': 6, 'AUG': 7, 'SEP': 8, 'OCT': 9, 'NOV': 10, 'DEC': 11
                };

                // Function to parse a single date like "SEP10" or "31AUG"
                const parseSingleDate = (dateStr: string) => {
                  const match = dateStr.match(/(\d{1,2})([A-Z]{3})|([A-Z]{3})(\d{1,2})/);
                  if (match) {
                    const [, dayFirst, monthFirst, monthSecond, daySecond] = match;
                    const day = dayFirst || daySecond;
                    const month = monthFirst || monthSecond;
                    
                    if (month in monthMap && day) {
                      return new Date(currentYear, monthMap[month], parseInt(day));
                    }
                  }
                  return null;
                };

                let possibleStartDates: Date[] = [];

                // Check for multiple dates separated by comma
                if (effectiveDateStr.includes(',')) {
                  const dates = effectiveDateStr.split(',').map(d => d.trim());
                  for (const dateStr of dates) {
                    const parsed = parseSingleDate(dateStr);
                    if (parsed) {
                      possibleStartDates.push(parsed);
                    }
                  }
                } else {
                  // Check for date range format "01SEP-30SEP"
                  const rangeMatch = effectiveDateStr.match(/(\d{1,2})([A-Z]{3})-(\d{1,2})([A-Z]{3})/);
                  if (rangeMatch) {
                    const [, startDay, startMonth, endDay, endMonth] = rangeMatch;
                    
                    if (startMonth in monthMap && endMonth in monthMap) {
                      const startDate = new Date(currentYear, monthMap[startMonth], parseInt(startDay));
                      const endDate = new Date(currentYear, monthMap[endMonth], parseInt(endDay));
                      
                      console.log('Range dates:', { startDate, endDate });
                      
                      addToCalendarMutation.mutate({
                        userId: user.id,
                        pairingId: pairingId,
                        startDate,
                        endDate
                      });
                      return;
                    }
                  } else {
                    // Single date format
                    const parsed = parseSingleDate(effectiveDateStr);
                    if (parsed) {
                      possibleStartDates.push(parsed);
                    }
                  }
                }

                if (possibleStartDates.length === 0) {
                  toast({ title: 'Error', description: 'Could not parse any valid dates from pairing', variant: 'destructive' });
                  return;
                }

                // If multiple start dates, ask user to choose
                if (possibleStartDates.length > 1) {
                  const dateOptions = possibleStartDates.map(date => 
                    date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                  ).join(' or ');
                  
                  const choice = confirm(`This pairing has multiple start dates: ${dateOptions}. Click OK to add all dates, or Cancel to add only the first date.`);
                  
                  if (choice) {
                    // Add all dates
                    for (const startDate of possibleStartDates) {
                      const pairingDays = pairing.pairingDays || 4;
                      const endDate = new Date(startDate);
                      endDate.setDate(endDate.getDate() + pairingDays - 1);
                      
                      console.log('Adding date range:', { startDate, endDate, days: pairingDays });
                      
                      try {
                        await api.addToCalendar(user.id, pairing.id, startDate, endDate);
                      } catch (error) {
                        console.error('Error adding one of the date ranges:', error);
                      }
                    }
                    
                    toast({ title: 'Success', description: `Added ${possibleStartDates.length} date ranges to calendar!` });
                    setIsAddedToCalendar(true);
                    queryClient.invalidateQueries({ queryKey: ['calendar'] });
                    queryClient.refetchQueries({ queryKey: ['calendar'] });
                    return;
                  } else {
                    // Use only the first date
                    possibleStartDates = [possibleStartDates[0]];
                  }
                }

                // Single start date
                const startDate = possibleStartDates[0];
                const pairingDays = pairing.pairingDays || 4;
                const endDate = new Date(startDate);
                endDate.setDate(endDate.getDate() + pairingDays - 1);

                console.log('Adding single date range:', { startDate, endDate, days: pairingDays });

                addToCalendarMutation.mutate({
                  userId: user.id,
                  pairingId: pairing.id,
                  startDate,
                  endDate
                });

              } catch (error) {
                console.error('Error adding to calendar:', error);
                const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
                toast({ title: 'Error', description: `Failed to add pairing to calendar: ${errorMessage}`, variant: 'destructive' });
              }
            }}
          >
            <Calendar className={`h-4 w-4 mr-2 ${isAddedToCalendar ? 'text-green-500' : ''}`} />
            {addToCalendarMutation.isPending ? 'Adding...' : isAddedToCalendar ? 'Added to Calendar' : 'Add to Calendar'}
          </Button>
          <Button 
            variant="outline" 
            size="sm"
            className="w-full sm:w-auto"
            disabled={isAddingFavorite}
            onClick={async () => {
              try {
                setIsAddingFavorite(true);
                const seniorityNumber = localStorage.getItem('seniorityNumber') || "15860";
                const base = localStorage.getItem('base') || "NYC";
                const aircraft = localStorage.getItem('aircraft') || "A220";

                // Create or update user first
                const user = await api.createOrUpdateUser({
                  seniorityNumber: parseInt(seniorityNumber),
                  base,
                  aircraft
                });

                // Add to favorites
                await api.addFavorite(user.id, pairingId);

                // Update state for visual feedback
                setIsFavorited(true);

                // Invalidate favorites query to refresh the favorites tab
                queryClient.invalidateQueries({
                  queryKey: ["favorites", seniorityNumber]
                });

                // Show success feedback
                console.log('Added to favorites successfully');
              } catch (error) {
                console.error('Error adding to favorites:', error);
                setIsFavorited(false);
              } finally {
                setIsAddingFavorite(false);
              }
            }}
          >
            <Heart className={`h-4 w-4 mr-2 ${isFavorited ? 'fill-red-500 text-red-500' : ''}`} />
            {isAddingFavorite ? 'Adding...' : isFavorited ? 'Added to Favorites' : 'Add to Favorites'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}