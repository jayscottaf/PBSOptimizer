import { selectionImpact } from '../../shared/report-selection-impact';
import type {
  BidDocument,
  BidDocumentLine,
  BidReviewResult,
  ReviewFinding,
} from '../../shared/bid-review';
import type {
  ParsedPreferenceReason,
  PairingAward,
  ReasonsReportMetadata,
} from '../reasonsReportParser';
import { parseOutcomeMetrics } from './outcome-metrics';
import { printedDurationMinutes, formatDuration } from '../../shared/durations';

const preferenceStart =
  /^(Award Pairings|Avoid Pairings|Prefer Off|Set Condition|Clear Schedule|Else Start Next|Waive)\b/i;
const groupStart =
  /^(Pairing Bid Group|Reserve Bid Group|Start Pairings|Start Reserve)/i;
export function parseBidDocument(text: string): BidDocument {
  const period = text.match(/Bid Period\s*:\s*([A-Z]{3,9})\s+(20\d{2})/i);
  const lines: BidDocumentLine[] = [];
  const numberedGroups = /^\s*\d+[.)]?\s+(?:Pairing|Reserve) Bid Group/im.test(
    text
  );
  let systemDefaults = false;
  let group = 0;
  let current: BidDocumentLine | undefined;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!line) continue;
    const numbered = line.match(/^(\d{1,3})[.):]?\s+(.+)$/);
    const body = numbered?.[2] ?? line;
    if (systemDefaults && !numbered) continue;
    if (numbered) systemDefaults = false;
    if (groupStart.test(body)) {
      // Unnumbered groups at the end of confirmations are system defaults.
      if (!numbered && group > 0 && numberedGroups) {
        systemDefaults = true;
        current = undefined;
        continue;
      }
      group++;
      current = {
        number: numbered ? Number(numbered[1]) : null,
        text: body,
        group,
      };
      lines.push(current);
    } else if (preferenceStart.test(body)) {
      if (!group) group = 1;
      current = {
        number: numbered ? Number(numbered[1]) : null,
        text: body,
        group,
        automatic:
          numberedGroups && !numbered && /^Award Pairings$/i.test(body),
      };
      lines.push(current);
    } else if (numbered) {
      current = { number: Number(numbered[1]), text: body, group: group || 1 };
      lines.push(current);
    } else if (
      current &&
      /^(If |(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Days|Legs)\b|Nov\b|Dec\b|Jan\b|Feb\b|Mar\b|Apr\b|May\b|Jun\b|Jul\b|Aug\b|Sep\b|Oct\b|\d{1,2},\s*20\d{2}|\d{4},)/i.test(
        line
      )
    ) {
      current.text += ` ${line}`;
    }
  }
  return {
    period: period
      ? `${period[1].slice(0, 3).toUpperCase()} ${period[2]}`
      : null,
    modified: /Confirmation\s*#?\s*Bids Modified/i.test(text),
    lines,
  };
}

function canonical(text: string) {
  return text
    .toLowerCase()
    .replace(/\s*\(admin limit\s*=\s*\d+\)/g, '')
    .replace(/credit window/g, 'credit')
    .replace(/\b0+(\d)/g, '$1')
    .replace(/[^a-z0-9><=]+/g, ' ')
    .trim();
}

export function reviewBefore(document: BidDocument): BidReviewResult {
  const findings: ReviewFinding[] = [];
  const groups = [...new Set(document.lines.map(l => l.group))];
  if (document.modified)
    findings.push({
      tone: 'warning',
      title: 'This copy contains modified bids',
      detail:
        'The last-submitted time does not confirm that these edits were submitted. Save or submit the final version in PBS and keep a matching copy.',
    });
  if (!document.lines.length)
    throw new Error(
      'No recognizable bid preferences found. Use a text-based PBS confirmation PDF or paste the numbered bid text.'
    );
  for (const line of document.lines.filter(
    l =>
      l.number !== null &&
      !groupStart.test(l.text) &&
      !preferenceStart.test(l.text)
  ))
    findings.push({
      tone: 'warning',
      title: `Choice ${line.number}: instruction not checked`,
      detail:
        'This instruction is preserved in the preview but is outside the supported structure checks.',
    });
  for (const group of groups) {
    const lines = document.lines.filter(l => l.group === group);
    const label =
      lines.find(l => groupStart.test(l.text))?.text ?? `Group ${group}`;
    if (/Reserve/i.test(label)) continue;
    const firstAward = lines.findIndex(line =>
      /^Award Pairings/i.test(line.text)
    );
    if (
      firstAward >= 0 &&
      lines
        .slice(firstAward + 1)
        .some(line => /^Set Condition/i.test(line.text))
    )
      findings.push({
        tone: 'warning',
        title: `Group ${group}: Set Condition appears after an Award`,
        detail:
          'Put Set Condition instructions before award preferences so the line is built under the intended conditions.',
      });
    for (let index = 0; index < lines.length; index++) {
      const award = lines[index];
      if (!/^Award Pairings/i.test(award.text)) continue;
      const station = award.text
        .match(/Pairing Check-In Station\s+([A-Z]{3})\b/i)?.[1]
        ?.toUpperCase();
      if (
        station &&
        lines
          .slice(0, index)
          .some(line =>
            new RegExp(
              `^Avoid Pairings If Pairing Check-In Station ${station}(?: Else|$)`,
              'i'
            ).test(line.text)
          )
      )
        findings.push({
          tone: 'warning',
          title: `Group ${group}: an award conflicts with an earlier station avoidance`,
          detail: `You request ${station} departures after avoiding them. Reorder or change one preference if that is not intentional.`,
        });
    }
    const explicitAwards = lines.filter(
      l => /^Award Pairings/i.test(l.text) && !l.automatic
    );
    const restrictions = lines.filter(l =>
      /^(Avoid Pairings|Prefer Off)/i.test(l.text)
    );
    if (
      restrictions.length &&
      lines.some(l => l.automatic) &&
      !explicitAwards.some(
        l =>
          /^Award Pairings$/i.test(l.text) || /Pairing Numbers?/i.test(l.text)
      )
    )
      findings.push({
        tone: 'info',
        title: `Group ${group}: make the fallback intentional`,
        detail:
          'The system-generated Award Pairings can fill the remaining line with any legal candidates. Add acceptable backup preferences before it to guide the final trip; more preferences do not guarantee a different award.',
      });
    if (
      group < groups.length &&
      !lines.some(l =>
        /Else Start Next|Clear Schedule.*Start Next/i.test(l.text)
      )
    )
      findings.push({
        tone: 'warning',
        title: `Group ${group}: check the exit to the next group`,
        detail:
          'This group has no recognized Else Start Next or Clear Schedule and Start Next instruction. Verify the transition in PBS.',
      });
    if (
      restrictions.some(l =>
        /^Prefer Off Friday, Saturday, Sunday/i.test(l.text)
      ) &&
      restrictions.some(l => /^Prefer Off Saturday, Sunday/i.test(l.text))
    )
      findings.push({
        tone: 'info',
        title: `Group ${group}: weekends are a deliberate tradeoff`,
        detail:
          'The Friday–Sunday and Saturday–Sunday preferences overlap. Keep them if Friday is the first day you would sacrifice; check the listed order against your actual priorities.',
      });
    for (const line of restrictions) {
      if (
        /^Avoid Pairings/i.test(line.text) &&
        (line.text.match(/\bIf\b/g)?.length ?? 0) > 1
      )
        findings.push({
          tone: 'warning',
          title: `Choice ${line.number ?? 'in group ' + group}: conditions are combined`,
          detail:
            'Multiple If conditions on one Avoid must all match. Split them only if you intend to avoid either condition independently.',
          preferences: line.number ? [line.number] : undefined,
        });
    }
  }
  return {
    mode: 'before',
    period: document.period,
    summary: [
      { label: 'Bid groups', value: String(groups.length) },
      {
        label: 'Preferences reviewed',
        value: String(
          document.lines.filter(l => !groupStart.test(l.text) && !l.automatic)
            .length
        ),
      },
    ],
    findings,
    groups: groups.map(number => ({
      number,
      label:
        document.lines.find(l => l.group === number && groupStart.test(l.text))
          ?.text ?? 'Pairing Bid Group',
      status: 'Checked for structure',
    })),
    comparisons: [],
    awards: [],
    limitations: [
      'This checks the uploaded snapshot only; later edits in PBS are not reviewed.',
      'This is a structure and strategy review, not a prediction of awards or a legality certification. Use Bid Builder simulation against the correct month’s package for candidate fit.',
      'Only recognized preferences are checked. Confirm all lines in the preview below, especially wrapped or unsupported instructions.',
    ],
  };
}

export function reviewResults(input: {
  metadata: ReasonsReportMetadata;
  preferences: ParsedPreferenceReason[];
  awards: PairingAward[];
  document?: BidDocument;
}): BidReviewResult {
  const { metadata, preferences, awards, document } = input;
  const period = `${metadata.month} ${metadata.year}`;
  const primary = preferences[0];
  if (!primary) throw new Error('No preferences found for this pilot.');
  const rows = preferences.map(p => ({
    ...p,
    ...parseOutcomeMetrics(p.outcome, p.outcomeDetail),
  }));
  const findings: ReviewFinding[] = [];
  const impacts = rows.map(p => ({
    ...p,
    bidGroup: p.bidGroupInfo ?? undefined,
    groupActive: p.outcome !== 'Unknown' || p.awardedPairingNumbers.length > 0,
  }));
  for (const selection of impacts.filter(
    p => /^(Avoid Pairings|Prefer Off)/i.test(p.preferenceText) && p.groupActive
  )) {
    const impact = selectionImpact(selection, impacts);
    if (impact)
      findings.push({
        tone: 'info',
        title: `Choice ${selection.preferenceNumber} excluded ${impact.count} candidates in a reported pool`,
        detail: `${selection.preferenceText}. ${impact.matchingCount ?? 'Unknown'} candidates were in that pool. Counts across pools can overlap and are not added together.`,
        preferences: [selection.preferenceNumber],
      });
  }
  const creditMinutes = awards.reduce(
    (sum, a) => sum + printedDurationMinutes(a.monthCredit),
    0
  );
  const groupNumbers = [
    ...new Set(
      rows.map(p => Number(p.bidGroupInfo?.match(/^Bid Group (\d+)/)?.[1] ?? 1))
    ),
  ];
  const winningRow = rows.find(p => p.awardedPairingNumbers.length > 0);
  const winningGroup = winningRow
    ? Number(winningRow.bidGroupInfo?.match(/^Bid Group (\d+)/)?.[1] ?? 1)
    : null;
  const windowMin = primary.windowInfo?.match(
    /Window (\d{1,3}:[0-5][0-9])/
  )?.[1];
  const completed = rows.some(row =>
    [row.runningTotal, row.automaticFallback?.runningTotal].some(
      total =>
        total &&
        windowMin !== undefined &&
        printedDurationMinutes(total) >= printedDurationMinutes(windowMin)
    )
  );
  if (primary.pilotBanners?.some(flag => /Denial Mode/i.test(flag)))
    findings.push({
      tone: 'warning',
      title: 'PBS used Denial Mode',
      detail:
        'PBS relaxed at least some preferences to build the line. Review partial time-off outcomes separately from your protected dates and seniority losses.',
    });
  const groups = groupNumbers.map(number => {
    const groupRows = rows.filter(
      p =>
        Number(p.bidGroupInfo?.match(/^Bid Group (\d+)/)?.[1] ?? 1) === number
    );
    return {
      number,
      label:
        groupRows[0]?.bidGroupInfo?.replace(/^Bid Group \d+: /, '') ??
        'Bid group',
      status:
        completed && winningGroup !== null && number > winningGroup
          ? 'Not reached after the awarded group'
          : groupRows.some(
                p =>
                  p.outcome !== 'Unknown' || p.awardedPairingNumbers.length > 0
              )
            ? number === winningGroup
              ? 'Produced awards'
              : 'Processed'
            : groupRows.some(p =>
                  p.groupStatuses?.some(status =>
                    /Max Reduced Regular Lines Reached/i.test(status)
                  )
                )
              ? 'Unavailable: reduced-line quota filled'
              : 'No evaluated outcomes reported',
    };
  });
  if (groups.some(group => group.status.startsWith('Unavailable:')))
    findings.push({
      tone: 'info',
      title: 'Reduced-line quota was filled',
      detail:
        'The reduced regular line attempt was unavailable. This is an administrative limit, not evidence of a badly written bid.',
    });
  for (const row of rows.filter(
    p =>
      p.outcome === 'Honored' &&
      /^(Avoid Pairings|Prefer Off|Set Condition)/i.test(p.preferenceText)
  ))
    findings.push({
      tone: 'success',
      title: `Choice ${row.preferenceNumber} honored`,
      detail: row.preferenceText,
      preferences: [row.preferenceNumber],
    });
  const partial = rows.filter(p => p.outcome === 'Partially honored');
  if (partial.length)
    findings.push({
      tone: 'warning',
      title: 'Some time-off preferences were only partly honored',
      detail: partial
        .map(p => `#${p.preferenceNumber}: ${p.preferenceText}`)
        .join('; '),
      preferences: partial.map(p => p.preferenceNumber),
    });
  const seniorOnly = rows.filter(
    p =>
      p.matchingCount !== null &&
      p.matchingCount > 0 &&
      p.seniorBidderCount === p.matchingCount &&
      p.awardedCount === 0
  );
  for (const row of seniorOnly)
    findings.push({
      tone: 'info',
      title: `Choice ${row.preferenceNumber}: all ${row.matchingCount} candidates went to senior bidders`,
      detail:
        'Changing the wording alone would not make those trips available. Keep aspirational choices, with realistic fallbacks below them.',
      preferences: [row.preferenceNumber],
    });
  for (const row of rows.filter(
    p => (p.automaticFallback?.awardedCount ?? 0) > 0
  ))
    findings.push({
      tone: 'warning',
      title: `Automatic fallback supplied ${row.automaticFallback!.awardedCount} ${row.automaticFallback!.awardedCount === 1 ? 'trip' : 'trips'}`,
      detail:
        'Your explicit award preferences did not supply the whole line. Consider adding acceptable backup trips or departure-day tiers before the system fallback. The report cannot prove that an alternative bid would have won a different line.',
    });
  const awardNumbers = new Set(awards.map(a => a.pairingNumber));
  const explicitNumbers = new Set(
    rows
      .filter(p => p.awardedCount !== null && p.awardedCount > 0)
      .flatMap(p =>
        p.awardedPairingNumbers.filter(
          n => !p.automaticAwardedPairingNumbers?.includes(n)
        )
      )
  );
  const awardRows = awards
    .slice()
    .sort((a, b) => a.checkInDate.localeCompare(b.checkInDate))
    .map(a => ({
      pairingNumber: a.pairingNumber,
      start: a.checkInDate,
      end: a.checkOutDate,
      credit: a.monthCredit,
      source: explicitNumbers.has(a.pairingNumber)
        ? `Choice ${rows.find(p => p.awardedCount && p.awardedPairingNumbers.includes(a.pairingNumber))?.preferenceNumber}`
        : rows.some(p =>
              p.automaticAwardedPairingNumbers?.includes(a.pairingNumber)
            )
          ? 'Automatic fallback'
          : 'Not classified by this report',
    }));
  const comparisons: BidReviewResult['comparisons'] = [];
  if (document) {
    if (document.period && document.period !== period)
      findings.unshift({
        tone: 'warning',
        title: 'The bid copy is for a different period',
        detail: `The copy says ${document.period}; the Reasons Report says ${period}. These documents are not compared line by line.`,
      });
    else {
      const submitted = new Map(
        document.lines
          .filter(l => l.number !== null && !groupStart.test(l.text))
          .map(l => [l.number!, l.text])
      );
      const processed = new Map(
        rows.map(p => [p.preferenceNumber, p.preferenceText])
      );
      for (const number of new Set([
        ...submitted.keys(),
        ...processed.keys(),
      ])) {
        const snapshot = submitted.get(number) ?? null,
          actual = processed.get(number) ?? null;
        if (!snapshot || !actual || canonical(snapshot) !== canonical(actual))
          comparisons.push({ number, snapshot, processed: actual });
      }
      if (comparisons.length)
        findings.unshift({
          tone: 'warning',
          title: 'The saved bid differs from the bid PBS processed',
          detail: `${comparisons.length} numbered ${comparisons.length === 1 ? 'choice differs' : 'choices differ'}. The review uses the Reasons Report. Skipped reserve choices are not graded as failures.`,
        });
      else
        findings.unshift({
          tone: 'success',
          title: 'Recognized numbered choices match',
          detail:
            'The saved copy matches the recognized preference text in this report. This does not certify the submission or any unsupported instructions.',
        });
    }
    if (document.modified)
      findings.unshift({
        tone: 'info',
        title: 'The PDF is marked Bids Modified',
        detail:
          'The processed Reasons Report takes precedence over this saved snapshot.',
      });
  }
  if (!awardNumbers.size)
    findings.unshift({
      tone: 'info',
      title: 'No pairing awards found',
      detail:
        'This may be a reserve award or a report without an award table. No credit total or successful line is inferred.',
    });
  return {
    mode: 'results',
    period,
    pilot: {
      name: primary.pilotName ?? 'Selected pilot',
      seniorityNumber: primary.pilotSeniorityNumber!,
    },
    summary: [
      { label: 'Pairings awarded', value: String(awards.length) },
      {
        label: 'Month credit',
        value: awards.length
          ? formatDuration(creditMinutes, ':')
          : 'Not reported',
      },
      {
        label: 'Awarded group',
        value: winningGroup === null ? 'Not established' : String(winningGroup),
      },
      {
        label: 'Credit window',
        value: primary.windowInfo?.replace(/^Window /, '') ?? 'Not reported',
      },
    ],
    findings,
    groups,
    comparisons,
    awards: awardRows,
    limitations: [
      'The Reasons Report is the record of the processed bid. A missing or older PDF does not block this review.',
      'Exclusion counts from different candidate pools may overlap; they are not added together.',
      'Suggestions identify tradeoffs, not guaranteed improvements. The report does not reconstruct alternate PBS awards.',
    ],
  };
}
