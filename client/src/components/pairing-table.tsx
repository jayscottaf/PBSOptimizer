import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Eye, Bookmark, Star, X, Calendar, Info, AlertTriangle } from 'lucide-react';
import type { Pairing } from '@/lib/api';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/hooks/use-toast';
import type { ConflictInfo } from '@/lib/conflictDetection';
import { calculateValidStartDates } from '@/lib/pairingDates';
import { maxLayoverMinutes, formatLayoverMinutes } from '@/lib/layover';
import { calculateDutyStartTime, calculateDutyEndTime } from '@shared/dutyTimeCalculator';

interface PairingTableProps {
  pairings: Pairing[];
  onSort: (column: string, direction: 'asc' | 'desc') => void;
  sortColumn: string;
  sortDirection: 'asc' | 'desc';
  onPairingClick?: (pairing: Pairing) => void;
  showDeleteButton?: boolean;
  onDeleteFavorite?: (pairingId: number) => void;
  showAddToCalendar?: boolean;
  currentUser?: any;
  bidPackageYear?: number;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
  onPageChange?: (page: number) => void;
  conflicts?: Map<number, ConflictInfo>;
  showHeader?: boolean;
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
  hasActiveFilters?: boolean;
  /** Pairing ids currently favorited — turns the row star into a toggle. */
  favoritePairingIds?: Set<number>;
  onToggleFavorite?: (pairing: Pairing) => void;
}

export function PairingTable({
  pairings,
  onSort,
  sortColumn,
  sortDirection,
  onPairingClick,
  showDeleteButton = false,
  onDeleteFavorite,
  showAddToCalendar = false,
  currentUser,
  bidPackageYear,
  pagination,
  onPageChange,
  conflicts = new Map(),
  showHeader = true,
  isLoading = false,
  isError = false,
  onRetry,
  hasActiveFilters = false,
  favoritePairingIds,
  onToggleFavorite,
}: PairingTableProps) {
  const [selectedPairing, setSelectedPairing] = useState<Pairing | null>(null);
  const queryClient = useQueryClient();

  // Column headers are sortable via plain onClick <th>s with no keyboard
  // access or aria-sort — this spreads onto each one to fix both without
  // duplicating the toggle-direction logic seven times.
  const handleSortClick = (column: string) => {
    onSort(column, sortColumn === column && sortDirection === 'desc' ? 'asc' : 'desc');
  };
  const sortHeaderProps = (column: string) => ({
    onClick: () => handleSortClick(column),
    onKeyDown: (e: React.KeyboardEvent<HTMLTableCellElement>) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleSortClick(column);
      }
    },
    role: 'columnheader' as const,
    tabIndex: 0,
    'aria-sort': (sortColumn === column
      ? sortDirection === 'asc'
        ? 'ascending'
        : 'descending'
      : 'none') as React.AriaAttributes['aria-sort'],
  });

  // Format route with day-by-day grouping, layover highlighting, and DH markers
  const formatRouteDisplay = (pairing: Pairing) => {
    if (!pairing.flightSegments || !Array.isArray(pairing.flightSegments) || pairing.flightSegments.length === 0) {
      return <span className="text-foreground">{pairing.route || ''}</span>;
    }

    // Build deadhead segments set
    const deadheadSegments = new Set<string>();
    pairing.flightSegments.forEach((segment: any) => {
      if (segment.isDeadhead && segment.departure && segment.arrival) {
        deadheadSegments.add(
          `${segment.departure.toUpperCase()}-${segment.arrival.toUpperCase()}`
        );
      }
    });

    // Sort segments chronologically
    const sortedSegments = [...pairing.flightSegments].sort((a: any, b: any) => {
      const dateCompare = (a.date || 'A').localeCompare(b.date || 'A');
      if (dateCompare !== 0) return dateCompare;
      return (a.departureTime || '').localeCompare(b.departureTime || '');
    });

    // Group segments by day
    const flightsByDay = new Map<string, any[]>();
    sortedSegments.forEach((seg: any) => {
      const day = seg.date || 'A';
      if (!flightsByDay.has(day)) {
        flightsByDay.set(day, []);
      }
      flightsByDay.get(day)!.push(seg);
    });

    const sortedDays = Array.from(flightsByDay.keys()).sort();
    const lastDayWithFlights = sortedDays[sortedDays.length - 1];

    // Build route for each day
    const dayRoutes: { day: string; segments: { airport: string; isDeadhead: boolean; isLayover: boolean }[] }[] = [];
    
    sortedDays.forEach((day, dayIdx) => {
      const dayFlights = flightsByDay.get(day)!;
      const segments: { airport: string; isDeadhead: boolean; isLayover: boolean }[] = [];
      
      dayFlights.forEach((seg: any, segIdx: number) => {
        const departure = (seg.departure || '').toUpperCase();
        const arrival = (seg.arrival || '').toUpperCase();
        const segmentKey = `${departure}-${arrival}`;
        const isDeadhead = deadheadSegments.has(segmentKey);
        
        // Add departure if it's the first segment of the day
        if (segIdx === 0) {
          segments.push({ airport: departure, isDeadhead: false, isLayover: false });
        }
        
        // Add arrival - mark as layover if it's the last segment of the day (except last day)
        const isLastSegmentOfDay = segIdx === dayFlights.length - 1;
        const isLayover = isLastSegmentOfDay && day !== lastDayWithFlights;
        
        segments.push({ airport: arrival, isDeadhead, isLayover });
      });
      
      dayRoutes.push({ day, segments });
    });

    return (
      <div className="flex flex-wrap items-center gap-1">
        {dayRoutes.map((dayRoute, dayIdx) => (
          <div key={dayRoute.day} className="flex items-center gap-1">
            {dayIdx > 0 && (
              <span className="text-muted-foreground mx-1">|</span>
            )}
            <span className="text-xs font-medium text-muted-foreground mr-1">
              {dayRoute.day}:
            </span>
            {dayRoute.segments.map((seg, segIdx) => (
              <div key={`${seg.airport}-${segIdx}`} className="flex items-center">
                {segIdx > 0 && <span className="text-muted-foreground dark:text-muted-foreground">-</span>}
                <span
                  className={`${
                    seg.isDeadhead ? 'text-muted-foreground italic' : ''
                  } ${
                    seg.isLayover
                      ? 'font-bold text-teal-600 dark:text-teal-400'
                      : seg.isDeadhead ? '' : 'text-foreground'
                  }`}
                >
                  {seg.isDeadhead ? `(DH)${seg.airport}` : seg.airport}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    );
  };

  const formatEffectiveDisplay = (pairing: Pairing): string => {
    try {
      const months = [
        'JAN',
        'FEB',
        'MAR',
        'APR',
        'MAY',
        'JUN',
        'JUL',
        'AUG',
        'SEP',
        'OCT',
        'NOV',
        'DEC',
      ];
      const monthRegex = /(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)/g;
      const raw = (pairing.effectiveDates || '').toUpperCase();
      const cleanedFromField = raw
        .replace(/EFFECTIVE/g, '')
        .replace(/ONLY/g, '')
        .replace(/\./g, '')
        .trim();

      // EFFECTIVE line and weekday qualifiers from full text, if present
      const full = (pairing.fullTextBlock || '').toUpperCase();
      const effIndex = full.indexOf('EFFECTIVE');
      const beforeEff = effIndex >= 0 ? full.substring(0, effIndex) : full;
      const effTail =
        effIndex >= 0 ? full.substring(effIndex + 'EFFECTIVE'.length) : '';
      const cleanedFromFull =
        effTail
          .replace(/ONLY/g, '')
          .replace(/\./g, '')
          .trim()
          .split(/\n|CHECK-IN|DAY\s+[A-Z]/)[0] || '';

      const weekdayTokens = Array.from(
        beforeEff.matchAll(/\b(SU|MO|TU|WE|TH|FR|SA)\b/g)
      ).map(m => m[1]);
      const weekdaySuffix =
        weekdayTokens.length > 0 ? ` ${weekdayTokens.join(',')}` : '';

      const normalizeToken = (mon: string, day: string) =>
        `${mon}${parseInt(day, 10)}`;

      const collectExplicitDates = (s: string): string[] => {
        const out: string[] = [];
        // token forms: MONdd or ddMON possibly separated by commas/spaces
        const tokenRegex =
          /\b((?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s*\d{1,2}|\d{1,2}\s*(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC))\b/g;
        for (const m of Array.from(s.matchAll(tokenRegex))) {
          const part = m[1];
          const md = part.match(
            /^(?:([A-Z]{3})\s*(\d{1,2})|(\d{1,2})\s*([A-Z]{3}))$/
          );
          if (md) {
            const mon = (md[1] || md[4]) as string;
            const day = (md[2] || md[3]) as string;
            if (months.includes(mon)) {
              out.push(normalizeToken(mon, day));
            }
          }
        }
        return Array.from(new Set(out));
      };

      // Prefer richer EFFECTIVE tail when it contains months
      const source =
        (cleanedFromFull.match(monthRegex)
          ? cleanedFromFull
          : cleanedFromField) || cleanedFromField;

      // 1) Explicit comma/space-separated dates
      const explicitDates = collectExplicitDates(source);

      // 2) Ranges → for rows, prefer listing endpoints only; if no weekdays, show as a range; if weekdays exist, list endpoints
      const currentYear = new Date().getFullYear();
      const monthMap: Record<string, number> = {
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
      const dayFirst = source.match(
        /\b(\d{1,2})\s*(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s*-\s*(\d{1,2})\s*(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\b/
      );
      const monFirst = source.match(
        /\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s*(\d{1,2})\s*-\s*(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s*(\d{1,2})\b/
      );
      if (dayFirst || monFirst) {
        const sm = monFirst ? monFirst[1] : dayFirst![2];
        const sd = monFirst ? monFirst[2] : dayFirst![1];
        const em = monFirst ? monFirst[3] : dayFirst![4];
        const ed = monFirst ? monFirst[4] : dayFirst![3];
        const startToken = normalizeToken(sm, sd);
        const endToken = normalizeToken(em, ed);
        if (weekdayTokens.length > 0) {
          // Prioritize explicit endpoints when weekdays are present (avoid mid-range extras like SEP26)
          const parts = Array.from(new Set([startToken, endToken]));
          return `${parts.join(', ')}${weekdaySuffix}`.trim();
        }
        return `${sm}${parseInt(sd, 10)} - ${em}${parseInt(ed, 10)}${weekdaySuffix}`.trim();
      }

      const allDates = Array.from(new Set(explicitDates));
      if (allDates.length > 1) {
        return `${allDates.join(', ')}${weekdaySuffix}`.trim();
      }
      if (allDates.length === 1) {
        return `${allDates[0]}${weekdaySuffix}`.trim();
      }

      // Fallback: single normalized token from source if present
      const md = source.match(
        /\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s*(\d{1,2})\b|\b(\d{1,2})\s*(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\b/
      );
      if (md) {
        const mon = (md[1] || md[4]) as string;
        const day = (md[2] || md[3]) as string;
        return `${normalizeToken(mon, day)}${weekdaySuffix}`.trim();
      }

      return pairing.effectiveDates;
    } catch {
      return pairing.effectiveDates;
    }
  };

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
      return api.addToCalendar(userId, pairingId, startDate, endDate);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['calendar'] });
      queryClient.invalidateQueries({ queryKey: ['calendarEvents'] });
      toast({
        title: 'Success',
        description: 'Pairing added to calendar successfully!',
      });
    },
    onError: (error: any) => {
      toast({
        title: 'Error',
        description: error.message || 'Failed to add pairing to calendar',
        variant: 'destructive',
      });
    },
  });

  const handleAddToCalendar = async (pairing: any) => {
    if (!currentUser) {
      toast({
        title: 'Error',
        description: 'User not found',
        variant: 'destructive',
      });
      return;
    }

    try {
      const year = bidPackageYear || new Date().getFullYear();

      // Extract the full EFFECTIVE date range (incl. day-of-week and
      // specific-date EXCEPT exclusions) from the full pairing text, same as
      // the pairing detail modal — using pairing.effectiveDates alone misses
      // exceptions and this table has no bid-package-year context of its own.
      let effectiveDates = pairing.effectiveDates || '';
      if (pairing.fullTextBlock) {
        let dateRange = '';
        let dayOfWeekExceptions = '';
        let specificDateExceptions = '';

        const effectiveMatch = pairing.fullTextBlock.match(
          /EFFECTIVE\s+([A-Z]{3}\d{1,2}(?:-[A-Z]{3}\.?\s*\d{1,2})?)/i
        );
        if (effectiveMatch) {
          dateRange = effectiveMatch[1].trim();
        }

        const dayOfWeekMatch = pairing.fullTextBlock.match(
          /(?:EXCPT|EXCEPT)\s+([A-Z]{2}(?:\s+[A-Z]{2})*)\s+EFFECTIVE/i
        );
        if (dayOfWeekMatch) {
          dayOfWeekExceptions = dayOfWeekMatch[1].trim();
        }

        const specificDateMatch = pairing.fullTextBlock.match(
          /EXCEPT\s+((?:[A-Z]{3}\s+\d{1,2}\s*)+)/i
        );
        if (specificDateMatch) {
          specificDateExceptions = specificDateMatch[1].trim();
        }

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

      const pairingDays = pairing.pairingDays || 1;
      const possibleStartDates = calculateValidStartDates(
        effectiveDates,
        year,
        pairingDays
      );

      if (possibleStartDates.length === 0) {
        toast({
          title: 'Error',
          description: 'Could not parse any valid dates from pairing',
          variant: 'destructive',
        });
        return;
      }

      const baseDate = possibleStartDates[0];
      const segments = pairing.flightSegments || [];
      const startDate = segments.length > 0
        ? calculateDutyStartTime(baseDate, segments[0])
        : baseDate;
      const endDate = segments.length > 0
        ? calculateDutyEndTime(baseDate, segments[segments.length - 1])
        : new Date(baseDate.getTime() + (pairingDays - 1) * 24 * 60 * 60 * 1000);

      if (possibleStartDates.length > 1) {
        toast({
          title: 'Multiple dates found',
          description: `This pairing runs on ${possibleStartDates.length} start dates — added the earliest (${baseDate.toLocaleDateString()}). Open the pairing details to add the others.`,
        });
      }

      addToCalendarMutation.mutate({
        userId: currentUser.id,
        pairingId: pairing.id,
        startDate,
        endDate,
      });
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to add pairing to calendar',
        variant: 'destructive',
      });
    }
  };

  const handlePairingClick = (pairing: Pairing) => {
    if (onPairingClick) {
      onPairingClick(pairing);
    } else {
      setSelectedPairing(pairing);
    }
  };

  // Single source of truth for hold-probability color grading. Used for the
  // progress fill, the percentage label, and the badge background so the
  // signal is consistent across the cell.
  const getHoldProbabilityBand = (probability: number) => {
    if (probability >= 80) {
      return { bar: 'bg-green-500', text: 'text-green-700', bg: 'bg-green-100' };
    }
    if (probability >= 50) {
      return { bar: 'bg-yellow-500', text: 'text-yellow-700', bg: 'bg-yellow-100' };
    }
    if (probability >= 30) {
      return { bar: 'bg-orange-500', text: 'text-orange-700', bg: 'bg-orange-100' };
    }
    return { bar: 'bg-red-500', text: 'text-red-700', bg: 'bg-red-100' };
  };

  // Ensure pairings is always an array
  const safePairings = Array.isArray(pairings) ? pairings : [];

  const legend = (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
        >
          <Info className="h-3.5 w-3.5" />
          Legend
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 text-sm">
        <p className="mb-2 font-medium">Reading this table</p>
        <dl className="space-y-1.5 text-xs">
          <div className="flex gap-2">
            <dt className="w-20 shrink-0 font-medium">HH.MM</dt>
            <dd className="text-muted-foreground">
              Times are hours.minutes — 15.45 = 15h 45m
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-20 shrink-0 font-medium">Hold %</dt>
            <dd className="text-muted-foreground">
              Estimated chance the pairing is still available at your
              seniority when PBS reaches it
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-20 shrink-0 font-medium">A / B / C…</dt>
            <dd className="text-muted-foreground">
              Duty days of the trip, in order
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-20 shrink-0 font-medium">
              <span className="font-semibold text-teal-600 dark:text-teal-400">
                Teal city
              </span>
            </dt>
            <dd className="text-muted-foreground">
              Overnight layover station
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-20 shrink-0 font-medium italic">(DH)</dt>
            <dd className="text-muted-foreground">
              Deadhead — repositioning flight, ride as passenger
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-20 shrink-0 font-medium">TAFB</dt>
            <dd className="text-muted-foreground">
              Time Away From Base: check-in to release
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-20 shrink-0 font-medium">C/B</dt>
            <dd className="text-muted-foreground">
              Credit ÷ block — higher means more pay per hour flown
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-20 shrink-0 font-medium">
              <Star className="inline h-3.5 w-3.5 fill-yellow-400 text-yellow-400" />
            </dt>
            <dd className="text-muted-foreground">
              Tap the star to save a pairing to Favorites
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-20 shrink-0 font-medium">
              <AlertTriangle className="inline h-3.5 w-3.5 text-warning" />
            </dt>
            <dd className="text-muted-foreground">
              Conflicts with an event on your calendar
            </dd>
          </div>
        </dl>
      </PopoverContent>
    </Popover>
  );

  return (
    <Card className={!showHeader ? 'border-0 rounded-none shadow-none' : undefined}>
      {showHeader && (
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <h3 className="text-lg font-semibold text-foreground">Pairing Results</h3>
          <div className="flex items-center space-x-4">
            <span className="text-sm text-muted-foreground">
              Showing {safePairings.length} pairings
            </span>
            {legend}
            <Button
              variant="link"
              className="text-blue-600 hover:text-blue-700 font-medium"
            >
              Export CSV
            </Button>
          </div>
        </div>
      )}
      {!showHeader && (
        <div className="flex justify-end border-b border-border px-2 py-1">
          {legend}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] sm:min-w-[1000px] lg:min-w-[1100px]">
          <thead className="bg-muted">
            <tr>
              <th
                className="px-2 sm:px-4 py-2 sm:py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider min-w-[60px] sm:min-w-[70px] cursor-pointer hover:bg-muted/70"
                title="Rotation number in the bid package"
                {...sortHeaderProps('pairingNumber')}
              >
                <div className="flex items-center space-x-1">
                  <span className="truncate">Pairing #</span>
                  {sortColumn === 'pairingNumber' && (
                    <span className="text-blue-600 flex-shrink-0">
                      {sortDirection === 'asc' ? '↑' : '↓'}
                    </span>
                  )}
                </div>
              </th>
              <th
                className="px-2 sm:px-4 py-2 sm:py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider min-w-[60px] sm:min-w-[80px] cursor-pointer hover:bg-muted/70"
                title="Estimated chance this pairing is still available at your seniority"
                {...sortHeaderProps('holdProbability')}
              >
                <div className="flex items-center space-x-1">
                  <span className="truncate">Hold %</span>
                  {sortColumn === 'holdProbability' && (
                    <span className="text-blue-600 flex-shrink-0">
                      {sortDirection === 'asc' ? '↑' : '↓'}
                    </span>
                  )}
                </div>
              </th>
              <th className="px-2 sm:px-4 py-2 sm:py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider min-w-[200px] sm:min-w-[280px] lg:min-w-[350px]">
                Route
              </th>
              <th
                className="px-2 sm:px-4 py-2 sm:py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider min-w-[50px] sm:min-w-[60px] cursor-pointer hover:bg-muted/70"
                title="Pay credit, HH.MM (15.45 = 15h 45m)"
                {...sortHeaderProps('creditHours')}
              >
                <div className="flex items-center space-x-1">
                  <span className="truncate">Credit</span>
                  {sortColumn === 'creditHours' && (
                    <span className="text-blue-600 flex-shrink-0">
                      {sortDirection === 'asc' ? '↑' : '↓'}
                    </span>
                  )}
                </div>
              </th>
              <th
                className="px-2 sm:px-4 py-2 sm:py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider min-w-[50px] sm:min-w-[60px] cursor-pointer hover:bg-muted/70"
                title="Scheduled flying time, HH.MM"
                {...sortHeaderProps('blockHours')}
              >
                <div className="flex items-center space-x-1">
                  <span className="truncate">Block</span>
                  {sortColumn === 'blockHours' && (
                    <span className="text-blue-600 flex-shrink-0">
                      {sortDirection === 'asc' ? '↑' : '↓'}
                    </span>
                  )}
                </div>
              </th>
              <th
                className="px-2 sm:px-4 py-2 sm:py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider min-w-[50px] sm:min-w-[60px] cursor-pointer hover:bg-muted/70"
                title="Time Away From Base: check-in to release, HH.MM"
                {...sortHeaderProps('tafb')}
              >
                <div className="flex items-center space-x-1">
                  <span className="truncate">TAFB</span>
                  {sortColumn === 'tafb' && (
                    <span className="text-blue-600 flex-shrink-0">
                      {sortDirection === 'asc' ? '↑' : '↓'}
                    </span>
                  )}
                </div>
              </th>
              <th
                className="px-2 sm:px-4 py-2 sm:py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider min-w-[60px] sm:min-w-[80px] cursor-pointer hover:bg-muted/70"
                title="Longest layover in this pairing"
                {...sortHeaderProps('maxLayover')}
              >
                <div className="flex items-center space-x-1">
                  <span className="truncate">Layover</span>
                  {sortColumn === 'maxLayover' && (
                    <span className="text-blue-600 flex-shrink-0">
                      {sortDirection === 'asc' ? '↑' : '↓'}
                    </span>
                  )}
                </div>
              </th>
              <th
                className="px-2 sm:px-4 py-2 sm:py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider min-w-[40px] sm:min-w-[50px] cursor-pointer hover:bg-muted/70"
                title="Trip length in days"
                {...sortHeaderProps('pairingDays')}
              >
                <div className="flex items-center space-x-1">
                  <span className="truncate">Days</span>
                  {sortColumn === 'pairingDays' && (
                    <span className="text-blue-600 flex-shrink-0">
                      {sortDirection === 'asc' ? '↑' : '↓'}
                    </span>
                  )}
                </div>
              </th>
              <th
                className="px-2 sm:px-4 py-2 sm:py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider min-w-[60px] sm:min-w-[70px] cursor-pointer hover:bg-muted/70"
                title="Credit \u00f7 block \u2014 higher = more pay per hour flown"
                {...sortHeaderProps('creditBlockRatio')}
              >
                <div className="flex items-center space-x-1">
                  <span className="truncate">C/B Ratio</span>
                  {sortColumn === 'creditBlockRatio' && (
                    <span className="text-blue-600 flex-shrink-0">
                      {sortDirection === 'asc' ? '↑' : '↓'}
                    </span>
                  )}
                </div>
              </th>
              {(showDeleteButton || showAddToCalendar) && (
                <th className="px-2 sm:px-4 py-2 sm:py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider min-w-[60px] sm:min-w-[70px]">
                  Actions
                </th>
              )}
              {showDeleteButton && (
                <th className="px-2 sm:px-4 py-2 sm:py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider min-w-[50px] sm:min-w-[60px]">
                  Remove
                </th>
              )}
            </tr>
          </thead>
          <tbody className="bg-card divide-y divide-border">
            {isLoading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={`skeleton-${i}`}>
                  <td colSpan={showDeleteButton ? 10 : 9} className="px-4 py-3">
                    <div className="h-4 bg-muted rounded animate-pulse" />
                  </td>
                </tr>
              ))
            ) : isError ? (
              <tr>
                <td
                  colSpan={showDeleteButton ? 10 : 9}
                  className="px-6 py-8 text-center"
                >
                  <p className="text-red-600 dark:text-red-400 font-medium">
                    Couldn't load pairings.
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Check your connection and try again.
                  </p>
                  {onRetry && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-3"
                      onClick={onRetry}
                    >
                      Retry
                    </Button>
                  )}
                </td>
              </tr>
            ) : safePairings.length === 0 ? (
              <tr>
                <td
                  colSpan={showDeleteButton ? 10 : 9}
                  className="px-6 py-8 text-center text-muted-foreground"
                >
                  {hasActiveFilters
                    ? 'No pairings match your filters. Try clearing some to see more results.'
                    : 'No pairings found. Upload a bid package to get started.'}
                </td>
              </tr>
            ) : (
              safePairings.map((pairing, index) => (
                <tr
                  key={`${pairing.id}-${index}`}
                  className="hover:bg-muted cursor-pointer"
                  onClick={() => handlePairingClick(pairing)}
                >
                  <td className="px-2 sm:px-4 py-2 sm:py-4 whitespace-nowrap">
                    <div className="flex items-center gap-1">
                      <span className="font-mono font-medium text-foreground text-xs sm:text-sm">
                        {pairing.pairingNumber}
                      </span>
                      {onToggleFavorite ? (
                        <button
                          type="button"
                          onClick={e => {
                            e.stopPropagation();
                            onToggleFavorite(pairing);
                          }}
                          title={
                            favoritePairingIds?.has(pairing.id)
                              ? 'Remove from favorites'
                              : 'Add to favorites'
                          }
                          aria-label={
                            favoritePairingIds?.has(pairing.id)
                              ? `Remove ${pairing.pairingNumber} from favorites`
                              : `Add ${pairing.pairingNumber} to favorites`
                          }
                          aria-pressed={favoritePairingIds?.has(pairing.id)}
                          className="inline-flex items-center justify-center rounded p-0.5 transition-colors hover:bg-muted"
                        >
                          <Star
                            className={`h-3 w-3 sm:h-4 sm:w-4 flex-shrink-0 transition-colors ${
                              favoritePairingIds?.has(pairing.id)
                                ? 'fill-yellow-400 text-yellow-400'
                                : 'text-muted-foreground/50 hover:text-yellow-400'
                            }`}
                          />
                        </button>
                      ) : (
                        pairing.holdProbability >= 80 && (
                          <Star className="text-yellow-400 h-3 w-3 sm:h-4 sm:w-4 flex-shrink-0" />
                        )
                      )}
                      {conflicts.has(pairing.id) && (
                        <Popover>
                          <PopoverTrigger asChild>
                            <button
                              onClick={(e) => e.stopPropagation()}
                              type="button"
                              className="inline-flex items-center justify-center p-0.5 hover:bg-orange-100 dark:hover:bg-orange-950 rounded cursor-help"
                              aria-label="Conflicts with calendar"
                            >
                              <AlertTriangle className="text-orange-500 h-3 w-3 sm:h-4 sm:w-4 flex-shrink-0" />
                            </button>
                          </PopoverTrigger>
                          <PopoverContent
                            onClick={e => e.stopPropagation()}
                            className="w-auto bg-popover text-popover-foreground border-border text-xs px-3 py-2"
                          >
                            {(() => {
                              const conflictData = conflicts.get(pairing.id);
                              if (!conflictData?.conflicts || conflictData.conflicts.length === 0) {
                                return 'Conflicts with calendar';
                              }
                              const first = conflictData.conflicts[0];
                              return `${first.calendarPairingNumber || 'Pairing'} (${first.calendarStartDate})`;
                            })()}
                          </PopoverContent>
                        </Popover>
                      )}
                    </div>
                  </td>
                  <td className="px-2 sm:px-4 py-2 sm:py-4 whitespace-nowrap">
                    {(() => {
                      const band = getHoldProbabilityBand(pairing.holdProbability);
                      return (
                    <div className="flex items-center space-x-1 sm:space-x-2 min-w-[70px] sm:min-w-[100px]">
                      <div className="flex-1 bg-muted rounded-full h-1.5 sm:h-2 min-w-[30px] sm:min-w-[50px]">
                        <div
                          className={`h-1.5 sm:h-2 rounded-full ${band.bar}`}
                          style={{ width: `${pairing.holdProbability}%` }}
                        />
                      </div>
                      <span
                        className={`text-xs font-semibold px-1.5 py-0.5 rounded ${band.bg} ${band.text} flex-shrink-0`}
                      >
                        {pairing.holdProbability}%
                      </span>
                      {(() => {
                        const hasReasoning = pairing.holdProbabilityReasoning && pairing.holdProbabilityReasoning.length > 0;
                        return hasReasoning ? (
                          <Popover>
                            <PopoverTrigger asChild>
                              <button
                                type="button"
                                onClick={(e) => e.stopPropagation()}
                                className="flex-shrink-0 p-0.5 hover:bg-muted/70 rounded inline-flex items-center cursor-pointer"
                                aria-label="Why this hold probability"
                              >
                                <Info className="w-3 h-3 text-blue-500" />
                              </button>
                            </PopoverTrigger>
                            <PopoverContent
                              onClick={e => e.stopPropagation()}
                              className="w-80 bg-popover text-popover-foreground border-border p-3"
                            >
                              <div className="space-y-2">
                                <div className="font-semibold text-sm border-b border-border pb-2">
                                  Hold Probability: {pairing.holdProbability}%
                                </div>
                                {pairing.holdProbabilityReasoning?.map((reason, idx) => (
                                  <div key={idx} className="text-xs leading-relaxed">
                                    {reason}
                                  </div>
                                ))}
                              </div>
                            </PopoverContent>
                          </Popover>
                        ) : null;
                      })()}
                    </div>
                      );
                    })()}
                  </td>
                  <td className="px-2 sm:px-4 py-2 sm:py-4">
                    <div
                      className="text-xs sm:text-sm"
                      title={pairing.route}
                    >
                      {formatRouteDisplay(pairing)}
                    </div>
                    <div
                      className="text-xs text-muted-foreground"
                      title={formatEffectiveDisplay(pairing)}
                    >
                      {formatEffectiveDisplay(pairing)}
                    </div>
                  </td>
                  <td className="px-2 sm:px-4 py-2 sm:py-4 whitespace-nowrap">
                    <span className="font-mono text-xs sm:text-sm font-medium text-foreground">
                      {pairing.creditHours}
                    </span>
                  </td>
                  <td className="px-2 sm:px-4 py-2 sm:py-4 whitespace-nowrap">
                    <span className="font-mono text-xs sm:text-sm text-muted-foreground">
                      {pairing.blockHours}
                    </span>
                  </td>
                  <td className="px-2 sm:px-4 py-2 sm:py-4 whitespace-nowrap">
                    <span className="text-xs sm:text-sm text-muted-foreground">
                      {pairing.tafb}
                    </span>
                  </td>
                  <td className="px-2 sm:px-4 py-2 sm:py-4 whitespace-nowrap">
                    <span className="text-xs sm:text-sm text-muted-foreground">
                      {formatLayoverMinutes(maxLayoverMinutes(pairing))}
                    </span>
                  </td>
                  <td className="px-2 sm:px-4 py-2 sm:py-4 whitespace-nowrap">
                    <span className="text-xs sm:text-sm font-medium text-foreground">
                      {pairing.pairingDays}
                    </span>
                  </td>
                  <td className="px-2 sm:px-4 py-2 sm:py-4 whitespace-nowrap">
                    {(() => {
                      const ratio =
                        parseFloat(pairing.creditHours.toString()) /
                        parseFloat(pairing.blockHours.toString());
                      let colorClass = '';
                      let bgClass = '';

                      // Band on the ratio itself (matches the fixed cutoffs used
                      // for the "Credit/Block Ratio Quality" stats elsewhere).
                      if (ratio >= 1.3) {
                        colorClass = 'text-green-700 dark:text-green-400';
                        bgClass = 'bg-green-100 dark:bg-green-950';
                      } else if (ratio >= 1.2) {
                        colorClass = 'text-yellow-700 dark:text-yellow-400';
                        bgClass = 'bg-yellow-100 dark:bg-yellow-950';
                      } else if (ratio >= 1.1) {
                        colorClass = 'text-orange-700 dark:text-orange-400';
                        bgClass = 'bg-orange-100 dark:bg-orange-950';
                      } else {
                        colorClass = 'text-red-700 dark:text-red-400';
                        bgClass = 'bg-red-100 dark:bg-red-950';
                      }

                      return (
                        <span
                          className={`font-mono text-xs sm:text-sm font-medium px-2 py-1 rounded ${colorClass} ${bgClass}`}
                        >
                          {ratio.toFixed(2)}
                        </span>
                      );
                    })()}
                  </td>
                  {(showDeleteButton || showAddToCalendar) && (
                    <td className="py-2 px-4 text-center border-b">
                      <div className="flex items-center justify-center gap-1">
                        {showAddToCalendar && currentUser && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={e => {
                              e.stopPropagation();
                              handleAddToCalendar(pairing);
                            }}
                            disabled={addToCalendarMutation.isPending}
                            className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/30"
                            title="Add to Calendar"
                            aria-label="Add to Calendar"
                          >
                            <Calendar className="h-4 w-4" />
                          </Button>
                        )}
                        {showDeleteButton &&
                          onDeleteFavorite &&
                          !showAddToCalendar && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={e => {
                                e.stopPropagation();
                                onDeleteFavorite(pairing.id);
                              }}
                              className="text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/30"
                              title="Remove from favorites"
                              aria-label="Remove from favorites"
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          )}
                      </div>
                    </td>
                  )}
                  {showDeleteButton && (
                    <td className="px-2 sm:px-4 py-2 sm:py-4 whitespace-nowrap text-center">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 sm:h-8 sm:w-8 p-0"
                        onClick={e => {
                          e.stopPropagation();
                          if (onDeleteFavorite) {
                            onDeleteFavorite(pairing.id);
                          }
                        }}
                        aria-label="Remove from favorites"
                      >
                        <X className="h-3 w-3 sm:h-4 sm:w-4 text-red-500" />
                      </Button>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {safePairings.length > 0 && pagination && (
        <div className="bg-card px-6 py-3 border-t border-border flex items-center justify-between">
          <div className="flex-1 flex justify-between sm:hidden">
            <Button
              variant="outline"
              disabled={!pagination.hasPrev}
              onClick={() =>
                onPageChange &&
                onPageChange(Math.max(1, (pagination.page || 1) - 1))
              }
            >
              Previous
            </Button>
            <Button
              variant="outline"
              disabled={!pagination.hasNext}
              onClick={() =>
                onPageChange && onPageChange((pagination.page || 1) + 1)
              }
            >
              Next
            </Button>
          </div>
          <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
            <div>
              <p className="text-sm text-secondary-foreground">
                Showing{' '}
                <span className="font-medium">
                  {(pagination.page - 1) * pagination.limit + 1}
                </span>{' '}
                to{' '}
                <span className="font-medium">
                  {(pagination.page - 1) * pagination.limit +
                    safePairings.length}
                </span>{' '}
                of <span className="font-medium">{pagination.total}</span>{' '}
                results
              </p>
            </div>
            <div className="flex space-x-1">
              <Button
                variant="outline"
                size="sm"
                disabled={!pagination.hasPrev}
                onClick={() =>
                  onPageChange && onPageChange(Math.max(1, pagination.page - 1))
                }
              >
                Previous
              </Button>
              <Button variant={'default'} size="sm">
                {pagination.page}
              </Button>
              {pagination.hasNext && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    onPageChange && onPageChange(pagination.page + 1)
                  }
                >
                  {pagination.page + 1}
                </Button>
              )}
              {pagination.page + 1 < pagination.totalPages && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    onPageChange && onPageChange(pagination.page + 2)
                  }
                >
                  {pagination.page + 2}
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                disabled={!pagination.hasNext}
                onClick={() =>
                  onPageChange && onPageChange(pagination.page + 1)
                }
              >
                Next
              </Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
