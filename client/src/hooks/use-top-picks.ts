import { useQuery } from '@tanstack/react-query';

export interface TopPickScored {
  pairingNumber: string;
  score: number;
  creditNorm: number;
  qolNorm: number;
  holdProbability: number | null;
  pairingDays: number;
  creditHours: number;
  reasons: string[];
}

export interface TopPicksResult {
  rationale: string[];
  group1Completion: number;
  topScored: TopPickScored[];
  profileSource: 'learned' | 'manual' | 'neutral' | string;
}

/**
 * Ranked "what should I bid?" picks from the server-side optimizer.
 * Cached indefinitely per (package, user) — the inputs only change when a
 * new package is uploaded or the profile is re-learned, and both paths
 * already invalidate by changing the key or reloading.
 */
export function useTopPicks(
  bidPackageId: number | undefined,
  userId: number | undefined
) {
  return useQuery<TopPicksResult>({
    queryKey: ['top-picks', bidPackageId ?? null, userId ?? null],
    queryFn: async () => {
      const res = await fetch('/api/optimize-bid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bidPackageId, userId }),
      });
      if (!res.ok) {
        throw new Error(`optimize-bid failed (${res.status})`);
      }
      return res.json();
    },
    enabled: !!bidPackageId,
    staleTime: Infinity,
    gcTime: 24 * 60 * 60 * 1000,
    retry: 1,
  });
}
