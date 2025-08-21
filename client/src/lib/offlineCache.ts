// Minimal IndexedDB helper for offline caching (no external deps)

type PairingCacheRecord = {
	key: string;
	data: any;
	updatedAt: number;
};

const DB_NAME = 'pbs-cache';
const DB_VERSION = 2; // Increment when schema changes
const CURRENT_SCHEMA_VERSION = '1.2.0'; // Match SW version for consistency

function openDB(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, DB_VERSION);
		req.onupgradeneeded = (event) => {
			const db = req.result;
			const oldVersion = (event as IDBVersionChangeEvent).oldVersion;
			
			console.log(`IndexedDB: Upgrading from version ${oldVersion} to ${DB_VERSION}`);
			
			// Initial setup (version 1)
			if (oldVersion < 1) {
				if (!db.objectStoreNames.contains('pairings')) {
					const pairingsStore = db.createObjectStore('pairings', { keyPath: 'key' });
					pairingsStore.createIndex('updatedAt', 'updatedAt', { unique: false });
				}
				if (!db.objectStoreNames.contains('stats')) {
					const statsStore = db.createObjectStore('stats', { keyPath: 'key' });
					statsStore.createIndex('updatedAt', 'updatedAt', { unique: false });
				}
			}
			
			// Schema version 2 improvements
			if (oldVersion < 2) {
				// Add metadata store for tracking versions and migrations
				if (!db.objectStoreNames.contains('metadata')) {
					db.createObjectStore('metadata', { keyPath: 'key' });
				}
				
				// Add indexes if missing
				if (db.objectStoreNames.contains('pairings')) {
					const pairingsStore = req.transaction?.objectStore('pairings');
					if (pairingsStore && !pairingsStore.indexNames.contains('updatedAt')) {
						pairingsStore.createIndex('updatedAt', 'updatedAt', { unique: false });
					}
				}
			}
		};
		req.onsuccess = async () => {
			const db = req.result;
			
			// Set schema version metadata (only if metadata store exists)
			try {
				if (db.objectStoreNames.contains('metadata')) {
					const tx = db.transaction('metadata', 'readwrite');
					const store = tx.objectStore('metadata');
					await new Promise<void>((resolve, reject) => {
						const putReq = store.put({ 
							key: 'schema_version', 
							value: CURRENT_SCHEMA_VERSION,
							updatedAt: Date.now()
						});
						putReq.onsuccess = () => resolve();
						putReq.onerror = () => reject(putReq.error);
					});
				}
			} catch (error) {
				console.warn('Failed to set schema version:', error);
			}
			
			resolve(db);
		};
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

// Schema migration and diagnostics
export async function getCacheInfo(): Promise<{
	schemaVersion: string;
	dbVersion: number;
	totalEntries: number;
	userCacheStats: Record<string, number>;
	lastUpdated: Date | null;
}> {
	try {
		const db = await openDB();
		
		// Get schema version
		let schemaVersion = 'unknown';
		try {
			if (db.objectStoreNames.contains('metadata')) {
				const metaTx = db.transaction('metadata', 'readonly');
				const metaStore = metaTx.objectStore('metadata');
				const schemaReq = await new Promise<any>((resolve, reject) => {
					const req = metaStore.get('schema_version');
					req.onsuccess = () => resolve(req.result);
					req.onerror = () => reject(req.error);
				});
				schemaVersion = schemaReq?.value || 'unknown';
			} else {
				schemaVersion = 'pre-1.2.0';
			}
		} catch (error) {
			console.warn('Could not get schema version:', error);
		}
		
		// Count entries by user
		const pairingsTx = db.transaction('pairings', 'readonly');
		const pairingsStore = pairingsTx.objectStore('pairings');
		const allKeys = await new Promise<string[]>((resolve, reject) => {
			const req = pairingsStore.getAllKeys();
			req.onsuccess = () => resolve(req.result as string[]);
			req.onerror = () => reject(req.error);
		});
		
		const userCacheStats: Record<string, number> = {};
		let totalEntries = allKeys.length;
		let lastUpdated: Date | null = null;
		
		for (const key of allKeys) {
			// Extract user from key pattern: user:15600:pairings:...
			const userMatch = key.match(/^user:(\d+):/);
			if (userMatch) {
				const userId = userMatch[1];
				userCacheStats[userId] = (userCacheStats[userId] || 0) + 1;
			} else {
				userCacheStats['no-user'] = (userCacheStats['no-user'] || 0) + 1;
			}
		}
		
		// Get most recent update time
		try {
			if (pairingsStore.indexNames.contains('updatedAt')) {
				const cursor = await new Promise<IDBCursorWithValue | null>((resolve, reject) => {
					const req = pairingsStore.index('updatedAt').openCursor(null, 'prev');
					req.onsuccess = () => resolve(req.result);
					req.onerror = () => reject(req.error);
				});
				if (cursor) {
					lastUpdated = new Date(cursor.value.updatedAt);
				}
			}
		} catch (error) {
			console.warn('Could not get last updated time:', error);
		}
		
		return {
			schemaVersion,
			dbVersion: DB_VERSION,
			totalEntries,
			userCacheStats,
			lastUpdated
		};
	} catch (error) {
		console.error('Failed to get cache info:', error);
		throw error;
	}
}

export async function migrateOldCacheFormat(): Promise<void> {
	try {
		console.log('Checking for old cache format migration...');
		const info = await getCacheInfo();
		
		// If we have entries without user prefixes, they need migration
		if (info.userCacheStats['no-user'] > 0) {
			console.log(`Found ${info.userCacheStats['no-user']} entries without user prefix, migration recommended`);
			// For now, just log. In the future, could implement automatic migration
			// or prompt user to clear old cache
		}
		
		console.log('Cache migration check complete:', info);
	} catch (error) {
		console.warn('Cache migration check failed (this is normal for first-time users):', error instanceof Error ? error.message : String(error));
		// Don't rethrow - migration failures shouldn't break app startup
	}
}


