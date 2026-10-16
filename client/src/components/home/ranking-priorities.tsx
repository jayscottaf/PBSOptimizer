import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BidProfileWeights } from '@shared/bidTypes';
import {
  recommendationGoals,
  type RecommendationGoal,
} from '@shared/recommendation-goals';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { apiRequest } from '@/lib/queryClient';

export function RankingPriorities({ userId }: { userId?: number }) {
  const client = useQueryClient();
  const { data, isError } = useQuery<{
    weights: BidProfileWeights;
    source: string;
  }>({
    queryKey: ['bid-profile', userId],
    queryFn: async () =>
      (await apiRequest('GET', `/api/bid-profile/${userId}`)).json(),
    enabled: !!userId,
    staleTime: 60_000,
  });
  const [draft, setDraft] = useState<BidProfileWeights>();
  useEffect(() => {
    if (data) setDraft(data.weights);
  }, [data]);
  const save = useMutation({
    mutationFn: async () =>
      (
        await apiRequest('PUT', `/api/bid-profile/${userId}`, {
          weights: draft,
        })
      ).json(),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['bid-profile', userId] }),
        client.invalidateQueries({ queryKey: ['top-picks'] }),
      ]);
    },
  });
  const goal = draft?.rankingGoal ?? 'existing';
  return (
    <details className="mb-4 rounded-lg border bg-muted/20 p-3">
      <summary className="cursor-pointer text-sm font-medium">
        My priorities ·{' '}
        {data?.weights.rankingGoal
          ? recommendationGoals[data.weights.rankingGoal]
          : data?.source === 'learned'
            ? 'From bid history'
            : data?.source === 'manual' || data?.source === 'mixed'
              ? 'Saved credit/QoL balance'
              : 'General defaults'}
      </summary>
      <p className="my-3 text-sm text-muted-foreground">
        {data?.source === 'learned' || data?.source === 'mixed'
          ? 'Your history informs these preferences; you can override them.'
          : data?.source === 'manual'
            ? 'Using your saved priorities.'
            : 'Using general defaults until you choose your priorities.'}{' '}
        These settings also guide auto-drafts. Hold estimates still affect which
        trips are realistic.
      </p>
      {!userId ? (
        <p className="text-sm">Set up your profile to save priorities.</p>
      ) : isError ? (
        <p role="alert">
          Could not load priorities. Try reopening this section.
        </p>
      ) : !draft ? (
        <p>Loading priorities…</p>
      ) : (
        <div className="space-y-4">
          <label className="block text-sm font-medium">
            Ranking goal
            <select
              className="mt-1 h-11 w-full rounded-md border bg-background px-3"
              value={goal}
              onChange={e => {
                save.reset();
                setDraft({
                  ...draft,
                  rankingGoal:
                    e.target.value === 'existing'
                      ? undefined
                      : (e.target.value as RecommendationGoal),
                  creditLeaning:
                    e.target.value === 'existing'
                      ? (data?.weights.creditLeaning ?? 0)
                      : e.target.value === 'qol'
                        ? -1
                        : e.target.value === 'credit'
                          ? 1
                          : 0,
                });
              }}
            >
              <option value="existing">Existing credit/QoL balance</option>
              {Object.entries(recommendationGoals).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <fieldset>
            <legend className="mb-2 text-sm font-medium">
              Preferred trip lengths
            </legend>
            <div className="flex flex-wrap gap-3">
              {[1, 2, 3, 4, 5, 6].map(days => (
                <label
                  key={days}
                  className="flex min-h-10 items-center gap-2 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={draft.preferredTripLengths.includes(days)}
                    onChange={e => {
                      save.reset();
                      setDraft({
                        ...draft,
                        preferredTripLengths: e.target.checked
                          ? [...draft.preferredTripLengths, days]
                          : draft.preferredTripLengths.filter(n => n !== days),
                      });
                    }}
                  />
                  {days}-day
                </label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Priority order:{' '}
              {draft.preferredTripLengths.length
                ? draft.preferredTripLengths
                    .map(days => `${days}-day`)
                    .join(' → ')
                : 'Any trip length'}
              . Uncheck and reselect to change the order.
            </p>
          </fieldset>
          <label className="flex min-h-10 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.avoidsRedeyes}
              onChange={e => {
                save.reset();
                setDraft({ ...draft, avoidsRedeyes: e.target.checked });
              }}
            />
            Prefer trips without redeyes
          </label>
          {(
            ['checkInStationAvoids', 'layoverLikes', 'layoverDislikes'] as const
          ).map((field, i) => (
            <label key={field} className="block text-sm font-medium">
              {
                [
                  'Avoid report stations',
                  'Preferred layover cities',
                  'Avoid layover cities',
                ][i]
              }
              <Input
                className="mt-1"
                key={`${field}-${data?.weights[field].join(',')}`}
                defaultValue={draft[field].join(', ')}
                placeholder="Three-letter codes, separated by commas"
                onChange={e => {
                  save.reset();
                  setDraft({
                    ...draft,
                    [field]: e.target.value
                      .toUpperCase()
                      .split(/[ ,]+/)
                      .filter(Boolean),
                  });
                }}
              />
            </label>
          ))}
          <p className="text-xs text-muted-foreground">
            Quality of life uses trip lengths, layovers, report stations and
            redeyes. Credit / block means more pay credit per hour of flying; it
            is separate from credit per day. Preferences guide ranking, not
            guaranteed days off.
          </p>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save priorities'}
          </Button>
          {save.isSuccess && (
            <p role="status" className="text-sm text-success">
              Priorities saved. Recommendations updated.
            </p>
          )}
          {save.isError && (
            <p role="alert" className="text-sm text-destructive">
              Could not save priorities. Your saved settings are unchanged.
            </p>
          )}
        </div>
      )}
    </details>
  );
}
