import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { Pairing, BidPackage } from "@/lib/api";

interface StatsPanelProps {
  pairings: Pairing[];
  bidPackage?: BidPackage;
}

export function StatsPanel({ pairings, bidPackage }: StatsPanelProps) {
  if (!pairings || !Array.isArray(pairings)) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Statistics</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">No pairing data available</p>
        </CardContent>
      </Card>
    );
  }

  const totalPairings = pairings.length;
  const likelyToHold = pairings.filter(p => p.holdProbability >= 70).length;
  const highCredit = pairings.filter(p => parseFloat(p.creditHours) >= 5.5).length;
  const sixDayCombo = pairings.filter(p => p.tafb.includes('6d') || p.tafb.includes('7d')).length;

  // Expected total for NYC A220 is typically 500-600 pairings
  const expectedTotal = 534;
  const progressPercentage = Math.min((totalPairings / expectedTotal) * 100, 100);

  // Show processing status for current bid package
  const isProcessing = bidPackage?.status === 'processing';
  const isFailed = bidPackage?.status === 'failed';

  return (
    <Card>
      <CardContent className="p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Quick Stats</h3>
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-600">Total Pairings</span>
            <div className="flex items-center space-x-2">
              <span className="font-medium text-gray-900">{totalPairings}</span>
              {isProcessing && (
                <span className="text-xs text-orange-600">Processing...</span>
              )}
              {isFailed && (
                <span className="text-xs text-red-600">Failed</span>
              )}
            </div>
          </div>
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