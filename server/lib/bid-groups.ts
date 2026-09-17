export interface StoredBidPreferenceRow {
  preferenceText: string;
  outcome: string;
  month: string;
  year: number;
  bidGroup?: string;
  producedAward: boolean;
}

export function markActiveBidGroups<T extends StoredBidPreferenceRow>(
  rows: T[]
) {
  const activeGroups = new Set(
    rows
      .filter(
        row => row.bidGroup && (row.outcome !== 'Unknown' || row.producedAward)
      )
      .map(row => `${row.month}|${row.year}|${row.bidGroup}`)
  );
  const periodsWithActiveGroup = new Set(
    [...activeGroups].map(key => key.split('|').slice(0, 2).join('|'))
  );

  return rows.map(row => {
    const period = `${row.month}|${row.year}`;
    const groupKey = row.bidGroup ? `${period}|${row.bidGroup}` : null;
    return {
      ...row,
      groupActive: groupKey
        ? activeGroups.has(groupKey) || !periodsWithActiveGroup.has(period)
        : undefined,
    };
  });
}
