import { apiRequest } from './queryClient';

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
  // Pagination and sorting
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

// Add this type for the new response format
interface PaginatedResponse<T> {
  pairings: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
  statistics?: {
    likelyToHold: number;
    highCredit: number;
  };
}

const API_BASE = ''; // Assuming API_BASE is defined elsewhere or is an empty string for local context.

export const api = {
  // Bid packages
  getBidPackages: async (): Promise<BidPackage[]> => {
    const response = await apiRequest('GET', '/api/bid-packages');
    return response.json();
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
  getPairings: async (bidPackageId?: number): Promise<Pairing[]> => {
    try {
      const url = bidPackageId
        ? `/api/pairings?bidPackageId=${bidPackageId}`
        : '/api/pairings';
      const response = await apiRequest('GET', url);
      const data = await response.json();
      return Array.isArray(data) ? data : [];
    } catch (error) {
      console.error('Error fetching pairings:', error);
      return [];
    }
  },

  searchPairings: async (
    filters: SearchFilters
  ): Promise<PaginatedResponse<Pairing>> => {
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

      // Handle new paginated response format
      if (data && data.pairings && data.pagination) {
        return data;
      }

      // Fallback for old format (array)
      return {
        pairings: Array.isArray(data) ? data : [],
        pagination: {
          page: 1,
          limit: data.length || 0,
          total: data.length || 0,
          totalPages: 1,
          hasNext: false,
          hasPrev: false,
        },
      };
    } catch (error) {
      console.error('Error searching pairings:', error);
      return {
        pairings: [],
        pagination: {
          page: 1,
          limit: 0,
          total: 0,
          totalPages: 0,
          hasNext: false,
          hasPrev: false,
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

    if (!response.ok) {
      const errorText = await response.text();
      console.error('API: Error response:', errorText);
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const result = await response.json();
    console.log('API: Success response:', result);
    return result;
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
  async analyzePairings(question: string, bidPackageId?: number) {
    // Include bidPackageId in the question context if provided
    const contextualQuestion = bidPackageId
      ? `Analyzing bid package #${bidPackageId}: ${question}`
      : question;

    const response = await fetch('/api/askAssistant', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ question: contextualQuestion }),
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
