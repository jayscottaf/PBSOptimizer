import { CircleHelp, Hotel, PlaneLanding, PlaneTakeoff } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import type { CommuteFitResult } from '@/lib/commute-fit';
import { cn } from '@/lib/utils';

interface CommuteFitBadgeProps {
  result: CommuteFitResult;
  className?: string;
  showTimes?: boolean;
}

const STATUS_DETAILS = {
  both: {
    label: 'Fits both ways',
    icon: PlaneLanding,
    className: 'border-success/25 bg-success/10 text-success',
  },
  'commute-in-only': {
    label: 'Commute in only',
    icon: PlaneTakeoff,
    className: 'border-info/25 bg-info/10 text-info',
  },
  'commute-home-only': {
    label: 'Commute home only',
    icon: PlaneLanding,
    className: 'border-info/25 bg-info/10 text-info',
  },
  'overnight-needed': {
    label: 'Hotel likely needed',
    icon: Hotel,
    className: 'border-warning/25 bg-warning/10 text-warning',
  },
  unknown: {
    label: 'Times unavailable',
    icon: CircleHelp,
    className: 'border-border bg-muted text-muted-foreground',
  },
} as const;

export function CommuteFitBadge({
  result,
  className,
  showTimes = false,
}: CommuteFitBadgeProps) {
  const detail = STATUS_DETAILS[result.status];
  const Icon = detail.icon;
  const timing =
    showTimes && result.status !== 'unknown'
      ? ` · ${result.reportLabel} → ${result.releaseLabel}`
      : '';

  return (
    <Badge
      variant="outline"
      className={cn(
        'gap-1 whitespace-nowrap font-medium',
        detail.className,
        className
      )}
      title={result.reasons.join(' ')}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      {detail.label}
      {timing}
    </Badge>
  );
}
