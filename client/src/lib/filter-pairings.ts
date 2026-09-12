import { printedDurationMinutes } from '../../../shared/durations';
import * as pbs from './pbsDerivations';
import { pairingConflictsWithDaysOff } from './pairingDates';
import type { Pairing, SearchFilters } from './api';

export function filterPairings<T extends Pairing>(
  pairings: T[],
  filters: SearchFilters,
  packageYear: number
): T[] {
  return pairings.filter(pairing => {
    // Credit hours filter
    if (filters.creditMin !== undefined) {
      const credit = parseFloat(pairing.creditHours?.toString() || '0');
      if (credit < filters.creditMin) {
        return false;
      }
    }
    if (filters.creditMax !== undefined) {
      const credit = parseFloat(pairing.creditHours?.toString() || '0');
      if (credit > filters.creditMax) {
        return false;
      }
    }

    // Block hours filter
    if (filters.blockMin !== undefined) {
      const block = parseFloat(pairing.blockHours?.toString() || '0');
      if (block < filters.blockMin) {
        return false;
      }
    }
    if (filters.blockMax !== undefined) {
      const block = parseFloat(pairing.blockHours?.toString() || '0');
      if (block > filters.blockMax) {
        return false;
      }
    }

    // Hold probability filter
    if (filters.holdProbabilityMin !== undefined) {
      const hold = parseFloat(pairing.holdProbability?.toString() || '0');
      if (hold < filters.holdProbabilityMin) {
        return false;
      }
    }

    // Pairing days filter
    if (filters.pairingDays !== undefined) {
      if (pairing.pairingDays !== filters.pairingDays) {
        return false;
      }
    }
    if (filters.pairingDaysMin !== undefined) {
      if ((pairing.pairingDays || 0) < filters.pairingDaysMin) {
        return false;
      }
    }
    if (filters.pairingDaysMax !== undefined) {
      if ((pairing.pairingDays || 0) > filters.pairingDaysMax) {
        return false;
      }
    }

    // TAFB filter
    if (filters.tafbMin !== undefined || filters.tafbMax !== undefined) {
      const tafbHours = printedDurationMinutes(pairing.tafb) / 60;
      if (!Number.isFinite(tafbHours)) return false;

      if (filters.tafbMin !== undefined && tafbHours < filters.tafbMin) {
        return false;
      }
      if (filters.tafbMax !== undefined && tafbHours > filters.tafbMax) {
        return false;
      }
    }

    // Efficiency filter (C/B ratio)
    if (filters.efficiency !== undefined) {
      const credit = parseFloat(pairing.creditHours?.toString() || '0');
      const block = parseFloat(pairing.blockHours?.toString() || '0');
      const efficiency = block > 0 ? credit / block : 0;
      if (efficiency < filters.efficiency) {
        return false;
      }
    }

    // ---- PBS-native filters (must mirror server/storage.ts SQL) ----
    if (filters.deadheadsMin !== undefined) {
      if ((pairing.deadheads || 0) < filters.deadheadsMin) {
        return false;
      }
    }
    if (filters.deadheadsMax !== undefined) {
      if ((pairing.deadheads || 0) > filters.deadheadsMax) {
        return false;
      }
    }
    if (filters.layoverCountMin !== undefined) {
      if (pbs.layoverCount(pairing) < filters.layoverCountMin) {
        return false;
      }
    }
    if (filters.layoverCountMax !== undefined) {
      if (pbs.layoverCount(pairing) > filters.layoverCountMax) {
        return false;
      }
    }
    if (filters.totalLayoverHoursMin !== undefined) {
      if (pbs.totalLayoverHours(pairing) < filters.totalLayoverHoursMin) {
        return false;
      }
    }
    if (filters.totalLayoverHoursMax !== undefined) {
      if (pbs.totalLayoverHours(pairing) > filters.totalLayoverHoursMax) {
        return false;
      }
    }
    if (
      filters.averageDailyCreditMin !== undefined ||
      filters.averageDailyCreditMax !== undefined
    ) {
      const credit = parseFloat(pairing.creditHours?.toString() || '0');
      const days = pairing.pairingDays || 0;
      const avg = days > 0 ? credit / days : 0;
      if (
        filters.averageDailyCreditMin !== undefined &&
        avg < filters.averageDailyCreditMin
      ) {
        return false;
      }
      if (
        filters.averageDailyCreditMax !== undefined &&
        avg > filters.averageDailyCreditMax
      ) {
        return false;
      }
    }
    if (
      filters.averageDailyBlockMin !== undefined ||
      filters.averageDailyBlockMax !== undefined
    ) {
      const block = parseFloat(pairing.blockHours?.toString() || '0');
      const days = pairing.pairingDays || 0;
      const avg = days > 0 ? block / days : 0;
      if (
        filters.averageDailyBlockMin !== undefined &&
        avg < filters.averageDailyBlockMin
      ) {
        return false;
      }
      if (
        filters.averageDailyBlockMax !== undefined &&
        avg > filters.averageDailyBlockMax
      ) {
        return false;
      }
    }
    if (
      filters.checkInHourMin !== undefined ||
      filters.checkInHourMax !== undefined
    ) {
      const hour = pbs.checkInHour(pairing);
      if (hour === null) {
        return false;
      }
      if (
        filters.checkInHourMin !== undefined &&
        hour < filters.checkInHourMin
      ) {
        return false;
      }
      if (
        filters.checkInHourMax !== undefined &&
        hour > filters.checkInHourMax
      ) {
        return false;
      }
    }
    if (filters.checkInStations && filters.checkInStations.length > 0) {
      const station = pbs.checkInStation(pairing);
      const wanted = filters.checkInStations.map(s => s.toUpperCase());
      if (!station || !wanted.includes(station)) {
        return false;
      }
    }
    if (
      filters.excludeCheckInStations &&
      filters.excludeCheckInStations.length > 0
    ) {
      const station = pbs.checkInStation(pairing);
      const banned = filters.excludeCheckInStations.map(s => s.toUpperCase());
      // No parseable station → keep (mirrors the SQL's IS NULL branch)
      if (station && banned.includes(station)) {
        return false;
      }
    }
    if (filters.hasRedeye !== undefined) {
      if (pbs.hasRedeye(pairing) !== filters.hasRedeye) {
        return false;
      }
    }
    if (
      filters.excludeLayoverCities &&
      filters.excludeLayoverCities.length > 0
    ) {
      const cities = pbs.layoverCities(pairing);
      const banned = filters.excludeLayoverCities.map(c => c.toUpperCase());
      if (cities.some(c => banned.includes(c))) {
        return false;
      }
    }
    // Layovers In (include list) — mirrors the server's EXISTS clause;
    // previously missing from this client-side path entirely.
    if (filters.layoverLocations && filters.layoverLocations.length > 0) {
      const cities = pbs.layoverCities(pairing);
      const wanted = filters.layoverLocations.map(c => c.toUpperCase());
      if (!cities.some(c => wanted.includes(c))) {
        return false;
      }
    }

    // Search filter
    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      const pairingNum = pairing.pairingNumber?.toString().toLowerCase() || '';
      const route = pairing.route?.toString().toLowerCase() || '';
      if (
        !pairingNum.includes(searchLower) &&
        !route.includes(searchLower) &&
        !String(pairing.effectiveDates).toLowerCase().includes(searchLower)
      ) {
        return false;
      }
    }

    // Rotation number filter
    if (filters.rotationNumber) {
      const rotationLower = filters.rotationNumber.toLowerCase();
      const pairingNum = pairing.pairingNumber?.toString().toLowerCase() || '';
      if (!pairingNum.includes(rotationLower)) {
        return false;
      }
    }

    // Preferred Days Off filter - exclude pairings with flights on these dates
    if (filters.preferredDaysOff && filters.preferredDaysOff.length > 0) {
      const year = packageYear;

      const effectiveDates = pairing.effectiveDates || '';
      const pairingDays = pairing.pairingDays || 1;

      if (effectiveDates && pairingDays) {
        const hasConflict = pairingConflictsWithDaysOff(
          effectiveDates,
          year,
          pairingDays,
          filters.preferredDaysOff,
          {
            operatingDows: (pairing as any).operatingDows,
            exceptDates: (pairing as any).exceptDates,
          }
        );

        if (hasConflict) {
          return false;
        }
      }
    }

    return true;
  });
}
