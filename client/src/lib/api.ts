import { apiRequest } from './queryClient';
import {
  cacheKeyForPairings,
  savePairingsCache,
  loadPairingsCache,
  saveFullPairingsCache,
  loadFullPairingsCache,
} from './offlineCache';
export interface BidPackage {
  id: number;
  name: string;
  month: string;
  year: number;
  base: string;
  aircraft: string;
  uploadedAt: string;
  status: string;
}

export interface Pairing {
  id: number;
  bidPackageId: number;
  pairingNumber: string;
  effectiveDates: string;
  route: string;
  creditHours: string;
  blockHours: string;
  tafb: string;
  fdp?: string;
  payHours?: string;
  sitEdpPay?: string;
  carveouts?: string;
  deadheads: number;
  layovers: any;
  flightSegments: any;
  fullTextBlock: string;
  holdProbability: number;
  pairingDays?: number;
  seniorityPercentage?: number; // Added seniorityPercentage
}

export interface SearchFilters {
  bidPackageId?: number;
  search?: string;
  creditMin?: number;
  creditMax?: number;
  blockMin?: number;
  blockMax?: number;
  tafb?: string;
  tafbMin?: number;
  tafbMax?: number;
  holdProbabilityMin?: number;
  pairingDays?: number;
  pairingDaysMin?: number;
  pairingDaysMax?: number;
  efficiency?: number;
  seniorityPercentage?: number;
  preferredDaysOff?: Date[]; // Added preferredDaysOff
  // Pagination and sorting
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

// Add this type for the new response format
interface SearchPairingsResponse {
  pairings: Pairing[];
  statistics: {
    likelyToHold: number;
    highCredit: number;
    ratioBreakdown: {
      excellent: number;
      good: number;
      average: number;
      poor: number;
    };
  };
}

const API_BASE = ''; // Assuming API_BASE is defined elsewhere or is an empty string for local context.

export const api = {
  // Bid packages
  getBidPackages: async (): Promise<BidPackage[]> => {
    const response = await apiRequest('GET', '/api/bid-packages');
    return response.json();
  },

  // Prefetch entire dataset for current filters and cache for offline/global sorting
  prefetchAllPairings: async (
    filters: SearchFilters & { bidPackageId: number },
    userId?: string | number,
    options?: { force?: boolean }
  ) => {
    console.log('Starting prefetch for filters:', filters, 'userId:', userId, 'options:', options);

    // Use cache key WITHOUT sortBy/sortOrder to enable global sorting on one dataset
    const { sortBy, sortOrder, page, limit: _, ...filtersForCache } = filters;
    const key = cacheKeyForPairings(
      filters.bidPackageId,
      filtersForCache,
      userId
    );

    console.log('Prefetch cache key:', key);

    // Check if already cached (unless force is true)
    if (!options?.force) {
      const existing = await loadFullPairingsCache(key);
      if (existing && existing.length > 0) {
        console.log('Full cache already exists, skipping prefetch');
        return { total: existing.length, cached: true };
      }
    } else {
      console.log('Force prefetch requested, bypassing cache check');
    }

    // First page to determine total
    const first = await fetch('/api/pairings/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...filters,
        page: 1,
        limit: 100,
        sortBy: 'pairingNumber',
        sortOrder: 'asc',
      }),
    });
    if (!first.ok) {
      throw new Error('Prefetch failed');
    }
    const firstData = await first.json();
    const total =
      firstData?.pagination?.total ||
      (Array.isArray(firstData) ? firstData.length : 0);
    const limit = firstData?.pagination?.limit || 100;
    let rows: Pairing[] =
      firstData?.pairings || (Array.isArray(firstData) ? firstData : []);

    console.log(
      `Prefetch: Page 1 fetched, total=${total}, limit=${limit}, found=${rows.length}`
    );

    const totalPages = Math.ceil(total / limit);
    for (let page = 2; page <= totalPages; page++) {
      const res = await fetch('/api/pairings/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...filters,
          page,
          limit,
          sortBy: 'pairingNumber',
          sortOrder: 'asc',
        }),
      });
      if (!res.ok) {
        console.warn(`Prefetch: Failed to fetch page ${page}`);
        break;
      }
      const data = await res.json();
      const part: Pairing[] = data?.pairings || [];
      rows = rows.concat(part);
      console.log(
        `Prefetch: Page ${page}/${totalPages} fetched, total rows=${rows.length}`
      );
    }

    console.log(`Prefetch: Caching ${rows.length} total rows with key: ${key}`);
    await saveFullPairingsCache(key, rows);
    console.log('Prefetch: Cache save completed');
    return { total: rows.length, cached: true };
  },

  // Progress stream (SSE)
  openProgressStream: (
    bidPackageId: number,
    onMessage: (data: any) => void
  ): EventSource => {
    const es = new EventSource(
      `/api/progress/stream?bidPackageId=${bidPackageId}`
    );
    es.onmessage = e => {
      try {
        const data = JSON.parse(e.data);
        onMessage(data);
      } catch {
        // Ignore JSON parsing errors
      }
    };
    return es;
  },

  uploadBidPackage: async (
    file: File,
    data: {
      name: string;
      month: string;
      year: number;
      base: string;
      aircraft: string;
    }
  ) => {
    const formData = new FormData();
    formData.append('bidPackage', file);
    formData.append('name', data.name);
    formData.append('month', data.month);
    formData.append('year', data.year.toString());
    formData.append('base', data.base);
    formData.append('aircraft', data.aircraft);

    const response = await fetch('/api/upload', {
      method: 'POST',
      body: formData,
      credentials: 'include',
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(error || response.statusText);
    }

    return response.json();
  },

  // Pairings
  getPairings: async (
    bidPackageId?: number,
    userId?: string | number
  ): Promise<Pairing[]> => {
    const key = cacheKeyForPairings(bidPackageId, undefined, userId);
    try {
      const url = bidPackageId
        ? `/api/pairings?bidPackageId=${bidPackageId}`
        : '/api/pairings';
      const response = await apiRequest('GET', url);
      const data = await response.json();
      const list = Array.isArray(data) ? data : [];
      // Save to offline cache
      savePairingsCache(key, list).catch(() => {});
      return list;
    } catch (error) {
      // Offline/read error → return cached if present
      const cached = await loadPairingsCache<Pairing[]>(key);
      if (cached) {
        return cached;
      }
      return [];
    }
  },

  searchPairings: async (
    filters: SearchFilters,
    userId?: string | number
  ): Promise<SearchPairingsResponse> => {
    try {
      const response = await fetch('/api/pairings/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(filters),
      });

      if (!response.ok) {
        throw new Error('Failed to search pairings');
      }
      const data = await response.json();
      // Cache the full result
      const list = data?.pairings ?? (Array.isArray(data) ? data : []);
      const key = cacheKeyForPairings(filters.bidPackageId, filters, userId);
      saveFullPairingsCache(key, list).catch(() => {});

      return data;
    } catch (error) {
      console.error('Error searching pairings:', error);
      // Offline: try cached
      const key = cacheKeyForPairings(filters.bidPackageId, filters, userId);
      const cached = await loadFullPairingsCache<Pairing[]>(key);
      if (cached) {
        return {
          pairings: cached,
          statistics: {
            likelyToHold: 0,
            highCredit: 0,
            ratioBreakdown: { excellent: 0, good: 0, average: 0, poor: 0 },
          },
        };
      }
      return {
        pairings: [],
        statistics: {
          likelyToHold: 0,
          highCredit: 0,
          ratioBreakdown: { excellent: 0, good: 0, average: 0, poor: 0 },
        },
      };
    }
  },

  getPairing: async (id: number): Promise<Pairing> => {
    const response = await apiRequest('GET', `/api/pairings/${id}`);
    return response.json();
  },

  // User
  createOrUpdateUser: async (data: {
    seniorityNumber: number;
    seniorityPercentile?: number;
    base: string;
    aircraft: string;
  }) => {
    const response = await apiRequest('POST', '/api/user', data);
    return response.json();
  },

  // Favorites
  addFavorite: async (userId: number, pairingId: number) => {
    const response = await fetch('/api/favorites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, pairingId }),
    });
    if (!response.ok) {
      throw new Error('Failed to add favorite');
    }
    return response.json();
  },

  removeFavorite: async (userId: number, pairingId: number) => {
    const response = await fetch('/api/favorites', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, pairingId }),
    });
    if (!response.ok) {
      throw new Error('Failed to remove favorite');
    }
    return response.json();
  },

  addToCalendar: async (
    userId: number,
    pairingId: number,
    startDate: Date,
    endDate: Date
  ) => {
    console.log('API: Adding to calendar with params:', {
      userId,
      pairingId,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
    });
    try {
      const response = await fetch('/api/calendar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          pairingId,
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
        }),
      });
      console.log('API: Response status:', response.status);
      console.log(
        'API: Response headers:',
        Object.fromEntries(response.headers.entries())
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error('API: Error response:', errorText);
        throw new Error(
          `Failed to add to calendar (HTTP ${response.status}): ${errorText}`
        );
      }

      const result = await response.json();
      console.log('API: Success response:', result);
      return result;
    } catch (error) {
      console.error('API: Network or parsing error:', error);
      throw error;
    }
  },

  removeFromCalendar: async (userId: number, pairingId: number) => {
    const response = await fetch('/api/calendar', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, pairingId }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to remove from calendar: ${errorText}`);
    }
    return response.json();
  },

  getFavorites: async (userId: number): Promise<Pairing[]> => {
    const response = await apiRequest('GET', `/api/favorites/${userId}`);
    return response.json();
  },

  // History
  getBidHistory: async (pairingNumber: string) => {
    const response = await apiRequest('GET', `/api/history/${pairingNumber}`);
    return response.json();
  },

  // AI Chat Analysis
  async analyzePairings(question: string, bidPackageId?: number, sessionId?: string) {
    // Include bidPackageId and seniority context automatically
    let seniorityFromLocal: string | null = null;
    let nameFromLocal: string | null = null;
    try {
      if (typeof window !== 'undefined') {
        seniorityFromLocal = localStorage.getItem('seniorityPercentile');
        nameFromLocal = localStorage.getItem('name');
      }
    } catch {
      // Ignore localStorage errors
    }

    const prefixParts: string[] = [];

    // Add name if available
    if (nameFromLocal) {
      prefixParts.push(`Pilot: ${nameFromLocal}`);
    }

    // Add seniority
    if (seniorityFromLocal) {
      prefixParts.push(`Seniority: ${seniorityFromLocal}%`);
    }

    // Add bid package with full details
    if (bidPackageId) {
      try {
        const bidPackages = await this.getBidPackages();
        const currentPackage = bidPackages.find(pkg => pkg.id === bidPackageId);
        if (currentPackage) {
          const pkgDisplay = `${currentPackage.base} ${currentPackage.aircraft} ${currentPackage.month} ${currentPackage.year}`;
          prefixParts.push(`Current Bid Package: ${pkgDisplay}`);
        } else {
          prefixParts.push(`Bid package #${bidPackageId}`);
        }
      } catch {
        prefixParts.push(`Bid package #${bidPackageId}`);
      }
    }

    const contextualQuestion = prefixParts.length
      ? `${prefixParts.join(' | ')}: ${question}`
      : question;

    const response = await fetch('/api/askAssistant', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        question: contextualQuestion,
        bidPackageId,
        seniorityPercentile: seniorityFromLocal
          ? parseFloat(seniorityFromLocal)
          : undefined,
        sessionId,
      }),
    });

    if (!response.ok) {
      throw new Error('Failed to get response from PBS Assistant');
    }

    const result = await response.json();
    return {
      response: result.reply,
      data: result.data || null,
    };
  },

  // Chat History
  async getChatHistory(sessionId: string) {
    const response = await apiRequest('GET', `/api/chat-history/${sessionId}`);
    return response.json();
  },

  async saveChatMessage(data: {
    sessionId: string;
    bidPackageId?: number;
    messageType: 'user' | 'assistant';
    content: string;
    messageData?: any;
  }) {
    const response = await apiRequest('POST', '/api/chat-history', data);
    return response.json();
  },

  async clearChatHistory(sessionId: string) {
    const response = await apiRequest(
      'DELETE',
      `/api/chat-history/${sessionId}`
    );
    return response.json();
  },
};
