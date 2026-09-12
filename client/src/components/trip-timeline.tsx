import {
  groupTripDays,
  formatFlightTime,
  type TimelineSegment,
} from '@/lib/trip-timeline';
import { formatDuration, printedDurationMinutes } from '@shared/durations';

export function TripTimeline({ segments }: { segments: TimelineSegment[] }) {
  const days = groupTripDays(segments);
  if (!days.length)
    return (
      <p className="text-sm text-muted-foreground">
        No flight segments available. Check the original report below.
      </p>
    );
  return (
    <ol
      aria-label="Trip itinerary"
      className="space-y-5 border-l-2 border-primary/30 pl-5"
    >
      {days.map(({ letter, day, flights }, index) => (
        <li key={letter} className="relative">
          <span
            aria-hidden="true"
            className="absolute -left-[27px] top-1 h-3 w-3 rounded-full border-2 border-background bg-primary"
          />
          {day &&
            index > 0 &&
            days[index - 1].day &&
            day - days[index - 1].day! > 1 && (
              <p className="mb-2 text-xs text-muted-foreground">
                No flights listed on {day - days[index - 1].day! - 1}{' '}
                intervening day(s)
              </p>
            )}
          <h4 className="mb-2 text-sm font-semibold">
            {day ? `Day ${day}` : 'Day not specified'}{' '}
            <span className="ml-1 font-normal text-muted-foreground">
              {day ? `· ${letter}` : ''}
            </span>
          </h4>
          <div className="space-y-2">
            {flights.map((flight, index) => (
              <div key={index} className="rounded-lg border bg-card p-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>
                    Flight {flight.flightNumber || '—'}
                    {flight.isDeadhead ? ' · Deadhead' : ''}
                  </span>
                  <span>
                    {formatDuration(
                      printedDurationMinutes(flight.blockTime),
                      ':'
                    )}{' '}
                    block
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                  <div>
                    <p className="text-lg font-semibold">
                      {flight.departure || '—'}
                    </p>
                    <p className="tabular-nums text-sm">
                      {formatFlightTime(flight.departureTime)}
                    </p>
                  </div>
                  <span aria-label="to" className="text-muted-foreground">
                    →
                  </span>
                  <div className="text-right">
                    <p className="text-lg font-semibold">
                      {flight.arrival || '—'}
                    </p>
                    <p className="tabular-nums text-sm">
                      {formatFlightTime(flight.arrivalTime)}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </li>
      ))}
    </ol>
  );
}
