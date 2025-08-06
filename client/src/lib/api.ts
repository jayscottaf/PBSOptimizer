import { apiRequest } from "./queryClient";

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
}

export interface SearchFilters {
  bidPackageId?: number;
  search?: string;
  creditMin?: number;
  creditMax?: number;
  blockMin?: number;
  tafb?: string;
  holdProbabilityMin?: number;
}

export const api = {
  // Bid packages
  getBidPackages: async (): Promise<BidPackage[]> => {
    const response = await apiRequest("GET", "/api/bid-packages");
    return response.json();
  },

  uploadBidPackage: async (file: File, data: {
    name: string;
    month: string;
    year: number;
    base: string;
    aircraft: string;
  }) => {
    const formData = new FormData();
    formData.append("bidPackage", file);
    formData.append("name", data.name);
    formData.append("month", data.month);
    formData.append("year", data.year.toString());
    formData.append("base", data.base);
    formData.append("aircraft", data.aircraft);

    const response = await fetch("/api/upload", {
      method: "POST",
      body: formData,
      credentials: "include",
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
      const url = bidPackageId ? `/api/pairings?bidPackageId=${bidPackageId}` : "/api/pairings";
      const response = await apiRequest("GET", url);
      const data = await response.json();
      return Array.isArray(data) ? data : [];
    } catch (error) {
      console.error("Error fetching pairings:", error);
      return [];
    }
  },

  searchPairings: async (filters: SearchFilters): Promise<Pairing[]> => {
    try {
      const response = await apiRequest("POST", "/api/pairings/search", filters);
      const data = await response.json();
      return Array.isArray(data) ? data : [];
    } catch (error) {
      console.error("Error searching pairings:", error);
      return [];
    }
  },

  getPairing: async (id: number): Promise<Pairing> => {
    const response = await apiRequest("GET", `/api/pairings/${id}`);
    return response.json();
  },

  // User
  createOrUpdateUser: async (data: {
    seniorityNumber: number;
    base: string;
    aircraft: string;
  }) => {
    const response = await apiRequest("POST", "/api/user", data);
    return response.json();
  },

  // Favorites
  addFavorite: async (userId: number, pairingId: number) => {
    const response = await fetch('/api/favorites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, pairingId }),
    });
    if (!response.ok) throw new Error('Failed to add favorite');
    return response.json();
  },

  removeFavorite: async (userId: number, pairingId: number) => {
    const response = await fetch('/api/favorites', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, pairingId }),
    });
    if (!response.ok) throw new Error('Failed to remove favorite');
    return response.json();
  },

  addToCalendar: async (userId: number, pairingId: number, startDate: Date, endDate: Date) => {
    const response = await fetch('/api/calendar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId,
        pairingId,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString()
      }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to add to calendar: ${errorText}`);
    }
    return response.json();
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
    const response = await apiRequest("GET", `/api/favorites/${userId}`);
    return response.json();
  },

  // History
  getBidHistory: async (pairingNumber: string) => {
    const response = await apiRequest("GET", `/api/history/${pairingNumber}`);
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
      data: result.data || null
    };
  },

  // Chat History
  async getChatHistory(sessionId: string) {
    const response = await apiRequest("GET", `/api/chat-history/${sessionId}`);
    return response.json();
  },

  async saveChatMessage(data: {
    sessionId: string;
    bidPackageId?: number;
    messageType: 'user' | 'assistant';
    content: string;
    messageData?: any;
  }) {
    const response = await apiRequest("POST", "/api/chat-history", data);
    return response.json();
  },

  async clearChatHistory(sessionId: string) {
    const response = await apiRequest("DELETE", `/api/chat-history/${sessionId}`);
    return response.json();
  },
};