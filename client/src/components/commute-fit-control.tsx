import { useId } from 'react';
import { ChevronDown, Clock3, Info, PlaneTakeoff } from 'lucide-react';
import type { CommuteFitPreferences } from '@/lib/commute-fit';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

const MINUTES_PER_DAY = 24 * 60;

export interface CommuteFitCounts {
  both: number;
  total: number;
  unknown: number;
}

export interface CommuteFitControlProps {
  value: CommuteFitPreferences;
  onChange: (value: CommuteFitPreferences) => void;
  counts?: CommuteFitCounts;
  disabled?: boolean;
  className?: string;
}

function formatTimeInput(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0 || minutes >= MINUTES_PER_DAY) {
    return '';
  }

  const hours = Math.floor(minutes / 60)
    .toString()
    .padStart(2, '0');
  const remainder = (minutes % 60).toString().padStart(2, '0');
  return `${hours}:${remainder}`;
}

function parseTimeInput(value: string): number | null {
  const match = value.match(/^(\d{2}):(\d{2})$/);
  if (!match) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) {
    return null;
  }
  return hours * 60 + minutes;
}

function parseBufferInput(value: string): number | null {
  if (value.trim() === '') {
    return 0;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Math.min(180, Math.max(0, Math.round(parsed)));
}

export function CommuteFitControl({
  value,
  onChange,
  counts,
  disabled = false,
  className,
}: CommuteFitControlProps) {
  const id = useId();
  const commuteEnabledId = `${id}-enabled`;
  const earliestReportId = `${id}-earliest-report`;
  const latestReleaseId = `${id}-latest-release`;
  const inboundBufferId = `${id}-inbound-buffer`;
  const outboundBufferId = `${id}-outbound-buffer`;
  const bothWaysOnlyId = `${id}-both-ways-only`;
  const update = (patch: Partial<CommuteFitPreferences>) =>
    onChange({ ...value, ...patch });

  const handleTimeChange = (
    key: 'earliestAcceptableReportMinutes' | 'latestAcceptableReleaseMinutes',
    rawValue: string
  ) => {
    const minutes = parseTimeInput(rawValue);
    if (minutes !== null) {
      update({ [key]: minutes });
    }
  };

  const handleBufferChange = (
    key: 'inboundBufferMinutes' | 'outboundBufferMinutes',
    rawValue: string
  ) => {
    const minutes = parseBufferInput(rawValue);
    if (minutes !== null) {
      update({ [key]: minutes });
    }
  };

  const matchingCount = counts
    ? Math.min(counts.both, counts.total)
    : undefined;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant={value.enabled ? 'secondary' : 'outline'}
          size="sm"
          disabled={disabled}
          aria-label={
            value.enabled && matchingCount !== undefined
              ? `Commute fit enabled, ${matchingCount} of ${counts?.total} trips fit both ways`
              : `Commute fit ${value.enabled ? 'enabled' : 'disabled'}`
          }
          className={cn(
            'h-9 gap-2 border-primary/20',
            value.enabled && 'bg-primary/10 text-primary hover:bg-primary/15',
            className
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              'h-2 w-2 rounded-full bg-muted-foreground/40',
              value.enabled && 'bg-success'
            )}
          />
          Commute fit
          {value.enabled && matchingCount !== undefined && (
            <Badge
              variant="secondary"
              className="h-5 border-0 bg-background/80 px-1.5 tabular-nums text-foreground"
            >
              {matchingCount}/{counts?.total}
            </Badge>
          )}
          <ChevronDown className="h-3.5 w-3.5 opacity-60" />
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        sideOffset={8}
        collisionPadding={16}
        className="max-h-[calc(100vh-2rem)] w-[min(24rem,calc(100vw-2rem))] overflow-y-auto p-0"
      >
        <div className="border-b bg-muted/35 px-4 py-3.5">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <PlaneTakeoff className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <h3 className="font-semibold leading-5">Commute fit</h3>
              <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                Find pairings that fit the times you can reach and leave base.
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-4 p-4">
          <div className="flex items-center justify-between gap-4 rounded-lg border bg-background p-3">
            <div className="min-w-0">
              <Label htmlFor={commuteEnabledId}>Use commute fit</Label>
              <p className="mt-1 text-xs text-muted-foreground">
                Evaluate every trip against these times.
              </p>
            </div>
            <Switch
              id={commuteEnabledId}
              checked={value.enabled}
              onCheckedChange={checked => update({ enabled: checked })}
              aria-describedby={`${commuteEnabledId}-description`}
            />
            <span id={`${commuteEnabledId}-description`} className="sr-only">
              Turns commute timing estimates on or off.
            </span>
          </div>

          <fieldset
            disabled={!value.enabled}
            className="space-y-4 disabled:opacity-55"
          >
            <legend className="sr-only">Commute timing preferences</legend>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor={earliestReportId}>Earliest report</Label>
                <div className="relative">
                  <Clock3 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id={earliestReportId}
                    type="time"
                    value={formatTimeInput(
                      value.earliestAcceptableReportMinutes
                    )}
                    onChange={event =>
                      handleTimeChange(
                        'earliestAcceptableReportMinutes',
                        event.target.value
                      )
                    }
                    className="pl-9 tabular-nums"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  First duty report you can make
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor={latestReleaseId}>Latest release</Label>
                <div className="relative">
                  <Clock3 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id={latestReleaseId}
                    type="time"
                    value={formatTimeInput(
                      value.latestAcceptableReleaseMinutes
                    )}
                    onChange={event =>
                      handleTimeChange(
                        'latestAcceptableReleaseMinutes',
                        event.target.value
                      )
                    }
                    className="pl-9 tabular-nums"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Last duty release you can accept
                </p>
              </div>
            </div>

            <details className="rounded-lg border bg-background">
              <summary className="cursor-pointer px-3 py-2.5 text-sm font-medium marker:text-primary">
                Extra connection time{' '}
                <span className="ml-1 font-normal text-muted-foreground">
                  Optional
                </span>
              </summary>
              <div className="grid grid-cols-2 gap-3 border-t px-3 py-3">
                <div className="space-y-1.5">
                  <Label htmlFor={inboundBufferId} className="text-xs">
                    Before report
                  </Label>
                  <div className="relative">
                    <Input
                      id={inboundBufferId}
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={180}
                      step={15}
                      value={value.inboundBufferMinutes}
                      onChange={event =>
                        handleBufferChange(
                          'inboundBufferMinutes',
                          event.target.value
                        )
                      }
                      className="pr-11 tabular-nums"
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                      min
                    </span>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={outboundBufferId} className="text-xs">
                    After release
                  </Label>
                  <div className="relative">
                    <Input
                      id={outboundBufferId}
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={180}
                      step={15}
                      value={value.outboundBufferMinutes}
                      onChange={event =>
                        handleBufferChange(
                          'outboundBufferMinutes',
                          event.target.value
                        )
                      }
                      className="pr-11 tabular-nums"
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                      min
                    </span>
                  </div>
                </div>
              </div>
            </details>

            <div className="flex items-start justify-between gap-4 rounded-lg border border-primary/20 bg-primary/[0.06] p-3">
              <div className="min-w-0">
                <Label htmlFor={bothWaysOnlyId}>
                  Show only trips that fit both ways
                </Label>
                <p className="mt-1 text-xs text-muted-foreground">
                  Hide trips that require an overnight on either end.
                </p>
              </div>
              <Switch
                id={bothWaysOnlyId}
                disabled={!value.enabled}
                checked={value.onlyShowBothWays}
                onCheckedChange={checked =>
                  update({ onlyShowBothWays: checked })
                }
              />
            </div>
          </fieldset>

          {value.enabled && counts && (
            <div
              className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs"
              role="status"
              aria-live="polite"
            >
              <span className="font-medium text-success">
                {matchingCount} fit both ways
              </span>
              <span className="text-muted-foreground">
                of {counts.total} trips
              </span>
              {counts.unknown > 0 && (
                <span className="text-warning">
                  {counts.unknown} missing times
                </span>
              )}
            </div>
          )}

          <div className="flex gap-2 rounded-lg bg-muted/55 p-3 text-xs leading-5 text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <p>
              Schedule timing only. Report is estimated 60 minutes before the
              first departure and release 30 minutes after the final arrival.
              This does not check flight schedules, seats, or inventory.
            </p>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
