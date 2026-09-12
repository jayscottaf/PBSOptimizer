import assert from 'node:assert/strict';
import { test } from 'node:test';
import { awardIdentity } from '../lib/award-identity';

test('award identity includes operating date and uses stable employee identity', () => {
  const first = {
    pairingNumber: '1001',
    juniorHolderEmployeeNumber: '00123',
    juniorHolderSeniority: 100,
    checkInDate: '08/01 Sat 09:00',
  };
  assert.notEqual(
    awardIdentity(first),
    awardIdentity({ ...first, checkInDate: '08/07 Fri 09:00' })
  );
  assert.equal(
    awardIdentity(first),
    awardIdentity({
      ...first,
      juniorHolderSeniority: 99,
      juniorHolderEmployeeNumber: '123',
      checkInDate: '2026-08-01',
    })
  );
  assert.notEqual(
    awardIdentity(first),
    awardIdentity({ ...first, juniorHolderEmployeeNumber: '124' })
  );
});
