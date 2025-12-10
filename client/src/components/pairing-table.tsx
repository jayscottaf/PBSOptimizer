import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Eye, Bookmark, Star, X, Calendar, Info, AlertTriangle } from 'lucide-react';
import type { Pairing } from '@/lib/api';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/hooks/use-toast';
import type { ConflictInfo } from '@/lib/conflictDetection';

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
  pagination,
  onPageChange,
  conflicts = new Map(),
}: PairingTableProps) {
  const [selectedPairing, setSelectedPairing] = useState<Pairing | null>(null);
  const queryClient = useQueryClient();

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
      // Parse effective dates similar to pairing modal logic
      const effectiveDateStr = pairing.effectiveDates;
      const currentYear = new Date().getFullYear();

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

      let startDate: Date | null = null;

      // Check for date range format "01SEP-30SEP"
      const rangeMatch = effectiveDateStr.match(
        /(\d{1,2})([A-Z]{3})-(\d{1,2})([A-Z]{3})/
      );
      if (rangeMatch) {
        const [, startDay, startMonth] = rangeMatch;
        if (startMonth in monthMap) {
          startDate = new Date(
            currentYear,
            monthMap[startMonth],
            parseInt(startDay)
          );
        }
      } else {
        // Try parsing as single date
        startDate = parseSingleDate(effectiveDateStr);
      }

      if (!startDate) {
        toast({
          title: 'Error',
          description: 'Could not parse effective date',
          variant: 'destructive',
        });
        return;
      }

      const pairingDays = pairing.pairingDays || 1;
      const endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + pairingDays - 1);

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

  const getHoldProbabilityColor = (probability: number) => {
    if (probability >= 80) {
      return 'text-green-600';
    }
    if (probability >= 50) {
      return 'text-yellow-600';
    }
    return 'text-red-600';
  };

  const getProgressColor = (probability: number) => {
    const seniorityPercentile = parseFloat(
      localStorage.getItem('seniorityPercentile') || '50'
    );

    // Color based on seniority percentile ranges
    if (seniorityPercentile <= 25) {
      return 'bg-green-500';
    }
    if (seniorityPercentile <= 50) {
      return 'bg-yellow-500';
    }
    if (seniorityPercentile <= 75) {
      return 'bg-orange-500';
    }
    return 'bg-red-500';
  };

  // Ensure pairings is always an array
  const safePairings = Array.isArray(pairings) ? pairings : [];

  return (
    <Card>
      <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Pairing Results</h3>
        <div className="flex items-center space-x-4">
          <span className="text-sm text-gray-500 dark:text-gray-400">
            Showing {safePairings.length} pairings
          </span>
          <Button
            variant="link"
            className="text-blue-600 hover:text-blue-700 font-medium"
          >
            Export CSV
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[800px] sm:min-w-[900px] lg:min-w-[1000px]">
          <thead className="bg-gray-50 dark:bg-gray-800">
            <tr>
              <th
                className="px-2 sm:px-4 py-2 sm:py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider min-w-[80px] sm:min-w-[100px] cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800"
                onClick={() =>
                  onSort(
                    'pairingNumber',
                    sortColumn === 'pairingNumber' && sortDirection === 'desc'
                      ? 'asc'
                      : 'desc'
                  )
                }
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
              <th className="px-2 sm:px-4 py-2 sm:py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider min-w-[100px] sm:min-w-[150px]">
                Route
              </th>
              <th
                className="px-2 sm:px-4 py-2 sm:py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider min-w-[60px] sm:min-w-[80px] cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800"
                onClick={() =>
                  onSort(
                    'creditHours',
                    sortColumn === 'creditHours' && sortDirection === 'desc'
                      ? 'asc'
                      : 'desc'
                  )
                }
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
                className="px-2 sm:px-4 py-2 sm:py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider min-w-[60px] sm:min-w-[80px] cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800"
                onClick={() =>
                  onSort(
                    'blockHours',
                    sortColumn === 'blockHours' && sortDirection === 'desc'
                      ? 'asc'
                      : 'desc'
                  )
                }
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
                className="px-2 sm:px-4 py-2 sm:py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider min-w-[60px] sm:min-w-[80px] cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800"
                onClick={() =>
                  onSort(
                    'tafb',
                    sortColumn === 'tafb' && sortDirection === 'desc'
                      ? 'asc'
                      : 'desc'
                  )
                }
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
                className="px-2 sm:px-4 py-2 sm:py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider min-w-[50px] sm:min-w-[60px] cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800"
                onClick={() =>
                  onSort(
                    'pairingDays',
                    sortColumn === 'pairingDays' && sortDirection === 'desc'
                      ? 'asc'
                      : 'desc'
                  )
                }
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
                className="px-2 sm:px-4 py-2 sm:py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider min-w-[70px] sm:min-w-[90px] cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800"
                onClick={() =>
                  onSort(
                    'creditBlockRatio',
                    sortColumn === 'creditBlockRatio' &&
                      sortDirection === 'desc'
                      ? 'asc'
                      : 'desc'
                  )
                }
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
              <th
                className="px-2 sm:px-4 py-2 sm:py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider min-w-[80px] sm:min-w-[100px] cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800"
                onClick={() =>
                  onSort(
                    'holdProbability',
                    sortColumn === 'holdProbability' && sortDirection === 'desc'
                      ? 'asc'
                      : 'desc'
                  )
                }
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
              {(showDeleteButton || showAddToCalendar) && (
                <th className="px-2 sm:px-4 py-2 sm:py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider min-w-[70px] sm:min-w-[90px]">
                  Actions
                </th>
              )}
              {showDeleteButton && (
                <th className="px-2 sm:px-4 py-2 sm:py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider min-w-[60px] sm:min-w-[80px]">
                  Remove
                </th>
              )}
            </tr>
          </thead>
          <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-700">
            {safePairings.length === 0 ? (
              <tr>
                <td
                  colSpan={showDeleteButton ? 10 : 9}
                  className="px-6 py-8 text-center text-gray-500 dark:text-gray-400"
                >
                  No pairings found. Upload a bid package to get started.
                </td>
              </tr>
            ) : (
              safePairings.map((pairing, index) => (
                <tr
                  key={`${pairing.id}-${index}`}
                  className="hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer"
                  onClick={() => handlePairingClick(pairing)}
                >
                  <td className="px-2 sm:px-4 py-2 sm:py-4 whitespace-nowrap">
                    <div className="flex items-center gap-1">
                      <span className="font-mono font-medium text-gray-900 dark:text-gray-100 text-xs sm:text-sm">
                        {pairing.pairingNumber}
                      </span>
                      {pairing.holdProbability >= 80 && (
                        <Star className="text-yellow-400 h-3 w-3 sm:h-4 sm:w-4 flex-shrink-0" />
                      )}
                      {conflicts.has(pairing.id) && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <AlertTriangle className="text-orange-500 h-3 w-3 sm:h-4 sm:w-4 flex-shrink-0" />
                          </TooltipTrigger>
                          <TooltipContent side="right" className="max-w-xs">
                            <div className="space-y-1">
                              <p className="font-semibold">Conflicts with calendar:</p>
                              {conflicts.get(pairing.id)?.conflicts.map((conflict, idx) => (
                                <div key={idx} className="text-xs">
                                  Pairing {conflict.calendarPairingNumber}
                                  <br />
                                  {conflict.calendarStartDate} to {conflict.calendarEndDate}
                                </div>
                              ))}
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                  </td>
                  <td className="px-2 sm:px-4 py-2 sm:py-4 whitespace-nowrap">
                    <div
                      className="text-xs sm:text-sm text-gray-900 dark:text-gray-100 truncate max-w-[80px] sm:max-w-[120px] lg:max-w-[140px]"
                      title={pairing.route}
                    >
                      {pairing.route}
                    </div>
                    <div
                      className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-[80px] sm:max-w-[120px] lg:max-w-[140px]"
                      title={formatEffectiveDisplay(pairing)}
                    >
                      {formatEffectiveDisplay(pairing)}
                    </div>
                  </td>
                  <td className="px-2 sm:px-4 py-2 sm:py-4 whitespace-nowrap">
                    <span className="font-mono text-xs sm:text-sm font-medium text-gray-900 dark:text-gray-100">
                      {pairing.creditHours}
                    </span>
                  </td>
                  <td className="px-2 sm:px-4 py-2 sm:py-4 whitespace-nowrap">
                    <span className="font-mono text-xs sm:text-sm text-gray-600 dark:text-gray-400">
                      {pairing.blockHours}
                    </span>
                  </td>
                  <td className="px-2 sm:px-4 py-2 sm:py-4 whitespace-nowrap">
                    <span className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">
                      {pairing.tafb}
                    </span>
                  </td>
                  <td className="px-2 sm:px-4 py-2 sm:py-4 whitespace-nowrap">
                    <span className="text-xs sm:text-sm font-medium text-gray-900 dark:text-gray-100">
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

                      // Use seniority percentile for color coding if available
                      const seniorityPercentile = parseFloat(
                        localStorage.getItem('seniorityPercentile') || '50'
                      );

                      if (seniorityPercentile <= 25) {
                        colorClass = 'text-green-700';
                        bgClass = 'bg-green-100';
                      } else if (seniorityPercentile <= 50) {
                        colorClass = 'text-yellow-700';
                        bgClass = 'bg-yellow-100';
                      } else if (seniorityPercentile <= 75) {
                        colorClass = 'text-orange-700';
                        bgClass = 'bg-orange-100';
                      } else {
                        colorClass = 'text-red-700';
                        bgClass = 'bg-red-100';
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
                  <td className="px-2 sm:px-4 py-2 sm:py-4 whitespace-nowrap">
                    <div className="flex items-center space-x-1 sm:space-x-2 min-w-[70px] sm:min-w-[100px]">
                      <div className="flex-1 bg-gray-200 rounded-full h-1.5 sm:h-2 min-w-[30px] sm:min-w-[50px]">
                        <div
                          className={`h-1.5 sm:h-2 rounded-full ${getProgressColor(pairing.holdProbability)}`}
                          style={{ width: `${pairing.holdProbability}%` }}
                        />
                      </div>
                      <span
                        className={`text-xs font-medium ${getHoldProbabilityColor(pairing.holdProbability)} flex-shrink-0`}
                      >
                        {pairing.holdProbability}%
                      </span>
                      {(() => {
                        const hasReasoning = pairing.holdProbabilityReasoning && pairing.holdProbabilityReasoning.length > 0;
                        return hasReasoning ? (
                            <div className="relative inline-flex group">
                              <button
                                type="button"
                                onClick={(e) => e.stopPropagation()}
                                className="flex-shrink-0 p-0.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded inline-flex items-center cursor-pointer"
                              >
                                <Info className="w-3 h-3 text-blue-500" />
                              </button>
                              {/* Simple CSS-based tooltip - positioned below for first rows, above for others */}
                              <div className={`absolute z-[100] ${
                                index < 2
                                  ? 'top-full mt-2'
                                  : 'bottom-full mb-2'
                                } left-1/2 transform -translate-x-1/2 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 pointer-events-none`}>
                                <div className="bg-gray-900 text-white p-3 rounded-lg shadow-2xl border border-gray-600 min-w-[280px] max-w-sm">
                                  <div className="space-y-2">
                                    <div className="font-semibold text-sm border-b border-gray-700 pb-2">
                                      Hold Probability: {pairing.holdProbability}%
                                    </div>
                                    {pairing.holdProbabilityReasoning.map((reason, idx) => (
                                      <div key={idx} className="text-xs text-gray-100 leading-relaxed">
                                        {reason}
                                      </div>
                                    ))}
                                  </div>
                                  {/* Arrow pointing up for bottom tooltip, down for top tooltip */}
                                  {index < 2 ? (
                                    <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-px">
                                      <div className="border-8 border-transparent border-b-gray-900"></div>
                                    </div>
                                  ) : (
                                    <div className="absolute top-full left-1/2 transform -translate-x-1/2 -mt-px">
                                      <div className="border-8 border-transparent border-t-gray-900"></div>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                        ) : null;
                      })()}
                    </div>
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
        <div className="bg-white dark:bg-gray-900 px-6 py-3 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
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
              <p className="text-sm text-gray-700">
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
