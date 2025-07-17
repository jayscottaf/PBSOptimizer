import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { X } from "lucide-react";
import { api } from "@/lib/api";

interface PairingModalProps {
  pairingId: number;
  onClose: () => void;
}

export function PairingModal({ pairingId, onClose }: PairingModalProps) {
  const { data: pairing, isLoading } = useQuery({
    queryKey: ["/api/pairings", pairingId],
    queryFn: () => api.getPairing(pairingId),
  });

  const { data: bidHistory = [] } = useQuery({
    queryKey: ["/api/history", pairing?.pairingNumber],
    queryFn: () => pairing ? api.getBidHistory(pairing.pairingNumber) : Promise.resolve([]),
    enabled: !!pairing,
  });

  if (isLoading || !pairing) {
    return (
      <Dialog open={true} onOpenChange={onClose}>
        <DialogContent className="max-w-4xl max-h-screen overflow-y-auto">
          <div className="flex items-center justify-center h-64">
            <div className="text-gray-500">Loading pairing details...</div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  const flightSegments = pairing.flightSegments || [];

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-screen overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span>Pairing Details - {pairing.pairingNumber}</span>
            <Button variant="ghost" size="sm" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Pairing Overview */}
            <div className="space-y-4">
              <h4 className="font-semibold text-gray-900">Overview</h4>
              <Card>
                <CardContent className="p-4 bg-gray-50 font-mono text-sm space-y-1">
                  <div><span className="text-gray-600">Pairing:</span> {pairing.pairingNumber}</div>
                  <div><span className="text-gray-600">Effective:</span> {pairing.effectiveDates}</div>
                  {pairing.payHours && <div><span className="text-gray-600">Total Pay:</span> {pairing.payHours}</div>}
                  <div><span className="text-gray-600">Credit:</span> {pairing.creditHours}</div>
                  <div><span className="text-gray-600">Block:</span> {pairing.blockHours}</div>
                  <div><span className="text-gray-600">TAFB:</span> {pairing.tafb} hours</div>
                  <div><span className="text-gray-600">Days:</span> {(pairing as any).pairingDays || 'N/A'}</div>
                  {pairing.fdp && <div><span className="text-gray-600">FDP:</span> {pairing.fdp}</div>}
                  {pairing.deadheads > 0 && <div><span className="text-gray-600">Deadheads:</span> {pairing.deadheads}</div>}
                </CardContent>
              </Card>
            </div>

            {/* Flight Segments */}
            <div className="space-y-4">
              <h4 className="font-semibold text-gray-900">Flight Segments</h4>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {flightSegments.length > 0 ? (
                  (() => {
                    // Group flights by day letter (A, B, C, etc.)
                    const groupedByDay = flightSegments.reduce((acc: any, segment: any) => {
                      const dayLetter = segment.date || 'A';
                      if (!acc[dayLetter]) acc[dayLetter] = [];
                      acc[dayLetter].push(segment);
                      return acc;
                    }, {});

                    const dayOrder = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
                    const sortedDays = dayOrder.filter(day => groupedByDay[day]);

                    return sortedDays.map((dayLetter, dayIndex) => (
                      <Card key={dayLetter}>
                        <CardContent className="p-3 bg-blue-50 border border-blue-200 font-mono text-sm">
                          <div className="font-medium text-blue-900 mb-2">
                            Day {dayIndex + 1} - {dayLetter}
                          </div>
                          {groupedByDay[dayLetter].map((segment: any, segIndex: number) => (
                            <div key={segIndex} className="text-blue-800 mb-1">
                              {segment.flightNumber} {segment.departure} {segment.departureTime} {segment.arrival} {segment.arrivalTime} ({segment.blockTime})
                              {segment.isDeadhead && <span className="text-orange-600 ml-2">[DH]</span>}
                            </div>
                          ))}
                        </CardContent>
                      </Card>
                    ));
                  })()
                ) : (
                  <div className="text-gray-500 text-sm">No flight segment details available</div>
                )}
              </div>
            </div>
          </div>

          {/* Full Text Block */}
          <div className="space-y-4">
            <h4 className="font-semibold text-gray-900">Full Pairing Text</h4>
            <Card>
              <CardContent className="p-4">
                <pre className="text-xs font-mono whitespace-pre-wrap bg-gray-50 p-4 rounded border overflow-x-auto">
                  {pairing.fullTextBlock || 'No full text block available'}
                </pre>
              </CardContent>
            </Card>
          </div>

          {/* Historical Awards */}
          <div className="space-y-4">
            <h4 className="font-semibold text-gray-900">Historical Awards</h4>
            <Card>
              <CardContent className="p-4">
                {bidHistory.length > 0 ? (
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                    <div className="text-sm text-yellow-800">
                      <div className="font-medium mb-2">Recent awards for similar pairings:</div>
                      <div className="space-y-1 font-mono">
                        {bidHistory.slice(0, 3).map((award: any, index: number) => (
                          <div key={index}>
                            • {award.month} {award.year}: Junior holder #{award.juniorHolderSeniority}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-gray-500 text-sm">No historical award data available</div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200">
          <Button variant="outline">Export Details</Button>
          <Button className="bg-blue-600 hover:bg-blue-700">Add to Favorites</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
