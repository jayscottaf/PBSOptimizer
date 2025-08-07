import {
  users,
  bidPackages,
  pairings,
  bidHistory,
  userFavorites,
  chatHistory,
  userCalendarEvents,
  type User,
  type InsertUser,
  type BidPackage,
  type InsertBidPackage,
  type Pairing,
  type InsertPairing,
  type BidHistory,
  type InsertBidHistory,
  type UserFavorite,
  type InsertUserFavorite,
  type ChatMessage,
  type UserCalendarEvent,
  type InsertUserCalendarEvent
} from "@shared/schema";
import { db } from "./db";
import { eq, and, desc, asc, like, gte, lte, or, sql } from "drizzle-orm";

export interface IStorage {
  // User operations
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  createOrUpdateUser(userData: { seniorityNumber: number; seniorityPercentile?: number; base: string; aircraft: string }): Promise<User>;
  getUserBySeniority(seniorityNumber: number): Promise<User | undefined>;

  // Bid Package operations
  createBidPackage(bidPackage: InsertBidPackage): Promise<BidPackage>;
  getBidPackages(): Promise<BidPackage[]>;
  getBidPackage(id: number): Promise<BidPackage | undefined>;
  updateBidPackageStatus(id: number, status: string): Promise<void>;
  deleteBidPackage(id: number): Promise<void>;
  clearAllData(): Promise<void>;

  // Pairing operations
  createPairing(pairing: InsertPairing): Promise<Pairing>;
  getPairings(bidPackageId?: number): Promise<Pairing[]>;
  getPairing(id: number): Promise<Pairing | undefined>;
  getPairingByNumber(pairingNumber: string, bidPackageId?: number): Promise<Pairing | undefined>;
  searchPairings(filters: {
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
        efficiency?: number; // Added for efficiency filter
  }): Promise<Pairing[]>;

  // Bid History operations
  createBidHistory(bidHistory: InsertBidHistory): Promise<BidHistory>;
  getBidHistoryForPairing(pairingNumber: string): Promise<BidHistory[]>;

  // User favorites
  addUserFavorite(favorite: InsertUserFavorite): Promise<UserFavorite>;
  removeUserFavorite(userId: number, pairingId: number): Promise<void>;
  getUserFavorites(userId: number): Promise<Pairing[]>;

  // Chat history
  saveChatMessage(message: InsertChatHistory): Promise<ChatMessage>;
  getChatHistory(sessionId: string): Promise<ChatMessage[]>;
  clearChatHistory(sessionId: string): Promise<void>;

  // Calendar events
  addUserCalendarEvent(event: InsertUserCalendarEvent): Promise<UserCalendarEvent>;
  removeUserCalendarEvent(userId: number, pairingId: number): Promise<void>;
  getUserCalendarEvents(userId: number): Promise<(UserCalendarEvent & { pairing: Pairing })[]>;
  getUserCalendarEventsForMonth(userId: number, month: number, year: number): Promise<(UserCalendarEvent & { pairing: Pairing })[]>;
  getUserCalendarEventsInRange(userId: number, startDate: Date, endDate: Date): Promise<(UserCalendarEvent & { pairing: Pairing })[]>;
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

  async createOrUpdateUser(userData: { seniorityNumber: number; seniorityPercentile?: number; base: string; aircraft: string }): Promise<User> {
    const existingUser = await this.getUserBySeniority(userData.seniorityNumber);

    if (existingUser) {
      // Update existing user
      const [updatedUser] = await db
        .update(users)
        .set({
          base: userData.base,
          aircraft: userData.aircraft,
          seniorityPercentile: userData.seniorityPercentile || existingUser.seniorityPercentile,
          updatedAt: new Date()
        })
        .where(eq(users.seniorityNumber, userData.seniorityNumber))
        .returning();
      return updatedUser;
    } else {
      // Create new user
      return await this.createUser({
        seniorityNumber: userData.seniorityNumber,
        base: userData.base,
        aircraft: userData.aircraft,
        seniorityPercentile: userData.seniorityPercentile || 50 // Default to 50 if not provided
      });
    }
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

  async deleteBidPackage(id: number): Promise<void> {
    // Delete associated data in the correct order (foreign key constraints)
    await db.delete(chatHistory).where(eq(chatHistory.bidPackageId, id));
    await db.delete(userFavorites).where(
      eq(userFavorites.pairingId,
        db.select({ id: pairings.id }).from(pairings).where(eq(pairings.bidPackageId, id))
      )
    );
    await db.delete(pairings).where(eq(pairings.bidPackageId, id));
    await db.delete(bidPackages).where(eq(bidPackages.id, id));
    console.log(`Deleted bid package ${id} and all associated data`);
  }

  async clearAllData(): Promise<void> {
    await db.delete(chatHistory);
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

  async getPairingByNumber(pairingNumber: string, bidPackageId?: number): Promise<Pairing | undefined> {
    let whereConditions = [eq(pairings.pairingNumber, pairingNumber)];

    if (bidPackageId) {
      whereConditions.push(eq(pairings.bidPackageId, bidPackageId));
    }

    const [pairing] = await db.select().from(pairings).where(and(...whereConditions));
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
    tafbMin?: number;
    tafbMax?: number;
    holdProbabilityMin?: number;
        pairingDays?: number;
        pairingDaysMin?: number;
        pairingDaysMax?: number;
        efficiency?: number; // Added for efficiency filter
  }): Promise<Pairing[]> {
    try {
      const conditions = [];

      // Always require bidPackageId for safety
      if (!filters.bidPackageId) {
        console.error("Bid package ID is required for pairing search");
        return [];
      }

      conditions.push(eq(pairings.bidPackageId, filters.bidPackageId));

    if (filters.search) {
      conditions.push(
        or(
          like(pairings.route, `%${filters.search}%`),
          like(pairings.pairingNumber, `%${filters.search}%`),
          like(pairings.effectiveDates, `%${filters.search}%`),
          like(pairings.fullTextBlock, `%${filters.search}%`)
        )
      );
    }

    if (filters.creditMin !== undefined) {
      conditions.push(sql`CAST(${pairings.creditHours} AS DECIMAL) >= ${filters.creditMin}`);
    }

    if (filters.creditMax !== undefined) {
      conditions.push(sql`CAST(${pairings.creditHours} AS DECIMAL) <= ${filters.creditMax}`);
    }

    if (filters.blockMin !== undefined) {
      conditions.push(gte(pairings.blockHours, filters.blockMin.toString()));
    }

    if (filters.blockMax !== undefined) {
      conditions.push(lte(pairings.blockHours, filters.blockMax.toString()));
    }

    if (filters.holdProbabilityMin !== undefined) {
      conditions.push(gte(pairings.holdProbability, filters.holdProbabilityMin));
    }

    if (filters.pairingDays !== undefined) {
      conditions.push(eq(pairings.pairingDays, filters.pairingDays));
    }

    if (filters.pairingDaysMin !== undefined) {
      conditions.push(gte(pairings.pairingDays, filters.pairingDaysMin));
    }

    if (filters.pairingDaysMax !== undefined) {
      conditions.push(lte(pairings.pairingDays, filters.pairingDaysMax));
    }

    // TAFB filter (decimal hours format)
    if (filters.tafbMin !== undefined) {
      conditions.push(gte(pairings.tafb, filters.tafbMin.toString()));
    }
    if (filters.tafbMax !== undefined) {
      conditions.push(lte(pairings.tafb, filters.tafbMax.toString()));
    }

    if (conditions.length > 0) {
        let results = await db.select().from(pairings)
          .where(and(...conditions))
          .orderBy(asc(pairings.pairingNumber));

        // Apply efficiency filter (credit/block ratio) after database query
        if (filters.efficiency !== undefined) {
          results = results.filter(pairing => {
            const creditHours = parseFloat(pairing.creditHours.toString());
            const blockHours = parseFloat(pairing.blockHours.toString());
            const efficiency = blockHours > 0 ? creditHours / blockHours : 0;
            return efficiency >= filters.efficiency;
          });
        }

        return results;
      }

      return await db.select().from(pairings).orderBy(asc(pairings.pairingNumber));
    } catch (error) {
      console.error("Error in searchPairings:", error);
      return [];
    }
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

  // Chat history methods
  async saveChatMessage(message: InsertChatHistory): Promise<ChatHistory> {
    const [savedMessage] = await db.insert(chatHistory).values(message).returning();
    return savedMessage;
  }

  async getChatHistory(sessionId: string): Promise<ChatHistory[]> {
    return await db
      .select()
      .from(chatHistory)
      .where(eq(chatHistory.sessionId, sessionId))
      .orderBy(asc(chatHistory.createdAt));
  }

  async clearChatHistory(sessionId: string): Promise<void> {
    await db.delete(chatHistory).where(eq(chatHistory.sessionId, sessionId));
  }

  // Enhanced analytics operations for OpenAI token optimization
  async getTopEfficientPairings(bidPackageId: number, limit: number = 20): Promise<{ pairings: Pairing[], stats: any }> {
    const allPairings = await db
      .select()
      .from(pairings)
      .where(eq(pairings.bidPackageId, bidPackageId));

    // Helper function to parse Delta PBS hours format (handles both string and number)
    const parseHours = (hours: any): number => {
      if (typeof hours === 'number') return hours;
      if (typeof hours === 'string') {
        // Handle Delta PBS format like "5.28" or "21.49"
        return parseFloat(hours) || 0;
      }
      return 0;
    };

    // Calculate efficiency (credit hours / block hours ratio)
    const pairingsWithEfficiency = allPairings.map(p => {
      const creditHours = parseHours(p.creditHours);
      const blockHours = parseHours(p.blockHours);
      return {
        ...p,
        creditHours,
        blockHours,
        efficiency: blockHours > 0 ? creditHours / blockHours : 0
      };
    });

    // Sort by efficiency descending
    const topPairings = pairingsWithEfficiency
      .sort((a, b) => b.efficiency - a.efficiency)
      .slice(0, limit);

    const stats = {
      totalPairings: allPairings.length,
      avgEfficiency: Number((pairingsWithEfficiency.reduce((sum, p) => sum + p.efficiency, 0) / pairingsWithEfficiency.length).toFixed(2)),
      topEfficiency: Number((topPairings[0]?.efficiency || 0).toFixed(2)),
      avgCredit: Number((pairingsWithEfficiency.reduce((sum, p) => sum + p.creditHours, 0) / pairingsWithEfficiency.length).toFixed(2)),
      avgBlock: Number((pairingsWithEfficiency.reduce((sum, p) => sum + p.blockHours, 0) / pairingsWithEfficiency.length).toFixed(2))
    };

    return { pairings: topPairings, stats };
  }

  async getTopCreditPairings(bidPackageId: number, limit: number = 20): Promise<{ pairings: Pairing[], stats: any }> {
    const topPairings = await db
      .select()
      .from(pairings)
      .where(eq(pairings.bidPackageId, bidPackageId))
      .orderBy(desc(pairings.creditHours))
      .limit(limit);

    const allPairings = await db
      .select()
      .from(pairings)
      .where(eq(pairings.bidPackageId, bidPackageId));

    const stats = {
      totalPairings: allPairings.length,
      maxCredit: topPairings[0]?.creditHours || 0,
      avgCredit: allPairings.reduce((sum, p) => sum + p.creditHours, 0) / allPairings.length,
      minCredit: Math.min(...allPairings.map(p => p.creditHours))
    };

    return { pairings: topPairings, stats };
  }

  async getBidPackageStats(bidPackageId: number): Promise<{
    totalPairings: number;
    creditBlockRatios: {
      min: number;
      max: number;
      average: number;
    };
    creditHours: {
      min: number;
      max: number;
      average: number;
    };
    blockHours: {
      min: number;
      max: number;
      average: number;
    };
  }> {
    const allPairings = await db
      .select()
      .from(pairings)
      .where(eq(pairings.bidPackageId, bidPackageId));

    if (allPairings.length === 0) {
      return {
        totalPairings: 0,
        creditBlockRatios: { min: 1.0, max: 1.0, average: 1.0 },
        creditHours: { min: 0, max: 0, average: 0 },
        blockHours: { min: 0, max: 0, average: 0 }
      };
    }

    // Calculate C/B ratios for all pairings
    const ratios = allPairings
      .filter(p => p.blockHours > 0) // Avoid division by zero
      .map(p => p.creditHours / p.blockHours);

    const creditHours = allPairings.map(p => p.creditHours);
    const blockHours = allPairings.map(p => p.blockHours);

    return {
      totalPairings: allPairings.length,
      creditBlockRatios: {
        min: Math.min(...ratios),
        max: Math.max(...ratios),
        average: ratios.reduce((sum, ratio) => sum + ratio, 0) / ratios.length
      },
      creditHours: {
        min: Math.min(...creditHours),
        max: Math.max(...creditHours),
        average: creditHours.reduce((sum, hours) => sum + hours, 0) / creditHours.length
      },
      blockHours: {
        min: Math.min(...blockHours),
        max: Math.max(...blockHours),
        average: blockHours.reduce((sum, hours) => sum + hours, 0) / blockHours.length
      }
    };
  }

  async getTopHoldProbabilityPairings(bidPackageId: number, limit: number = 20): Promise<{ pairings: Pairing[], stats: any }> {
    const topPairings = await db
      .select()
      .from(pairings)
      .where(eq(pairings.bidPackageId, bidPackageId))
      .orderBy(desc(pairings.holdProbability))
      .limit(limit);

    const allPairings = await db
      .select()
      .from(pairings)
      .where(eq(pairings.bidPackageId, bidPackageId));

    const stats = {
      totalPairings: allPairings.length,
      maxHold: topPairings[0]?.holdProbability || 0,
      avgHold: allPairings.reduce((sum, p) => sum + (p.holdProbability || 0), 0) / allPairings.length,
      highHoldCount: allPairings.filter(p => (p.holdProbability || 0) >= 80).length
    };

    return { pairings: topPairings, stats };
  }

  async getPairingStatsSummary(bidPackageId: number): Promise<any> {
    const allPairings = await db
      .select()
      .from(pairings)
      .where(eq(pairings.bidPackageId, bidPackageId));

    const turnCount = allPairings.filter(p => p.pairingDays === 1).length;
    const multiDayCount = allPairings.filter(p => p.pairingDays > 1).length;
    const deadheadCount = allPairings.filter(p =>
      p.fullText?.includes('DH') ||
      p.fullTextBlock?.includes('DH') ||
      (p.flightSegments && Array.isArray(p.flightSegments) &&
       p.flightSegments.some((seg: any) => seg.isDeadhead === true))
    ).length;

    return {
      totalPairings: allPairings.length,
      avgCreditHours: allPairings.reduce((sum, p) => sum + p.creditHours, 0) / allPairings.length,
      avgBlockHours: allPairings.reduce((sum, p) => sum + p.blockHours, 0) / allPairings.length,
      avgPairingDays: allPairings.reduce((sum, p) => sum + p.pairingDays, 0) / allPairings.length,
      avgHoldProbability: allPairings.reduce((sum, p) => sum + (p.holdProbability || 0), 0) / allPairings.length,
      maxCreditHours: Math.max(...allPairings.map(p => p.creditHours)),
      minCreditHours: Math.min(...allPairings.map(p => p.creditHours)),
      maxBlockHours: Math.max(...allPairings.map(p => p.blockHours)),
      turnCount,
      multiDayCount,
      deadheadCount,
      dayDistribution: {
        '1day': allPairings.filter(p => p.pairingDays === 1).length,
        '2day': allPairings.filter(p => p.pairingDays === 2).length,
        '3day': allPairings.filter(p => p.pairingDays === 3).length,
        '4day': allPairings.filter(p => p.pairingDays === 4).length,
        '5day+': allPairings.filter(p => p.pairingDays >= 5).length,
      }
    };
  }

  async analyzePairingsByLayoverSummary(bidPackageId: number, city?: string): Promise<any> {
    const allPairings = await db
      .select()
      .from(pairings)
      .where(eq(pairings.bidPackageId, bidPackageId));

    const layoverAnalysis = allPairings.reduce((acc, p) => {
      if (p.layovers && Array.isArray(p.layovers)) {
        p.layovers.forEach((layover: any) => {
          if (!city || layover.city === city) {
            if (!acc[layover.city]) {
              acc[layover.city] = { count: 0, totalDuration: 0, pairings: [] };
            }
            acc[layover.city].count++;
            acc[layover.city].totalDuration += layover.duration || 0;
            acc[layover.city].pairings.push(p.pairingNumber);
          }
        });
      }
      return acc;
    }, {} as any);

    // Convert to summary format
    const summary = Object.entries(layoverAnalysis).map(([city, data]: [string, any]) => ({
      city,
      count: data.count,
      avgDuration: data.totalDuration / data.count,
      pairings: data.pairings.slice(0, 10) // Limit to first 10 pairings
    })).sort((a, b) => b.count - a.count);

    return {
      totalLayovers: Object.values(layoverAnalysis).reduce((sum: number, data: any) => sum + data.count, 0),
      uniqueCities: Object.keys(layoverAnalysis).length,
      topCities: summary.slice(0, 10),
      requestedCity: city ? layoverAnalysis[city] : null
    };
  }

  async getDeadheadAnalysis(bidPackageId: number): Promise<any> {
    const allPairings = await db
      .select()
      .from(pairings)
      .where(eq(pairings.bidPackageId, bidPackageId));

    const deadheadPairings = allPairings.filter(p =>
      p.fullText?.includes('DH') ||
      p.fullTextBlock?.includes('DH') ||
      (p.flightSegments && Array.isArray(p.flightSegments) &&
       p.flightSegments.some((seg: any) => seg.isDeadhead === true))
    );
    const nonDeadheadPairings = allPairings.filter(p =>
      !(p.fullText?.includes('DH') ||
        p.fullTextBlock?.includes('DH') ||
        (p.flightSegments && Array.isArray(p.flightSegments) &&
         p.flightSegments.some((seg: any) => seg.isDeadhead === true)))
    );

    return {
      totalPairings: allPairings.length,
      deadheadCount: deadheadPairings.length,
      deadheadPercentage: (deadheadPairings.length / allPairings.length) * 100,
      avgCreditWithDeadhead: deadheadPairings.reduce((sum, p) => sum + p.creditHours, 0) / deadheadPairings.length,
      avgCreditWithoutDeadhead: nonDeadheadPairings.reduce((sum, p) => sum + p.creditHours, 0) / nonDeadheadPairings.length,
      topDeadheadPairings: deadheadPairings
        .sort((a, b) => b.creditHours - a.creditHours)
        .slice(0, 10)
        .map(p => ({ pairingNumber: p.pairingNumber, creditHours: p.creditHours, blockHours: p.blockHours }))
    };
  }

  async getPairingDurationAnalysis(bidPackageId: number): Promise<any> {
    const allPairings = await db
      .select()
      .from(pairings)
      .where(eq(pairings.bidPackageId, bidPackageId));

    const durationGroups = allPairings.reduce((acc, p) => {
      const key = `${p.pairingDays}day`;
      if (!acc[key]) {
        acc[key] = { count: 0, totalCredit: 0, totalBlock: 0, pairings: [] };
      }
      acc[key].count++;
      acc[key].totalCredit += p.creditHours;
      acc[key].totalBlock += p.blockHours;
      acc[key].pairings.push({
        pairingNumber: p.pairingNumber,
        creditHours: p.creditHours,
        blockHours: p.blockHours,
        holdProbability: p.holdProbability
      });
      return acc;
    }, {} as any);

    // Calculate averages and sort pairings
    Object.values(durationGroups).forEach((group: any) => {
      group.avgCredit = group.totalCredit / group.count;
      group.avgBlock = group.totalBlock / group.count;
      group.pairings = group.pairings.sort((a: any, b: any) => b.creditHours - a.creditHours).slice(0, 10);
    });

    return {
      totalPairings: allPairings.length,
      durationBreakdown: durationGroups,
      mostCommonDuration: Object.entries(durationGroups).sort(([,a]: [string, any], [,b]: [string, any]) => b.count - a.count)[0]?.[0],
      avgDuration: allPairings.reduce((sum, p) => sum + p.pairingDays, 0) / allPairings.length
    };
  }

  // Calendar event methods
  async addUserCalendarEvent(data: { userId: number; pairingId: number; startDate: Date; endDate: Date; notes?: string }): Promise<UserCalendarEvent> {
    // Check if this user already has a calendar event for this pairing
    const existing = await db
      .select()
      .from(userCalendarEvents)
      .where(
        and(
          eq(userCalendarEvents.userId, data.userId),
          eq(userCalendarEvents.pairingId, data.pairingId)
        )
      );

    if (existing.length > 0) {
      console.log('Calendar event already exists, returning existing:', existing[0]);
      return existing[0];
    }

    const [result] = await db
      .insert(userCalendarEvents)
      .values(data)
      .returning();

    console.log('Added new calendar event:', result);
    return result;
  }

  async removeUserCalendarEvent(userId: number, pairingId: number): Promise<void> {
    await db.delete(userCalendarEvents)
      .where(
        and(
          eq(userCalendarEvents.userId, userId),
          eq(userCalendarEvents.pairingId, pairingId)
        )
      );
  }

  async getUserCalendarEvents(userId: number): Promise<(UserCalendarEvent & { pairing: Pairing })[]> {
    const result = await db
      .select({
        calendarEvent: userCalendarEvents,
        pairing: pairings,
      })
      .from(userCalendarEvents)
      .innerJoin(pairings, eq(userCalendarEvents.pairingId, pairings.id))
      .where(eq(userCalendarEvents.userId, userId))
      .orderBy(asc(userCalendarEvents.startDate));

    return result.map(r => ({ ...r.calendarEvent, pairing: r.pairing }));
  }

  async getUserCalendarEventsForMonth(userId: number, month: number, year: number): Promise<(UserCalendarEvent & { pairing: Pairing })[]> {
    const startDate = new Date(year, month - 1, 1); // month is 1-based, Date constructor expects 0-based
    const endDate = new Date(year, month, 0, 23, 59, 59); // Last day of month

    // Get events that have ANY overlap with the requested month (including carryover pairings)
    const result = await db
      .select({
        calendarEvent: userCalendarEvents,
        pairing: pairings,
      })
      .from(userCalendarEvents)
      .innerJoin(pairings, eq(userCalendarEvents.pairingId, pairings.id))
      .where(
        and(
          eq(userCalendarEvents.userId, userId),
          // Event overlaps with month if: event_start <= month_end AND event_end >= month_start
          lte(userCalendarEvents.startDate, endDate),
          gte(userCalendarEvents.endDate, startDate)
        )
      )
      .orderBy(asc(userCalendarEvents.startDate));

    return result.map(r => ({ ...r.calendarEvent, pairing: r.pairing }));
  }

  async getUserCalendarEventsInRange(userId: number, startDate: Date, endDate: Date): Promise<(UserCalendarEvent & { pairing: Pairing })[]> {
    const result = await db
      .select({
        calendarEvent: userCalendarEvents,
        pairing: pairings,
      })
      .from(userCalendarEvents)
      .innerJoin(pairings, eq(userCalendarEvents.pairingId, pairings.id))
      .where(
        and(
          eq(userCalendarEvents.userId, userId),
          // Event overlaps with range if: event_start <= range_end AND event_end >= range_start
          lte(userCalendarEvents.startDate, endDate),
          gte(userCalendarEvents.endDate, startDate)
        )
      )
      .orderBy(asc(userCalendarEvents.startDate));

    return result.map(r => ({ ...r.calendarEvent, pairing: r.pairing }));
  }
}

export const storage = new DatabaseStorage();