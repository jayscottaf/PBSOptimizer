import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, Search } from 'lucide-react';
import { api } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  CALENDAR_KIND_LABELS,
  describeLineItemWhen,
  lineItemTimes,
  lineItemTitle,
  type LineForCalendar,
} from '@/lib/line-calendar';
import { decimalHoursToMinutes, formatDuration } from '@shared/durations';
import { CALENDAR_KIND_STYLES } from '@/lib/calendar-kinds';

interface Props {
  userId?: number;
  /** The line found for the profile's seniority, if any. */
  line: LineForCalendar | null;
  /** The uploaded report's category, to look a line up by seniority. */
  report: {
    month: string;
    year: number;
    base: string;
    aircraft: string;
    position: string;
  };
}

/**
 * Offers to put the pilot's own line from a just-uploaded wide schedule on
 * the calendar: training, reserve and vacation blocks as well as trips.
 */
export function MyLineCalendar({ userId, line: initialLine, report }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [line, setLine] = useState<LineForCalendar | null>(initialLine);
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(initialLine?.items.map((_, index) => index) ?? [])
  );
  const [seniority, setSeniority] = useState('');
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState(false);

  const findLine = async () => {
    const number = Number(seniority);
    if (!Number.isInteger(number) || number <= 0) return;
    setBusy(true);
    try {
      const found = await api.getWideLine({ ...report, seniority: number });
      setLine(found);
      setSelected(new Set(found.items.map((_, index) => index)));
    } catch (error) {
      toast({
        title: 'Line not found',
        description:
          error instanceof Error ? error.message : 'No line for that number.',
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  const addToCalendar = async () => {
    if (!line || !userId) return;
    setBusy(true);
    let count = 0;
    try {
      for (const [index, item] of line.items.entries()) {
        if (!selected.has(index)) continue;
        const { start, end } = lineItemTimes(item, line);
        if (item.pairingId !== null) {
          await api.addToCalendar(userId, item.pairingId, start, end);
        } else {
          await api.addCalendarEntry({
            userId,
            kind: item.kind,
            title: lineItemTitle(item),
            startDate: start,
            endDate: end,
            creditHours: item.creditHours,
          });
        }
        count++;
      }
      setAdded(true);
      toast({
        title: 'Added to calendar',
        description: `${count} ${count === 1 ? 'item' : 'items'} from your ${line.month} ${line.year} line.`,
      });
    } catch (error) {
      toast({
        title:
          count > 0
            ? `Added ${count}, then stopped`
            : 'Could not add to calendar',
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
      queryClient.invalidateQueries({ queryKey: ['calendar'] });
      queryClient.invalidateQueries({ queryKey: ['calendarEvents'] });
    }
  };

  if (!line) {
    return (
      <div className="space-y-2 rounded-lg border p-3 text-left text-sm">
        <p className="font-medium">Add your line to the calendar</p>
        <p className="text-xs text-muted-foreground">
          Your profile&apos;s seniority isn&apos;t on this report. Enter the
          seniority number shown beside your name on it.
        </p>
        <div className="flex gap-2">
          <Input
            value={seniority}
            onChange={event =>
              setSeniority(event.target.value.replace(/\D/g, ''))
            }
            inputMode="numeric"
            placeholder="e.g. 14870"
            aria-label="Seniority number on this report"
          />
          <Button
            variant="outline"
            className="min-h-10 gap-1.5"
            onClick={findLine}
            disabled={busy || !seniority}
          >
            <Search className="h-4 w-4" /> Find
          </Button>
        </div>
      </div>
    );
  }

  const chosen = selected.size;
  return (
    <div className="space-y-3 rounded-lg border p-3 text-left text-sm">
      <div>
        <p className="font-medium">
          Your {line.month} {line.year} line · seniority {line.seniority}
        </p>
        <p className="text-xs text-muted-foreground">
          Choose what to put on your calendar. Training, reserve and vacation
          count toward credit, days off and trip conflicts.
        </p>
      </div>
      <ul className="space-y-1.5">
        {line.items.map((item, index) => {
          const style = CALENDAR_KIND_STYLES[item.kind];
          return (
            <li key={index}>
              <label className="flex min-h-10 cursor-pointer items-start gap-2">
                <Checkbox
                  className="mt-0.5"
                  checked={selected.has(index)}
                  onCheckedChange={checked =>
                    setSelected(previous => {
                      const next = new Set(previous);
                      if (checked) next.add(index);
                      else next.delete(index);
                      return next;
                    })
                  }
                />
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[11px] font-medium text-white ${style.chip}`}
                    >
                      {CALENDAR_KIND_LABELS[item.kind]}
                    </span>
                    <span className="font-medium">{item.code}</span>
                    {item.creditHours !== null && item.creditHours > 0 && (
                      <span className="text-xs text-muted-foreground">
                        {formatDuration(
                          decimalHoursToMinutes(item.creditHours),
                          ':'
                        )}{' '}
                        credit
                      </span>
                    )}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {describeLineItemWhen(item, line)}
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      {!line.bidPackageFound &&
        line.items.some(item => item.kind === 'pairing') && (
          <p className="text-xs text-muted-foreground">
            The {line.month} {line.year} bid package isn&apos;t uploaded, so
            trips go on the calendar by number without their flight details.
          </p>
        )}
      {!userId ? (
        <p className="text-xs text-muted-foreground">
          Complete your profile to use the calendar.
        </p>
      ) : (
        <Button
          className="min-h-11 w-full gap-2"
          onClick={addToCalendar}
          disabled={busy || chosen === 0 || added}
        >
          <CalendarPlus className="h-4 w-4" />
          {added
            ? 'Added to calendar'
            : busy
              ? 'Adding…'
              : `Add ${chosen} ${chosen === 1 ? 'item' : 'items'} to calendar`}
        </Button>
      )}
    </div>
  );
}
