/**
 * Serializes a DraftBid to NAVBLUE's canonical bid-line XML, matching the
 * schema captured from a live bid (docs/ai-bidding-coach/
 * navblue-ui-audit.md §10): the app stores/posts bid lines as XML whose
 * element names equal the in-memory model keys (xml2json round-trip).
 *
 * Pure function — no DB/OpenAI imports; tested in bid-tools-check.
 *
 * Scope: the constructs our DraftBid can express. Times are encoded the
 * way the live model does (Hour zero-padded to 3, Minute to 2).
 */

import type {
  BidPreference,
  DraftBid,
  PairingFilter,
} from '../../shared/bidTypes';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function tag(name: string, inner: string): string {
  return inner === ''
    ? `<${name}/>`
    : `<${name}>${inner}</${name}>`;
}

function timeXml(hoursDecimal: number): string {
  const h = Math.floor(hoursDecimal);
  const m = Math.round((hoursDecimal - h) * 60);
  return tag(
    'Time',
    tag('Hour', String(h).padStart(3, '0')) +
      tag('Minute', String(m).padStart(2, '0'))
  );
}

function timeIntervalCondition(op: 'GT' | 'LT', hours: number): string {
  return (
    tag('TimeIntervalType', 'TimeIntervalCondition') +
    tag('TimeIntervalCondition', tag('Operator', op) + timeXml(hours))
  );
}

function numberDaysCondition(op: 'GT' | 'LT' | 'EQ', value: number): string {
  return (
    tag('NumberDaysType', 'NumberDaysCondition') +
    tag(
      'NumberDaysCondition',
      tag('Operator', op) + tag('Value', String(value))
    )
  );
}

function property(type: string, inner: string): string {
  return tag(
    'PairingProperty',
    tag('PairingPropertyType', type) + tag(type, inner)
  );
}

function dowsXml(dows: string[]): string {
  return tag('DOWs', dows.map(d => tag('DOW', esc(d))).join(''));
}

/** Render one PairingFilter as a list of <PairingProperty> elements. */
export function filterToProperties(filter: PairingFilter): string[] {
  const props: string[] = [];
  if (filter.pairingNumbers?.length) {
    props.push(
      property(
        'PairingNumbers',
        tag(
          'Pairings',
          filter.pairingNumbers.map(n => tag('Pairing', esc(n))).join('')
        )
      )
    );
  }
  if (
    filter.pairingDaysMin !== undefined &&
    filter.pairingDaysMin === filter.pairingDaysMax
  ) {
    props.push(
      property('PairingLength', numberDaysCondition('EQ', filter.pairingDaysMin))
    );
  } else {
    if (filter.pairingDaysMin !== undefined) {
      props.push(
        property(
          'PairingLength',
          numberDaysCondition('GT', filter.pairingDaysMin - 1)
        )
      );
    }
    if (filter.pairingDaysMax !== undefined) {
      props.push(
        property(
          'PairingLength',
          numberDaysCondition('LT', filter.pairingDaysMax + 1)
        )
      );
    }
  }
  if (filter.layoverCities?.length) {
    props.push(
      property(
        'Layovers',
        tag(
          'Stations',
          filter.layoverCities.map(c => tag('Station', esc(c))).join('')
        )
      )
    );
  }
  if (filter.checkInStations?.length) {
    props.push(
      property(
        'CheckInBase',
        tag(
          'Stations',
          filter.checkInStations.map(c => tag('Station', esc(c))).join('')
        )
      )
    );
  }
  if (filter.carryOutMin !== undefined) {
    props.push(
      property('CarryOut', numberDaysCondition('GT', filter.carryOutMin - 1))
    );
  }
  if (filter.carryOutMax !== undefined) {
    props.push(
      property('CarryOut', numberDaysCondition('LT', filter.carryOutMax + 1))
    );
  }
  if (filter.averageDailyBlockMin !== undefined) {
    props.push(
      property(
        'AverageDailyBlockTime',
        timeIntervalCondition('GT', filter.averageDailyBlockMin)
      )
    );
  }
  if (filter.averageDailyBlockMax !== undefined) {
    props.push(
      property(
        'AverageDailyBlockTime',
        timeIntervalCondition('LT', filter.averageDailyBlockMax)
      )
    );
  }
  if (filter.averageDailyCreditMin !== undefined) {
    props.push(
      property(
        'AverageDailyCredit',
        timeIntervalCondition('GT', filter.averageDailyCreditMin)
      )
    );
  }
  if (filter.averageDailyCreditMax !== undefined) {
    props.push(
      property(
        'AverageDailyCredit',
        timeIntervalCondition('LT', filter.averageDailyCreditMax)
      )
    );
  }
  if (filter.departOnDOWs?.length) {
    props.push(property('StartOnDOWs', dowsXml(filter.departOnDOWs)));
  }
  return props;
}

function preferenceXml(pref: BidPreference, lineNumber: number): string | null {
  const head = tag('BidLineNumber', String(lineNumber));
  switch (pref.type) {
    case 'award':
    case 'avoid': {
      const type = pref.type === 'award' ? 'AwardPairings' : 'AvoidPairings';
      const props = pref.filter ? filterToProperties(pref.filter) : [];
      const esn =
        pref.type === 'avoid' && pref.elseStartNext
          ? tag('ElseStartNext', tag('boolean', 'true'))
          : '';
      const body =
        esn +
        (props.length ? tag('PairingProperties', props.join('')) : '');
      return tag(
        'BidLine',
        head + tag('BidLineType', type) + tag(type, body)
      );
    }
    case 'preferOff': {
      let body = '';
      if (pref.preferOffDOWs?.length) {
        body = tag(
          'PreferOff',
          tag('PreferOffType', 'PreferOffDOWs') +
            tag(
              'PreferOffDOWs',
              tag('PreferOffType', 'DOWs') + dowsXml(pref.preferOffDOWs)
            )
        );
      } else if (pref.preferOffDates?.length) {
        body = tag(
          'PreferOff',
          tag('PreferOffType', 'PreferOffDates') +
            tag(
              'PreferOffDates',
              pref.preferOffDates.map(d => tag('Date', esc(d))).join('')
            )
        );
      } else {
        return null;
      }
      const esn = pref.elseStartNext
        ? tag('ElseStartNext', tag('boolean', 'true'))
        : '';
      return tag(
        'BidLine',
        head + tag('BidLineType', 'PreferOff') + body + esn
      );
    }
    case 'setConditionCredit': {
      const map = {
        min: 'MinimumCredit',
        max: 'MaximumCredit',
        mid: 'MidCredit',
        normal: null,
      } as const;
      const kind = map[pref.creditWindow ?? 'normal'];
      if (!kind) return null;
      return tag(
        'BidLine',
        head +
          tag('BidLineType', 'LineCondition') +
          tag(
            'LineCondition',
            tag('LineConditionType', kind) + tag(kind, '')
          )
      );
    }
    case 'setConditionPattern': {
      if (
        pref.patternDaysOnMin === undefined ||
        pref.patternDaysOnMax === undefined ||
        pref.patternDaysOffMin === undefined
      ) {
        return null;
      }
      return tag(
        'BidLine',
        head +
          tag('BidLineType', 'LineCondition') +
          tag(
            'LineCondition',
            tag('LineConditionType', 'Pattern') +
              tag(
                'Pattern',
                tag('NumberDays', String(pref.patternDaysOffMin)) +
                  tag(
                    'NumberDaysRange',
                    tag('Start', String(pref.patternDaysOnMin)) +
                      tag('End', String(pref.patternDaysOnMax))
                  )
              )
          )
      );
    }
    case 'clearScheduleStartNext':
      return tag(
        'BidLine',
        head +
          tag('BidLineType', 'ClearScheduleStartNext') +
          tag('ClearScheduleStartNext', '')
      );
    default:
      return null;
  }
}

/** Serialize a DraftBid to NAVBLUE bid-line XML (a <BidLines> document). */
export function bidToXml(bid: DraftBid): string {
  const lines: string[] = [];
  let n = 1;
  for (const group of bid.groups) {
    const groupType =
      group.type === 'reserve' ? 'StartReserve' : 'StartPairings';
    lines.push(
      tag(
        'BidLine',
        tag('BidLineNumber', String(n++)) +
          tag('BidLineType', 'StartBidGroup') +
          tag(
            'StartBidGroup',
            tag('BidGroupType', groupType) + tag(groupType, '')
          )
      )
    );
    for (const pref of group.preferences) {
      const xml = preferenceXml(pref, n);
      if (xml) {
        lines.push(xml);
        n++;
      }
    }
  }
  return tag('BidLines', lines.join(''));
}
