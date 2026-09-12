type AwardIdentity = {
  pairingNumber: string;
  juniorHolderEmployeeNumber?: string | null;
  juniorHolderSeniority: number;
  checkInDate?: string | null;
};

/** Report period/category scope is supplied by the import transaction. */
export function awardIdentity(row: AwardIdentity): string {
  const employee = row.juniorHolderEmployeeNumber?.trim().replace(/^0+/, '');
  const raw = row.checkInDate?.trim() ?? '';
  const printed = raw.match(/^(\d{1,2})\/(\d{1,2})\b/);
  const iso = raw.match(/^\d{4}-(\d{2})-(\d{2})\b/);
  const date = printed ?? iso;
  const day = date
    ? `${Number(date[1])}-${Number(date[2])}`
    : raw.toUpperCase();
  return JSON.stringify([
    row.pairingNumber.trim().toUpperCase(),
    employee
      ? `employee:${employee}`
      : `seniority:${row.juniorHolderSeniority}`,
    day,
  ]);
}
