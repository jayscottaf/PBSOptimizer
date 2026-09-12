import {
  decimalHoursToMinutes,
  formatDuration,
  printedDurationMinutes,
} from '../../../shared/durations';

interface ExportPairing {
  pairingNumber: string;
  route?: string | null;
  effectiveDates?: string | null;
  creditHours: string | number;
  blockHours: string | number;
  tafb?: string | null;
  pairingDays?: number | null;
  holdProbability?: number | null;
  fullTextBlock?: string | null;
}

function csvCell(value: unknown) {
  let text = String(value ?? '');
  // Quotes preserve commas/newlines; the prefix prevents spreadsheet formulas.
  if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function pairingsCsv(pairings: ExportPairing[]): string {
  const rows: unknown[][] = [
    [
      'Pairing',
      'Route',
      'Operating dates',
      'Credit (HH:MM)',
      'Block (HH:MM)',
      'Time away (HH:MM)',
      'Days',
      'Estimated hold (%)',
    ],
  ];
  for (const pairing of pairings)
    rows.push([
      pairing.pairingNumber,
      pairing.route,
      pairing.effectiveDates,
      formatDuration(decimalHoursToMinutes(pairing.creditHours), ':'),
      formatDuration(decimalHoursToMinutes(pairing.blockHours), ':'),
      formatDuration(printedDurationMinutes(pairing.tafb), ':'),
      pairing.pairingDays,
      pairing.holdProbability,
    ]);
  return rows.map(row => row.map(csvCell).join(',')).join('\r\n');
}

export function pairingText(pairing: ExportPairing): string {
  return `Pairing ${pairing.pairingNumber}\n${pairing.route || ''}\nOperating dates: ${pairing.effectiveDates || 'Not specified'}\nCredit: ${formatDuration(decimalHoursToMinutes(pairing.creditHours), ':')}\nBlock: ${formatDuration(decimalHoursToMinutes(pairing.blockHours), ':')}\nTime away: ${formatDuration(printedDurationMinutes(pairing.tafb), ':')}\nEstimated hold: ${typeof pairing.holdProbability !== 'number' ? 'Unknown' : `${pairing.holdProbability}%`}\n\nOriginal report\n${pairing.fullTextBlock || 'Not available'}\n`;
}

export function downloadText(
  filename: string,
  text: string,
  mime = 'text/plain'
) {
  const url = URL.createObjectURL(
    new Blob([text], { type: `${mime};charset=utf-8` })
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
