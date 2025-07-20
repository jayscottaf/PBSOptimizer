import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Eye, Bookmark, Star } from "lucide-react";
import type { Pairing } from "@/lib/api";

interface PairingTableProps {
  pairings: Pairing[];
  onPairingClick: (pairingId: number) => void;
}

export function PairingTable({ pairings, onPairingClick }: PairingTableProps) {
  const getHoldProbabilityColor = (probability: number) => {
    if (probability >= 80) return "text-green-600";
    if (probability >= 50) return "text-yellow-600";
    return "text-red-600";
  };

  const getProgressColor = (probability: number) => {
    if (probability >= 80) return "bg-green-500";
    if (probability >= 50) return "bg-yellow-500";
    return "bg-red-500";
  };

  return (
    <Card>
      <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900">Pairing Results</h3>
        <div className="flex items-center space-x-4">
          <span className="text-sm text-gray-500">
            Showing {pairings.length} pairings
          </span>
          <Button variant="link" className="text-blue-600 hover:text-blue-700 font-medium">
            Export CSV
          </Button>
        </div>
      </div>
      
      <div className="overflow-x-auto min-w-0">
        <table className="w-full min-w-[800px]">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider min-w-[100px]">
                Pairing #
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider min-w-[150px]">
                Route
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider min-w-[80px]">
                Credit
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider min-w-[80px]">
                Block
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider min-w-[100px]">
                TAFB
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider min-w-[120px]">
                Hold %
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider min-w-[100px]">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {pairings.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-6 py-8 text-center text-gray-500">
                  No pairings found. Upload a bid package to get started.
                </td>
              </tr>
            ) : (
              pairings.map((pairing) => (
                <tr 
                  key={pairing.id}
                  className="hover:bg-gray-50 cursor-pointer"
                  onClick={() => onPairingClick(pairing.id)}
                >
                  <td className="px-4 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <span className="font-mono font-medium text-gray-900 text-sm">
                        {pairing.pairingNumber}
                      </span>
                      {pairing.holdProbability >= 80 && (
                        <Star className="text-yellow-400 ml-2 h-4 w-4 flex-shrink-0" />
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-900 truncate max-w-[140px]" title={pairing.route}>{pairing.route}</div>
                    <div className="text-xs text-gray-500 truncate max-w-[140px]" title={pairing.effectiveDates}>{pairing.effectiveDates}</div>
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap">
                    <span className="font-mono text-sm font-medium text-gray-900">
                      {pairing.creditHours}
                    </span>
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap">
                    <span className="font-mono text-sm text-gray-600">
                      {pairing.blockHours}
                    </span>
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap">
                    <span className="text-sm text-gray-600">{pairing.tafb}</span>
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap">
                    <div className="flex items-center space-x-2 min-w-[100px]">
                      <div className="flex-1 bg-gray-200 rounded-full h-2 min-w-[50px]">
                        <div 
                          className={`h-2 rounded-full ${getProgressColor(pairing.holdProbability)}`}
                          style={{ width: `${pairing.holdProbability}%` }}
                        />
                      </div>
                      <span className={`text-xs font-medium ${getHoldProbabilityColor(pairing.holdProbability)} flex-shrink-0`}>
                        {pairing.holdProbability}%
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <Button 
                      variant="ghost" 
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        onPairingClick(pairing.id);
                      }}
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        // Handle favorite toggle
                      }}
                    >
                      <Bookmark className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pairings.length > 0 && (
        <div className="bg-white px-6 py-3 border-t border-gray-200 flex items-center justify-between">
          <div className="flex-1 flex justify-between sm:hidden">
            <Button variant="outline">Previous</Button>
            <Button variant="outline">Next</Button>
          </div>
          <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
            <div>
              <p className="text-sm text-gray-700">
                Showing <span className="font-medium">1</span> to{" "}
                <span className="font-medium">{Math.min(20, pairings.length)}</span> of{" "}
                <span className="font-medium">{pairings.length}</span> results
              </p>
            </div>
            <div className="flex space-x-1">
              <Button variant="outline" size="sm">Previous</Button>
              <Button variant="default" size="sm">1</Button>
              <Button variant="outline" size="sm">2</Button>
              <Button variant="outline" size="sm">3</Button>
              <Button variant="outline" size="sm">Next</Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
