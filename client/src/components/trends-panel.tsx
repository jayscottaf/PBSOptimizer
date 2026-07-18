import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useQuery } from '@tanstack/react-query';
import {
  TrendingUp,
  ListChecks,
  CircleCheck,
  CircleAlert,
  Lightbulb,
} from 'lucide-react';

interface TrendPeriod {
  period: string;
  pilots: number;
  totalPrefs: number;
  honored: number;
  lostToSenior: number;
}

interface HoldBoundary {
  period: string;
  pairingDays: number;
  juniorMostPercentile: number;
  awards: number;
}

interface TrendsResponse {
  base: string;
  month: string | null;
  availableMonths: string[];
  periods: TrendPeriod[];
  holdBoundaries: HoldBoundary[];
  window: {
    windowMin: number;
    windowMax: number;
    threshold: number;
    period: string;
  } | null;
}

const MONTH_NAMES: Record<string, string> = {
  JAN: 'January', FEB: 'February', MAR: 'March', APR: 'April',
  MAY: 'May', JUN: 'June', JUL: 'July', AUG: 'August',
  SEP: 'September', OCT: 'October', NOV: 'November', DEC: 'December',
};

interface TypeMixPeriod {
  period: string;
  award: number;
  avoid: number;
  preferOff: number;
  setCondition: number;
  other: number;
  totalPrefs: number;
  pilots: number;
  avgPrefsPerPilot: number;
  preferOffDays: number;
}

interface CityCount {
  city: string;
  count: number;
}

interface BidPatternsResponse {
  base: string;
  month: string | null;
  availableMonths: string[];
  typeMixByPeriod: TypeMixPeriod[];
  topRequestedLayovers: CityCount[];
  topAvoidedLayovers: CityCount[];
  earlyCheckInAvoidance: Array<{ hour: number; count: number }>;
  checkInStations: Array<{ station: string; awarded: number; avoided: number }>;
  daysOffPatterns: Array<{ days: number; count: number }>;
}

const TYPE_COLORS: Record<string, string> = {
  award: '#60a5fa',
  avoid: '#f87171',
  preferOff: '#34d399',
  setCondition: '#c084fc',
  other: '#9ca3af',
};

const TYPE_LABELS: Record<string, string> = {
  award: 'Award',
  avoid: 'Avoid',
  preferOff: 'Prefer Off',
  setCondition: 'Set Condition',
  other: 'Other',
};

function TypeMixChart({ periods }: { periods: TypeMixPeriod[] }) {
  return (
    <div className="space-y-1.5">
      {periods.map(p => (
        <div key={p.period} className="flex items-center gap-2 text-xs">
          <span className="w-20 shrink-0 text-muted-foreground font-mono">
            {p.period}
          </span>
          <div className="flex-1 h-4 rounded overflow-hidden flex bg-muted">
            {(['award', 'avoid', 'preferOff', 'setCondition', 'other'] as const).map(
              key => {
                const widthPct = (p[key] / Math.max(1, p.totalPrefs)) * 100;
                return widthPct > 0 ? (
                  <div
                    key={key}
                    style={{
                      width: `${widthPct}%`,
                      backgroundColor: TYPE_COLORS[key],
                    }}
                    title={`${TYPE_LABELS[key]}: ${p[key]}`}
                  />
                ) : null;
              }
            )}
          </div>
          <span className="w-16 shrink-0 text-right text-muted-foreground">
            {p.avgPrefsPerPilot.toFixed(0)}/pilot
          </span>
        </div>
      ))}
      <div className="flex flex-wrap gap-4 mt-2">
        {(['award', 'avoid', 'preferOff', 'setCondition', 'other'] as const).map(
          key => (
            <span
              key={key}
              className="flex items-center gap-1.5 text-xs text-muted-foreground"
            >
              <span
                className="inline-block w-3 h-3 rounded-sm"
                style={{ backgroundColor: TYPE_COLORS[key] }}
              />
              {TYPE_LABELS[key]}
            </span>
          )
        )}
      </div>
    </div>
  );
}

function RankedCityList({
  title,
  cities,
  accent,
}: {
  title: string;
  cities: CityCount[];
  accent: string;
}) {
  const max = Math.max(1, ...cities.map(c => c.count));
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground mb-1.5">
        {title}
      </p>
      <div className="space-y-1">
        {cities.map(c => (
          <div key={c.city} className="flex items-center gap-2 text-xs">
            <span className="w-9 shrink-0 font-mono text-secondary-foreground">
              {c.city}
            </span>
            <div className="flex-1 h-3 bg-muted rounded overflow-hidden">
              <div
                className="h-full rounded"
                style={{
                  width: `${(c.count / max) * 100}%`,
                  backgroundColor: accent,
                }}
              />
            </div>
            <span className="w-8 shrink-0 text-right text-muted-foreground">
              {c.count}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Histogram({
  data,
  labelFor,
  color,
}: {
  data: Array<{ key: number; count: number }>;
  labelFor: (key: number) => string;
  color: string;
}) {
  const max = Math.max(1, ...data.map(d => d.count));
  // Percentage heights need a parent with a resolved height; a flex column
  // sized to its own content (label + bar) never resolves one, so the bars
  // collapse to ~0. Give each bar column a fixed pixel height to fill
  // instead, and render labels in a separate row underneath.
  const BAR_AREA_PX = 80;
  return (
    <div>
      <div className="flex items-end gap-1" style={{ height: BAR_AREA_PX }}>
        {data.map(d => (
          <div
            key={d.key}
            className="flex-1 h-full flex flex-col justify-end"
            title={`${labelFor(d.key)}: ${d.count}`}
          >
            <div
              className="w-full rounded-t"
              style={{
                height: `${Math.max(d.count > 0 ? 2 : 0, (d.count / max) * BAR_AREA_PX)}px`,
                backgroundColor: color,
              }}
            />
          </div>
        ))}
      </div>
      <div className="flex gap-1 mt-1">
        {data.map(d => (
          <span
            key={d.key}
            className="flex-1 text-center text-[9px] text-muted-foreground whitespace-nowrap"
          >
            {labelFor(d.key)}
          </span>
        ))}
      </div>
    </div>
  );
}

const DAY_COLORS: Record<number, string> = {
  1: '#60a5fa', // blue
  2: '#34d399', // green
  3: '#fbbf24', // amber
  4: '#f87171', // red
  5: '#c084fc', // purple
};

function BoundaryChart({ boundaries }: { boundaries: HoldBoundary[] }) {
  const periods = [...new Set(boundaries.map(b => b.period))];
  const dayLengths = [...new Set(boundaries.map(b => b.pairingDays))]
    .filter(d => d >= 1 && d <= 5)
    .sort();
  if (periods.length < 2) {
    return (
      <p className="text-sm text-muted-foreground">
        Not enough periods for a trend line yet.
      </p>
    );
  }

  const W = 720;
  const H = 260;
  const PAD_L = 40;
  const PAD_B = 42;
  const PAD_T = 10;
  const x = (i: number) =>
    PAD_L + (i / (periods.length - 1)) * (W - PAD_L - 10);
  const y = (pct: number) => PAD_T + ((100 - pct) / 100) * (H - PAD_T - PAD_B);

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full min-w-[640px]"
        role="img"
        aria-label="Junior-most holder percentile by trip length over time"
      >
        {[0, 25, 50, 75, 100].map(g => (
          <g key={g}>
            <line
              x1={PAD_L}
              y1={y(g)}
              x2={W - 10}
              y2={y(g)}
              stroke="currentColor"
              strokeOpacity={0.12}
            />
            <text
              x={PAD_L - 6}
              y={y(g) + 4}
              textAnchor="end"
              fontSize={10}
              fill="currentColor"
              fillOpacity={0.55}
            >
              {g}
            </text>
          </g>
        ))}
        {periods.map((p, i) =>
          i % Math.ceil(periods.length / 9) === 0 || i === periods.length - 1 ? (
            <text
              key={p}
              x={x(i)}
              y={H - 24}
              textAnchor="middle"
              fontSize={9}
              fill="currentColor"
              fillOpacity={0.55}
              transform={`rotate(-30 ${x(i)} ${H - 24})`}
            >
              {p}
            </text>
          ) : null
        )}
        {dayLengths.map(days => {
          const points = periods
            .map((p, i) => {
              const row = boundaries.find(
                b => b.period === p && b.pairingDays === days
              );
              return row ? `${x(i)},${y(row.juniorMostPercentile)}` : null;
            })
            .filter(Boolean)
            .join(' ');
          return (
            <polyline
              key={days}
              points={points}
              fill="none"
              stroke={DAY_COLORS[days]}
              strokeWidth={2}
              strokeLinejoin="round"
            />
          );
        })}
      </svg>
      <div className="flex flex-wrap gap-4 mt-1">
        {dayLengths.map(days => (
          <span
            key={days}
            className="flex items-center gap-1.5 text-xs text-muted-foreground"
          >
            <span
              className="inline-block w-3 h-0.5 rounded"
              style={{ backgroundColor: DAY_COLORS[days] }}
            />
            {days}-day
          </span>
        ))}
      </div>
    </div>
  );
}

interface Insight {
  tone: 'success' | 'warning' | 'info';
  text: string;
}

/** Plain-English takeaways derived from the already-fetched history —
 *  averaged over the most recent 3 periods per trip length so a single
 *  odd month doesn't flip the message. */
function deriveInsights(
  data: TrendsResponse,
  seniorityPercentile: number | null | undefined
): Insight[] {
  const insights: Insight[] = [];

  const byDays = new Map<number, number[]>();
  for (const b of data.holdBoundaries) {
    if (b.juniorMostPercentile === null || b.juniorMostPercentile === undefined)
      continue;
    if (!byDays.has(b.pairingDays)) byDays.set(b.pairingDays, []);
    byDays.get(b.pairingDays)!.push(b.juniorMostPercentile);
  }
  const recentAvg = new Map<number, number>();
  for (const [days, values] of byDays) {
    const recent = values.slice(-3);
    recentAvg.set(
      days,
      recent.reduce((a, v) => a + v, 0) / Math.max(1, recent.length)
    );
  }

  if (
    recentAvg.size > 0 &&
    seniorityPercentile !== null &&
    seniorityPercentile !== undefined
  ) {
    const user = Number(seniorityPercentile);
    const holdable = [...recentAvg.entries()]
      .filter(([, pct]) => pct >= user + 5)
      .map(([d]) => d)
      .sort((a, b) => a - b);
    const tight = [...recentAvg.entries()]
      .filter(([, pct]) => pct < user)
      .sort((a, b) => a[1] - b[1]);
    if (holdable.length > 0) {
      insights.push({
        tone: 'success',
        text: `${holdable.map(d => `${d}-day`).join(', ')} trips have recently gone junior of your seniority (${user}%) — realistic targets for named awards.`,
      });
    }
    if (tight.length > 0) {
      const [days, pct] = tight[0];
      insights.push({
        tone: 'warning',
        text: `${days}-day trips are the tightest fit: the junior-most holder has averaged the ${pct.toFixed(0)}th percentile — senior of you, so treat them as long shots with fallbacks.`,
      });
    }
  }

  if (data.periods.length >= 4) {
    const shares = data.periods.map(p =>
      p.totalPrefs > 0 ? p.lostToSenior / p.totalPrefs : 0
    );
    const last = shares[shares.length - 1];
    const avg = shares.reduce((a, v) => a + v, 0) / shares.length;
    if (Math.abs(last - avg) >= 0.03) {
      insights.push({
        tone: 'info',
        text:
          last > avg
            ? `Contention is up: ${(last * 100).toFixed(0)}% of preferences were lost to seniors last period vs a ${(avg * 100).toFixed(0)}% average — leave more fallback room in your bid.`
            : `Contention eased last period (${(last * 100).toFixed(0)}% lost to seniors vs ${(avg * 100).toFixed(0)}% average) — a good month to reach for picks you usually miss.`,
      });
    }
  }

  return insights.slice(0, 3);
}

const INSIGHT_STYLES: Record<
  Insight['tone'],
  { icon: typeof CircleCheck; className: string }
> = {
  success: { icon: CircleCheck, className: 'text-success' },
  warning: { icon: CircleAlert, className: 'text-warning' },
  info: { icon: Lightbulb, className: 'text-info' },
};

export function TrendsPanel({
  seniorityPercentile,
}: {
  seniorityPercentile?: number | string | null;
} = {}) {
  const [month, setMonth] = useState<string>('');
  const monthQuery = month ? `?month=${month}` : '';

  const { data, isLoading, isError } = useQuery<TrendsResponse>({
    queryKey: ['/api/trends', month],
    queryFn: async () => {
      const res = await fetch(`/api/trends${monthQuery}`);
      if (!res.ok) throw new Error('Failed to load trends');
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });
  const { data: patterns } = useQuery<BidPatternsResponse>({
    queryKey: ['/api/bid-patterns', month],
    queryFn: async () => {
      const res = await fetch(`/api/bid-patterns${monthQuery}`);
      if (!res.ok) throw new Error('Failed to load bid patterns');
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
    enabled: !isLoading && !isError && !!data && data.periods.length > 0,
  });

  if (isLoading) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Crunching three years of award history…
      </div>
    );
  }
  if (isError || !data || data.periods.length === 0) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        No Reasons Report history imported yet — upload composite reports to
        unlock category trends.
      </div>
    );
  }

  const maxContention = Math.max(
    ...data.periods.map(p => p.lostToSenior / p.totalPrefs)
  );

  const userPct =
    seniorityPercentile !== null && seniorityPercentile !== undefined
      ? Number(seniorityPercentile)
      : undefined;
  const insights = deriveInsights(data, Number.isNaN(userPct) ? undefined : userPct);

  return (
    <div className="space-y-4 p-1">
      {insights.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {insights.map((insight, i) => {
            const { icon: Icon, className } = INSIGHT_STYLES[insight.tone];
            return (
              <Card key={i}>
                <CardContent className="flex items-start gap-2.5 p-4">
                  <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${className}`} />
                  <p className="text-sm leading-snug">{insight.text}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <CardTitle className="flex items-center gap-2 text-xl">
                <TrendingUp className="h-5 w-5 text-blue-500" />
                Category Trends — {data.base}
              </CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                {month
                  ? `Showing only ${MONTH_NAMES[month] ?? month} across every imported year — compare against what you're about to bid.`
                  : `Mined from ${data.periods.length} imported Reasons Report periods (${data.periods[0]?.period} – ${data.periods[data.periods.length - 1]?.period}).`}
                {data.window &&
                  ` Latest credit window ${data.window.windowMin.toFixed(0)}–${data.window.windowMax.toFixed(0)}h, threshold ${data.window.threshold.toFixed(0)}h (${data.window.period}).`}
              </p>
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
              Month
              <select
                value={month}
                onChange={e => setMonth(e.target.value)}
                className="rounded-md border border-input bg-card px-2 py-1.5 text-sm text-foreground"
              >
                <option value="">All periods</option>
                {data.availableMonths.map(m => (
                  <option key={m} value={m}>
                    {MONTH_NAMES[m] ?? m}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            How junior each trip length goes
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Percentile of the junior-most pilot awarded each trip length, per
            period. Higher lines = trips that go deep into the category (easier
            to hold); dips mark months when seniors took them.
          </p>
        </CardHeader>
        <CardContent className="text-secondary-foreground">
          <BoundaryChart boundaries={data.holdBoundaries} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Contention by period</CardTitle>
          <p className="text-xs text-muted-foreground">
            Share of all bid preferences lost to a more senior pilot — the
            category's competitiveness month by month.
          </p>
        </CardHeader>
        <CardContent>
          <div className="space-y-1.5">
            {data.periods.map(p => {
              const lostPct = (p.lostToSenior / p.totalPrefs) * 100;
              const honoredPct = (p.honored / p.totalPrefs) * 100;
              const widthPct =
                maxContention > 0
                  ? (p.lostToSenior / p.totalPrefs / maxContention) * 100
                  : 0;
              return (
                <div key={p.period} className="flex items-center gap-2 text-xs">
                  <span className="w-20 shrink-0 text-muted-foreground font-mono">
                    {p.period}
                  </span>
                  <div className="flex-1 h-4 bg-muted rounded overflow-hidden">
                    <div
                      className="h-full bg-red-400/80 dark:bg-red-500/70 rounded"
                      style={{ width: `${widthPct}%` }}
                    />
                  </div>
                  <span className="w-24 shrink-0 text-right text-red-500 dark:text-red-400">
                    {lostPct.toFixed(0)}% lost
                  </span>
                  <span className="w-24 shrink-0 text-right text-green-600 dark:text-green-400">
                    {honoredPct.toFixed(0)}% honored
                  </span>
                  <span className="w-16 shrink-0 text-right text-muted-foreground">
                    {p.pilots} pilots
                  </span>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {patterns && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ListChecks className="h-4 w-4 text-blue-500" />
                Bid patterns — what pilots actually ask for
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Mined from preference text across every imported period —
                what pilots bid, not just what they got.
              </p>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Preference mix &amp; bid complexity
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Share of each preference type per bid, and the average number
                of preferences per pilot (right column) — how much pilots are
                bidding has climbed sharply over time.
              </p>
            </CardHeader>
            <CardContent>
              <TypeMixChart periods={patterns.typeMixByPeriod} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Layover preferences</CardTitle>
              <p className="text-xs text-muted-foreground">
                Cities named in Award (requested) vs. Avoid preferences,
                ranked by how often they're bid.
              </p>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <RankedCityList
                  title="Most requested"
                  cities={patterns.topRequestedLayovers}
                  accent="#60a5fa"
                />
                <RankedCityList
                  title="Most avoided"
                  cities={patterns.topAvoidedLayovers}
                  accent="#f87171"
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Check-in time &amp; station preferences
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                What hour pilots want to start after (combining Award
                "Check-In Time &gt;" and Avoid "Check-In Time &lt;" bids), and
                which report station they favor or avoid.
              </p>
            </CardHeader>
            <CardContent className="space-y-5">
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">
                  Prefers check-in after…
                </p>
                <Histogram
                  data={patterns.earlyCheckInAvoidance.map(h => ({
                    key: h.hour,
                    count: h.count,
                  }))}
                  labelFor={h => `${h}:00`}
                  color="#60a5fa"
                />
              </div>
              <div className="space-y-1.5">
                {patterns.checkInStations.map(s => {
                  const max = Math.max(
                    1,
                    ...patterns.checkInStations.map(x => x.awarded + x.avoided)
                  );
                  return (
                    <div
                      key={s.station}
                      className="flex items-center gap-2 text-xs"
                    >
                      <span className="w-9 shrink-0 font-mono text-secondary-foreground">
                        {s.station}
                      </span>
                      <div className="flex-1 h-4 rounded overflow-hidden flex bg-muted">
                        <div
                          className="h-full bg-blue-400/80 dark:bg-blue-500/70"
                          style={{ width: `${(s.awarded / max) * 100}%` }}
                          title={`Requested: ${s.awarded}`}
                        />
                        <div
                          className="h-full bg-red-400/80 dark:bg-red-500/70"
                          style={{ width: `${(s.avoided / max) * 100}%` }}
                          title={`Avoided: ${s.avoided}`}
                        />
                      </div>
                      <span className="w-32 shrink-0 text-right text-muted-foreground">
                        {s.awarded} req · {s.avoided} avoid
                      </span>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {patterns.daysOffPatterns.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Consecutive days-off requests
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  Length of "N Consecutive Days Off" Set Condition bids — the
                  most common block pilots ask PBS to protect.
                </p>
              </CardHeader>
              <CardContent>
                <Histogram
                  data={patterns.daysOffPatterns.map(d => ({
                    key: d.days,
                    count: d.count,
                  }))}
                  labelFor={d => `${d}d`}
                  color="#c084fc"
                />
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
