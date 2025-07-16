import { Card, CardContent } from "@/components/ui/card";
import type { Pairing } from "@/lib/api";

interface StatsPanelProps {
  pairings: Pairing[];
}

export function StatsPanel({ pairings }: StatsPanelProps) {
  const totalPairings = pairings.length;
  const likelyToHold = pairings.filter(p => p.holdProbability >= 70).length;
  const highCredit = pairings.filter(p => parseFloat(p.creditHours) >= 5.5).length;
  const sixDayCombo = pairings.filter(p => p.tafb.includes('6d') || p.tafb.includes('7d')).length;

  return (
    <Card>
      <CardContent className="p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Quick Stats</h3>
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-600">Total Pairings</span>
            <span className="font-medium text-gray-900">{totalPairings}</span>
          </div>
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
