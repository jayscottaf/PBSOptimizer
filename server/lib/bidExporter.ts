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

export interface EntryStep {
  /** Exact display text NAVBLUE should show once the line is entered —
   * byte-identical to the corresponding entry in `lines`. */
  expectText: string;
  /** Ordered NAVBLUE UI actions to build the line, in the app's own
   * vocabulary (from the live-UI audit). */
  actions: string[];
  /** Why the optimizer chose this line (beginner-mode education). */
  why?: string;
}

export interface EntryGroup {
  title: string;
  /** The group-level NAVBLUE action, e.g. "Add Bid Group → Start Pairings". */
  groupAction: string;
  steps: EntryStep[];
}

export interface ExportResult {
  text: string;
  lines: string[];
  /** Grammar/structure problems the pilot should fix before submitting. */
  warnings: string[];
  /** Guided transcription steps for the PBS Entry Assistant. */
  entrySteps: EntryGroup[];
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
  if (filter.checkInStations && filter.checkInStations.length > 0) {
    conditions.push(
      `If Pairing Check-In Station ${filter.checkInStations.map(s => s.toUpperCase()).join(', ')}`
    );
  }
  if (filter.hasRedeye !== undefined) {
    conditions.push(
      filter.hasRedeye ? 'If Any Duty Is Redeye' : 'If Not Any Duty Is Redeye'
    );
  }
  if (filter.carryOutMin !== undefined) {
    conditions.push(`If Carry Out > ${filter.carryOutMin - 1} Days`);
  }
  if (filter.carryOutMax !== undefined) {
    conditions.push(`If Carry Out < ${filter.carryOutMax + 1} Days`);
  }
  if (filter.departOnDOWs && filter.departOnDOWs.length > 0) {
    conditions.push(`If Departing On ${filter.departOnDOWs.join(', ')}`);
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
      const esn = pref.elseStartNext ? ' Else Start Next Bid Group' : '';
      // Day-of-week Prefer Off is a distinct NAVBLUE construct
      // (PreferOffDOWs). The live app renders it with a double space after
      // "Prefer Off" — kept verbatim for text fidelity.
      if (
        (!pref.preferOffDates || pref.preferOffDates.length === 0) &&
        pref.preferOffDOWs &&
        pref.preferOffDOWs.length > 0
      ) {
        return `Prefer Off  ${pref.preferOffDOWs.join(', ')}` + esn;
      }
      const dates = (pref.preferOffDates ?? []).map(formatIsoDate).join(', ');
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
    case 'setConditionPattern': {
      const on1 = pref.patternDaysOnMin;
      const on2 = pref.patternDaysOnMax;
      const off = pref.patternDaysOffMin;
      if (on1 === undefined || on2 === undefined || off === undefined) {
        return null;
      }
      // Verbatim NAVBLUE rendering, including the " ,With" spacing, as it
      // appears in real submitted-bid confirmations.
      const esn = pref.elseStartNext ? ' Else Start Next Bid Group' : '';
      return (
        `Set Condition Pattern Between ${on1} And ${on2} Days On ,With ${off} Days Off (Minimum)` +
        esn
      );
    }
    case 'clearScheduleStartNext':
      return 'Clear Schedule and Start Next Bid Group';
    default:
      return null;
  }
}

/**
 * NAVBLUE UI actions for each filter condition, mirroring
 * renderFilterConditions field-for-field so the instructions and the
 * expected text always describe the same conditions. Vocabulary comes
 * from the live-UI audit (§1 preference types, §9 value-widget model):
 * property names are the exact labels in the "Add property" picker,
 * operators are { Exactly =, Greater Than >, Less Than <, Range }.
 */
function actionsForFilter(filter: PairingFilter): string[] {
  const a: string[] = [];
  const range = (
    label: string,
    min: number | undefined,
    max: number | undefined,
    fmt: (v: number) => string,
    unit = ''
  ) => {
    if (min !== undefined && max !== undefined) {
      if (min === max) {
        a.push(`Add property → ${label}; operator → Exactly =; value → ${fmt(min)}${unit}`);
      } else {
        a.push(`Add property → ${label}; operator → Range; values → ${fmt(min)}–${fmt(max)}${unit}`);
      }
    } else if (min !== undefined) {
      a.push(`Add property → ${label}; operator → Greater Than >; value → ${fmt(min)}${unit}`);
    } else if (max !== undefined) {
      a.push(`Add property → ${label}; operator → Less Than <; value → ${fmt(max)}${unit}`);
    }
  };
  const n = (v: number) => String(v);

  if (filter.pairingNumbers && filter.pairingNumbers.length > 0) {
    a.push(
      `Add property → Pairing Numbers; enter: ${filter.pairingNumbers.join(', ')}`
    );
  }
  range('Pairing Length', filter.pairingDaysMin, filter.pairingDaysMax, n, ' days');
  if (filter.layoverCities && filter.layoverCities.length > 0) {
    a.push(
      `Add property → Layover; sub-field Stations → add ${filter.layoverCities.map(c => c.toUpperCase()).join(', ')}`
    );
  }
  if (filter.excludeLayoverCities && filter.excludeLayoverCities.length > 0) {
    a.push(
      `Add property → Layover; matcher → If Not, quantifier → Any; sub-field Stations → add ${filter.excludeLayoverCities.map(c => c.toUpperCase()).join(', ')}`
    );
  }
  range('Number Of Layovers', filter.layoverCountMin, filter.layoverCountMax, n);
  range(
    'Total Layover Time',
    filter.totalLayoverHoursMin,
    filter.totalLayoverHoursMax,
    formatHours,
    ' (Hours/Minutes spinners)'
  );
  range('Pairing Credit', filter.creditMin, filter.creditMax, formatHours, ' (Hours/Minutes spinners)');
  if (filter.checkInHourMin !== undefined || filter.checkInHourMax !== undefined) {
    const from = String(filter.checkInHourMin ?? 0).padStart(2, '0');
    const to = String(filter.checkInHourMax ?? 23).padStart(2, '0');
    a.push(
      `Add property → Check-In Time; sub-field Time Range → ${from}:00 to ${to}:59`
    );
  }
  range('Average Daily Credit', filter.averageDailyCreditMin, filter.averageDailyCreditMax, formatHours, ' (Hours/Minutes spinners)');
  range('Average Daily Block Time', filter.averageDailyBlockMin, filter.averageDailyBlockMax, formatHours, ' (Hours/Minutes spinners)');
  range('Block Time', filter.blockMin, filter.blockMax, formatHours, ' (Hours/Minutes spinners)');
  if (filter.deadheadsMin !== undefined) {
    a.push(
      filter.deadheadsMin === 1
        ? 'Add property → Deadhead Day'
        : `Add property → Deadhead Legs; operator → Greater Than >; value → ${filter.deadheadsMin - 1}`
    );
  }
  if (filter.deadheadsMax !== undefined) {
    a.push(
      `Add property → Deadhead Legs; operator → Less Than <; value → ${filter.deadheadsMax + 1}`
    );
  }
  if (filter.checkInStations && filter.checkInStations.length > 0) {
    a.push(
      `Add property → Pairing Check-In Station; Stations → add ${filter.checkInStations.map(s => s.toUpperCase()).join(', ')}`
    );
  }
  if (filter.hasRedeye !== undefined) {
    a.push(
      filter.hasRedeye
        ? 'Add property → Duty Is Redeye (matcher If, quantifier Any)'
        : 'Add property → Duty Is Redeye; matcher → If Not, quantifier → Any'
    );
  }
  if (filter.carryOutMin !== undefined) {
    a.push(
      `Add property → Carry Out; operator → Greater Than >; value → ${filter.carryOutMin - 1} days`
    );
  }
  if (filter.carryOutMax !== undefined) {
    a.push(
      `Add property → Carry Out; operator → Less Than <; value → ${filter.carryOutMax + 1} days`
    );
  }
  if (filter.departOnDOWs && filter.departOnDOWs.length > 0) {
    a.push(
      `Add property → Depart On; sub-field Days Of Week List → ${filter.departOnDOWs.join(', ')}`
    );
  }
  return a;
}

/** NAVBLUE UI actions to build one preference line. */
function actionsForPreference(pref: BidPreference): string[] {
  const actions: string[] = [];
  switch (pref.type) {
    case 'award':
      actions.push('Preference type → Award Pairings');
      if (pref.filter) actions.push(...actionsForFilter(pref.filter));
      if (pref.limit !== undefined) {
        actions.push(`Set Limit → ${pref.limit} (max awards from this line)`);
      }
      break;
    case 'avoid':
      actions.push('Preference type → Avoid Pairings');
      if (pref.filter) actions.push(...actionsForFilter(pref.filter));
      break;
    case 'preferOff':
      actions.push('Preference type → Prefer Off');
      if (pref.preferOffDates && pref.preferOffDates.length > 0) {
        actions.push(
          `Dates List → pick ${pref.preferOffDates.map(formatIsoDate).join(', ')} — in this order (Denial Mode drops dates from the END of the list)`
        );
      }
      if (pref.preferOffDOWs && pref.preferOffDOWs.length > 0) {
        actions.push(
          `Days Of Week List → ${pref.preferOffDOWs.join(', ')} (every week)`
        );
      }
      break;
    case 'setConditionCredit': {
      const labels = {
        min: 'Minimum Credit',
        max: 'Maximum Credit',
        mid: 'Mid Credit',
        normal: null,
      } as const;
      const label = labels[pref.creditWindow ?? 'normal'];
      actions.push('Preference type → Set Condition');
      if (label) actions.push(`Condition sub-type → ${label}`);
      break;
    }
    case 'setConditionPattern':
      actions.push('Preference type → Set Condition');
      actions.push('Condition sub-type → Pattern');
      actions.push(
        `Days-on range → ${pref.patternDaysOnMin}–${pref.patternDaysOnMax} (spinners)`
      );
      actions.push(`Days-off minimum → ${pref.patternDaysOffMin}`);
      break;
    case 'clearScheduleStartNext':
      actions.push('Preference type → Clear Schedule and Start Next');
      actions.push(
        'Must be the LAST line in this bid group (PBS forces it to the bottom anyway)'
      );
      break;
  }
  if (pref.elseStartNext) {
    actions.push("Toggle 'Else Start Next Bid Group' → ON");
  }
  actions.push('Save the line, then verify the text below matches exactly');
  return actions;
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
      (p, i) =>
        (p.type === 'setConditionCredit' || p.type === 'setConditionPattern') &&
        firstAward !== -1 &&
        i > firstAward
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
  const entrySteps: EntryGroup[] = [];
  bid.groups.forEach((group, index) => {
    const header = group.type === 'reserve' ? 'Start Reserve' : 'Start Pairings';
    lines.push(header);
    const entryGroup: EntryGroup = {
      title: `Bid Group ${index + 1}${group.type === 'reserve' ? ' — Reserve' : ''}`,
      groupAction: `Add Bid Group → ${header}`,
      steps: [],
    };
    group.preferences.forEach(pref => {
      // Text and step are built from the same render in the same pass so
      // the checklist's expected text can never drift from the raw export.
      const line = renderPreference(pref);
      if (!line) return;
      lines.push(line);
      entryGroup.steps.push({
        expectText: line,
        actions: actionsForPreference(pref),
        why: pref.why,
      });
    });
    entrySteps.push(entryGroup);
  });
  const warnings = validate(bid);
  return {
    text: lines.join('\n'),
    lines,
    warnings,
    entrySteps,
  };
}
