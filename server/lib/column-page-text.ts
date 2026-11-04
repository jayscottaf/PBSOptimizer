/**
 * Column-aware page text for bid package PDFs.
 *
 * Pairing pages are printed in two columns (left column at x~11pt, right at
 * x~313pt on a 612pt page). pdf-parse's default renderer emits text in
 * content-stream order and starts a new line whenever y changes, so it only
 * reads correctly when the PDF happens to store the whole left column
 * before the right one. A package that stores text row by row across the
 * page interleaves the two columns line by line, corrupting every pairing
 * on the page.
 *
 * This renderer places text by coordinates instead: when both halves of a
 * page hold pairing content it reads the left column top to bottom, then
 * the right; otherwise (cover page, ALV table, parameters) it reads each
 * row across the full width. Items on a row are joined with no separator,
 * exactly like the default renderer, because the monospaced report text
 * carries its own spacing and the pairing parser depends on it.
 */

export interface PageTextItem {
  str: string;
  /** PDF text matrix: [a, b, c, d, x, y]. */
  transform: number[];
}

/** Vertical distance (pt) within which items count as the same row. */
const ROW_TOLERANCE = 2;

const PAIRING_CONTENT =
  /#[A-Z]?\d{4}\b|TOTAL CREDIT|EFFECTIVE\s+[A-Z]{3}|\b[A-Z]{3} \d{4}\s+[A-Z]{3} \d{4}/;

function looksLikePairingColumn(items: PageTextItem[]): boolean {
  return PAIRING_CONTENT.test(items.map(item => item.str).join('\n'));
}

function renderRows(items: PageTextItem[]): string {
  const sorted = items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const dy = b.item.transform[5] - a.item.transform[5];
      if (Math.abs(dy) > ROW_TOLERANCE) return dy;
      return a.item.transform[4] - b.item.transform[4] || a.index - b.index;
    });
  const rows: { y: number; text: string }[] = [];
  for (const { item } of sorted) {
    const y = item.transform[5];
    const last = rows[rows.length - 1];
    if (last && Math.abs(last.y - y) <= ROW_TOLERANCE) last.text += item.str;
    else rows.push({ y, text: item.str });
  }
  return rows.map(row => row.text).join('\n');
}

/**
 * Renders one page's text items. `pageLeft`/`pageWidth` come from the
 * page's view box; the column split is the page's horizontal midpoint.
 */
export function renderColumnAwarePage(
  rawItems: PageTextItem[],
  pageLeft: number,
  pageWidth: number
): string {
  const items = rawItems.filter(
    item => typeof item.str === 'string' && Array.isArray(item.transform)
  );
  const midpoint = pageLeft + pageWidth / 2;
  const left = items.filter(item => item.transform[4] < midpoint);
  const right = items.filter(item => item.transform[4] >= midpoint);
  if (
    left.length > 0 &&
    right.length > 0 &&
    looksLikePairingColumn(left) &&
    looksLikePairingColumn(right)
  ) {
    return `${renderRows(left)}\n${renderRows(right)}`;
  }
  return renderRows(items);
}

/** pdf-parse `pagerender` callback using {@link renderColumnAwarePage}. */
export async function columnAwarePageRender(page: any): Promise<string> {
  const content = await page.getTextContent({
    normalizeWhitespace: false,
    disableCombineTextItems: false,
  });
  const [x0 = 0, , x1 = 612] = Array.isArray(page.view) ? page.view : [];
  return renderColumnAwarePage(content.items, x0, x1 - x0);
}
