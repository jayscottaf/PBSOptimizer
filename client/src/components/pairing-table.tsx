import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Eye, Bookmark, Star, X } from "lucide-react";
import type { Pairing } from "@/lib/api";
import { useState } from "react";

interface PairingTableProps {
  pairings: Pairing[];
  onSort: (column: string, direction: "asc" | "desc") => void;
  sortColumn: string;
  sortDirection: "asc" | "desc";
  onPairingClick?: (pairing: Pairing) => void;
  showDeleteButton?: boolean;
  onDeleteFavorite?: (pairingId: number) => void;
}

export function PairingTable({ 
  pairings, 
  onSort, 
  sortColumn, 
  sortDirection, 
  onPairingClick, 
  showDeleteButton = false, 
  onDeleteFavorite 
}: PairingTableProps) {
  const [selectedPairing, setSelectedPairing] = useState<Pairing | null>(null);

  const handlePairingClick = (pairing: Pairing) => {
    if (onPairingClick) {
      onPairingClick(pairing);
    } else {
      setSelectedPairing(pairing);
    }
  };

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

  // Ensure pairings is always an array
  const safePairings = Array.isArray(pairings) ? pairings : [];

  return (
    <Card>
      <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900">Pairing Results</h3>
        <div className="flex items-center space-x-4">
          <span className="text-sm text-gray-500">
            Showing {safePairings.length} pairings
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
              <th 
                className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider min-w-[100px] cursor-pointer hover:bg-gray-100"
                onClick={() => onSort('pairingNumber', sortColumn === 'pairingNumber' && sortDirection === 'asc' ? 'desc' : 'asc')}
              >
                <div className="flex items-center space-x-1">
                  <span>Pairing #</span>
                  {sortColumn === 'pairingNumber' && (
                    <span className="text-blue-600">
                      {sortDirection === 'asc' ? '↑' : '↓'}
                    </span>
                  )}
                </div>
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider min-w-[150px]">
                Route
              </th>
              <th 
                className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider min-w-[80px] cursor-pointer hover:bg-gray-100"
                onClick={() => onSort('creditHours', sortColumn === 'creditHours' && sortDirection === 'asc' ? 'desc' : 'asc')}
              >
                <div className="flex items-center space-x-1">
                  <span>Credit</span>
                  {sortColumn === 'creditHours' && (
                    <span className="text-blue-600">
                      {sortDirection === 'asc' ? '↑' : '↓'}
                    </span>
                  )}
                </div>
              </th>
              <th 
                className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider min-w-[80px] cursor-pointer hover:bg-gray-100"
                onClick={() => onSort('blockHours', sortColumn === 'blockHours' && sortDirection === 'asc' ? 'desc' : 'asc')}
              >
                <div className="flex items-center space-x-1">
                  <span>Block</span>
                  {sortColumn === 'blockHours' && (
                    <span className="text-blue-600">
                      {sortDirection === 'asc' ? '↑' : '↓'}
                    </span>
                  )}
                </div>
              </th>
              <th 
                className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider min-w-[100px] cursor-pointer hover:bg-gray-100"
                onClick={() => onSort('tafb', sortColumn === 'tafb' && sortDirection === 'asc' ? 'desc' : 'asc')}
              >
                <div className="flex items-center space-x-1">
                  <span>TAFB</span>
                  {sortColumn === 'tafb' && (
                    <span className="text-blue-600">
                      {sortDirection === 'asc' ? '↑' : '↓'}
                    </span>
                  )}
                </div>
              </th>
              <th 
                className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider min-w-[80px] cursor-pointer hover:bg-gray-100"
                onClick={() => onSort('pairingDays', sortColumn === 'pairingDays' && sortDirection === 'asc' ? 'desc' : 'asc')}
              >
                <div className="flex items-center space-x-1">
                  <span>Days</span>
                  {sortColumn === 'pairingDays' && (
                    <span className="text-blue-600">
                      {sortDirection === 'asc' ? '↑' : '↓'}
                    </span>
                  )}
                </div>
              </th>
              <th 
                className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider min-w-[100px] cursor-pointer hover:bg-gray-100"
                onClick={() => onSort('creditBlockRatio', sortColumn === 'creditBlockRatio' && sortDirection === 'asc' ? 'desc' : 'asc')}
              >
                <div className="flex items-center space-x-1">
                  <span>C/B Ratio</span>
                  {sortColumn === 'creditBlockRatio' && (
                    <span className="text-blue-600">
                      {sortDirection === 'asc' ? '↑' : '↓'}
                    </span>
                  )}
                </div>
              </th>
              <th 
                className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider min-w-[120px] cursor-pointer hover:bg-gray-100"
                onClick={() => onSort('holdProbability', sortColumn === 'holdProbability' && sortDirection === 'asc' ? 'desc' : 'asc')}
              >
                <div className="flex items-center space-x-1">
                  <span>Hold %</span>
                  {sortColumn === 'holdProbability' && (
                    <span className="text-blue-600">
                      {sortDirection === 'asc' ? '↑' : '↓'}
                    </span>
                  )}
                </div>
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider min-w-[100px]">
                    Actions
                  </th>
                  {showDeleteButton && (
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider min-w-[80px]">
                      Remove
                    </th>
                  )}
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {safePairings.length === 0 ? (
              <tr>
                <td colSpan={showDeleteButton ? 10 : 9} className="px-6 py-8 text-center text-gray-500">
                  No pairings found. Upload a bid package to get started.
                </td>
              </tr>
            ) : (
              safePairings.map((pairing) => (
                <tr
                  key={pairing.id}
                  className="hover:bg-gray-50 cursor-pointer"
                  onClick={() => handlePairingClick(pairing)}
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
                    <span className="text-sm font-medium text-gray-900">{pairing.pairingDays}</span>
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap">
                    <span className="font-mono text-sm font-medium text-blue-600">
                      {(parseFloat(pairing.creditHours.toString()) / parseFloat(pairing.blockHours.toString())).toFixed(2)}
                    </span>
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
                        handlePairingClick(pairing);
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
                  {showDeleteButton && (
                    <td className="px-4 py-4 whitespace-nowrap text-center">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (onDeleteFavorite) {
                            onDeleteFavorite(pairing.id);
                          }
                        }}
                      >
                        <X className="h-4 w-4 text-red-500" />
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
      {safePairings.length > 0 && (
        <div className="bg-white px-6 py-3 border-t border-gray-200 flex items-center justify-between">
          <div className="flex-1 flex justify-between sm:hidden">
            <Button variant="outline">Previous</Button>
            <Button variant="outline">Next</Button>
          </div>
          <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
            <div>
              <p className="text-sm text-gray-700">
                Showing <span className="font-medium">1</span> to{" "}
                <span className="font-medium">{Math.min(20, safePairings.length)}</span> of{" "}
                <span className="font-medium">{safePairings.length}</span> results
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