import { useState } from 'react';
import { format, isSameMonth, startOfMonth } from 'date-fns';
import { Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import type { CalendarEntryKind } from '@shared/schema';
import { CALENDAR_KIND_LABELS } from '@/lib/line-calendar';

const KINDS: CalendarEntryKind[] = ['training', 'reserve', 'vacation', 'other'];

/** "15:00" -> 15, "7:30" -> 7.5, "12.5" -> 12.5; null when blank/invalid. */
export function parseCreditInput(value: string): number | null {
  const text = value.trim();
  if (!text) return null;
  const clock = text.match(/^(\d{1,3}):([0-5]\d)$/);
  if (clock) return Number(clock[1]) + Number(clock[2]) / 60;
  const decimal = Number(text);
  return Number.isFinite(decimal) && decimal >= 0 ? decimal : null;
}

interface Props {
  userId: number;
  /** Month being viewed; the form starts on its first day. */
  defaultDate: Date;
  onAdded: () => void;
}

/**
 * Manual calendar entry for anything the bid package and wide schedule
 * don't cover: training, reserve, vacation or a personal event.
 */
export function AddCalendarEventDialog({
  userId,
  defaultDate,
  onAdded,
}: Props) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<CalendarEntryKind>('training');
  const [title, setTitle] = useState('');
  // Today when viewing the current month, otherwise the viewed month's 1st.
  const day = format(
    isSameMonth(defaultDate, new Date()) ? new Date() : startOfMonth(defaultDate),
    'yyyy-MM-dd'
  );
  const [startDate, setStartDate] = useState(day);
  const [startTime, setStartTime] = useState('08:00');
  const [endDate, setEndDate] = useState(day);
  const [endTime, setEndTime] = useState('17:00');
  const [credit, setCredit] = useState('');
  const [saving, setSaving] = useState(false);

  const start = new Date(`${startDate}T${startTime || '00:00'}`);
  const end = new Date(`${endDate}T${endTime || '23:59'}`);
  const creditHours = parseCreditInput(credit);
  const invalid =
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime()) ||
    end < start ||
    (credit.trim() !== '' && creditHours === null);

  const reset = () => {
    setKind('training');
    setTitle('');
    setStartDate(day);
    setStartTime('08:00');
    setEndDate(day);
    setEndTime('17:00');
    setCredit('');
  };

  const save = async () => {
    if (invalid) return;
    setSaving(true);
    try {
      await api.addCalendarEntry({
        userId,
        kind,
        title: title.trim() || CALENDAR_KIND_LABELS[kind],
        startDate: start,
        endDate: end,
        creditHours,
      });
      toast({ title: 'Added to calendar' });
      onAdded();
      setOpen(false);
      reset();
    } catch (error) {
      toast({
        title: 'Could not add the event',
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        setOpen(next);
        if (next) {
          setStartDate(day);
          setEndDate(day);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="min-h-10 gap-1.5">
          <Plus className="h-4 w-4" />
          Add event
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add to calendar</DialogTitle>
          <DialogDescription>
            Training, reserve, vacation or anything else that blocks days. It
            counts toward credit and days off, and trips that overlap it are
            flagged as conflicts.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Type</Label>
            <div className="grid grid-cols-4 gap-1.5" role="radiogroup">
              {KINDS.map(option => (
                <Button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={kind === option}
                  variant={kind === option ? 'default' : 'outline'}
                  size="sm"
                  className="min-h-10 px-1 text-xs"
                  onClick={() => setKind(option)}
                >
                  {CALENDAR_KIND_LABELS[option]}
                </Button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="calendar-event-title">Title</Label>
            <Input
              id="calendar-event-title"
              value={title}
              maxLength={80}
              onChange={event => setTitle(event.target.value)}
              placeholder={
                kind === 'training'
                  ? 'e.g. 10WD or Recurrent sim'
                  : CALENDAR_KIND_LABELS[kind]
              }
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="calendar-event-start-date">Starts</Label>
              <Input
                id="calendar-event-start-date"
                type="date"
                value={startDate}
                onChange={event => {
                  setStartDate(event.target.value);
                  if (event.target.value > endDate)
                    setEndDate(event.target.value);
                }}
              />
              <Input
                type="time"
                aria-label="Start time"
                value={startTime}
                onChange={event => setStartTime(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="calendar-event-end-date">Ends</Label>
              <Input
                id="calendar-event-end-date"
                type="date"
                value={endDate}
                min={startDate}
                onChange={event => setEndDate(event.target.value)}
              />
              <Input
                type="time"
                aria-label="End time"
                value={endTime}
                onChange={event => setEndTime(event.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="calendar-event-credit">Credit (optional)</Label>
            <Input
              id="calendar-event-credit"
              value={credit}
              inputMode="decimal"
              onChange={event => setCredit(event.target.value)}
              placeholder="e.g. 15:00"
            />
            {credit.trim() !== '' && creditHours === null && (
              <p className="text-xs text-destructive">
                Use hours:minutes (15:00) or hours (15).
              </p>
            )}
          </div>
          {end < start && (
            <p className="text-xs text-destructive">
              The end must be after the start.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button
            className="min-h-11 w-full sm:w-auto"
            onClick={save}
            disabled={invalid || saving}
          >
            {saving ? 'Adding…' : 'Add to calendar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
