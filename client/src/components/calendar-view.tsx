import React, { useState } from 'react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, addMonths, subMonths, startOfWeek, endOfWeek, differenceInDays, addDays, isBefore, isAfter } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, Trash2, AlertTriangle } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/hooks/use-toast';

type CalendarEvent = {
  id: number;
  userId: number;
  pairingId: number;
  startDate: string;
  endDate: string;
  notes?: string;
  pairing: {
    id: number;
    pairingNumber: string;
    route: string;
    creditHours: string;
    blockHours: string;
    tafb: string;
    checkInTime?: string;
  };
};

type CalendarViewProps = {
  userId: number;
};

export function CalendarView({ userId }: CalendarViewProps) {
  // Set to August 2025 to show the bid period starting from August 31st
  const [currentDate, setCurrentDate] = useState(new Date(2025, 7, 31)); // August 31, 2025 (month is 0-indexed)
  const queryClient = useQueryClient();
  
  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const calendarStart = startOfWeek(monthStart, { weekStartsOn: 0 }); // Sunday
  const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
  const calendarDays = eachDayOfInterval({ start: calendarStart, end: calendarEnd });

  // Fetch calendar events for current month
  const { data: events = [], isLoading } = useQuery<CalendarEvent[]>({
    queryKey: ['calendar', userId, currentDate.getMonth() + 1, currentDate.getFullYear()],
    queryFn: async () => {
      const response = await fetch(`/api/calendar/${userId}/${currentDate.getMonth() + 1}/${currentDate.getFullYear()}`);
      if (!response.ok) throw new Error('Failed to fetch calendar events');
      return response.json();
    },
    staleTime: 0, // Always fetch fresh data
    refetchOnMount: true,
  });

  // Remove from calendar mutation
  const removeFromCalendarMutation = useMutation({
    mutationFn: async ({ userId, pairingId }: { userId: number; pairingId: number }) => {
      const response = await fetch('/api/calendar', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, pairingId }),
      });
      if (!response.ok) throw new Error('Failed to remove from calendar');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['calendar', userId] });
      toast({ title: 'Success', description: 'Pairing removed from calendar' });
    },
    onError: () => {
      toast({ title: 'Error', description: 'Failed to remove pairing from calendar', variant: 'destructive' });
    },
  });

  // Extract destination codes from route for display
  const getDestinationFromRoute = (route: string): string => {
    const airports = route.split('-');
    // Find the furthest destination (not the home base)
    const destinations = airports.filter(airport => airport !== 'JFK' && airport !== 'NYC');
    return destinations.length > 0 ? destinations[0] : airports[1] || '';
  };

  // Check for FAA crew rest violations
  const checkCrewRestViolations = (events: CalendarEvent[]): CalendarEvent[] => {
    const sortedEvents = events.sort((a, b) => 
      new Date(a.startDate).getTime() - new Date(b.startDate).getTime()
    );
    
    const violatingEvents: CalendarEvent[] = [];
    
    for (let i = 0; i < sortedEvents.length - 1; i++) {
      const currentEnd = new Date(sortedEvents[i].endDate);
      const nextStart = new Date(sortedEvents[i + 1].startDate);
      
      // Calculate hours between trips
      const hoursBetween = (nextStart.getTime() - currentEnd.getTime()) / (1000 * 60 * 60);
      
      // FAA requires minimum 10 hours rest between duty periods
      if (hoursBetween < 10) {
        violatingEvents.push(sortedEvents[i], sortedEvents[i + 1]);
      }
    }
    
    return violatingEvents;
  };

  const crewRestViolations = checkCrewRestViolations(events);
  
  const getEventSpan = (event: CalendarEvent, startDay: Date): { span: number; isStart: boolean } => {
    const eventStart = new Date(event.startDate);
    const eventEnd = new Date(event.endDate);
    const weekStart = startOfWeek(startDay, { weekStartsOn: 0 });
    const weekEnd = endOfWeek(startDay, { weekStartsOn: 0 });
    
    const displayStart = isBefore(eventStart, weekStart) ? weekStart : eventStart;
    const displayEnd = isAfter(eventEnd, weekEnd) ? weekEnd : eventEnd;
    
    const span = differenceInDays(displayEnd, displayStart) + 1;
    const isStart = isSameDay(eventStart, displayStart) || isSameDay(eventStart, startDay);
    
    return { span, isStart };
  };

  const getEventsForWeek = (weekStartDay: Date): CalendarEvent[] => {
    const weekEndDay = endOfWeek(weekStartDay, { weekStartsOn: 0 });
    return events.filter(event => {
      const eventStart = new Date(event.startDate);
      const eventEnd = new Date(event.endDate);
      return !(isAfter(eventStart, weekEndDay) || isBefore(eventEnd, weekStartDay));
    });
  };

  const handleRemoveFromCalendar = (pairingId: number) => {
    removeFromCalendarMutation.mutate({ userId, pairingId });
  };

  const navigateMonth = (direction: 'prev' | 'next') => {
    setCurrentDate(prev => direction === 'next' ? addMonths(prev, 1) : subMonths(prev, 1));
  };

  // Calculate weeks for the calendar
  const weeks = [];
  for (let i = 0; i < calendarDays.length; i += 7) {
    weeks.push(calendarDays.slice(i, i + 7));
  }

  return (
    <div className="space-y-4">
      {/* Navigation Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="outline" size="sm" onClick={() => navigateMonth('prev')}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="text-center min-w-[200px]">
            <h2 className="text-2xl font-bold">
              {format(currentDate, 'MMMM yyyy')}
            </h2>
            <p className="text-sm text-gray-600">
              Bid Period: Aug 31 - Sep 30, 2025
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => navigateMonth('next')}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        {crewRestViolations.length > 0 && (
          <div className="flex items-center gap-2 text-red-600 bg-red-50 px-3 py-2 rounded">
            <AlertTriangle className="h-4 w-4" />
            <span className="text-sm font-medium">{crewRestViolations.length} FAA Rest Violations</span>
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center p-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      ) : (
        <div className="bg-white border rounded-lg overflow-hidden">
          {/* Day headers */}
          <div className="grid grid-cols-7 bg-gray-50 border-b">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
              <div key={day} className="p-3 text-center font-semibold text-gray-700 border-r last:border-r-0">
                {day}
              </div>
            ))}
          </div>
          
          {/* Calendar weeks */}
          {weeks.map((week, weekIndex) => {
            const weekEvents = getEventsForWeek(week[0]);
            
            return (
              <div key={weekIndex} className="relative border-b last:border-b-0">
                {/* Day numbers and basic layout */}
                <div className="grid grid-cols-7 min-h-[120px]">
                  {week.map((day, dayIndex) => {
                    const isCurrentMonth = isSameMonth(day, currentDate);
                    const isToday = isSameDay(day, new Date());
                    
                    return (
                      <div
                        key={day.toISOString()}
                        className={`p-2 border-r last:border-r-0 relative ${
                          !isCurrentMonth ? 'bg-gray-50 text-gray-400' : 'bg-white'
                        }`}
                      >
                        <div className={`text-lg font-semibold ${
                          isToday ? 'bg-blue-600 text-white rounded-full w-8 h-8 flex items-center justify-center' : 
                          isCurrentMonth ? 'text-gray-900' : 'text-gray-400'
                        }`}>
                          {format(day, 'd')}
                        </div>
                      </div>
                    );
                  })}
                </div>
                
                {/* Pairing bars overlay */}
                <div className="absolute inset-0 pointer-events-none">
                  {weekEvents.map((event, eventIndex) => {
                    const eventStart = new Date(event.startDate);
                    const eventEnd = new Date(event.endDate);
                    
                    // Find which day in the week this event starts
                    let startDayIndex = -1;
                    for (let i = 0; i < week.length; i++) {
                      if (isSameDay(week[i], eventStart) || 
                          (isBefore(eventStart, week[i]) && i === 0)) {
                        startDayIndex = i;
                        break;
                      }
                    }
                    
                    if (startDayIndex === -1) return null;
                    
                    const { span } = getEventSpan(event, week[startDayIndex]);
                    const isViolation = crewRestViolations.some(v => v.id === event.id);
                    const destination = getDestinationFromRoute(event.pairing.route);
                    
                    const topOffset = 40 + (eventIndex * 30); // Stack events vertically
                    const leftOffset = (startDayIndex * (100 / 7)) + 0.5; // Percentage based positioning
                    const width = (span * (100 / 7)) - 1; // Span across days
                    
                    return (
                      <div
                        key={event.id}
                        className={`absolute pointer-events-auto group cursor-pointer ${
                          isViolation ? 'bg-red-500' : 'bg-blue-600'
                        }`}
                        style={{
                          left: `${leftOffset}%`,
                          width: `${width}%`,
                          top: `${topOffset}px`,
                          height: '24px',
                        }}
                        onClick={() => handleRemoveFromCalendar(event.pairingId)}
                      >
                        <div className="flex items-center justify-between h-full px-2 text-white text-sm font-bold">
                          <span className="truncate">
                            {event.pairing.pairingNumber}
                          </span>
                          <span className="text-xs font-normal ml-1 truncate">
                            {destination}
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="opacity-0 group-hover:opacity-100 h-4 w-4 p-0 hover:bg-red-100 ml-1"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRemoveFromCalendar(event.pairingId);
                            }}
                            disabled={removeFromCalendarMutation.isPending}
                          >
                            <Trash2 className="h-3 w-3 text-white" />
                          </Button>
                        </div>
                        
                        {/* Tooltip on hover */}
                        <div className="absolute bottom-full left-0 mb-2 px-2 py-1 bg-gray-900 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10">
                          {event.pairing.pairingNumber}: {event.pairing.creditHours} credit hrs
                          {isViolation && (
                            <div className="text-red-300">⚠️ FAA Rest Violation</div>
                          )}
                        </div>
                      </div>
                    );
                  }).filter(Boolean)}
                </div>
              </div>
            );
          })}
        </div>
      )}
      
      {events.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-6">
          <div className="bg-blue-50 p-4 rounded-lg">
            <div className="text-sm font-medium text-blue-700">Total Pairings</div>
            <div className="text-2xl font-bold text-blue-900">{events.length}</div>
          </div>
          <div className="bg-green-50 p-4 rounded-lg">
            <div className="text-sm font-medium text-green-700">Total Credit Hours</div>
            <div className="text-2xl font-bold text-green-900">
              {events.reduce((sum, event) => sum + parseFloat(event.pairing.creditHours), 0).toFixed(2)}
            </div>
          </div>
          <div className="bg-purple-50 p-4 rounded-lg">
            <div className="text-sm font-medium text-purple-700">Total Block Hours</div>
            <div className="text-2xl font-bold text-purple-900">
              {events.reduce((sum, event) => sum + parseFloat(event.pairing.blockHours), 0).toFixed(2)}
            </div>
          </div>
          {crewRestViolations.length > 0 && (
            <div className="bg-red-50 p-4 rounded-lg">
              <div className="text-sm font-medium text-red-700">FAA Rest Violations</div>
              <div className="text-2xl font-bold text-red-900">{crewRestViolations.length}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}