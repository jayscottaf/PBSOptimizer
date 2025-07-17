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
  blockMax?: number;
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
    const url = bidPackageId ? `/api/pairings?bidPackageId=${bidPackageId}` : "/api/pairings";
    const response = await apiRequest("GET", url);
    return response.json();
  },

  searchPairings: async (filters: SearchFilters): Promise<Pairing[]> => {
    const response = await apiRequest("POST", "/api/pairings/search", filters);
    return response.json();
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
    const response = await apiRequest("POST", "/api/favorites", { userId, pairingId });
    return response.json();
  },

  removeFavorite: async (userId: number, pairingId: number) => {
    const response = await apiRequest("DELETE", "/api/favorites", { userId, pairingId });
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
  analyzePairings: async (message: string, bidPackageId?: number) => {
    const response = await apiRequest("POST", "/api/chat/analyze", { 
      message, 
      bidPackageId 
    });
    return response.json();
  },
};
