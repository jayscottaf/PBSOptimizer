// Minimal IndexedDB helper for offline caching (no external deps)

type PairingCacheRecord = {
	key: string;
	data: any;
	updatedAt: number;
};

const DB_NAME = 'pbs-cache';
const DB_VERSION = 1;

function openDB(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, DB_VERSION);
		req.onupgradeneeded = () => {
			const db = req.result;
			if (!db.objectStoreNames.contains('pairings')) {
				db.createObjectStore('pairings', { keyPath: 'key' });
			}
			if (!db.objectStoreNames.contains('stats')) {
				db.createObjectStore('stats', { keyPath: 'key' });
			}
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

async function put(store: 'pairings'|'stats', key: string, data: any): Promise<void> {
	const db = await openDB();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(store, 'readwrite');
		(tx.objectStore(store) as IDBObjectStore).put({ key, data, updatedAt: Date.now() } as PairingCacheRecord);
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
	});
}

async function get(store: 'pairings'|'stats', key: string): Promise<PairingCacheRecord | undefined> {
	const db = await openDB();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(store, 'readonly');
		const req = (tx.objectStore(store) as IDBObjectStore).get(key);
		req.onsuccess = () => resolve(req.result as PairingCacheRecord | undefined);
		req.onerror = () => reject(req.error);
	});
}

export function cacheKeyForPairings(bidPackageId?: number, filters?: Record<string, any>, userId?: string | number): string {
	const userPrefix = userId ? `user:${userId}:` : '';
	
	if (!bidPackageId) return `${userPrefix}pairings:default`;
	if (!filters) return `${userPrefix}pairings:${bidPackageId}:all`;
	// Omit pagination, sort fields, and bidPackageId since it's already in the key prefix
	const { sortBy, sortOrder, page, limit, bidPackageId: _, ...rest } = filters as any;
	const cleaned: Record<string, any> = {};
	Object.keys(rest).forEach((k) => {
		const v = (rest as any)[k];
		if (v !== undefined && v !== null && v !== '') cleaned[k] = v;
	});
	
	// If no actual filters remain, use simple key
	if (Object.keys(cleaned).length === 0) {
		return `${userPrefix}pairings:${bidPackageId}:all`;
	}
	
	const sorted = Object.keys(cleaned).sort().reduce((acc, k) => { (acc as any)[k] = (cleaned as any)[k]; return acc; }, {} as Record<string, any>);
	return `${userPrefix}pairings:${bidPackageId}:${btoa(unescape(encodeURIComponent(JSON.stringify(sorted))).slice(0, 64))}`;
}

export async function savePairingsCache(key: string, data: any): Promise<void> { return put('pairings', key, data); }
export async function loadPairingsCache<T>(key: string): Promise<T | undefined> {
	const rec = await get('pairings', key);
	return rec?.data as T | undefined;
}

export async function saveStatsCache(key: string, data: any): Promise<void> { return put('stats', key, data); }
export async function loadStatsCache<T>(key: string): Promise<T | undefined> {
	const rec = await get('stats', key);
	return rec?.data as T | undefined;
}

// Full-dataset cache helpers (to enable offline global sorting/filtering)
function fullKey(key: string): string { return `full:${key}`; }
export async function saveFullPairingsCache(key: string, data: any[]): Promise<void> {
	return put('pairings', fullKey(key), data);
}
export async function loadFullPairingsCache<T = any[]>(key: string): Promise<T | undefined> {
	const rec = await get('pairings', fullKey(key));
	return rec?.data as T | undefined;
}
export async function hasFullPairingsCache(key: string): Promise<boolean> {
	const data = await loadFullPairingsCache(key).catch(() => undefined);
	return !!data;
}

// Cache management utilities
export async function getAllCacheKeys(store: 'pairings' | 'stats'): Promise<string[]> {
	const db = await openDB();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(store, 'readonly');
		const objectStore = tx.objectStore(store);
		const request = objectStore.getAllKeys();
		request.onsuccess = () => resolve(request.result as string[]);
		request.onerror = () => reject(request.error);
	});
}

export async function deleteCache(store: 'pairings' | 'stats', key: string): Promise<void> {
	const db = await openDB();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(store, 'readwrite');
		const deleteRequest = tx.objectStore(store).delete(key);
		deleteRequest.onsuccess = () => resolve();
		deleteRequest.onerror = () => reject(deleteRequest.error);
	});
}

// User-specific cache management
export async function purgeUserCache(userId: string | number): Promise<void> {
	const userPrefix = `user:${userId}:`;
	console.log(`Purging cache for user ${userId}...`);
	
	try {
		// Purge pairings cache
		const pairingsKeys = await getAllCacheKeys('pairings');
		const userPairingsKeys = pairingsKeys.filter(key => key.startsWith(userPrefix));
		console.log(`Found ${userPairingsKeys.length} pairing cache entries to purge`);
		
		for (const key of userPairingsKeys) {
			await deleteCache('pairings', key);
		}
		
		// Purge stats cache  
		const statsKeys = await getAllCacheKeys('stats');
		const userStatsKeys = statsKeys.filter(key => key.startsWith(userPrefix));
		console.log(`Found ${userStatsKeys.length} stats cache entries to purge`);
		
		for (const key of userStatsKeys) {
			await deleteCache('stats', key);
		}
		
		console.log(`Cache purge completed for user ${userId}`);
	} catch (error) {
		console.error(`Failed to purge cache for user ${userId}:`, error);
		throw error;
	}
}

export async function clearAllCache(): Promise<void> {
	console.log('Clearing all cache...');
	try {
		const db = await openDB();
		
		// Clear pairings
		const pairingsTx = db.transaction('pairings', 'readwrite');
		await new Promise<void>((resolve, reject) => {
			const clearReq = pairingsTx.objectStore('pairings').clear();
			clearReq.onsuccess = () => resolve();
			clearReq.onerror = () => reject(clearReq.error);
		});
		
		// Clear stats
		const statsTx = db.transaction('stats', 'readwrite');
		await new Promise<void>((resolve, reject) => {
			const clearReq = statsTx.objectStore('stats').clear();
			clearReq.onsuccess = () => resolve();
			clearReq.onerror = () => reject(clearReq.error);
		});
		
		console.log('All cache cleared');
	} catch (error) {
		console.error('Failed to clear all cache:', error);
		throw error;
	}
}


