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
      // Phones: pinned just above the fixed MobileNav (min-h-14 + border) so
      // tapping compare deep in the list visibly does something. Desktop:
      // inline above the table, which scrolls in its own panel.
      className="fixed inset-x-0 bottom-[calc(3.5rem+1px+env(safe-area-inset-bottom))] z-30 flex items-center gap-2 border-t border-primary/30 bg-card/95 px-3 py-2 shadow-[0_-4px_12px_rgba(0,0,0,0.25)] backdrop-blur md:static md:z-auto md:flex-row md:justify-between md:gap-3 md:border-b md:border-t-0 md:border-primary/20 md:bg-primary/[0.06] md:px-4 md:py-3 md:shadow-none md:backdrop-blur-none"
      role="status"
      aria-live="polite"
    >
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto md:flex-wrap md:overflow-visible">
        <div className="hidden shrink-0 items-center gap-1.5 text-sm font-medium sm:flex">
          <Columns3 className="h-4 w-4 text-primary" />
          Compare trips
        </div>
        {pairings.map(pairing => (
          <Badge
            key={pairing.id}
            variant="secondary"
            className="shrink-0 gap-1.5 py-1 pl-2.5 pr-1"
          >
            #{pairing.pairingNumber}
            <button
              type="button"
              onClick={() => onRemove(pairing.id)}
              className="relative rounded-full p-0.5 before:absolute before:-inset-3 before:content-[''] hover:bg-background"
              aria-label={`Remove ${pairing.pairingNumber} from comparison`}
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
        {pairings.length < 3 && (
          <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
            Add up to {3 - pairings.length} more
          </span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1 md:gap-2">
        <Button variant="ghost" size="sm" onClick={onClear} className="min-h-10 px-2 md:min-h-0">
          Clear
        </Button>
        <Button
          size="sm"
          onClick={onCompare}
          disabled={pairings.length < 2}
          className="min-h-10 gap-2 md:min-h-0"
        >
          <Columns3 className="h-4 w-4" />
          {pairings.length < 2 ? 'Add 1 more' : `Compare ${pairings.length}`}
        </Button>
      </div>
    </div>
  );
}
