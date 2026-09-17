import { useEffect, useMemo, useState } from 'react';

import type { Pairing } from '@/lib/api';
import {
  assessCommuteFit,
  DEFAULT_COMMUTE_FIT_PREFERENCES,
  type CommuteFitPreferences,
} from '@/lib/commute-fit';

const STORAGE_KEY = 'pbs.commute-fit.preferences.v1';

function validMinute(value: unknown, fallback: number, max = 1439): number {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= max
    ? Math.round(value)
    : fallback;
}

function loadPreferences(): CommuteFitPreferences {
  if (typeof window === 'undefined') {
    return DEFAULT_COMMUTE_FIT_PREFERENCES;
  }

  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    const value = saved && typeof saved === 'object' ? saved : {};
    return {
      enabled:
        typeof value.enabled === 'boolean'
          ? value.enabled
          : DEFAULT_COMMUTE_FIT_PREFERENCES.enabled,
      onlyShowBothWays:
        typeof value.onlyShowBothWays === 'boolean'
          ? value.onlyShowBothWays
          : DEFAULT_COMMUTE_FIT_PREFERENCES.onlyShowBothWays,
      earliestAcceptableReportMinutes: validMinute(
        value.earliestAcceptableReportMinutes,
        DEFAULT_COMMUTE_FIT_PREFERENCES.earliestAcceptableReportMinutes
      ),
      latestAcceptableReleaseMinutes: validMinute(
        value.latestAcceptableReleaseMinutes,
        DEFAULT_COMMUTE_FIT_PREFERENCES.latestAcceptableReleaseMinutes
      ),
      inboundBufferMinutes: validMinute(
        value.inboundBufferMinutes,
        DEFAULT_COMMUTE_FIT_PREFERENCES.inboundBufferMinutes,
        1440
      ),
      outboundBufferMinutes: validMinute(
        value.outboundBufferMinutes,
        DEFAULT_COMMUTE_FIT_PREFERENCES.outboundBufferMinutes,
        1440
      ),
    };
  } catch {
    return DEFAULT_COMMUTE_FIT_PREFERENCES;
  }
}

export function useCommuteFit(pairings: Pairing[]) {
  const [preferences, setPreferences] =
    useState<CommuteFitPreferences>(loadPreferences);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  }, [preferences]);

  const results = useMemo(() => {
    const map = new Map<number, ReturnType<typeof assessCommuteFit>>();
    if (!preferences.enabled) return map;

    for (const pairing of pairings) {
      map.set(
        pairing.id,
        assessCommuteFit(pairing.flightSegments, preferences)
      );
    }
    return map;
  }, [pairings, preferences]);

  const counts = useMemo(() => {
    let both = 0;
    let unknown = 0;
    for (const result of results.values()) {
      if (result.status === 'both') both += 1;
      if (result.status === 'unknown') unknown += 1;
    }
    return { both, unknown, total: pairings.length };
  }, [pairings.length, results]);

  return { preferences, setPreferences, results, counts };
}
