
import React, { useState } from 'react';
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface PairingInfo {
  pairingNumber: string;
  route?: string;
  creditHours?: string;
  blockHours?: string;
  tafb?: string;
  pairingDays?: string;
  holdProbability?: number;
  layovers?: string[];
  effectiveDates?: string;
  payHours?: string;
  fullText?: string;
}

interface PairingDisplayProps {
  pairing: PairingInfo;
  displayText?: string;
}

export function PairingDisplay({ pairing, displayText }: PairingDisplayProps) {
  const [showModal, setShowModal] = useState(false);

  const hoverContent = (
    <div className="space-y-2">
      <div className="font-semibold">{pairing.pairingNumber}</div>
      {pairing.route && (
        <div className="text-sm">
          <span className="text-gray-600">Route:</span> {pairing.route.substring(0, 100)}
          {pairing.route.length > 100 && '...'}
        </div>
      )}
      {pairing.creditHours && (
        <div className="text-sm">
          <span className="text-gray-600">Credit:</span> {pairing.creditHours}
        </div>
      )}
      {pairing.blockHours && (
        <div className="text-sm">
          <span className="text-gray-600">Block:</span> {pairing.blockHours}
        </div>
      )}
      {pairing.tafb && (
        <div className="text-sm">
          <span className="text-gray-600">TAFB:</span> {pairing.tafb}
        </div>
      )}
      {pairing.holdProbability !== undefined && (
        <div className="text-sm">
          <span className="text-gray-600">Hold %:</span> 
          <Badge variant="secondary" className="ml-1">{pairing.holdProbability}%</Badge>
        </div>
      )}
      <div className="text-xs text-blue-600 mt-2">
        Click to view full details
      </div>
    </div>
  );

  const modalContent = (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <div><span className="font-medium">Pairing:</span> {pairing.pairingNumber}</div>
          {pairing.effectiveDates && (
            <div><span className="font-medium">Effective:</span> {pairing.effectiveDates}</div>
          )}
          {pairing.creditHours && (
            <div><span className="font-medium">Credit:</span> {pairing.creditHours}</div>
          )}
          {pairing.blockHours && (
            <div><span className="font-medium">Block:</span> {pairing.blockHours}</div>
          )}
          {pairing.payHours && (
            <div><span className="font-medium">Pay:</span> {pairing.payHours}</div>
          )}
        </div>
        <div className="space-y-2">
          {pairing.tafb && (
            <div><span className="font-medium">TAFB:</span> {pairing.tafb}</div>
          )}
          {pairing.pairingDays && (
            <div><span className="font-medium">Days:</span> {pairing.pairingDays}</div>
          )}
          {pairing.holdProbability !== undefined && (
            <div>
              <span className="font-medium">Hold Probability:</span> 
              <Badge variant="secondary" className="ml-2">{pairing.holdProbability}%</Badge>
            </div>
          )}
        </div>
      </div>
      
      {pairing.route && (
        <div>
          <div className="font-medium mb-2">Route:</div>
          <Card>
            <CardContent className="p-3">
              <div className="text-sm font-mono">{pairing.route}</div>
            </CardContent>
          </Card>
        </div>
      )}

      {pairing.layovers && pairing.layovers.length > 0 && (
        <div>
          <div className="font-medium mb-2">Layovers:</div>
          <div className="flex flex-wrap gap-2">
            {pairing.layovers.map((layover, index) => (
              <Badge key={index} variant="outline">{layover}</Badge>
            ))}
          </div>
        </div>
      )}

      {pairing.fullText && (
        <div>
          <div className="font-medium mb-2">Full Pairing Text:</div>
          <Card>
            <CardContent className="p-3">
              <pre className="text-xs font-mono whitespace-pre-wrap bg-gray-50 p-3 rounded border overflow-x-auto max-h-64">
                {pairing.fullText}
              </pre>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );

  return (
    <>
      <HoverCard>
        <HoverCardTrigger asChild>
          <span
            className="inline-block px-2 py-1 bg-blue-100 text-blue-800 rounded cursor-pointer hover:bg-blue-200 transition-colors text-sm font-medium"
            onClick={() => setShowModal(true)}
          >
            {displayText || pairing.pairingNumber}
          </span>
        </HoverCardTrigger>
        <HoverCardContent className="w-80">
          {hoverContent}
        </HoverCardContent>
      </HoverCard>

      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Pairing Details - {pairing.pairingNumber}</DialogTitle>
            <DialogDescription>
              Complete details for pairing {pairing.pairingNumber}
            </DialogDescription>
          </DialogHeader>
          {modalContent}
        </DialogContent>
      </Dialog>
    </>
  );
}
