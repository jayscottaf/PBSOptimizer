import React, { useState } from 'react';
import {
  format,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  addMonths,
  subMonths,
  startOfWeek,
  endOfWeek,
  differenceInDays,
  isBefore,
  isAfter,
} from 'date-fns';
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
  bidPackageId?: number;
};

export function CalendarView({ userId, bidPackageId }: CalendarViewProps) {
  // Get user profile from localStorage for ALV matching
  const [userProfile, setUserProfile] = useState<{
    base?: string;
    aircraft?: string;
    position?: string;
  }>({});

  React.useEffect(() => {
    try {
      const base = localStorage.getItem('base') || undefined;
      const aircraft = localStorage.getItem('aircraft') || undefined;
      const position = localStorage.getItem('position') || undefined;
      setUserProfile({ base, aircraft, position });
    } catch (error) {
      console.error('Error loading user profile:', error);
    }
  }, []);

  // Get latest bid package info for dynamic date initialization
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

  const latestBidPackage = React.useMemo(() => {
    if (!bidPackages || bidPackages.length === 0) {
      return null;
    }
    const packagesArray = (bidPackages as any[]).slice();
    packagesArray.sort(
      (a, b) =>
        new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()
    );
    const mostRecentCompleted = packagesArray.find(
      (pkg: any) => pkg.status === 'completed'
    );
    return mostRecentCompleted || packagesArray[0];
  }, [bidPackages]);

  // Calculate user's ALV based on profile and bid package ALV table
  const userALV = React.useMemo(() => {
    const defaultALV = 85; // Only used if no bid package or profile

    if (!latestBidPackage) {
      console.warn('No bid package available for ALV calculation');
      return defaultALV;
    }

    // Try to match user's profile to ALV table FIRST (most specific)
    if (latestBidPackage.alvTable && Array.isArray(latestBidPackage.alvTable)) {
      const { base, aircraft, position } = userProfile;

      if (base && aircraft && position) {
        console.log(`Looking for ALV match: base=${base}, aircraft=${aircraft}, position=${position}`);
        console.log('Available ALV table:', latestBidPackage.alvTable);

        // Normalize inputs for matching
        const normalizedBase = base.replace(/[^a-z]/gi, '').toUpperCase();
        const normalizedAircraft = aircraft.replace(/[^a-z0-9]/gi, '').toUpperCase();
        const normalizedPosition = position.toUpperCase();

        // Try to find match with flexible aircraft matching and exact position match
        const match = latestBidPackage.alvTable.find((entry: any) => {
          const entryAircraft = String(entry.aircraft || '').replace(/[^a-z0-9]/gi, '').toUpperCase();
          const entryBase = String(entry.base || '').toUpperCase();
          const entryPosition = String(entry.position || '').toUpperCase();

          // Base must match exactly
          const baseMatches = entryBase === normalizedBase || entryBase.includes(normalizedBase);

          // Aircraft can match in various ways (220, A220, etc.)
          const aircraftMatches =
            entryAircraft === normalizedAircraft ||
            entryAircraft.includes(normalizedAircraft) ||
            normalizedAircraft.includes(entryAircraft);

          // Position must match exactly
          const positionMatches = entryPosition === normalizedPosition;

          return baseMatches && aircraftMatches && positionMatches;
        });

        if (match && match.alvHours) {
          console.log(`✅ Matched ALV for ${base} ${aircraft} ${position}: ${match.alvHours}h from table entry:`, match);
          return match.alvHours;
        } else {
          console.warn(`❌ No ALV match found for ${base} ${aircraft} ${position}. Available entries:`,
            latestBidPackage.alvTable.map((e: any) => `${e.base} ${e.aircraft} ${e.position}`));
        }
      } else {
        console.warn('User profile incomplete - missing base, aircraft, or position', userProfile);
      }
    }

    // If no table match, check for default ALV
    if (latestBidPackage.alvHours) {
      const alvFromPackage = parseFloat(latestBidPackage.alvHours as string);
      if (!isNaN(alvFromPackage) && alvFromPackage > 0) {
        console.log(`Using default ALV from bid package: ${alvFromPackage}h`);
        return alvFromPackage;
      }
    }

    // Last resort fallback
    console.warn('⚠️ Using hardcoded fallback ALV of 85h - bid package should have ALV data!');
    return defaultALV;
  }, [latestBidPackage, userProfile]);

  // Initialize to current date, will be updated when bid package loads
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const queryClient = useQueryClient();

  // Update calendar month when bid package data loads
  React.useEffect(() => {
    if (latestBidPackage?.month && latestBidPackage?.year) {
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

      const monthIndex = monthMap[latestBidPackage.month] ?? new Date().getMonth();
      const targetDate = new Date(latestBidPackage.year, monthIndex, 1);

      // Only update if we're not already on the correct month
      if (currentDate.getMonth() !== monthIndex || currentDate.getFullYear() !== latestBidPackage.year) {
        setCurrentDate(targetDate);
      }
    }
  }, [latestBidPackage?.month, latestBidPackage?.year]);

  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const calendarStart = startOfWeek(monthStart, { weekStartsOn: 0 }); // Sunday
  const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
  const calendarDays = eachDayOfInterval({
    start: calendarStart,
    end: calendarEnd,
  });

  // Fetch calendar events for current month - using a wider range to catch carryover pairings
  const { data: events = [], isLoading } = useQuery<CalendarEvent[]>({
    queryKey: [
      'calendar',
      userId,
      currentDate.getMonth() + 1,
      currentDate.getFullYear(),
    ],
    queryFn: async () => {
      // Get events for a wider range to ensure we catch all carryover pairings
      const startOfCalendarView = calendarStart;
      const endOfCalendarView = calendarEnd;
      console.log('Fetching calendar events for date range:', {
        start: startOfCalendarView.toISOString(),
        end: endOfCalendarView.toISOString(),
        month: currentDate.getMonth() + 1,
        year: currentDate.getFullYear(),
      });

      const response = await fetch(
        `/api/users/${userId}/calendar?startDate=${startOfCalendarView.toISOString()}&endDate=${endOfCalendarView.toISOString()}`
      );
      if (!response.ok) {
        throw new Error('Failed to fetch calendar events');
      }
      const result = await response.json();
      console.log('Calendar events fetched:', result);
      return result;
    },
    staleTime: 0, // Always fetch fresh data
    refetchOnMount: true,
  });

  // Fetch bid package stats for the active bid package
  const { data: bidPackageStats } = useQuery({
    queryKey: ['bid-package-stats', bidPackageId || null],
    queryFn: async () => {
      if (!bidPackageId) {
        return null;
      }
      const response = await fetch(`/api/bid-packages/${bidPackageId}/stats`);
      if (!response.ok) {
        return null;
      }
      return response.json();
    },
    enabled: !!bidPackageId,
    staleTime: 5 * 60 * 1000,
  });

  // Remove from calendar mutation
  const removeFromCalendarMutation = useMutation({
    mutationFn: async ({
      userId,
      pairingId,
    }: {
      userId: number;
      pairingId: number;
    }) => {
      const response = await fetch(
        `/api/users/${userId}/calendar/${pairingId}`,
        {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
        }
      );
      if (!response.ok) {
        throw new Error('Failed to remove from calendar');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['calendar', userId] });
      toast({ title: 'Success', description: 'Pairing removed from calendar' });
    },
    onError: () => {
      toast({
        title: 'Error',
        description: 'Failed to remove pairing from calendar',
        variant: 'destructive',
      });
    },
  });

  // Extract destination codes from route for display
  const getDestinationFromRoute = (route: string): string => {
    const airports = route.split('-');
    // Find the furthest destination (not the home base)
    const destinations = airports.filter(
      airport => airport !== 'JFK' && airport !== 'NYC'
    );
    return destinations.length > 0 ? destinations[0] : airports[1] || '';
  };

  // Check for FAA crew rest violations
  const checkCrewRestViolations = (
    events: CalendarEvent[]
  ): CalendarEvent[] => {
    const sortedEvents = events.sort(
      (a, b) =>
        new Date(a.startDate).getTime() - new Date(b.startDate).getTime()
    );

    const violatingEvents: CalendarEvent[] = [];

    for (let i = 0; i < sortedEvents.length - 1; i++) {
      const currentEnd = new Date(sortedEvents[i].endDate);
      const nextStart = new Date(sortedEvents[i + 1].startDate);

      // Calculate hours between trips
      const hoursBetween =
        (nextStart.getTime() - currentEnd.getTime()) / (1000 * 60 * 60);

      // FAA requires minimum 10 hours rest between duty periods
      if (hoursBetween < 10) {
        violatingEvents.push(sortedEvents[i], sortedEvents[i + 1]);
      }
    }

    return violatingEvents;
  };

  const crewRestViolations = checkCrewRestViolations(events);

  const getEventSpan = (
    event: CalendarEvent,
    startDay: Date
  ): { span: number; isStart: boolean } => {
    const eventStart = new Date(event.startDate);
    const eventEnd = new Date(event.endDate);
    const weekStart = startOfWeek(startDay, { weekStartsOn: 0 });
    const weekEnd = endOfWeek(startDay, { weekStartsOn: 0 });

    const displayStart = isBefore(eventStart, weekStart)
      ? weekStart
      : eventStart;
    const displayEnd = isAfter(eventEnd, weekEnd) ? weekEnd : eventEnd;

    const span = differenceInDays(displayEnd, displayStart) + 1;
    const isStart =
      isSameDay(eventStart, displayStart) || isSameDay(eventStart, startDay);

    return { span, isStart };
  };

  const getEventsForWeek = (weekStartDay: Date): CalendarEvent[] => {
    const weekEndDay = endOfWeek(weekStartDay, { weekStartsOn: 0 });
    return events.filter(event => {
      const eventStart = new Date(event.startDate);
      const eventEnd = new Date(event.endDate);
      return !(
        isAfter(eventStart, weekEndDay) || isBefore(eventEnd, weekStartDay)
      );
    });
  };

  const handleRemoveFromCalendar = (pairingId: number) => {
    removeFromCalendarMutation.mutate({ userId, pairingId });
  };

  const navigateMonth = (direction: 'prev' | 'next') => {
    setCurrentDate(prev =>
      direction === 'next' ? addMonths(prev, 1) : subMonths(prev, 1)
    );
  };

  // Calculate stats
  const totalCreditHours = events.reduce((sum, event) => {
    return (
      sum + (parseFloat(event.pairing?.creditHours?.toString() || '0') || 0)
    );
  }, 0);

  const totalBlockHours = events.reduce((sum, event) => {
    return (
      sum + (parseFloat(event.pairing?.blockHours?.toString() || '0') || 0)
    );
  }, 0);

  // Calculate total working days and days off
  const totalWorkingDays = events.reduce((sum, event) => {
    return sum + (event.pairing?.pairingDays || 0);
  }, 0);

  // Calculate days off (total days in month minus working days)
  const daysInMonth = new Date(
    currentDate.getFullYear(),
    currentDate.getMonth() + 1,
    0
  ).getDate();
  const totalDaysOff = daysInMonth - totalWorkingDays;

  const ratio = totalBlockHours > 0 ? totalCreditHours / totalBlockHours : 0;

  // Use actual bid package statistics for efficiency scoring
  const hasStats =
    !!bidPackageStats && (bidPackageStats.totalPairings || 0) > 0;
  const minRatio = hasStats ? bidPackageStats.creditBlockRatios.min : undefined;
  const maxRatio = hasStats ? bidPackageStats.creditBlockRatios.max : undefined;
  const avgRatio = hasStats
    ? bidPackageStats.creditBlockRatios.average
    : undefined;

  // Calculate percentile-based rating using actual bid package range
  let ratioLabel = 'Average';
  let ratioDotColor = 'bg-orange-500';

  if (hasStats && minRatio !== undefined && maxRatio !== undefined && maxRatio > minRatio) {
    const range = maxRatio - minRatio;
    const percentile = (ratio - minRatio) / range;

    if (percentile >= 0.80) {
      ratioLabel = 'Excellent';
      ratioDotColor = 'bg-green-500';
    } else if (percentile >= 0.60) {
      ratioLabel = 'Good';
      ratioDotColor = 'bg-blue-500';
    } else if (percentile >= 0.40) {
      ratioLabel = 'Average';
      ratioDotColor = 'bg-orange-500';
    } else if (percentile >= 0.20) {
      ratioLabel = 'Below Average';
      ratioDotColor = 'bg-yellow-500';
    } else {
      ratioLabel = 'Poor';
      ratioDotColor = 'bg-red-500';
    }
  } else {
    // Fallback to fixed thresholds if no stats available
    if (ratio >= 1.3) {
      ratioLabel = 'Excellent';
      ratioDotColor = 'bg-green-500';
    } else if (ratio >= 1.2) {
      ratioLabel = 'Good';
      ratioDotColor = 'bg-blue-500';
    } else if (ratio >= 1.1) {
      ratioLabel = 'Average';
      ratioDotColor = 'bg-orange-500';
    } else {
      ratioLabel = 'Poor';
      ratioDotColor = 'bg-red-500';
    }
  }

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
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigateMonth('prev')}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="text-center min-w-[200px]">
            <h2 className="text-2xl font-bold">
              {format(currentDate, 'MMMM yyyy')}
            </h2>
            <p className="text-sm text-gray-600">
              {bidPackageId && latestBidPackage
                ? `Bid Package: ${latestBidPackage.month} ${latestBidPackage.year}`
                : 'Calendar View'}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigateMonth('next')}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        {crewRestViolations.length > 0 && (
          <div className="flex items-center gap-2 text-red-600 bg-red-50 px-3 py-2 rounded">
            <AlertTriangle className="h-4 w-4" />
            <span className="text-sm font-medium">
              {crewRestViolations.length} FAA Rest Violations
            </span>
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
              <div
                key={day}
                className="p-3 text-center font-semibold text-gray-700 border-r last:border-r-0"
              >
                {day}
              </div>
            ))}
          </div>

          {/* Calendar weeks */}
          {weeks.map((week, weekIndex) => {
            const weekEvents = getEventsForWeek(week[0]);

            return (
              <div
                key={weekIndex}
                className="relative border-b last:border-b-0"
              >
                {/* Day numbers and basic layout */}
                <div className="grid grid-cols-7 min-h-[120px]">
                  {week.map((day, _dayIndex) => {
                    const isCurrentMonth = isSameMonth(day, currentDate);
                    const isToday = isSameDay(day, new Date());

                    return (
                      <div
                        key={day.toISOString()}
                        className={`p-2 border-r last:border-r-0 relative ${
                          !isCurrentMonth
                            ? 'bg-gray-50 text-gray-400'
                            : 'bg-white'
                        }`}
                      >
                        <div
                          className={`text-lg font-semibold ${
                            isToday
                              ? 'bg-blue-600 text-white rounded-full w-8 h-8 flex items-center justify-center'
                              : isCurrentMonth
                                ? 'text-gray-900'
                                : 'text-gray-400'
                          }`}
                        >
                          {format(day, 'd')}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Pairing bars overlay */}
                <div className="absolute inset-0 pointer-events-none">
                  {weekEvents
                    .map((event, eventIndex) => {
                      const eventStart = new Date(event.startDate);

                      // Find which day in the week this event starts
                      let startDayIndex = -1;
                      for (let i = 0; i < week.length; i++) {
                        if (
                          isSameDay(week[i], eventStart) ||
                          (isBefore(eventStart, week[i]) && i === 0)
                        ) {
                          startDayIndex = i;
                          break;
                        }
                      }

                      if (startDayIndex === -1) {
                        return null;
                      }

                      const { span } = getEventSpan(event, week[startDayIndex]);
                      const isViolation = crewRestViolations.some(
                        v => v.id === event.id
                      );
                      const destination = getDestinationFromRoute(
                        event.pairing.route
                      );

                      const topOffset = 40 + eventIndex * 30; // Stack events vertically
                      const leftOffset = startDayIndex * (100 / 7) + 0.5; // Percentage based positioning
                      const width = span * (100 / 7) - 1; // Span across days

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
                          onClick={() =>
                            handleRemoveFromCalendar(event.pairingId)
                          }
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
                              onClick={e => {
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
                            {event.pairing.pairingNumber}:{' '}
                            {event.pairing.creditHours} credit hrs
                            {isViolation && (
                              <div className="text-red-300">
                                ⚠️ FAA Rest Violation
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })
                    .filter(Boolean)}
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
              <CardTitle className="text-xl font-semibold text-gray-900">
                Monthly Overview
              </CardTitle>
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
                      <div className="text-sm text-gray-600">
                        Total Pairings
                      </div>
                      <div className="text-xs text-gray-500">This month</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold text-gray-900">
                      {events.length}
                    </div>
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
                      <div className="text-xs text-gray-500">Target: {userALV.toFixed(0)}h</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold text-gray-900">
                      {totalCreditHours.toFixed(2)}
                    </div>
                    <div className={`text-xs px-2 py-1 rounded-full ${
                      totalCreditHours >= userALV
                        ? 'text-green-600 bg-green-100'
                        : 'text-orange-600 bg-orange-100'
                    }`}>
                      {totalCreditHours >= userALV ? '+' : ''}{(totalCreditHours - userALV).toFixed(1)}h
                    </div>
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>Progress</span>
                    <span>{totalCreditHours.toFixed(1)}/{userALV.toFixed(0)}</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-green-500 h-2 rounded-full transition-all duration-300"
                      style={{
                        width: `${Math.min((totalCreditHours / userALV) * 100, 100)}%`,
                      }}
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
                    <div className="text-2xl font-bold text-gray-900">
                      {totalBlockHours.toFixed(2)}
                    </div>
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
                      style={{
                        width: `${Math.min((totalBlockHours / 85) * 100, 100)}%`,
                      }}
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
                    <div className="text-2xl font-bold text-gray-900">
                      {totalWorkingDays}
                    </div>
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
                      style={{
                        width: `${Math.min((totalWorkingDays / 30) * 100, 100)}%`,
                      }}
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
                    <div className="text-2xl font-bold text-gray-900">
                      {totalDaysOff}
                    </div>
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
                      style={{
                        width: `${Math.min((totalDaysOff / 30) * 100, 100)}%`,
                      }}
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
                      <div className="text-sm text-gray-600">
                        Credit/Block Ratio
                      </div>
                      <div
                        className={`text-xs px-2 py-1 rounded-full ${
                          ratio >= 1.3
                            ? 'text-green-600 bg-green-100'
                            : ratio >= 1.2
                              ? 'text-blue-600 bg-blue-100'
                              : ratio >= 1.1
                                ? 'text-orange-600 bg-orange-100'
                                : 'text-red-600 bg-red-100'
                        }`}
                      >
                        {ratioLabel}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold text-gray-900">
                      {ratio.toFixed(2)}
                    </div>
                    <div className="flex items-center gap-1 justify-end">
                      <div className={`w-2 h-2 ${ratioDotColor} rounded-full`}></div>
                      <span className="text-xs text-gray-500">({ratioLabel})</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Efficiency Score */}
            <div className="mt-6 p-4 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg border border-blue-100">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                    📈
                  </div>
                  <div>
                    <div className="text-sm font-medium text-gray-900">
                      Efficiency Score
                    </div>
                    <div className="text-xs text-gray-600">
                      Compared to all {bidPackageStats?.totalPairings || 0}{' '}
                      pairings in bid package
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-3xl font-bold text-blue-600">
                    {hasStats &&
                    minRatio !== undefined &&
                    maxRatio !== undefined &&
                    maxRatio > minRatio
                      ? Math.round(
                          Math.min(
                            100,
                            Math.max(
                              0,
                              ((ratio - minRatio) / (maxRatio - minRatio)) * 100
                            )
                          )
                        )
                      : 0}
                    %
                  </div>
                  <div className="text-sm text-blue-600 font-medium">
                    {hasStats ? ratioLabel : 'Insufficient data'}
                  </div>
                </div>
              </div>

              {hasStats && (
                <div className="text-xs text-gray-600 space-y-1">
                  <div className="flex justify-between">
                    <span>Your ratio: {ratio.toFixed(2)}</span>
                    <span>Package average: {avgRatio!.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>
                      Package range: {minRatio!.toFixed(2)} -{' '}
                      {maxRatio!.toFixed(2)}
                    </span>
                    <span
                      className={
                        ratio > (avgRatio as number)
                          ? 'text-green-600'
                          : 'text-orange-600'
                      }
                    >
                      {ratio > (avgRatio as number) ? '+' : ''}
                      {(
                        ((ratio - (avgRatio as number)) /
                          (avgRatio as number)) *
                        100
                      ).toFixed(1)}
                      % vs avg
                    </span>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
