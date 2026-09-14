import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { CategoryComparison } from '@shared/category-seniority';
import { categoryKey } from '@shared/category-key';
import { Button } from '@/components/ui/button';

interface Props {
  seniorityNumber?: number;
  base?: string;
  aircraft?: string;
  position?: string;
  savedCategory?: string;
}

export function CategoryComparisonPanel({
  seniorityNumber,
  base = '',
  aircraft = '',
  position = 'B',
  savedCategory,
}: Props) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const validNumber = Number.isInteger(seniorityNumber) && seniorityNumber! > 0;
  const query = useQuery<{ categories: CategoryComparison[] }>({
    queryKey: ['category-comparisons', seniorityNumber],
    queryFn: async ({ signal }) => {
      const response = await fetch(
        `/api/category-seniority/comparisons?seniorityNumber=${seniorityNumber}`,
        { signal }
      );
      if (!response.ok) throw new Error('Could not load category comparisons.');
      return response.json();
    },
    enabled: validNumber,
    staleTime: 0,
    retry: 1,
  });
  const categories = query.data?.categories ?? [];
  const defaultKey = categoryKey(base, aircraft, position);
  const activeKey = selectedKey ?? defaultKey;
  const active = categories.find(
    category =>
      categoryKey(category.base, category.aircraft, category.position) ===
      activeKey
  );
  const label = (category: CategoryComparison) =>
    `${category.base} ${category.aircraft}${category.position} · ${category.position === 'A' ? 'Captain' : 'First Officer'}`;

  if (!validNumber) return null;
  return (
    <section
      aria-label="Compare category seniority"
      className="rounded-xl border bg-card p-4 space-y-3"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">
            Your seniority in other categories
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            Seniority #{seniorityNumber}
            {savedCategory ? ` · Saved position: ${savedCategory}` : ''}
          </p>
        </div>
        <div
          className="text-2xl font-semibold tabular-nums"
          role="status"
          data-testid="comparison-percentile"
        >
          {query.isFetching
            ? '…'
            : query.isError || !active
              ? '—'
              : `${active.percentile}%`}
        </div>
      </div>
      <label className="block space-y-1 text-xs font-medium">
        <span>Compare with</span>
        <select
          aria-label="Compare with category"
          value={activeKey}
          onChange={event => setSelectedKey(event.target.value)}
          className="block w-full min-h-10 rounded-md border bg-background px-3 py-2 text-sm"
        >
          {!categories.some(
            category =>
              categoryKey(
                category.base,
                category.aircraft,
                category.position
              ) === defaultKey
          ) && (
            <option value={defaultKey}>
              {base} {aircraft}
              {/-?[AB]$/.test(aircraft) ? '' : position} · Selected report
              category
            </option>
          )}
          {categories.map(category => (
            <option
              key={categoryKey(
                category.base,
                category.aircraft,
                category.position
              )}
              value={categoryKey(
                category.base,
                category.aircraft,
                category.position
              )}
            >
              {label(category)}
            </option>
          ))}
        </select>
      </label>
      <p className="text-xs text-muted-foreground" role="status">
        {query.isFetching
          ? 'Comparing your seniority against imported category rosters…'
          : query.isError
            ? 'Could not load the rosters. Please retry.'
            : active
              ? `${active.month} ${active.year} Reasons Report · ${active.seniorOrEqual} of ${active.totalPilots} reported pilots at or above your seniority. This is an estimate from that report, not a live roster.`
              : 'No matching Reasons Report roster is imported for this category. Choose another available category above.'}
      </p>
      <p className="text-xs text-muted-foreground">
        Your saved position stays the same. Bid analysis uses the category of
        the selected bid package.
      </p>
      {query.isError && (
        <Button size="sm" variant="outline" onClick={() => query.refetch()}>
          Retry comparisons
        </Button>
      )}
    </section>
  );
}
