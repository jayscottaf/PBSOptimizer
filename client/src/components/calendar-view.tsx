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
    pairingDays?: number; // Added for calculating working days
  };
};

type CalendarViewProps = {
  userId: number;
};

export function CalendarView({ userId }: CalendarViewProps) {
  // Set to September 2025 for the bid month (even though bid period starts Aug 31)
  const [currentDate, setCurrentDate] = useState(new Date(2025, 8, 1)); // September 1, 2025 (month is 0-indexed)
  const queryClient = useQueryClient();

  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const calendarStart = startOfWeek(monthStart, { weekStartsOn: 0 }); // Sunday
  const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
  const calendarDays = eachDayOfInterval({ start: calendarStart, end: calendarEnd });

  // Fetch calendar events for current month - using a wider range to catch carryover pairings
  const { data: events = [], isLoading } = useQuery<CalendarEvent[]>({
    queryKey: ['calendar', userId, currentDate.getMonth() + 1, currentDate.getFullYear()],
    queryFn: async () => {
      // Get events for a wider range to ensure we catch all carryover pairings
      const startOfCalendarView = calendarStart;
      const endOfCalendarView = calendarEnd;

      const response = await fetch(`/api/calendar/${userId}?startDate=${startOfCalendarView.toISOString()}&endDate=${endOfCalendarView.toISOString()}`);
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

  // Calculate stats
  const totalCreditHours = events.reduce((sum, event) => {
    return sum + (parseFloat(event.pairing?.creditHours?.toString() || '0') || 0);
  }, 0);

  const totalBlockHours = events.reduce((sum, event) => {
    return sum + (parseFloat(event.pairing?.blockHours?.toString() || '0') || 0);
  }, 0);

  // Calculate total working days and days off
  const totalWorkingDays = events.reduce((sum, event) => {
    return sum + (event.pairing?.pairingDays || 0);
  }, 0);

  // Calculate days off (total days in month minus working days)
  const daysInMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0).getDate();
  const totalDaysOff = daysInMonth - totalWorkingDays;

  const ratio = totalBlockHours > 0 ? totalCreditHours / totalBlockHours : 0;
  let ratioLabel = 'Poor';
  if (ratio >= 1.3) ratioLabel = 'Excellent';
  else if (ratio >= 1.2) ratioLabel = 'Good';
  else if (ratio >= 1.1) ratioLabel = 'Average';

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
        <Card className="mt-6">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-xl font-semibold text-gray-900">Monthly Overview</CardTitle>
              <span className="text-sm text-gray-500">
                {format(currentDate, 'MMMM yyyy')} performance metrics
              </span>
            </div>
          </CardHeader>
          <CardContent className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
              {/* Total Pairings */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
                      📋
                    </div>
                    <div>
                      <div className="text-sm text-gray-600">Total Pairings</div>
                      <div className="text-xs text-gray-500">This month</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold text-gray-900">{events.length}</div>
                  </div>
                </div>
              </div>

              {/* Credit Hours */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center">
                      ⏱️
                    </div>
                    <div>
                      <div className="text-sm text-gray-600">Credit Hours</div>
                      <div className="text-xs text-gray-500">Target: 85h</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold text-gray-900">{totalCreditHours.toFixed(2)}</div>
                    <div className="text-xs text-green-600 bg-green-100 px-2 py-1 rounded-full">
                      +15.2h
                    </div>
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>Progress</span>
                    <span>{totalCreditHours.toFixed(1)}/85</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div 
                      className="bg-green-500 h-2 rounded-full transition-all duration-300" 
                      style={{ width: `${Math.min((totalCreditHours / 85) * 100, 100)}%` }}
                    ></div>
                  </div>
                </div>
              </div>

              {/* Block Hours */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-orange-100 rounded-lg flex items-center justify-center">
                      🛫
                    </div>
                    <div>
                      <div className="text-sm text-gray-600">Block Hours</div>
                      <div className="text-xs text-gray-500">Flight time</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold text-gray-900">{totalBlockHours.toFixed(2)}</div>
                    <div className="text-xs text-orange-600 bg-orange-100 px-2 py-1 rounded-full">
                      +12h
                    </div>
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>Progress</span>
                    <span>{totalBlockHours.toFixed(1)}/85</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div 
                      className="bg-orange-500 h-2 rounded-full transition-all duration-300" 
                      style={{ width: `${Math.min((totalBlockHours / 85) * 100, 100)}%` }}
                    ></div>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Days Working */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-purple-100 rounded-lg flex items-center justify-center">
                      📅
                    </div>
                    <div>
                      <div className="text-sm text-gray-600">Days Working</div>
                      <div className="text-xs text-green-600">+40%</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold text-gray-900">{totalWorkingDays}</div>
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>Progress</span>
                    <span>{totalWorkingDays}/30</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div 
                      className="bg-purple-500 h-2 rounded-full transition-all duration-300" 
                      style={{ width: `${Math.min((totalWorkingDays / 30) * 100, 100)}%` }}
                    ></div>
                  </div>
                </div>
              </div>

              {/* Days Off */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-emerald-100 rounded-lg flex items-center justify-center">
                      🏖️
                    </div>
                    <div>
                      <div className="text-sm text-gray-600">Days Off</div>
                      <div className="text-xs text-emerald-600">+60%</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold text-gray-900">{totalDaysOff}</div>
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>Progress</span>
                    <span>{totalDaysOff}/30</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div 
                      className="bg-emerald-500 h-2 rounded-full transition-all duration-300" 
                      style={{ width: `${Math.min((totalDaysOff / 30) * 100, 100)}%` }}
                    ></div>
                  </div>
                </div>
              </div>

              {/* Credit/Block Ratio */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
                      📊
                    </div>
                    <div>
                      <div className="text-sm text-gray-600">Credit/Block Ratio</div>
                      <div className={`text-xs px-2 py-1 rounded-full ${
                        ratio >= 1.3 ? 'text-green-600 bg-green-100' :
                        ratio >= 1.2 ? 'text-blue-600 bg-blue-100' :
                        ratio >= 1.1 ? 'text-orange-600 bg-orange-100' :
                        'text-red-600 bg-red-100'
                      }`}>
                        {ratioLabel}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold text-gray-900">{ratio.toFixed(2)}</div>
                    <div className="flex items-center gap-1">
                      <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                      <span className="text-xs text-gray-500">(Excellent)</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Efficiency Score */}
            <div className="mt-6 p-4 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg border border-blue-100">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                    📈
                  </div>
                  <div>
                    <div className="text-sm font-medium text-gray-900">Efficiency Score</div>
                    <div className="text-xs text-gray-600">Based on credit/block ratio and utilization</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-3xl font-bold text-blue-600">
                    {Math.round((ratio * 50) + (Math.min(totalCreditHours / 85, 1) * 50))}%
                  </div>
                  <div className="text-sm text-blue-600 font-medium">Excellent</div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}