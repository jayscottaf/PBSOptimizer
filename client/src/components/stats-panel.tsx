import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import type { Pairing, BidPackage } from '@/lib/api';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BarChart2 } from 'lucide-react';
import { api } from '@/lib/api';

type AvgByDaysStats = Record<number, { credit: number; block: number; count?: number }>;

type RatioBreakdown = {
  excellent: number;
  good: number;
  average: number;
  poor: number;
};

type PercentileThresholds = {
  excellent: number;
  good: number;
  average: number;
};

interface BackendStatistics {
  likelyToHold: number;
  highCredit: number;
  avgByDays?: AvgByDaysStats;
  ratioBreakdown?: RatioBreakdown;
  percentileThresholds?: PercentileThresholds;
  pairingTypeBreakdown?: Record<number, number>;
}

interface StatsPanelProps {
  pairings: Pairing[];
  bidPackage?: BidPackage;
  hideHeader?: boolean;
  statistics?: BackendStatistics;
  bidPackageStats?: {
    totalPairings: number;
    creditBlockRatios: {
      min: number;
      max: number;
      average: number;
    };
    pairingTypeBreakdown?: Record<number, number>;
    avgByDays?: Record<number, { credit: number; block: number }>;
    ratioBreakdown?: {
      excellent: number;
      good: number;
      average: number;
      poor: number;
    };
  } | null;
  onTripLengthFilter?: (days: number) => void;
}

interface ComputedStats {
  totalPairings: number;
  likelyToHold: number;
  highCredit: number;
  avgCreditHours: number;
  avgBlockHours: number;
  avgByDays: AvgByDaysStats;
  ratioBreakdown: RatioBreakdown;
  percentileThresholds: PercentileThresholds | null;
  pairingTypeBreakdown: Record<number, number>;
}

export function StatsPanel({
  pairings,
  bidPackage,
  hideHeader = false,
  statistics,
  bidPackageStats,
  onTripLengthFilter,
}: StatsPanelProps) {
  const [streamProgress, setStreamProgress] = useState<{
    percent: number;
    processed?: number;
    total?: number;
  } | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const stats = useMemo<ComputedStats>(() => {
    if (!pairings || !Array.isArray(pairings) || pairings.length === 0) {
      return {
        totalPairings: 0,
        likelyToHold: 0,
        highCredit: 0,
        avgCreditHours: 0,
        avgBlockHours: 0,
        avgByDays: {},
        ratioBreakdown: {
          excellent: 0,
          good: 0,
          average: 0,
          poor: 0,
        },
        percentileThresholds: null,
        pairingTypeBreakdown: {},
      };
    }

    // Helper function to parse Delta PBS hours format (handles both string and number)
    const parseHours = (hours: any): number => {
      if (typeof hours === 'number') {
        return hours;
      }
      if (typeof hours === 'string') {
        return parseFloat(hours) || 0;
      }
      return 0;
    };

    // Use total from pairings length
    const totalPairings = pairings.length;

    // Prefer backend-provided statistics when available; otherwise calculate from current page
    const highCreditCount =
      statistics?.highCredit ??
      pairings.filter(p => parseHours(p.creditHours) >= 18).length;
    const getHoldProb = (value: any): number =>
      typeof value === 'number' ? value : parseFloat(String(value)) || 0;
    const likelyToHoldCount =
      statistics?.likelyToHold ??
      pairings.filter(p => getHoldProb((p as any).holdProbability) >= 70)
        .length;

    const totalCredit = pairings.reduce(
      (sum, p) => sum + parseHours(p.creditHours),
      0
    );
    const totalBlock = pairings.reduce(
      (sum, p) => sum + parseHours(p.blockHours),
      0
    );
    const avgCreditHours =
      pairings.length > 0 ? totalCredit / pairings.length : 0;
    const avgBlockHours =
      pairings.length > 0 ? totalBlock / pairings.length : 0;

    // Calculate averages by pairing days (1-5 days) from current page OR use backend stats
    const avgByDays: { [key: number]: { credit: number; block: number; count: number } } = {};

    if (statistics?.avgByDays) {
      // Use backend-provided stats (covers ALL pairings)
      Object.keys(statistics.avgByDays).forEach(key => {
        const days = parseInt(key);
        avgByDays[days] = {
          credit: statistics.avgByDays![days].credit,
          block: statistics.avgByDays![days].block,
          count: 0, // Count not needed from backend
        };
      });
    } else {
      // Fallback: calculate from current page pairings
      for (let days = 1; days <= 5; days++) {
        const dayPairings = pairings.filter((p: any) => p.pairingDays === days);
        if (dayPairings.length > 0) {
          const dayCredit = dayPairings.reduce((sum, p) => sum + parseHours(p.creditHours), 0);
          const dayBlock = dayPairings.reduce((sum, p) => sum + parseHours(p.blockHours), 0);
          avgByDays[days] = {
            credit: dayCredit / dayPairings.length,
            block: dayBlock / dayPairings.length,
            count: dayPairings.length,
          };
        }
      }
    }
    // Calculate credit-to-block ratio breakdown
    // Use backend global ratio breakdown when available so the sidebar card reflects all pairings, not just current page
    // Use percentile-based categorization if bidPackageStats are available (consistent with calendar view)
    const hasStats = !!bidPackageStats && (bidPackageStats.totalPairings || 0) > 0;
    const minRatio = hasStats ? bidPackageStats.creditBlockRatios.min : undefined;
    const maxRatio = hasStats ? bidPackageStats.creditBlockRatios.max : undefined;

    // Calculate percentile thresholds for display
    let percentileThresholds = null;
    if (hasStats && minRatio !== undefined && maxRatio !== undefined && maxRatio > minRatio) {
      const range = maxRatio - minRatio;
      percentileThresholds = {
        excellent: minRatio + (range * 0.80), // 80th percentile
        good: minRatio + (range * 0.60),      // 60th percentile
        average: minRatio + (range * 0.40),   // 40th percentile
      };
    }

    // Calculate pairing type breakdown by trip length
    const pairingTypeBreakdown = pairings.reduce(
      (acc, pairing) => {
        const days = pairing.pairingDays;
        if (days !== undefined && days >= 1 && days <= 5) {
          acc[days] = (acc[days] || 0) + 1;
        }
        return acc;
      },
      {} as { [key: number]: number }
    );

    const ratioBreakdown =
      statistics?.ratioBreakdown ??
      pairings.reduce(
        (acc, pairing) => {
          const credit = parseHours(pairing.creditHours);
          const block = parseHours(pairing.blockHours);
          const ratio = block > 0 ? credit / block : 0;

          // Use percentile-based categorization if we have bid package stats
          if (hasStats && minRatio !== undefined && maxRatio !== undefined && maxRatio > minRatio) {
            const range = maxRatio - minRatio;
            const percentile = (ratio - minRatio) / range;

            if (percentile >= 0.80) {
              acc.excellent++;
            } else if (percentile >= 0.60) {
              acc.good++;
            } else if (percentile >= 0.40) {
              acc.average++;
            } else {
              acc.poor++;
            }
          } else {
            // Fallback to fixed thresholds if no stats available
            if (ratio >= 1.3) {
              acc.excellent++;
            } else if (ratio >= 1.2) {
              acc.good++;
            } else if (ratio >= 1.1) {
              acc.average++;
            } else {
              acc.poor++;
            }
          }
          return acc;
        },
        { excellent: 0, good: 0, average: 0, poor: 0 }
      );

    return {
      totalPairings, // This will now show the correct total
      likelyToHold: likelyToHoldCount,
      highCredit: highCreditCount,
      avgCreditHours: pairings.length > 0 ? totalCredit / pairings.length : 0,
      avgBlockHours: pairings.length > 0 ? totalBlock / pairings.length : 0,
      avgByDays,
      ratioBreakdown,
      percentileThresholds,
      pairingTypeBreakdown,
    };
  }, [pairings, statistics, bidPackageStats]);

  // Show processing status for current bid package
  const isProcessing = bidPackage?.status === 'processing';
  const isFailed = bidPackage?.status === 'failed';
  const expectedTotalBase = 534;
  const totalFromStream =
    streamProgress?.total && streamProgress.total > 0
      ? streamProgress.total
      : undefined;
  const expectedTotal = totalFromStream ?? expectedTotalBase;
  const computedPct = Math.min(
    (stats.totalPairings / expectedTotal) * 100,
    100
  );
  const progressPercentage =
    typeof streamProgress?.percent === 'number'
      ? Math.min(Math.max(streamProgress.percent, 0), 100)
      : computedPct;
  const displayTotalPairings =
    isProcessing &&
    (streamProgress?.processed !== undefined ||
      typeof streamProgress?.percent === 'number')
      ? streamProgress?.processed !== undefined
        ? streamProgress.processed!
        : Math.round((progressPercentage / 100) * expectedTotal)
      : stats.totalPairings;

  // Open SSE stream while processing to update progress live
  useEffect(() => {
    if (isProcessing && bidPackage?.id && !esRef.current) {
      const es: EventSource = api.openProgressStream(
        bidPackage.id,
        (data: any) => {
          if (typeof data?.percent === 'number') {
            setStreamProgress({
              percent: data.percent,
              processed: data?.processed,
              total: data?.total,
            });
          }
          if (data?.status === 'completed' || data?.status === 'failed') {
            es.close();
            esRef.current = null;
          }
        }
      );
      esRef.current = es;
    }
    return () => {
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
    };
  }, [isProcessing, bidPackage?.id]);

  if (hideHeader) {
    return (
      <div className="p-0">
        {isProcessing && (
          <div className="space-y-2">
            <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
              <span>Processing bid package</span>
              <span>{Math.round(progressPercentage)}%</span>
            </div>
            <Progress value={progressPercentage} className="h-2" />
          </div>
        )}
        {isFailed && (
          <div className="space-y-2">
            <div className="text-xs text-red-600 bg-red-50 p-2 rounded">
              PDF processing failed. Please try uploading again.
            </div>
          </div>
        )}
        <div className="grid grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 gap-3 lg:gap-4">
          <div className="text-center">
            <div className="text-xl lg:text-2xl font-bold text-blue-600">
              {displayTotalPairings}
            </div>
            <div className="text-xs lg:text-sm text-gray-600 dark:text-gray-400">
              Total Pairings
            </div>
            {isProcessing && (
              <span className="text-xs text-orange-600">Processing...</span>
            )}
            {isFailed && <span className="text-xs text-red-600">Failed</span>}
          </div>
          <div className="text-center">
            <div className="text-xl lg:text-2xl font-bold text-green-600">
              {stats.likelyToHold}
            </div>
            <div className="text-xs lg:text-sm text-gray-600 dark:text-gray-400">
              Likely to Hold (≥70%)
            </div>
          </div>
          <div className="text-center">
            <div className="text-xl lg:text-2xl font-bold text-purple-600">
              {stats.highCredit}
            </div>
            <div className="text-xs lg:text-sm text-gray-600 dark:text-gray-400">
              High Credit (18+ hrs)
            </div>
          </div>
        </div>

        {/* Combined Trip Types Table */}
        {stats.totalPairings > 0 && (
          <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
            <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-3">
              ✈️ Trip Types
            </h4>
            <div className="space-y-1">
              {/* Header row */}
              <div className="grid grid-cols-4 gap-2 text-xs font-medium text-gray-500 dark:text-gray-400 pb-1 border-b border-gray-200 dark:border-gray-700">
                <div>Trip</div>
                <div className="text-right">%</div>
                <div className="text-right">Avg Credit</div>
                <div className="text-right">Avg Block</div>
              </div>
              {/* Data rows */}
              {[1, 2, 3, 4, 5].map(days => {
                // Use global stats from bidPackageStats when available (always shows all pairings regardless of filters)
                const count = bidPackageStats?.pairingTypeBreakdown?.[days] ?? stats.pairingTypeBreakdown[days] ?? 0;
                const totalForPercentage = bidPackageStats?.totalPairings ?? stats.totalPairings;
                const percentage = totalForPercentage > 0 ? (count / totalForPercentage * 100).toFixed(0) : 0;
                const avgData = bidPackageStats?.avgByDays?.[days] ?? stats.avgByDays[days];

                return (
                  <div
                    key={days}
                    className="grid grid-cols-4 gap-2 text-xs py-1 cursor-pointer hover:bg-gray-50 rounded transition-colors"
                    onClick={() => onTripLengthFilter?.(days)}
                  >
                    <span className="text-gray-700 dark:text-gray-300 font-medium">{days}-day</span>
                    <span className="text-gray-900 dark:text-gray-100 font-medium text-right">{percentage}%</span>
                    <span className="text-gray-900 dark:text-gray-100 font-medium text-right">
                      {avgData ? avgData.credit.toFixed(1) : '-'}
                    </span>
                    <span className="text-gray-900 dark:text-gray-100 font-medium text-right">
                      {avgData ? avgData.block.toFixed(1) : '-'}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Credit/Block Ratio Breakdown */}
        {stats.totalPairings > 0 && (
          <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
            <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-3 flex items-center">
              <BarChart2 className="h-4 w-4 mr-2" />
              Credit/Block Ratio Quality
            </h4>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  <div className="w-3 h-3 bg-green-500 rounded mr-2"></div>
                  <span className="text-xs text-gray-600 dark:text-gray-400">
                    Excellent{stats.percentileThresholds ? ` (≥${stats.percentileThresholds.excellent.toFixed(2)})` : ' (top 20%)'}
                  </span>
                </div>
                <div className="text-sm font-medium text-green-700">
                  {bidPackageStats?.ratioBreakdown?.excellent ?? stats.ratioBreakdown.excellent} (
                  {(
                    ((bidPackageStats?.ratioBreakdown?.excellent ?? stats.ratioBreakdown.excellent) /
                      (bidPackageStats?.totalPairings || displayTotalPairings || 1)) *
                    100
                  ).toFixed(0)}
                  %)
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  <div className="w-3 h-3 bg-yellow-500 rounded mr-2"></div>
                  <span className="text-xs text-gray-600 dark:text-gray-400">
                    Good{stats.percentileThresholds ? ` (${stats.percentileThresholds.good.toFixed(2)}-${(stats.percentileThresholds.excellent - 0.01).toFixed(2)})` : ' (60-80%)'}
                  </span>
                </div>
                <div className="text-sm font-medium text-yellow-700">
                  {bidPackageStats?.ratioBreakdown?.good ?? stats.ratioBreakdown.good} (
                  {(
                    ((bidPackageStats?.ratioBreakdown?.good ?? stats.ratioBreakdown.good) / (bidPackageStats?.totalPairings || displayTotalPairings || 1)) *
                    100
                  ).toFixed(0)}
                  %)
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  <div className="w-3 h-3 bg-orange-500 rounded mr-2"></div>
                  <span className="text-xs text-gray-600 dark:text-gray-400">
                    Average{stats.percentileThresholds ? ` (${stats.percentileThresholds.average.toFixed(2)}-${(stats.percentileThresholds.good - 0.01).toFixed(2)})` : ' (40-60%)'}
                  </span>
                </div>
                <div className="text-sm font-medium text-orange-700">
                  {bidPackageStats?.ratioBreakdown?.average ?? stats.ratioBreakdown.average} (
                  {(
                    ((bidPackageStats?.ratioBreakdown?.average ?? stats.ratioBreakdown.average) /
                      (bidPackageStats?.totalPairings || displayTotalPairings || 1)) *
                    100
                  ).toFixed(0)}
                  %)
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  <div className="w-3 h-3 bg-red-500 rounded mr-2"></div>
                  <span className="text-xs text-gray-600 dark:text-gray-400">
                    Poor{stats.percentileThresholds ? ` (<${stats.percentileThresholds.average.toFixed(2)})` : ' (bottom 40%)'}
                  </span>
                </div>
                <div className="text-sm font-medium text-red-700">
                  {bidPackageStats?.ratioBreakdown?.poor ?? stats.ratioBreakdown.poor} (
                  {(
                    ((bidPackageStats?.ratioBreakdown?.poor ?? stats.ratioBreakdown.poor) / (bidPackageStats?.totalPairings || displayTotalPairings || 1)) *
                    100
                  ).toFixed(0)}
                  %)
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Quick Stats</CardTitle>
      </CardHeader>
      <CardContent className="p-6">
        {isProcessing && (
          <div className="space-y-2">
            <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
              <span>Processing bid package</span>
              <span>{Math.round(progressPercentage)}%</span>
            </div>
            <Progress value={progressPercentage} className="h-2" />
          </div>
        )}
        {isFailed && (
          <div className="space-y-2">
            <div className="text-xs text-red-600 bg-red-50 p-2 rounded">
              PDF processing failed. Please try uploading again.
            </div>
          </div>
        )}
        <div className="grid grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 gap-3 lg:gap-4">
          <div className="text-center">
            <div className="text-xl lg:text-2xl font-bold text-blue-600">
              {displayTotalPairings}
            </div>
            <div className="text-xs lg:text-sm text-gray-600 dark:text-gray-400">
              Total Pairings
            </div>
            {isProcessing && (
              <span className="text-xs text-orange-600">Processing...</span>
            )}
            {isFailed && <span className="text-xs text-red-600">Failed</span>}
          </div>
          <div className="text-center">
            <div className="text-xl lg:text-2xl font-bold text-green-600">
              {stats.likelyToHold}
            </div>
            <div className="text-xs lg:text-sm text-gray-600 dark:text-gray-400">
              Likely to Hold (≥70%)
            </div>
          </div>
          <div className="text-center">
            <div className="text-xl lg:text-2xl font-bold text-purple-600">
              {stats.highCredit}
            </div>
            <div className="text-xs lg:text-sm text-gray-600 dark:text-gray-400">
              High Credit (18+ hrs)
            </div>
          </div>
        </div>

        {/* Combined Trip Types Table */}
        {stats.totalPairings > 0 && (
          <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
            <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-3">
              ✈️ Trip Types
            </h4>
            <div className="space-y-1">
              {/* Header row */}
              <div className="grid grid-cols-4 gap-2 text-xs font-medium text-gray-500 dark:text-gray-400 pb-1 border-b border-gray-200 dark:border-gray-700">
                <div>Trip</div>
                <div className="text-right">%</div>
                <div className="text-right">Avg Credit</div>
                <div className="text-right">Avg Block</div>
              </div>
              {/* Data rows */}
              {[1, 2, 3, 4, 5].map(days => {
                // Use global stats from bidPackageStats when available (always shows all pairings regardless of filters)
                const count = bidPackageStats?.pairingTypeBreakdown?.[days] ?? stats.pairingTypeBreakdown[days] ?? 0;
                const totalForPercentage = bidPackageStats?.totalPairings ?? stats.totalPairings;
                const percentage = totalForPercentage > 0 ? (count / totalForPercentage * 100).toFixed(0) : 0;
                const avgData = bidPackageStats?.avgByDays?.[days] ?? stats.avgByDays[days];

                return (
                  <div
                    key={days}
                    className="grid grid-cols-4 gap-2 text-xs py-1 cursor-pointer hover:bg-gray-50 rounded transition-colors"
                    onClick={() => onTripLengthFilter?.(days)}
                  >
                    <span className="text-gray-700 dark:text-gray-300 font-medium">{days}-day</span>
                    <span className="text-gray-900 dark:text-gray-100 font-medium text-right">{percentage}%</span>
                    <span className="text-gray-900 dark:text-gray-100 font-medium text-right">
                      {avgData ? avgData.credit.toFixed(1) : '-'}
                    </span>
                    <span className="text-gray-900 dark:text-gray-100 font-medium text-right">
                      {avgData ? avgData.block.toFixed(1) : '-'}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Credit/Block Ratio Breakdown */}
        {stats.totalPairings > 0 && (
          <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
            <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-3 flex items-center">
              <BarChart2 className="h-4 w-4 mr-2" />
              Credit/Block Ratio Quality
            </h4>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  <div className="w-3 h-3 bg-green-500 rounded mr-2"></div>
                  <span className="text-xs text-gray-600 dark:text-gray-400">
                    Excellent{stats.percentileThresholds ? ` (≥${stats.percentileThresholds.excellent.toFixed(2)})` : ' (top 20%)'}
                  </span>
                </div>
                <div className="text-sm font-medium text-green-700">
                  {bidPackageStats?.ratioBreakdown?.excellent ?? stats.ratioBreakdown.excellent} (
                  {(
                    ((bidPackageStats?.ratioBreakdown?.excellent ?? stats.ratioBreakdown.excellent) / (bidPackageStats?.totalPairings || stats.totalPairings)) *
                    100
                  ).toFixed(0)}
                  %)
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  <div className="w-3 h-3 bg-yellow-500 rounded mr-2"></div>
                  <span className="text-xs text-gray-600 dark:text-gray-400">
                    Good{stats.percentileThresholds ? ` (${stats.percentileThresholds.good.toFixed(2)}-${(stats.percentileThresholds.excellent - 0.01).toFixed(2)})` : ' (60-80%)'}
                  </span>
                </div>
                <div className="text-sm font-medium text-yellow-700">
                  {bidPackageStats?.ratioBreakdown?.good ?? stats.ratioBreakdown.good} (
                  {(
                    ((bidPackageStats?.ratioBreakdown?.good ?? stats.ratioBreakdown.good) / (bidPackageStats?.totalPairings || stats.totalPairings)) *
                    100
                  ).toFixed(0)}
                  %)
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  <div className="w-3 h-3 bg-orange-500 rounded mr-2"></div>
                  <span className="text-xs text-gray-600 dark:text-gray-400">
                    Average{stats.percentileThresholds ? ` (${stats.percentileThresholds.average.toFixed(2)}-${(stats.percentileThresholds.good - 0.01).toFixed(2)})` : ' (40-60%)'}
                  </span>
                </div>
                <div className="text-sm font-medium text-orange-700">
                  {bidPackageStats?.ratioBreakdown?.average ?? stats.ratioBreakdown.average} (
                  {(
                    ((bidPackageStats?.ratioBreakdown?.average ?? stats.ratioBreakdown.average) / (bidPackageStats?.totalPairings || stats.totalPairings)) *
                    100
                  ).toFixed(0)}
                  %)
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  <div className="w-3 h-3 bg-red-500 rounded mr-2"></div>
                  <span className="text-xs text-gray-600 dark:text-gray-400">
                    Poor{stats.percentileThresholds ? ` (<${stats.percentileThresholds.average.toFixed(2)})` : ' (bottom 40%)'}
                  </span>
                </div>
                <div className="text-sm font-medium text-red-700">
                  {bidPackageStats?.ratioBreakdown?.poor ?? stats.ratioBreakdown.poor} (
                  {(
                    ((bidPackageStats?.ratioBreakdown?.poor ?? stats.ratioBreakdown.poor) / (bidPackageStats?.totalPairings || stats.totalPairings)) *
                    100
                  ).toFixed(0)}
                  %)
                </div>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
