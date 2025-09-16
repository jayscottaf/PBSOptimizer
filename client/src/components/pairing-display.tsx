import React, { useState } from 'react';
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

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
  fullTextBlock?: string;
}

interface PairingDisplayProps {
  pairing: PairingInfo;
  displayText?: string;
}

export function PairingDisplay({ pairing, displayText }: PairingDisplayProps) {
  const [showModal, setShowModal] = useState(false);

  const hoverContent = (
    <div className="space-y-2 max-w-96">
      <div className="font-semibold">{pairing.pairingNumber}</div>
      {pairing.fullTextBlock || pairing.fullText ? (
        <div className="text-sm">
          <span className="text-gray-600">Full Pairing Text Preview:</span>
          <pre className="text-xs font-mono whitespace-pre-wrap bg-gray-50 p-2 rounded border mt-1 max-h-32 overflow-y-auto">
            {(pairing.fullTextBlock || pairing.fullText || '').substring(
              0,
              300
            )}
            {(pairing.fullTextBlock || pairing.fullText || '').length > 300 &&
              '...'}
          </pre>
        </div>
      ) : (
        <>
          {pairing.route && (
            <div className="text-sm">
              <span className="text-gray-600">Route:</span>{' '}
              {String(pairing.route).substring(0, 100)}
              {String(pairing.route).length > 100 && '...'}
            </div>
          )}
          {pairing.creditHours && (
            <div className="text-sm">
              <span className="text-gray-600">Credit:</span>{' '}
              {String(pairing.creditHours)}
            </div>
          )}
          {pairing.blockHours && (
            <div className="text-sm">
              <span className="text-gray-600">Block:</span>{' '}
              {String(pairing.blockHours)}
            </div>
          )}
          {pairing.tafb && (
            <div className="text-sm">
              <span className="text-gray-600">TAFB:</span>{' '}
              {String(pairing.tafb)}
            </div>
          )}
          {pairing.holdProbability !== undefined && (
            <div className="text-sm">
              <span className="text-gray-600">Hold %:</span>
              <Badge
                variant="secondary"
                className={`ml-1 ${
                  pairing.holdProbability === 100
                    ? 'bg-green-100 text-green-800'
                    : pairing.holdProbability === 75
                      ? 'bg-blue-100 text-blue-800'
                      : pairing.holdProbability === 50
                        ? 'bg-yellow-100 text-yellow-800'
                        : 'bg-red-100 text-red-800'
                }`}
              >
                {pairing.holdProbability}% -{' '}
                {pairing.holdProbability === 100
                  ? 'Very Likely'
                  : pairing.holdProbability === 75
                    ? 'Likely'
                    : pairing.holdProbability === 50
                      ? 'Unlikely'
                      : 'Very Unlikely'}
              </Badge>
            </div>
          )}
        </>
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
          <div>
            <span className="font-medium">Pairing:</span>{' '}
            {String(pairing.pairingNumber || '')}
          </div>
          {pairing.effectiveDates && (
            <div>
              <span className="font-medium">Effective:</span>{' '}
              {String(pairing.effectiveDates)}
            </div>
          )}
          {pairing.creditHours && (
            <div>
              <span className="font-medium">Credit:</span>{' '}
              {String(pairing.creditHours)}
            </div>
          )}
          {pairing.blockHours && (
            <div>
              <span className="font-medium">Block:</span>{' '}
              {String(pairing.blockHours)}
            </div>
          )}
          {pairing.payHours && (
            <div>
              <span className="font-medium">Pay:</span>{' '}
              {String(pairing.payHours)}
            </div>
          )}
        </div>
        <div className="space-y-2">
          {pairing.tafb && (
            <div>
              <span className="font-medium">TAFB:</span> {String(pairing.tafb)}
            </div>
          )}
          {pairing.pairingDays && (
            <div>
              <span className="font-medium">Days:</span>{' '}
              {String(pairing.pairingDays)}
            </div>
          )}
          {pairing.holdProbability !== undefined && (
            <div>
              <span className="font-medium">Hold Probability:</span>
              <Badge
                variant="secondary"
                className={`ml-2 ${
                  pairing.holdProbability === 100
                    ? 'bg-green-100 text-green-800'
                    : pairing.holdProbability === 75
                      ? 'bg-blue-100 text-blue-800'
                      : pairing.holdProbability === 50
                        ? 'bg-yellow-100 text-yellow-800'
                        : 'bg-red-100 text-red-800'
                }`}
              >
                {pairing.holdProbability}% -{' '}
                {pairing.holdProbability === 100
                  ? 'Very Likely'
                  : pairing.holdProbability === 75
                    ? 'Likely'
                    : pairing.holdProbability === 50
                      ? 'Unlikely'
                      : 'Very Unlikely'}
              </Badge>
            </div>
          )}
        </div>
      </div>

      {pairing.route && (
        <div>
          <div className="font-medium mb-2">Route:</div>
          <Card>
            <CardContent className="p-3">
              <div className="text-sm font-mono">{String(pairing.route)}</div>
            </CardContent>
          </Card>
        </div>
      )}

      {pairing.layovers &&
        Array.isArray(pairing.layovers) &&
        pairing.layovers.length > 0 && (
          <div>
            <div className="font-medium mb-2">Layovers:</div>
            <div className="flex flex-wrap gap-2">
              {pairing.layovers.map((layover, index) => (
                <Badge key={index} variant="outline">
                  {String(layover)}
                </Badge>
              ))}
            </div>
          </div>
        )}

      {(pairing.fullText || pairing.fullTextBlock) && (
        <div>
          <div className="font-medium mb-2">Full Pairing Text:</div>
          <Card>
            <CardContent className="p-3">
              <pre className="text-xs font-mono whitespace-pre-wrap bg-gray-50 p-3 rounded border overflow-x-auto max-h-64">
                {pairing.fullTextBlock || pairing.fullText}
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
        <HoverCardContent className="w-80">{hoverContent}</HoverCardContent>
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
