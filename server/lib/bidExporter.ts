/**
 * NAVBLUE bid exporter.
 *
 * Renders a structured DraftBid to pasteable NAVBLUE-style preference text
 * and validates the structure against the grammar rules extracted in
 * docs/ai-bidding-coach/navblue-rules.md and delta-rules.md. The output is
 * review-ready: pilots must still verify each line in the NAVBLUE UI, since
 * property availability varies by airline configuration.
 */

import type {
  BidGroup,
  BidPreference,
  DraftBid,
  PairingFilter,
} from '../../shared/bidTypes';

export interface ExportResult {
  text: string;
  lines: string[];
  /** Grammar/structure problems the pilot should fix before submitting. */
  warnings: string[];
}

function formatHours(hours: number): string {
  const whole = Math.floor(hours);
  const minutes = Math.round((hours - whole) * 60);
  return `${whole}:${String(minutes).padStart(2, '0')}`;
}

function formatIsoDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  return `${months[parseInt(m[2], 10) - 1]} ${parseInt(m[3], 10)}`;
}

function renderFilterConditions(filter: PairingFilter): string[] {
  const conditions: string[] = [];
  if (filter.pairingNumbers && filter.pairingNumbers.length > 0) {
    conditions.push(`If Pairing Numbers ${filter.pairingNumbers.join(', ')}`);
  }
  if (
    filter.pairingDaysMin !== undefined &&
    filter.pairingDaysMax !== undefined
  ) {
    if (filter.pairingDaysMin === filter.pairingDaysMax) {
      conditions.push(`If Pairing Length = ${filter.pairingDaysMin} Days`);
    } else {
      conditions.push(
        `If Pairing Length Between ${filter.pairingDaysMin} and ${filter.pairingDaysMax} Days`
      );
    }
  } else if (filter.pairingDaysMin !== undefined) {
    conditions.push(`If Pairing Length >= ${filter.pairingDaysMin} Days`);
  } else if (filter.pairingDaysMax !== undefined) {
    conditions.push(`If Pairing Length <= ${filter.pairingDaysMax} Days`);
  }
  if (filter.layoverCities && filter.layoverCities.length > 0) {
    conditions.push(
      `If Layovers In ${filter.layoverCities.map(c => c.toUpperCase()).join(', ')}`
    );
  }
  if (filter.excludeLayoverCities && filter.excludeLayoverCities.length > 0) {
    conditions.push(
      `If Not Any Layover In ${filter.excludeLayoverCities.map(c => c.toUpperCase()).join(', ')}`
    );
  }
  if (
    filter.layoverCountMin !== undefined &&
    filter.layoverCountMax !== undefined
  ) {
    conditions.push(
      `If Number Of Layovers Between ${filter.layoverCountMin} and ${filter.layoverCountMax}`
    );
  } else if (filter.layoverCountMin !== undefined) {
    conditions.push(`If Number Of Layovers > ${filter.layoverCountMin}`);
  } else if (filter.layoverCountMax !== undefined) {
    conditions.push(`If Number Of Layovers < ${filter.layoverCountMax}`);
  }
  if (filter.totalLayoverHoursMin !== undefined) {
    conditions.push(
      `If Total Layover Time > ${formatHours(filter.totalLayoverHoursMin)}`
    );
  }
  if (filter.totalLayoverHoursMax !== undefined) {
    conditions.push(
      `If Total Layover Time < ${formatHours(filter.totalLayoverHoursMax)}`
    );
  }
  if (filter.creditMin !== undefined && filter.creditMax !== undefined) {
    conditions.push(
      `If Pairing Credit Between ${formatHours(filter.creditMin)} and ${formatHours(filter.creditMax)}`
    );
  } else if (filter.creditMin !== undefined) {
    conditions.push(`If Pairing Credit > ${formatHours(filter.creditMin)}`);
  } else if (filter.creditMax !== undefined) {
    conditions.push(`If Pairing Credit < ${formatHours(filter.creditMax)}`);
  }
  if (filter.checkInHourMin !== undefined || filter.checkInHourMax !== undefined) {
    const from = String(filter.checkInHourMin ?? 0).padStart(2, '0');
    const to = String(filter.checkInHourMax ?? 23).padStart(2, '0');
    conditions.push(`If Check-In Time Between ${from}:00 and ${to}:59`);
  }
  if (filter.averageDailyCreditMin !== undefined) {
    conditions.push(
      `If Average Daily Credit > ${formatHours(filter.averageDailyCreditMin)}`
    );
  }
  if (filter.averageDailyCreditMax !== undefined) {
    conditions.push(
      `If Average Daily Credit < ${formatHours(filter.averageDailyCreditMax)}`
    );
  }
  if (filter.averageDailyBlockMin !== undefined) {
    conditions.push(
      `If Average Daily Block Time > ${formatHours(filter.averageDailyBlockMin)}`
    );
  }
  if (filter.averageDailyBlockMax !== undefined) {
    conditions.push(
      `If Average Daily Block Time < ${formatHours(filter.averageDailyBlockMax)}`
    );
  }
  // NAVBLUE has real Block Time and Deadhead Legs properties (confirmed in
  // the live Pairings preference panel) — emit them, not app-only notes.
  if (filter.blockMin !== undefined && filter.blockMax !== undefined) {
    conditions.push(
      `If Block Time Between ${formatHours(filter.blockMin)} and ${formatHours(filter.blockMax)}`
    );
  } else if (filter.blockMin !== undefined) {
    conditions.push(`If Block Time > ${formatHours(filter.blockMin)}`);
  } else if (filter.blockMax !== undefined) {
    conditions.push(`If Block Time < ${formatHours(filter.blockMax)}`);
  }
  if (filter.deadheadsMin !== undefined) {
    // "Deadhead Day" is the NAVBLUE shorthand for "has at least one DH leg".
    conditions.push(
      filter.deadheadsMin === 1
        ? 'If Deadhead Day'
        : `If Deadhead Legs > ${filter.deadheadsMin - 1}`
    );
  }
  if (filter.deadheadsMax !== undefined) {
    conditions.push(`If Deadhead Legs < ${filter.deadheadsMax + 1}`);
  }
  return conditions;
}

function renderPreference(pref: BidPreference): string | null {
  switch (pref.type) {
    case 'award': {
      const conditions = pref.filter ? renderFilterConditions(pref.filter) : [];
      const limit = pref.limit !== undefined ? ` Limit ${pref.limit}` : '';
      return ['Award Pairings', ...conditions].join(' ') + limit;
    }
    case 'avoid': {
      const conditions = pref.filter ? renderFilterConditions(pref.filter) : [];
      const esn = pref.elseStartNext ? ' Else Start Next Bid Group' : '';
      return ['Avoid Pairings', ...conditions].join(' ') + esn;
    }
    case 'preferOff': {
      const dates = (pref.preferOffDates ?? []).map(formatIsoDate).join(', ');
      const esn = pref.elseStartNext ? ' Else Start Next Bid Group' : '';
      return `Prefer Off ${dates}` + esn;
    }
    case 'setConditionCredit': {
      const labels = {
        min: 'Minimum Credit',
        max: 'Maximum Credit',
        mid: 'Mid Credit',
        normal: null,
      } as const;
      const label = labels[pref.creditWindow ?? 'normal'];
      if (!label) return null;
      const esn = pref.elseStartNext ? ' Else Start Next Bid Group' : '';
      return `Set Condition ${label}` + esn;
    }
    case 'clearScheduleStartNext':
      return 'Clear Schedule and Start Next Bid Group';
    default:
      return null;
  }
}

function validate(bid: DraftBid): string[] {
  const warnings: string[] = [];
  bid.groups.forEach((group: BidGroup, index: number) => {
    const isLast = index === bid.groups.length - 1;
    const nextGroup = bid.groups[index + 1];
    const hasExit = group.preferences.some(
      p => p.type === 'clearScheduleStartNext' || p.elseStartNext
    );
    // The exit requirement applies between consecutive groups of the same
    // type; a pairings group followed by a trailing reserve group is the
    // standard structure and needs no exit (Handbook p148).
    if (!isLast && nextGroup?.type === group.type && !hasExit) {
      warnings.push(
        `Group ${index + 1}: PBS will not accept multiple ${group.type} bid groups unless every one except the last has Else Start Next or Clear Schedule and Start Next (Handbook p148).`
      );
    }
    if (isLast && group.preferences.some(p => p.type === 'clearScheduleStartNext')) {
      warnings.push(
        `Group ${index + 1}: never place a Start Next in the last bid group (Handbook p152).`
      );
    }
    const cssnIndex = group.preferences.findIndex(
      p => p.type === 'clearScheduleStartNext'
    );
    if (cssnIndex !== -1 && cssnIndex !== group.preferences.length - 1) {
      warnings.push(
        `Group ${index + 1}: Clear Schedule and Start Next is forced to the bottom of its group by PBS; preferences after it will be reordered above it (NAVBLUE p180).`
      );
    }
    const firstAward = group.preferences.findIndex(p => p.type === 'award');
    const lateSetCondition = group.preferences.findIndex(
      (p, i) => p.type === 'setConditionCredit' && firstAward !== -1 && i > firstAward
    );
    if (lateSetCondition !== -1) {
      warnings.push(
        `Group ${index + 1}: Set Condition is always forced above Award preferences by PBS; place it at the top of the group (NAVBLUE p181-182).`
      );
    }
    group.preferences.forEach((p, i) => {
      if (p.limit !== undefined && p.type !== 'award') {
        warnings.push(
          `Group ${index + 1}, preference ${i + 1}: Limit applies only to Award Pairings (NAVBLUE p174-175).`
        );
      }
      if (p.elseStartNext && p.type === 'award') {
        warnings.push(
          `Group ${index + 1}, preference ${i + 1}: Else Start Next attaches to Prefer Off, Avoid, and Set Condition bids, not Award (NAVBLUE p92).`
        );
      }
    });
    if (group.type === 'pairings' && group.preferences.length === 0) {
      warnings.push(`Group ${index + 1}: empty pairing group.`);
    }
  });
  const hasReserve = bid.groups.some(g => g.type === 'reserve');
  if (!hasReserve) {
    warnings.push(
      'No reserve bid group: the handbook rule of thumb is to bid both a pairing group and a reserve group - a trailing reserve group does not hurt regular-line chances (Handbook p148).'
    );
  }
  return warnings;
}

export function exportBid(bid: DraftBid): ExportResult {
  const lines: string[] = [];
  bid.groups.forEach(group => {
    lines.push(group.type === 'reserve' ? 'Start Reserve' : 'Start Pairings');
    group.preferences.forEach(pref => {
      const line = renderPreference(pref);
      if (line) lines.push(line);
    });
  });
  const warnings = validate(bid);
  return {
    text: lines.join('\n'),
    lines,
    warnings,
  };
}
