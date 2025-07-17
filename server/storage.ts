import { 
  users, 
  bidPackages, 
  pairings, 
  bidHistory, 
  userFavorites,
  type User, 
  type InsertUser,
  type BidPackage,
  type InsertBidPackage,
  type Pairing,
  type InsertPairing,
  type BidHistory,
  type InsertBidHistory,
  type UserFavorite,
  type InsertUserFavorite
} from "@shared/schema";
import { db } from "./db";
import { eq, and, desc, asc, like, gte, lte } from "drizzle-orm";

export interface IStorage {
  // User operations
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  getUserBySeniority(seniorityNumber: number): Promise<User | undefined>;

  // Bid Package operations
  createBidPackage(bidPackage: InsertBidPackage): Promise<BidPackage>;
  getBidPackages(): Promise<BidPackage[]>;
  getBidPackage(id: number): Promise<BidPackage | undefined>;
  updateBidPackageStatus(id: number, status: string): Promise<void>;
  clearAllData(): Promise<void>;

  // Pairing operations
  createPairing(pairing: InsertPairing): Promise<Pairing>;
  getPairings(bidPackageId?: number): Promise<Pairing[]>;
  getPairing(id: number): Promise<Pairing | undefined>;
  searchPairings(filters: {
    bidPackageId?: number;
    search?: string;
    creditMin?: number;
    creditMax?: number;
    blockMin?: number;
    blockMax?: number;
    tafb?: string;
    holdProbabilityMin?: number;
	pairingDays?: number;
	pairingDaysMin?: number;
	pairingDaysMax?: number;
  }): Promise<Pairing[]>;

  // Bid History operations
  createBidHistory(bidHistory: InsertBidHistory): Promise<BidHistory>;
  getBidHistoryForPairing(pairingNumber: string): Promise<BidHistory[]>;

  // User Favorites operations
  addUserFavorite(favorite: InsertUserFavorite): Promise<UserFavorite>;
  removeUserFavorite(userId: number, pairingId: number): Promise<void>;
  getUserFavorites(userId: number): Promise<Pairing[]>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    // This method is kept for compatibility but not used in PBS app
    return undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(insertUser)
      .returning();
    return user;
  }

  async getUserBySeniority(seniorityNumber: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.seniorityNumber, seniorityNumber));
    return user || undefined;
  }

  async createBidPackage(bidPackage: InsertBidPackage): Promise<BidPackage> {
    const [newBidPackage] = await db
      .insert(bidPackages)
      .values(bidPackage)
      .returning();
    return newBidPackage;
  }

  async getBidPackages(): Promise<BidPackage[]> {
    return await db.select().from(bidPackages).orderBy(desc(bidPackages.uploadedAt));
  }

  async getBidPackage(id: number): Promise<BidPackage | undefined> {
    const [bidPackage] = await db.select().from(bidPackages).where(eq(bidPackages.id, id));
    return bidPackage || undefined;
  }

  async updateBidPackageStatus(id: number, status: string): Promise<void> {
    await db.update(bidPackages)
      .set({ status })
      .where(eq(bidPackages.id, id));
  }

  async clearAllData(): Promise<void> {
    // Clear all data in the correct order to avoid foreign key constraints
    await db.delete(userFavorites);
    await db.delete(bidHistory);
    await db.delete(pairings);
    await db.delete(bidPackages);
    console.log('All data cleared from database');
  }

  async createPairing(pairing: InsertPairing): Promise<Pairing> {
    const [newPairing] = await db
      .insert(pairings)
      .values(pairing)
      .returning();
    return newPairing;
  }

  async getPairings(bidPackageId?: number): Promise<Pairing[]> {
    if (bidPackageId) {
      return await db.select().from(pairings)
        .where(eq(pairings.bidPackageId, bidPackageId))
        .orderBy(asc(pairings.pairingNumber));
    }
    return await db.select().from(pairings).orderBy(asc(pairings.pairingNumber));
  }

  async getPairing(id: number): Promise<Pairing | undefined> {
    const [pairing] = await db.select().from(pairings).where(eq(pairings.id, id));
    return pairing || undefined;
  }

  async searchPairings(filters: {
    bidPackageId?: number;
    search?: string;
    creditMin?: number;
    creditMax?: number;
    blockMin?: number;
    blockMax?: number;
    tafb?: string;
    holdProbabilityMin?: number;
	pairingDays?: number;
	pairingDaysMin?: number;
	pairingDaysMax?: number;
  }): Promise<Pairing[]> {
    const conditions = [];

    if (filters.bidPackageId) {
      conditions.push(eq(pairings.bidPackageId, filters.bidPackageId));
    }

    if (filters.search) {
      conditions.push(like(pairings.route, `%${filters.search}%`));
    }

    if (filters.creditMin) {
      conditions.push(gte(pairings.creditHours, filters.creditMin.toString()));
    }

    if (filters.creditMax) {
      conditions.push(lte(pairings.creditHours, filters.creditMax.toString()));
    }

    if (filters.holdProbabilityMin) {
      conditions.push(gte(pairings.holdProbability, filters.holdProbabilityMin));
    }

	if (filters.pairingDays) {
      conditions.push(eq(pairings.pairingDays, filters.pairingDays));
    }

    if (filters.pairingDaysMin) {
      conditions.push(gte(pairings.pairingDays, filters.pairingDaysMin));
    }

    if (filters.pairingDaysMax) {
      conditions.push(lte(pairings.pairingDays, filters.pairingDaysMax));
    }

    if (conditions.length > 0) {
      return await db.select().from(pairings)
        .where(and(...conditions))
        .orderBy(asc(pairings.pairingNumber));
    }

    return await db.select().from(pairings).orderBy(asc(pairings.pairingNumber));
  }

  async createBidHistory(bidHistoryData: InsertBidHistory): Promise<BidHistory> {
    const [newBidHistory] = await db
      .insert(bidHistory)
      .values(bidHistoryData)
      .returning();
    return newBidHistory;
  }

  async getBidHistoryForPairing(pairingNumber: string): Promise<BidHistory[]> {
    return await db.select().from(bidHistory)
      .where(eq(bidHistory.pairingNumber, pairingNumber))
      .orderBy(desc(bidHistory.awardedAt));
  }

  async addUserFavorite(favorite: InsertUserFavorite): Promise<UserFavorite> {
    const [newFavorite] = await db
      .insert(userFavorites)
      .values(favorite)
      .returning();
    return newFavorite;
  }

  async removeUserFavorite(userId: number, pairingId: number): Promise<void> {
    await db.delete(userFavorites)
      .where(
        and(
          eq(userFavorites.userId, userId),
          eq(userFavorites.pairingId, pairingId)
        )
      );
  }

  async getUserFavorites(userId: number): Promise<Pairing[]> {
    const result = await db
      .select({
        pairing: pairings,
      })
      .from(userFavorites)
      .innerJoin(pairings, eq(userFavorites.pairingId, pairings.id))
      .where(eq(userFavorites.userId, userId));

    return result.map(r => r.pairing);
  }
}

export const storage = new DatabaseStorage();