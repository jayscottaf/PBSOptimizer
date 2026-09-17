export interface CategoryStanding {
  categoryPosition: number;
  categoryTotal: number;
  regularPosition: number;
  regularTotal: number;
  reserveAbove: number;
  reserveTotal: number;
}

export function parseCategoryStanding(
  banner: string | null | undefined
): CategoryStanding | null {
  const match = banner?.match(
    /^Standing Category (\d+)\/(\d+), Regular (\d+)\/(\d+), Reserve (\d+) above\/(\d+)$/
  );
  if (!match) return null;
  const values = match.slice(1).map(Number);
  if (values.some(value => !Number.isInteger(value) || value < 0)) return null;
  return {
    categoryPosition: values[0],
    categoryTotal: values[1],
    regularPosition: values[2],
    regularTotal: values[3],
    reserveAbove: values[4],
    reserveTotal: values[5],
  };
}
