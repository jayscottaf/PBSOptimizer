import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { Pairing, BidPackage } from "@/lib/api";
import React, { useMemo } from 'react';
import { BarChart2 } from "lucide-react";


interface StatsPanelProps {
  pairings: Pairing[];
  bidPackage?: BidPackage;
}

export function StatsPanel({ pairings, bidPackage }: StatsPanelProps) {
  const stats = useMemo(() => {
    if (!pairings || !Array.isArray(pairings) || pairings.length === 0) {
      return {
        totalPairings: 0,
        likelyToHold: 0,
        highCredit: 0,
        sixDayCombos: 0,
        avgCreditHours: 0,
        avgBlockHours: 0,
        ratioBreakdown: {
          excellent: 0,
          good: 0,
          average: 0,
          poor: 0
        }
      };
    }

    // Helper function to parse Delta PBS hours format (handles both string and number)
    const parseHours = (hours: any): number => {
      if (typeof hours === 'number') return hours;
      if (typeof hours === 'string') {
        return parseFloat(hours) || 0;
      }
      return 0;
    };

    const highCreditCount = pairings.filter(p => parseHours(p.creditHours) >= 18).length;
    const likelyToHoldCount = pairings.filter(p => (p.holdProbability || 0) >= 0.7).length;
    const sixDayCount = pairings.filter(p => (p.pairingDays || 0) >= 6).length;

    const totalCredit = pairings.reduce((sum, p) => sum + parseHours(p.creditHours), 0);
    const totalBlock = pairings.reduce((sum, p) => sum + parseHours(p.blockHours), 0);

    // Calculate credit-to-block ratio breakdown
    const ratioBreakdown = pairings.reduce((acc, pairing) => {
      const credit = parseHours(pairing.creditHours);
      const block = parseHours(pairing.blockHours);
      const ratio = block > 0 ? credit / block : 0;

      if (ratio >= 1.3) {
        acc.excellent++;
      } else if (ratio >= 1.2) {
        acc.good++;
      } else if (ratio >= 1.1) {
        acc.average++;
      } else {
        acc.poor++;
      }
      return acc;
    }, { excellent: 0, good: 0, average: 0, poor: 0 });

    return {
      totalPairings: pairings.length,
      likelyToHold: likelyToHoldCount,
      highCredit: highCreditCount,
      sixDayCombos: sixDayCount,
      avgCreditHours: pairings.length > 0 ? totalCredit / pairings.length : 0,
      avgBlockHours: pairings.length > 0 ? totalBlock / pairings.length : 0,
      ratioBreakdown
    };
  }, [pairings]);

  // Show processing status for current bid package
  const isProcessing = bidPackage?.status === 'processing';
  const isFailed = bidPackage?.status === 'failed';
  const expectedTotal = 534;
  const progressPercentage = Math.min((stats.totalPairings / expectedTotal) * 100, 100);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Statistics</CardTitle>
      </CardHeader>
      <CardContent className="p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Quick Stats</h3>
        {isProcessing && (
          <div className="space-y-2">
            <div className="flex justify-between text-xs text-gray-500">
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
        <div className="grid grid-cols-2 gap-4">
          <div className="text-center">
            <div className="text-2xl font-bold text-blue-600">{stats.totalPairings}</div>
            <div className="text-sm text-gray-600">Total Pairings</div>
            {isProcessing && (
              <span className="text-xs text-orange-600">Processing...</span>
            )}
            {isFailed && (
              <span className="text-xs text-red-600">Failed</span>
            )}
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-green-600">{stats.likelyToHold}</div>
            <div className="text-sm text-gray-600">Likely to Hold</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-purple-600">{stats.highCredit}</div>
            <div className="text-sm text-gray-600">High Credit</div>
          </div>
          {stats.sixDayCombos > 0 && (
            <div className="text-center">
              <div className="text-2xl font-bold text-orange-600">{stats.sixDayCombos}</div>
              <div className="text-sm text-gray-600">6-Day Combos</div>
            </div>
          )}
        </div>

        <div className="mt-6 pt-4 border-t border-gray-200">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="text-center">
              <div className="font-medium text-gray-900">{stats.avgCreditHours.toFixed(1)}</div>
              <div className="text-gray-600">Avg Credit</div>
            </div>
            <div className="text-center">
              <div className="font-medium text-gray-900">{stats.avgBlockHours.toFixed(1)}</div>
              <div className="text-gray-600">Avg Block</div>
            </div>
          </div>
        </div>

        {/* Credit/Block Ratio Breakdown */}
        {stats.totalPairings > 0 && (
          <div className="mt-6 pt-4 border-t border-gray-200">
            <h4 className="text-sm font-medium text-gray-900 mb-3 flex items-center">
              <BarChart2 className="h-4 w-4 mr-2" />
              Credit/Block Ratio Quality
            </h4>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  <div className="w-3 h-3 bg-green-500 rounded mr-2"></div>
                  <span className="text-xs text-gray-600">Excellent (≥1.3)</span>
                </div>
                <div className="text-sm font-medium text-green-700">
                  {stats.ratioBreakdown.excellent} ({((stats.ratioBreakdown.excellent / stats.totalPairings) * 100).toFixed(0)}%)
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  <div className="w-3 h-3 bg-yellow-500 rounded mr-2"></div>
                  <span className="text-xs text-gray-600">Good (1.2-1.29)</span>
                </div>
                <div className="text-sm font-medium text-yellow-700">
                  {stats.ratioBreakdown.good} ({((stats.ratioBreakdown.good / stats.totalPairings) * 100).toFixed(0)}%)
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  <div className="w-3 h-3 bg-orange-500 rounded mr-2"></div>
                  <span className="text-xs text-gray-600">Average (1.1-1.19)</span>
                </div>
                <div className="text-sm font-medium text-orange-700">
                  {stats.ratioBreakdown.average} ({((stats.ratioBreakdown.average / stats.totalPairings) * 100).toFixed(0)}%)
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  <div className="w-3 h-3 bg-red-500 rounded mr-2"></div>
                  <span className="text-xs text-gray-600">Poor (&lt;1.1)</span>
                </div>
                <div className="text-sm font-medium text-red-700">
                  {stats.ratioBreakdown.poor} ({((stats.ratioBreakdown.poor / stats.totalPairings) * 100).toFixed(0)}%)
                </div>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}