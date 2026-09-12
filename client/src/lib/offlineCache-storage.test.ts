import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  savePairingsCache,
  saveFullPairingsCache,
  loadPairingsCache,
  loadFullPairingsCache,
  saveStatsCache,
  loadStatsCache,
  clearAllCache,
  purgeUserCache,
  getCacheInfo,
} from './offlineCache';

test('cache writes commit, user purge includes full/profile caches, and connections close', async () => {
  await savePairingsCache('user:7:profile:pairings', { total: 236 });
  await saveFullPairingsCache('user:7:profile:pairings', []);
  await saveStatsCache('user:7:stats', { total: 236 });
  await savePairingsCache('user:8:pairings', ['keep']);
  assert.deepEqual(await loadPairingsCache('user:7:profile:pairings'), {
    total: 236,
  });
  assert.deepEqual(await loadFullPairingsCache('user:7:profile:pairings'), []);
  const info = await getCacheInfo();
  assert.equal(info.userCacheStats['7'], 2);
  assert.ok(info.lastUpdated instanceof Date);
  await purgeUserCache(7);
  assert.equal(await loadPairingsCache('user:7:profile:pairings'), undefined);
  assert.equal(
    await loadFullPairingsCache('user:7:profile:pairings'),
    undefined
  );
  assert.equal(await loadStatsCache('user:7:stats'), undefined);
  assert.deepEqual(await loadPairingsCache('user:8:pairings'), ['keep']);
  await clearAllCache();
  assert.equal((await getCacheInfo()).totalEntries, 0);
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('pbs-cache-v2');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new Error('Leaked cache connection blocks deletion'));
  });
});
