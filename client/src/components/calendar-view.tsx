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
  startOfDay,
} from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, Trash2, AlertTriangle } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/hooks/use-toast';
import { PairingModal } from './pairing-modal';

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
    layovers?: Array<{ city?: string; hotel?: string; duration?: string }> | null;
    flightSegments?: Array<{
      date?: string; // day letter A/B/C/D...
      flightNumber?: string;
      departure?: string;
      departureTime?: string;
      arrival?: string;
      arrivalTime?: string;
    }> | null;
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
        }
        // Note: No match found, will try default ALV or fallback
      }
      // Note: Profile not fully loaded yet, will use default or fallback
    }

    // If no table match, check for default ALV
    if (latestBidPackage.alvHours) {
      const alvFromPackage = parseFloat(latestBidPackage.alvHours as string);
      if (!isNaN(alvFromPackage) && alvFromPackage > 0) {
        console.log(`Using default ALV from bid package: ${alvFromPackage}h`);
        return alvFromPackage;
      }
    }

    // Last resort fallback (only during initial load before bid package data is available)
    return defaultALV;
  }, [latestBidPackage, userProfile]);

  // Initialize to current date, will be updated when bid package loads
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [openPairingId, setOpenPairingId] = useState<number | null>(null);
  const queryClient = useQueryClient();

  // Update calendar month when bid package data loads
  React.useEffect(() => {
    if (latestBidPackage?.month && latestBidPackage?.year) {
      const monthMap: { [key: string]: number } = {
        JAN: 0, JANUARY: 0,
        FEB: 1, FEBRUARY: 1,
        MAR: 2, MARCH: 2,
        APR: 3, APRIL: 3,
        MAY: 4,
        JUN: 5, JUNE: 5,
        JUL: 6, JULY: 6,
        AUG: 7, AUGUST: 7,
        SEP: 8, SEPTEMBER: 8,
        OCT: 9, OCTOBER: 9,
        NOV: 10, NOVEMBER: 10,
        DEC: 11, DECEMBER: 11,
      };

      const monthKey = latestBidPackage.month.toUpperCase();
      const monthIndex = monthMap[monthKey] ?? new Date().getMonth();
      const targetDate = new Date(latestBidPackage.year, monthIndex, 1);

      console.log('Setting calendar to bid package month:', {
        month: latestBidPackage.month,
        year: latestBidPackage.year,
        monthIndex,
        targetDate: targetDate.toISOString()
      });

      // Only update if we're not already on the correct month
      if (currentDate.getMonth() !== monthIndex || currentDate.getFullYear() !== latestBidPackage.year) {
        setCurrentDate(targetDate);
      }
    }
  }, [latestBidPackage?.month, latestBidPackage?.year]);

  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);

  // Prefer the bid period dates from the PDF when present (e.g. May 2 → June 1
  // for a "May" Delta bid package). Falling back to the calendar month keeps
  // older packages (uploaded before the schema change) working unchanged.
  // The bid_period_start/end columns have stored both ISO ('YYYY-MM-DD') and
  // human-readable ('January 31, 2026') strings depending on when the
  // package was parsed, so this needs to handle both instead of assuming ISO
  // and silently producing an Invalid Date for the other format.
  const parseLocalDate = (raw: string): Date | null => {
    const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) {
      // Parse as local date components (not `new Date(iso)`) to avoid the
      // UTC-midnight interpretation shifting the date by a day depending on
      // the browser's timezone.
      const [, y, m, d] = isoMatch;
      return new Date(Number(y), Number(m) - 1, Number(d));
    }
    const parsed = new Date(raw);
    return isNaN(parsed.getTime()) ? null : parsed;
  };
  const bidStart = latestBidPackage?.bidPeriodStart
    ? parseLocalDate(latestBidPackage.bidPeriodStart as string)
    : null;
  const bidEnd = latestBidPackage?.bidPeriodEnd
    ? parseLocalDate(latestBidPackage.bidPeriodEnd as string)
    : null;
  const viewStart = bidStart ?? monthStart;
  const viewEnd = bidEnd ?? monthEnd;

  const calendarStart = startOfWeek(viewStart, { weekStartsOn: 0 }); // Sunday
  const calendarEnd = endOfWeek(viewEnd, { weekStartsOn: 0 });
  const calendarDays = eachDayOfInterval({
    start: calendarStart,
    end: calendarEnd,
  });

  const isInBidPeriod = (day: Date) => {
    if (!bidStart || !bidEnd) {
      return isSameMonth(day, currentDate);
    }
    const d = startOfDay(day).getTime();
    return d >= startOfDay(bidStart).getTime() && d <= startOfDay(bidEnd).getTime();
  };

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
      // Invalidate both the calendar view query and the dashboard calendar query
      queryClient.invalidateQueries({
        queryKey: [
          'calendar',
          userId,
          currentDate.getMonth() + 1,
          currentDate.getFullYear(),
        ],
      });
      // Also invalidate the dashboard's calendar events query to recalculate conflicts
      queryClient.invalidateQueries({ queryKey: ['calendarEvents', userId] });
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

  // Pilot's home base (filters out LGA/JFK/EWR etc. from the displayed route).
  const homeBase = (userProfile.base || '').toUpperCase();

  // Build the label shown on a calendar pairing bar. Prefer the actual
  // layovers list when present (e.g. "BOS · ATL" for a 3-day trip with two
  // overnights). Fall back to scanning the route string when layovers are
  // missing (older rows or 1-day turns with no overnight).
  const getPairingLabel = (
    pairing: CalendarEvent['pairing']
  ): string => {
    const layoverCities = (pairing.layovers ?? [])
      .map(l => (l?.city || '').toUpperCase())
      .filter(c => c && c !== homeBase);
    if (layoverCities.length > 0) {
      return Array.from(new Set(layoverCities)).join(' · ');
    }
    // Fallback: 1-day turn, or layovers field empty. Pick non-base airports
    // from the route string. Use the pilot's actual base when set; otherwise
    // fall back to the original NYC-area filter so legacy data still works.
    const baseFilter = new Set(
      homeBase ? [homeBase] : ['JFK', 'LGA', 'EWR', 'NYC']
    );
    const airports = (pairing.route || '')
      .split('-')
      .map(a => a.trim().toUpperCase())
      .filter(a => a && !baseFilter.has(a));
    return airports.length > 0 ? Array.from(new Set(airports)).join(' · ') : '';
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
  ): { span: number; isStart: boolean; dayOffset: number } => {
    const eventStart = new Date(event.startDate);
    const eventEnd = new Date(event.endDate);
    const weekStart = startOfWeek(startDay, { weekStartsOn: 0 });
    const weekEnd = endOfWeek(startDay, { weekStartsOn: 0 });

    const displayStart = isBefore(eventStart, weekStart)
      ? weekStart
      : eventStart;
    const displayEnd = isAfter(eventEnd, weekEnd) ? weekEnd : eventEnd;

    // Normalize to start-of-day to calculate calendar days, not hours
    // This fixes pairings with duty times that don't span full days
    const normalizedStart = startOfDay(displayStart);
    const normalizedEnd = startOfDay(displayEnd);
    const span = differenceInDays(normalizedEnd, normalizedStart) + 1;

    const isStart =
      isSameDay(eventStart, displayStart) || isSameDay(eventStart, startDay);

    // Trip-day index (0-based) of the first visible day in this week segment.
    // 0 when the trip starts this week; >0 when it carried over from a prior week.
    const dayOffset = differenceInDays(
      startOfDay(displayStart),
      startOfDay(eventStart)
    );

    return { span, isStart, dayOffset };
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

  // Calculate days off against the actual bid period length, not the
  // calendar month — Delta bid periods routinely span month boundaries
  // (e.g. "May 2" to "June 1"), so using the calendar month's day count
  // under/over-counted days off for most packages.
  const bidPeriodDays =
    Math.round(
      (startOfDay(viewEnd).getTime() - startOfDay(viewStart).getTime()) /
        (24 * 60 * 60 * 1000)
    ) + 1;
  const totalDaysOff = bidPeriodDays - totalWorkingDays;

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
            aria-label="Previous month"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="text-center min-w-[200px]">
            <h2 className="text-2xl font-bold">
              {format(currentDate, 'MMMM yyyy')}
            </h2>
            <p className="text-sm text-muted-foreground">
              {bidPackageId && latestBidPackage
                ? `Bid Package: ${latestBidPackage.month} ${latestBidPackage.year}`
                : 'Calendar View'}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigateMonth('next')}
            aria-label="Next month"
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
        <div className="bg-card border dark:border-gray-700 rounded-lg overflow-hidden">
          {/* Day headers */}
          <div className="grid grid-cols-7 bg-muted border-b">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
              <div
                key={day}
                className="p-3 text-center font-semibold text-secondary-foreground border-r dark:border-gray-700 last:border-r-0"
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
                className="relative border-b dark:border-gray-700 last:border-b-0"
              >
                {/* Day numbers and basic layout */}
                <div className="grid grid-cols-7 min-h-[120px]">
                  {week.map((day, _dayIndex) => {
                    const inBidPeriod = isInBidPeriod(day);
                    const isToday = isSameDay(day, new Date());

                    return (
                      <div
                        key={day.toISOString()}
                        className={`p-2 border-r dark:border-gray-700 last:border-r-0 relative ${
                          !inBidPeriod
                            ? 'bg-muted text-gray-400 dark:text-gray-600'
                            : 'bg-card'
                        }`}
                      >
                        <div
                          className={`text-lg font-semibold ${
                            isToday
                              ? 'bg-blue-600 text-white rounded-full w-8 h-8 flex items-center justify-center'
                              : inBidPeriod
                                ? 'text-foreground'
                                : 'text-gray-400 dark:text-gray-600'
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

                      const { span, dayOffset } = getEventSpan(
                        event,
                        week[startDayIndex]
                      );
                      const isViolation = crewRestViolations.some(
                        v => v.id === event.id
                      );

                      const topOffset = 40 + eventIndex * 30; // Stack events vertically
                      const leftOffset = startDayIndex * (100 / 7) + 0.5; // Percentage based positioning
                      const width = span * (100 / 7) - 1; // Span across days

                      // Per-day label = the city the pilot ends up in that
                      // day. Group flight segments by day letter (A/B/C/D)
                      // and take each day's last arrival.
                      //
                      // Edge case: a long layover (>24h) means one calendar
                      // day has no flights — segments may be A, C, D with
                      // B missing. Walk every letter from first to last
                      // present and carry the previous endpoint forward
                      // when a day has no flights (still in same city).
                      const segments = event.pairing.flightSegments ?? [];
                      const grouped = segments.reduce<Record<string, typeof segments>>(
                        (acc, seg) => {
                          const d = (seg?.date || 'A').toUpperCase();
                          (acc[d] ||= []).push(seg);
                          return acc;
                        },
                        {}
                      );
                      const dayOrder = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
                      const presentLetters = dayOrder.filter(d => grouped[d]);
                      const firstIdx = presentLetters.length
                        ? dayOrder.indexOf(presentLetters[0])
                        : -1;
                      const lastIdx = presentLetters.length
                        ? dayOrder.indexOf(
                            presentLetters[presentLetters.length - 1]
                          )
                        : -1;
                      const dayEndpoints: string[] = [];
                      let carry = '';
                      for (let idx = firstIdx; idx >= 0 && idx <= lastIdx; idx++) {
                        const letter = dayOrder[idx];
                        if (grouped[letter]) {
                          const last = grouped[letter][grouped[letter].length - 1];
                          carry = (last?.arrival || carry).toUpperCase();
                        }
                        dayEndpoints.push(carry);
                      }

                      // Fallback for older rows without flightSegments: use
                      // the last 3-letter airport code from the route string.
                      const routeAirports =
                        (event.pairing.route || '').match(/\b[A-Z]{3}\b/g) ?? [];
                      const finalDestination =
                        routeAirports[routeAirports.length - 1] || '';
                      const tripDays = event.pairing.pairingDays ?? span;

                      const dayLabels = Array.from({ length: span }, (_, i) => {
                        const tripDayIdx = dayOffset + i;
                        const fromSegments = dayEndpoints[tripDayIdx];
                        if (fromSegments) {
                          return fromSegments;
                        }
                        if (tripDayIdx >= tripDays - 1) {
                          return finalDestination;
                        }
                        return '';
                      });

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
                          onClick={() => setOpenPairingId(event.pairingId)}
                        >
                          {/* Pairing number floats at the top-left so it doesn't
                              steal space from the day-aligned layover segments. */}
                          <span className="absolute top-0 left-1 text-[10px] font-bold leading-none text-white">
                            {event.pairing.pairingNumber}
                          </span>

                          {/* One equal-width segment per visible day; each shows
                              that day's overnight city (or home base on day N). */}
                          <div className="flex h-full text-white text-xs">
                            {dayLabels.map((label, i) => (
                              <div
                                key={i}
                                className="flex-1 flex items-center justify-center px-1 truncate border-r border-blue-400/40 last:border-r-0"
                              >
                                {label}
                              </div>
                            ))}
                          </div>

                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label="Remove from calendar"
                            className="absolute top-0 right-0 h-5 w-5 p-0 hover:bg-red-100"
                            onClick={e => {
                              e.stopPropagation();
                              handleRemoveFromCalendar(event.pairingId);
                            }}
                            disabled={removeFromCalendarMutation.isPending}
                          >
                            <Trash2 className="h-3 w-3 text-white" />
                          </Button>

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
              <CardTitle className="text-xl font-semibold text-foreground">
                Monthly Overview
              </CardTitle>
              <span className="text-sm text-muted-foreground">
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
                      <div className="text-sm text-muted-foreground">
                        Total Pairings
                      </div>
                      <div className="text-xs text-muted-foreground">This month</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold text-foreground">
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
                      <div className="text-sm text-muted-foreground">Credit Hours</div>
                      <div className="text-xs text-muted-foreground">ALV: {userALV.toFixed(0)}h</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold text-foreground">
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
                  <div className="flex justify-between text-xs text-muted-foreground">
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
                      <div className="text-sm text-muted-foreground">Block Hours</div>
                      <div className="text-xs text-muted-foreground">Flight time</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold text-foreground">
                      {totalBlockHours.toFixed(2)}
                    </div>
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Progress</span>
                    <span>{totalBlockHours.toFixed(1)}/{userALV.toFixed(0)}</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-orange-500 h-2 rounded-full transition-all duration-300"
                      style={{
                        width: `${Math.min((totalBlockHours / userALV) * 100, 100)}%`,
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
                      <div className="text-sm text-muted-foreground">Days Working</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold text-foreground">
                      {totalWorkingDays}
                    </div>
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Progress</span>
                    <span>{totalWorkingDays}/{bidPeriodDays}</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-purple-500 h-2 rounded-full transition-all duration-300"
                      style={{
                        width: `${Math.min((totalWorkingDays / bidPeriodDays) * 100, 100)}%`,
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
                      <div className="text-sm text-muted-foreground">Days Off</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold text-foreground">
                      {totalDaysOff}
                    </div>
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Progress</span>
                    <span>{totalDaysOff}/{bidPeriodDays}</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-emerald-500 h-2 rounded-full transition-all duration-300"
                      style={{
                        width: `${Math.min((totalDaysOff / bidPeriodDays) * 100, 100)}%`,
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
                      <div className="text-sm text-muted-foreground">
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
                    <div className="text-2xl font-bold text-foreground">
                      {ratio.toFixed(2)}
                    </div>
                    <div className="flex items-center gap-1 justify-end">
                      <div className={`w-2 h-2 ${ratioDotColor} rounded-full`}></div>
                      <span className="text-xs text-muted-foreground">({ratioLabel})</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Efficiency Score */}
            <div className="mt-6 p-4 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 rounded-lg border border-blue-100 dark:border-blue-800">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/40 rounded-lg flex items-center justify-center">
                    📈
                  </div>
                  <div>
                    <div className="text-sm font-medium text-foreground">
                      Efficiency Score
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Compared to all {bidPackageStats?.totalPairings || 0}{' '}
                      pairings in bid package
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-3xl font-bold text-blue-600 dark:text-blue-400">
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
                  <div className="text-sm text-blue-600 dark:text-blue-400 font-medium">
                    {hasStats ? ratioLabel : 'Insufficient data'}
                  </div>
                </div>
              </div>

              {hasStats && (
                <div className="text-xs text-muted-foreground space-y-1">
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
                          ? 'text-green-600 dark:text-green-400'
                          : 'text-orange-600 dark:text-orange-400'
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

      {openPairingId !== null && (
        <PairingModal
          pairingId={openPairingId}
          onClose={() => setOpenPairingId(null)}
        />
      )}
    </div>
  );
}
