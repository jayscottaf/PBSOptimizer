import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { Pairing, BidPackage } from "@/lib/api";

interface StatsPanelProps {
  pairings: Pairing[];
  bidPackage?: BidPackage;
}

export function StatsPanel({ pairings, bidPackage }: StatsPanelProps) {
  const totalPairings = pairings.length;
  const likelyToHold = pairings.filter(p => p.holdProbability >= 70).length;
  const highCredit = pairings.filter(p => parseFloat(p.creditHours) >= 5.5).length;
  const sixDayCombo = pairings.filter(p => p.tafb.includes('6d') || p.tafb.includes('7d')).length;
  
  // Expected total for NYC A220 is typically 500-600 pairings
  const expectedTotal = 534;
  const progressPercentage = Math.min((totalPairings / expectedTotal) * 100, 100);

  return (
    <Card>
      <CardContent className="p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Quick Stats</h3>
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-600">Total Pairings</span>
            <div className="flex items-center space-x-2">
              <span className="font-medium text-gray-900">{totalPairings}</span>
              {bidPackage?.status === 'processing' && (
                <span className="text-xs text-orange-600">Loading...</span>
              )}
            </div>
          </div>
          {bidPackage?.status === 'processing' && (
            <div className="space-y-2">
              <div className="flex justify-between text-xs text-gray-500">
                <span>Processing bid package</span>
                <span>{Math.round(progressPercentage)}%</span>
              </div>
              <Progress value={progressPercentage} className="h-2" />
            </div>
          )}
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-600">Likely to Hold</span>
            <span className="font-medium text-green-600">{likelyToHold}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-600">High Credit</span>
            <span className="font-medium text-blue-600">{highCredit}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-600">6-Day Combos</span>
            <span className="font-medium text-gray-900">{sixDayCombo}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
