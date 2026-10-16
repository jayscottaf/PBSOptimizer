import type { BidHistory, ReasonsReportPreference } from '../../shared/schema';
import type {
  ParsedPreferenceReason,
  PairingAward,
} from '../reasonsReportParser';
import { decimalHoursToMinutes, formatDuration } from '../../shared/durations';

// These stay strings in the existing report_banners metadata array, alongside
// Window / Standing / Bid Group / Pre-Award entries. No raw HTML is retained.
const retained = 'Pilot review details retained';
export function reviewBanners(pref: ParsedPreferenceReason, banners: string[]) {
  return [
    ...banners,
    ...(pref.windowInfo ? [pref.windowInfo] : []),
    ...(pref.standingInfo ? [pref.standingInfo] : []),
    ...(pref.bidGroupInfo ? [pref.bidGroupInfo] : []),
    ...pref.preAwardInfo,
    retained,
    ...(pref.pilotName ? [`Pilot name: ${pref.pilotName}`] : []),
    ...(pref.pilotBanners ?? []).map(flag => `Pilot flag: ${flag}`),
    ...(pref.groupStatuses ?? []).map(status => `Group status: ${status}`),
  ];
}
export function restoreBidReview(
  records: ReasonsReportPreference[],
  history: BidHistory[]
) {
  const awards: PairingAward[] = history.map(row => ({
    pairingNumber: row.pairingNumber,
    pilotName: row.juniorHolderName ?? `Pilot #${row.juniorHolderSeniority}`,
    seniorityNumber: row.juniorHolderSeniority,
    employeeNumber: row.juniorHolderEmployeeNumber ?? '',
    awardType: row.awardType ?? 'Regular',
    pairingDays: row.pairingDays,
    monthCredit: formatDuration(decimalHoursToMinutes(row.creditHours), ':'),
    totalCredit:
      row.totalCredit === null
        ? ''
        : formatDuration(decimalHoursToMinutes(row.totalCredit), ':'),
    layoverCities: row.layoverCities ?? '',
    checkInDate: row.checkInDate ?? '',
    checkOutDate: row.checkOutDate ?? '',
  }));
  const preferences: ParsedPreferenceReason[] = records.map(row => {
    const banners = Array.isArray(row.reportBanners)
      ? row.reportBanners.filter(
          (value): value is string => typeof value === 'string'
        )
      : [];
    const prefixed = (prefix: string) =>
      banners
        .filter(b => b.startsWith(prefix))
        .map(b => b.slice(prefix.length));
    const fallback =
      row.outcomeDetail?.split('\nAutomatic Award Pairings:\n')[1] ?? '';
    return {
      preferenceNumber: row.preferenceNumber,
      preferenceText: row.preferenceText,
      outcome: row.outcome,
      outcomeDetail: row.outcomeDetail,
      awardedPairingNumbers: Array.isArray(row.awardedPairingNumbers)
        ? row.awardedPairingNumbers.map(String)
        : [],
      // Older imports kept fallback PBSEvents in outcomeDetail. Read the
      // timestamp-shaped events, never infer their identity from counts.
      automaticAwardedPairingNumbers: [
        ...fallback.matchAll(
          /^(\d{4,5})\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+\d{4}-\d{2}-\d{2}/gm
        ),
      ].map(m => m[1]),
      pilotSeniorityNumber: row.pilotSeniorityNumber,
      pilotEmployeeNumber: row.pilotEmployeeNumber,
      pilotName:
        prefixed('Pilot name: ')[0] ??
        awards.find(a => a.seniorityNumber === row.pilotSeniorityNumber)
          ?.pilotName ??
        null,
      windowInfo: banners.find(b => b.startsWith('Window ')) ?? null,
      standingInfo: banners.find(b => b.startsWith('Standing ')) ?? null,
      bidGroupInfo: banners.find(b => b.startsWith('Bid Group ')) ?? null,
      preAwardInfo: banners.filter(b => b.startsWith('Pre-Award ')),
      // Legacy banners were report-wide, so cannot establish this pilot's flags.
      pilotBanners: prefixed('Pilot flag: '),
      groupStatuses: prefixed('Group status: '),
    };
  });
  return {
    preferences,
    awards,
    legacyPilots: new Set(
      records
        .filter(
          row =>
            !Array.isArray(row.reportBanners) ||
            !row.reportBanners.includes(retained)
        )
        .map(row => row.pilotSeniorityNumber)
    ),
  };
}
