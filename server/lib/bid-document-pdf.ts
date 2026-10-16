import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import { parseBidDocument } from './bid-review';

/** Reassemble by page coordinates: confirmation numbers are a separate PDF
 * column and pdf-parse's default text order places them after their choices. */
export async function readBidPdf(buffer: Buffer) {
  const result = await pdfParse(buffer, {
    max: 50,
    pagerender: async page => {
      const content = await page.getTextContent();
      const items = content.items.filter(
        (item: any) => typeof item.str === 'string'
      );
      items.sort((a: any, b: any) =>
        Math.abs(b.transform[5] - a.transform[5]) > 2
          ? b.transform[5] - a.transform[5]
          : a.transform[4] - b.transform[4]
      );
      const lines: { y: number; items: any[] }[] = [];
      for (const item of items) {
        const y = item.transform[5];
        const last = lines[lines.length - 1];
        if (!last || Math.abs(last.y - y) > 2) lines.push({ y, items: [item] });
        else last.items.push(item);
      }
      return lines
        .map(line => {
          let text = '';
          let right = -Infinity;
          for (const item of line.items.sort(
            (a, b) => a.transform[4] - b.transform[4]
          )) {
            const gap = item.transform[4] - right;
            text += (text && gap > 1.5 ? ' ' : '') + item.str;
            right = item.transform[4] + (item.width ?? 0);
          }
          return text;
        })
        .join('\n');
    },
  });
  if (result.numpages > 50)
    throw new Error('Bid confirmations must have 50 pages or fewer.');
  if (result.text.length > 200000)
    throw new Error(
      'The bid PDF contains too much text. Use the confirmation pages only.'
    );
  const document = parseBidDocument(result.text);
  if (!document.lines.length)
    throw new Error(
      'No selectable bid text found in this PDF. Use the PBS print-to-PDF copy, or paste its numbered bid text.'
    );
  return document;
}
