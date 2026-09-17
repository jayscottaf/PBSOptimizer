import { Columns3, X } from 'lucide-react';
import type { Pairing } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

interface PairingComparisonBarProps {
  pairings: Pairing[];
  onRemove: (id: number) => void;
  onClear: () => void;
  onCompare: () => void;
}

export function PairingComparisonBar({
  pairings,
  onRemove,
  onClear,
  onCompare,
}: PairingComparisonBarProps) {
  if (pairings.length === 0) return null;

  return (
    <div
      className="flex flex-col gap-3 border-b border-primary/20 bg-primary/[0.06] px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4"
      role="status"
      aria-live="polite"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Columns3 className="h-4 w-4 text-primary" />
          Compare trips
        </div>
        {pairings.map(pairing => (
          <Badge
            key={pairing.id}
            variant="secondary"
            className="gap-1.5 py-1 pl-2.5 pr-1"
          >
            #{pairing.pairingNumber}
            <button
              type="button"
              onClick={() => onRemove(pairing.id)}
              className="rounded-full p-0.5 hover:bg-background"
              aria-label={`Remove ${pairing.pairingNumber} from comparison`}
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
        {pairings.length < 3 && (
          <span className="text-xs text-muted-foreground">
            Add up to {3 - pairings.length} more
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onClear}>
          Clear
        </Button>
        <Button
          size="sm"
          onClick={onCompare}
          disabled={pairings.length < 2}
          className="gap-2"
        >
          <Columns3 className="h-4 w-4" />
          Compare {pairings.length > 1 ? pairings.length : ''}
        </Button>
      </div>
    </div>
  );
}
