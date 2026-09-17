import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import { printedDurationHours } from '../shared/durations';

export interface WideScheduleEvent {
  day: number;
  type: 'pairing' | 'reserve' | 'vacation' | 'training' | 'other';
  code: string;
  creditHours?: number;
  checkInTime?: string;
}

export interface ParsedWideScheduleLine {
  pilotSeniority: number | null;
  sourceLabel: string | null;
  totalCreditHours: number;
  daysOff: number | null;
  lineType: 'regular' | 'reserve' | 'open';
  flags: string[];
  events: WideScheduleEvent[];
}

export interface ParsedWideSchedule {
  month: string;
  year: number;
  base: string;
  aircraft: string;
  position: 'A' | 'B';
  lines: ParsedWideScheduleLine[];
}

interface PdfTextItem {
  text: string;
  x: number;
  y: number;
}

interface PdfPageItems {
  items: PdfTextItem[];
}

const SCHEDULE_CODES = new Set([
  'RES',
  'PVAC',
  'SVAC',
  'PVPP',
  '10WD',
  '10TR',
  'OFIC',
  'MLOA',
  'VAC',
  'SICK',
  'CQ',
]);

const duration = (value: string) => {
  const match = value.match(/^(\d{2,3}):(\d{2})$/);
  return match ? printedDurationHours(`${match[1]}:${match[2]}`) : undefined;
};

const eventType = (code: string): WideScheduleEvent['type'] => {
  if (code === 'RES') return 'reserve';
  if (/VAC|PVPP/.test(code)) return 'vacation';
  if (/WD|TR|CQ/.test(code)) return 'training';
  return 'other';
};

const nearestDay = (y: number, dates: Array<{ day: number; y: number }>) =>
  dates.reduce((best, candidate) =>
    Math.abs(candidate.y - y) < Math.abs(best.y - y) ? candidate : best
  ).day;

export function parseWideSchedulePageItems(
  pages: PdfPageItems[]
): ParsedWideSchedule {
  const allText = pages
    .flatMap(page => page.items.map(item => item.text))
    .join(' ');
  const period = allText.match(/Period:\s*([A-Z]{3})\s+(20\d{2})/i);
  const category = allText.match(
    /Category:\s*([A-Z]{3})-([A-Z0-9]+)-([AB])\b/i
  );
  if (!period || !category) {
    throw new Error('This PDF is not a recognized NAVBLUE wide schedule.');
  }

  const lines: ParsedWideScheduleLine[] = [];
  for (const page of pages) {
    const dateItems = page.items
      .filter(
        item =>
          item.x >= 108 &&
          item.x <= 118 &&
          /^(?:[1-9]|[12]\d|3[01])$/.test(item.text)
      )
      .map(item => ({ day: Number(item.text), y: item.y }))
      .filter(
        (date, index, dates) =>
          dates.findIndex(other => other.day === date.day) === index
      )
      .sort((a, b) => a.day - b.day);
    if (dateItems.length < 28) continue;

    const headers = page.items
      .filter(
        item =>
          /^\d{5}\s*\/\s*\d{9}$/.test(item.text) || /^Open-\d+$/.test(item.text)
      )
      .sort((a, b) => a.x - b.x);

    for (let index = 0; index < headers.length; index++) {
      const header = headers[index];
      const nextX = headers[index + 1]?.x ?? header.x + 42;
      const rowItems = page.items.filter(
        item => item.x >= header.x - 5 && item.x < nextX - 5
      );
      const pilot = header.text.match(/^(\d{5})\s*\//);
      const creditText = rowItems.find(item =>
        /^Cr:\d{3}:\d{2}$/.test(item.text)
      )?.text;
      const daysOffText = rowItems.find(item =>
        /^Days Off:\s*\d+$/.test(item.text)
      )?.text;
      const flags = rowItems
        .filter(item => /^(?:NB|SB)$/.test(item.text))
        .map(item => item.text)
        .filter((flag, flagIndex, all) => all.indexOf(flag) === flagIndex);

      const events: WideScheduleEvent[] = [];
      for (const item of rowItems) {
        if (/^[A-Z]?\d{3,5}$/.test(item.text) && item.y >= dateItems[0].y - 8) {
          const samePosition = rowItems.filter(
            candidate => Math.abs(candidate.y - item.y) <= 1.5
          );
          const credit = samePosition
            .map(candidate => duration(candidate.text))
            .find(value => value !== undefined);
          const checkInTime = samePosition.find(candidate =>
            /^\d{2}:\d{2}$/.test(candidate.text)
          )?.text;
          events.push({
            day: nearestDay(item.y, dateItems),
            type: 'pairing',
            code: item.text,
            ...(credit !== undefined ? { creditHours: credit } : {}),
            ...(checkInTime ? { checkInTime } : {}),
          });
        } else if (SCHEDULE_CODES.has(item.text)) {
          events.push({
            day: nearestDay(item.y, dateItems),
            type: eventType(item.text),
            code: item.text,
          });
        }
      }

      const uniqueEvents = events.filter(
        (event, eventIndex, all) =>
          all.findIndex(
            candidate =>
              candidate.day === event.day &&
              candidate.type === event.type &&
              candidate.code === event.code
          ) === eventIndex
      );
      const isOpen = header.text.startsWith('Open-');
      const hasReserve = uniqueEvents.some(event => event.type === 'reserve');
      lines.push({
        pilotSeniority: pilot ? Number(pilot[1]) : null,
        sourceLabel: isOpen ? header.text : null,
        totalCreditHours: creditText
          ? printedDurationHours(creditText.slice(3))
          : uniqueEvents.reduce(
              (sum, event) => sum + (event.creditHours ?? 0),
              0
            ),
        daysOff: daysOffText ? Number(daysOffText.match(/\d+$/)?.[0]) : null,
        lineType: isOpen ? 'open' : hasReserve ? 'reserve' : 'regular',
        flags,
        events: uniqueEvents.sort((a, b) => a.day - b.day),
      });
    }
  }

  if (lines.length === 0) {
    throw new Error('No schedule lines could be extracted from this PDF.');
  }
  return {
    month: period[1].toUpperCase(),
    year: Number(period[2]),
    base: category[1].toUpperCase(),
    aircraft: category[2].toUpperCase(),
    position: category[3].toUpperCase() as 'A' | 'B',
    lines,
  };
}

export async function parseWideSchedulePdf(
  buffer: Buffer
): Promise<ParsedWideSchedule> {
  const pages: PdfPageItems[] = [];
  await pdfParse(buffer, {
    pagerender: async (page: any) => {
      const content = await page.getTextContent({
        normalizeWhitespace: false,
        disableCombineTextItems: false,
      });
      pages.push({
        items: content.items.map((item: any) => ({
          text: String(item.str ?? '').trim(),
          x: Number(item.transform?.[4] ?? 0),
          y: Number(item.transform?.[5] ?? 0),
        })),
      });
      return '';
    },
  });
  return parseWideSchedulePageItems(pages);
}
