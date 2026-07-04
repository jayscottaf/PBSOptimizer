import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useQuery } from '@tanstack/react-query';
import { TrendingUp } from 'lucide-react';

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
  periods: TrendPeriod[];
  holdBoundaries: HoldBoundary[];
  window: {
    windowMin: number;
    windowMax: number;
    threshold: number;
    period: string;
  } | null;
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
      <p className="text-sm text-gray-500 dark:text-gray-400">
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
            className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400"
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

export function TrendsPanel() {
  const { data, isLoading, isError } = useQuery<TrendsResponse>({
    queryKey: ['/api/trends'],
    queryFn: async () => {
      const res = await fetch('/api/trends');
      if (!res.ok) throw new Error('Failed to load trends');
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="p-6 text-sm text-gray-500 dark:text-gray-400">
        Crunching three years of award history…
      </div>
    );
  }
  if (isError || !data || data.periods.length === 0) {
    return (
      <div className="p-6 text-sm text-gray-500 dark:text-gray-400">
        No Reasons Report history imported yet — upload composite reports to
        unlock category trends.
      </div>
    );
  }

  const maxContention = Math.max(
    ...data.periods.map(p => p.lostToSenior / p.totalPrefs)
  );

  return (
    <div className="space-y-4 p-1">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <TrendingUp className="h-5 w-5 text-blue-500" />
            Category Trends — {data.base}
          </CardTitle>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Mined from {data.periods.length} imported Reasons Report periods
            ({data.periods[0]?.period} – {data.periods[data.periods.length - 1]?.period})
            {data.window &&
              ` · latest credit window ${data.window.windowMin.toFixed(0)}–${data.window.windowMax.toFixed(0)}h, threshold ${data.window.threshold.toFixed(0)}h (${data.window.period})`}
          </p>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            How junior each trip length goes
          </CardTitle>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Percentile of the junior-most pilot awarded each trip length, per
            period. Higher lines = trips that go deep into the category (easier
            to hold); dips mark months when seniors took them.
          </p>
        </CardHeader>
        <CardContent className="text-gray-700 dark:text-gray-300">
          <BoundaryChart boundaries={data.holdBoundaries} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Contention by period</CardTitle>
          <p className="text-xs text-gray-500 dark:text-gray-400">
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
                  <span className="w-20 shrink-0 text-gray-500 dark:text-gray-400 font-mono">
                    {p.period}
                  </span>
                  <div className="flex-1 h-4 bg-gray-100 dark:bg-gray-800 rounded overflow-hidden">
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
                  <span className="w-16 shrink-0 text-right text-gray-400 dark:text-gray-500">
                    {p.pilots} pilots
                  </span>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
