import {
  users,
  bidPackages,
  pairings,
  bidHistory,
  reasonsReportPreferences,
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
  type ReasonsReportPreference,
  type InsertReasonsReportPreference,
  type UserFavorite,
  type InsertUserFavorite,
  type ChatMessage,
  type InsertChatHistory,
  type ChatHistory,
  type UserCalendarEvent,
  type InsertUserCalendarEvent,
} from '../shared/schema';
import { db } from './db';
import {
  eq,
  and,
  desc,
  asc,
  like,
  gte,
  lte,
  or,
  sql,
  inArray,
} from 'drizzle-orm';
// Helper functions for decimal field parsing
const parseDecimal = (value: any): number => parseFloat(String(value)) || 0;
const parseNullable = (value: any): number =>
  value !== null && value !== undefined ? parseFloat(String(value)) || 0 : 0;
export interface IStorage {
  // User operations
  getUser(id: number): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  createOrUpdateUser(userData: {
    name?: string;
    seniorityNumber: number;
    seniorityPercentile?: number;
    base: string;
    aircraft: string;
  }): Promise<User>;
  getUserBySeniority(seniorityNumber: number): Promise<User | undefined>;
  getPrimaryUser(): Promise<User | undefined>;
  getUserByPin(pin: string): Promise<User | undefined>;
  setSyncPin(userId: number, pin: string): Promise<User>;

  // Bid Package operations
  createBidPackage(bidPackage: InsertBidPackage): Promise<BidPackage>;
  getBidPackages(): Promise<BidPackage[]>;
  getBidPackage(id: number): Promise<BidPackage | undefined>;
  updateBidPackageStatus(id: number, status: string): Promise<void>;
  updateBidPackageInfo(
    id: number,
    data: {
      name?: string;
      month?: string;
      year?: number;
      base?: string;
      aircraft?: string;
      alvHours?: number;
      alvTable?: any;
      bidPeriodStart?: string;
      bidPeriodEnd?: string;
    }
  ): Promise<void>;
  deleteBidPackage(id: number): Promise<void>;
  deletePairingsForBidPackage(bidPackageId: number): Promise<void>;
  clearAllData(): Promise<void>;

  // Pairing operations
  createPairing(pairing: InsertPairing): Promise<Pairing>;
  createPairingsBatch(pairingsData: InsertPairing[]): Promise<Pairing[]>;
  getPairings(bidPackageId?: number): Promise<Pairing[]>;
  getPairing(id: number): Promise<Pairing | undefined>;
  getPairingByNumber(
    pairingNumber: string,
    bidPackageId?: number
  ): Promise<Pairing | undefined>;
  searchPairings(filters: {
    bidPackageId?: number;
    search?: string;
    rotationNumber?: string;
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

  // Reasons Report per-preference outcomes
  createReasonsReportPreferences(
    records: InsertReasonsReportPreference[]
  ): Promise<number>;
  getReasonsReportPreferences(filter?: {
    base?: string;
    aircraft?: string;
    limit?: number;
  }): Promise<ReasonsReportPreference[]>;
  getCategoryRosters(base: string): Promise<Map<string, number[]>>;
  getCategoryCreditWindow(base: string): Promise<{
    windowMin: number;
    windowMax: number;
    threshold: number;
    period: string;
  } | null>;
  getStrategyStats(
    base: string,
    userPercentile: number
  ): Promise<{
    bandLow: number;
    bandHigh: number;
    periods: number;
    denialModePeriods: number;
    categories: Array<{
      category: string;
      total: number;
      honored: number;
      denied: number;
      producedAward: number;
      avgAwardDepth: number | null;
    }>;
  }>;

  // User favorites
  addUserFavorite(favorite: InsertUserFavorite): Promise<UserFavorite>;
  removeUserFavorite(userId: number, pairingId: number): Promise<void>;
  getUserFavorites(userId: number): Promise<Pairing[]>;

  // Chat history
  saveChatMessage(message: InsertChatHistory): Promise<ChatMessage>;
  getChatHistory(sessionId: string): Promise<ChatMessage[]>;
  clearChatHistory(sessionId: string): Promise<void>;
  getChatSessionsForUser(
    userId: number
  ): Promise<{ sessionId: string; lastMessageAt: Date; preview: string }[]>;

  // Calendar events
  addUserCalendarEvent(
    event: InsertUserCalendarEvent
  ): Promise<UserCalendarEvent>;
  removeUserCalendarEvent(userId: number, pairingId: number): Promise<void>;
  getUserCalendarEvents(
    userId: number
  ): Promise<(UserCalendarEvent & { pairing: Pairing })[]>;
  getUserCalendarEventsForMonth(
    userId: number,
    month: number,
    year: number
  ): Promise<(UserCalendarEvent & { pairing: Pairing })[]>;
  getUserCalendarEventsInRange(
    userId: number,
    startDate: Date,
    endDate: Date
  ): Promise<(UserCalendarEvent & { pairing: Pairing })[]>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  async createOrUpdateUser(userData: {
    name?: string;
    seniorityNumber: number;
    seniorityPercentile?: number;
    base: string;
    aircraft: string;
  }): Promise<User> {
    // This app is single-user: identity is the one canonical row (by id),
    // never a lookup by seniorityNumber, which changes every bid month.
    const existingUser = await this.getPrimaryUser();

    if (existingUser) {
      // Update existing user - only update fields that are provided
      const updateData: any = {
        seniorityNumber: userData.seniorityNumber,
        base: userData.base,
        aircraft: userData.aircraft,
        updatedAt: new Date(),
      };

      if (userData.name !== undefined) {
        updateData.name = userData.name;
      }

      if (userData.seniorityPercentile !== undefined) {
        updateData.seniorityPercentile = userData.seniorityPercentile;
      }

      const [updatedUser] = await db
        .update(users)
        .set(updateData)
        .where(eq(users.id, existingUser.id))
        .returning();
      return updatedUser;
    } else {
      // Create the one canonical user
      const newUserData: InsertUser = {
        seniorityNumber: userData.seniorityNumber,
        base: userData.base,
        aircraft: userData.aircraft,
        seniorityPercentile: userData.seniorityPercentile || 50, // Default to 50 if not provided
      };

      // Only add name if it's provided
      if (userData.name) {
        newUserData.name = userData.name;
      }

      return await this.createUser(newUserData);
    }
  }

  async getPrimaryUser(): Promise<User | undefined> {
    const [user] = await db.select().from(users).orderBy(users.id).limit(1);
    return user || undefined;
  }

  async getUserByPin(pin: string): Promise<User | undefined> {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.syncPin, pin));
    return user || undefined;
  }

  async setSyncPin(userId: number, pin: string): Promise<User> {
    const [updatedUser] = await db
      .update(users)
      .set({ syncPin: pin, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();
    return updatedUser;
  }

  async getUserBySeniority(seniorityNumber: number): Promise<User | undefined> {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.seniorityNumber, seniorityNumber));
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
    return await db
      .select()
      .from(bidPackages)
      .orderBy(desc(bidPackages.uploadedAt));
  }

  async getBidPackage(id: number): Promise<BidPackage | undefined> {
    const [bidPackage] = await db
      .select()
      .from(bidPackages)
      .where(eq(bidPackages.id, id));
    return bidPackage || undefined;
  }

  async updateBidPackageStatus(id: number, status: string): Promise<void> {
    await db.update(bidPackages).set({ status }).where(eq(bidPackages.id, id));
  }

  async updateBidPackageInfo(
    id: number,
    data: {
      name?: string;
      month?: string;
      year?: number;
      base?: string;
      aircraft?: string;
      alvHours?: number;
      alvTable?: any;
      bidPeriodStart?: string;
      bidPeriodEnd?: string;
    }
  ): Promise<void> {
    const updateData: any = {};
    if (data.name !== undefined) {
      updateData.name = data.name;
    }
    if (data.month !== undefined) {
      updateData.month = data.month;
    }
    if (data.year !== undefined) {
      updateData.year = data.year;
    }
    if (data.base !== undefined) {
      updateData.base = data.base;
    }
    if (data.aircraft !== undefined) {
      updateData.aircraft = data.aircraft;
    }
    if (data.alvHours !== undefined) {
      updateData.alvHours = data.alvHours.toString();
    }
    if (data.bidPeriodStart !== undefined) {
      updateData.bidPeriodStart = data.bidPeriodStart;
    }
    if (data.bidPeriodEnd !== undefined) {
      updateData.bidPeriodEnd = data.bidPeriodEnd;
    }
    if (data.alvTable !== undefined) {
      updateData.alvTable = data.alvTable;
    }
    if (Object.keys(updateData).length === 0) {
      return;
    }
    await db.update(bidPackages).set(updateData).where(eq(bidPackages.id, id));
  }

  // Removes any pairings already inserted for a bid package whose parse
  // failed partway through, without deleting the bid package row itself
  // (it stays visible in the UI with status 'failed').
  async deletePairingsForBidPackage(bidPackageId: number): Promise<void> {
    const pairingIds = await db
      .select({ id: pairings.id })
      .from(pairings)
      .where(eq(pairings.bidPackageId, bidPackageId));
    const pairingIdArray = pairingIds.map(p => p.id);

    if (pairingIdArray.length > 0) {
      await db
        .delete(userFavorites)
        .where(inArray(userFavorites.pairingId, pairingIdArray));
      await db
        .delete(userCalendarEvents)
        .where(inArray(userCalendarEvents.pairingId, pairingIdArray));
    }

    await db.delete(pairings).where(eq(pairings.bidPackageId, bidPackageId));
    console.log(
      `Deleted ${pairingIdArray.length} partial pairing(s) for failed bid package ${bidPackageId}`
    );
  }

  async deleteBidPackage(id: number): Promise<void> {
    // Delete associated data in the correct order (foreign key constraints)
    await db.delete(chatHistory).where(eq(chatHistory.bidPackageId, id));

    // Get all pairing IDs for this bid package
    const pairingIds = await db
      .select({ id: pairings.id })
      .from(pairings)
      .where(eq(pairings.bidPackageId, id));
    const pairingIdArray = pairingIds.map(p => p.id);

    // Delete user favorites that reference any of these pairings
    if (pairingIdArray.length > 0) {
      await db
        .delete(userFavorites)
        .where(inArray(userFavorites.pairingId, pairingIdArray));
      // Delete user calendar events that reference any of these pairings
      await db
        .delete(userCalendarEvents)
        .where(inArray(userCalendarEvents.pairingId, pairingIdArray));
    }

    await db.delete(pairings).where(eq(pairings.bidPackageId, id));
    await db.delete(bidPackages).where(eq(bidPackages.id, id));
    console.log(`Deleted bid package ${id} and all associated data`);
  }

  async clearAllData(): Promise<void> {
    await db.delete(chatHistory);
    await db.delete(userFavorites);
    await db.delete(userCalendarEvents);
    await db.delete(bidHistory);
    await db.delete(pairings);
    await db.delete(bidPackages);
    console.log('All data cleared from database');
  }

  async createPairing(pairing: InsertPairing): Promise<Pairing> {
    const [newPairing] = await db.insert(pairings).values(pairing).returning();
    return newPairing;
  }

  async createPairingsBatch(
    pairingsData: InsertPairing[]
  ): Promise<Pairing[]> {
    if (pairingsData.length === 0) {
      return [];
    }
    return await db.insert(pairings).values(pairingsData).returning();
  }

  async getPairings(bidPackageId?: number): Promise<Pairing[]> {
    if (bidPackageId) {
      return await db
        .select()
        .from(pairings)
        .where(eq(pairings.bidPackageId, bidPackageId))
        .orderBy(asc(pairings.pairingNumber));
    }
    return await db
      .select()
      .from(pairings)
      .orderBy(asc(pairings.pairingNumber));
  }

  async getPairing(id: number): Promise<Pairing | undefined> {
    const [pairing] = await db
      .select()
      .from(pairings)
      .where(eq(pairings.id, id));
    return pairing || undefined;
  }

  async getPairingByNumber(
    pairingNumber: string,
    bidPackageId?: number
  ): Promise<Pairing | undefined> {
    const whereConditions = [eq(pairings.pairingNumber, pairingNumber)];

    if (bidPackageId) {
      whereConditions.push(eq(pairings.bidPackageId, bidPackageId));
    }

    const [pairing] = await db
      .select()
      .from(pairings)
      .where(and(...whereConditions));
    return pairing || undefined;
  }

  async searchPairings(filters: {
    bidPackageId?: number;
    search?: string;
    rotationNumber?: string;
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
        console.error('Bid package ID is required for pairing search');
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

      if (filters.rotationNumber) {
        conditions.push(sql`${pairings.pairingNumber} ILIKE ${`%${filters.rotationNumber}%`}`);
      }

      if (filters.creditMin !== undefined) {
        conditions.push(
          sql`CAST(${pairings.creditHours} AS DECIMAL) >= ${filters.creditMin}`
        );
      }

      if (filters.creditMax !== undefined) {
        conditions.push(
          sql`CAST(${pairings.creditHours} AS DECIMAL) <= ${filters.creditMax}`
        );
      }

      if (filters.blockMin !== undefined) {
        conditions.push(
          sql`CAST(${pairings.blockHours} AS DECIMAL) >= ${filters.blockMin}`
        );
      }
      if (filters.blockMax !== undefined) {
        conditions.push(
          sql`CAST(${pairings.blockHours} AS DECIMAL) <= ${filters.blockMax}`
        );
      }

      if (filters.holdProbabilityMin !== undefined) {
        conditions.push(
          gte(pairings.holdProbability, filters.holdProbabilityMin)
        );
      }

      if (filters.pairingDays !== undefined) {
        conditions.push(eq(pairings.pairingDays, filters.pairingDays));
      }

      // Note: preferredDaysOff filtering would need to be implemented
      // based on pairing start/end dates vs preferred days off
      // This would require additional logic to check if pairings
      // conflict with requested days off

      if (filters.pairingDaysMin !== undefined) {
        conditions.push(gte(pairings.pairingDays, filters.pairingDaysMin));
      }

      if (filters.pairingDaysMax !== undefined) {
        conditions.push(lte(pairings.pairingDays, filters.pairingDaysMax));
      }

      // TAFB filter: compare as minutes (handles 'HH:MM' format)
      // TAFB filter: compare as minutes, supports 'HH:MM' and decimal 'HH.MM'
      if (filters.tafbMin !== undefined) {
        const minMins = filters.tafbMin * 60;
        conditions.push(sql`
                (
                        CASE
                                WHEN ${pairings.tafb}::text ~ '^[0-9]+:[0-9]{1,2}$' THEN
                                        (split_part(${pairings.tafb}::text, ':', 1)::int * 60 + split_part(${pairings.tafb}::text, ':', 2)::int)
                                WHEN ${pairings.tafb}::text ~ '^[0-9]+(\\.[0-9]+)?$' THEN
                                        floor((${pairings.tafb}::numeric) * 60)
                                ELSE 0
                        END
                ) >= ${minMins}
        `);
      }
      if (filters.tafbMax !== undefined) {
        const maxMins = filters.tafbMax * 60;
        conditions.push(sql`
                (
                        CASE
                                WHEN ${pairings.tafb}::text ~ '^[0-9]+:[0-9]{1,2}$' THEN
                                        (split_part(${pairings.tafb}::text, ':', 1)::int * 60 + split_part(${pairings.tafb}::text, ':', 2)::int)
                                WHEN ${pairings.tafb}::text ~ '^[0-9]+(\\.[0-9]+)?$' THEN
                                        floor((${pairings.tafb}::numeric) * 60)
                                ELSE 0
                        END
                ) <= ${maxMins}
        `);
      }

      if (conditions.length > 0) {
        let results = await db
          .select()
          .from(pairings)
          .where(and(...conditions))
          .orderBy(asc(pairings.pairingNumber));

        // Apply efficiency filter (credit/block ratio) after database query
        if (filters.efficiency !== undefined) {
          results = results.filter(pairing => {
            const creditHours = parseFloat(pairing.creditHours.toString());
            const blockHours = parseFloat(pairing.blockHours.toString());
            const efficiency = blockHours > 0 ? creditHours / blockHours : 0;
            return efficiency >= filters.efficiency!;
          });
        }

        return results;
      }

      return await db
        .select()
        .from(pairings)
        .orderBy(asc(pairings.pairingNumber));
    } catch (error) {
      console.error('Error in searchPairings:', error);
      // Rethrow instead of returning [] — a DB error should surface as a
      // failure, not be indistinguishable from "no pairings match."
      throw error;
    }
  }

  async getAllPairingsForBidPackage(filters: {
    bidPackageId: number;
    search?: string;
    rotationNumber?: string;
    creditMin?: number;
    creditMax?: number;
    blockMin?: number;
    blockMax?: number;
    tafbMin?: number;
    tafbMax?: number;
    holdProbabilityMin?: number;
    pairingDays?: number;
    pairingDaysMin?: number;
    pairingDaysMax?: number;
    efficiency?: number;
    layoverLocations?: string[];
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  }): Promise<{
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
  }> {
    try {
      const conditions = [];

      if (!filters.bidPackageId) {
        console.error('Bid package ID is required for pairing search');
        return {
          pairings: [],
          statistics: {
            likelyToHold: 0,
            highCredit: 0,
            ratioBreakdown: { excellent: 0, good: 0, average: 0, poor: 0 },
          },
        };
      }

      conditions.push(eq(pairings.bidPackageId, filters.bidPackageId));

      // Apply all filter conditions
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

      if (filters.rotationNumber) {
        conditions.push(sql`${pairings.pairingNumber} ILIKE ${`%${filters.rotationNumber}%`}`);
      }

      if (filters.creditMin !== undefined) {
        conditions.push(
          sql`CAST(${pairings.creditHours} AS DECIMAL) >= ${filters.creditMin}`
        );
      }

      if (filters.creditMax !== undefined) {
        conditions.push(
          sql`CAST(${pairings.creditHours} AS DECIMAL) <= ${filters.creditMax}`
        );
      }

      if (filters.blockMin !== undefined) {
        conditions.push(
          sql`CAST(${pairings.blockHours} AS DECIMAL) >= ${filters.blockMin}`
        );
      }

      if (filters.blockMax !== undefined) {
        conditions.push(
          sql`CAST(${pairings.blockHours} AS DECIMAL) <= ${filters.blockMax}`
        );
      }

      if (filters.holdProbabilityMin !== undefined) {
        conditions.push(
          gte(pairings.holdProbability, filters.holdProbabilityMin)
        );
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

      if (filters.tafbMin !== undefined) {
        const minMins = filters.tafbMin * 60;
        conditions.push(sql`
          (
            CASE
              WHEN ${pairings.tafb}::text ~ '^[0-9]+:[0-9]{1,2}$' THEN
                (split_part(${pairings.tafb}::text, ':', 1)::int * 60 + split_part(${pairings.tafb}::text, ':', 2)::int)
              WHEN ${pairings.tafb}::text ~ '^[0-9]+(\\.[0-9]+)?$' THEN
                floor((${pairings.tafb}::numeric) * 60)
              ELSE 0
            END
          ) >= ${minMins}
        `);
      }

      if (filters.tafbMax !== undefined) {
        const maxMins = filters.tafbMax * 60;
        conditions.push(sql`
          (
            CASE
              WHEN ${pairings.tafb}::text ~ '^[0-9]+:[0-9]{1,2}$' THEN
                (split_part(${pairings.tafb}::text, ':', 1)::int * 60 + split_part(${pairings.tafb}::text, ':', 2)::int)
              WHEN ${pairings.tafb}::text ~ '^[0-9]+(\\.[0-9]+)?$' THEN
                floor((${pairings.tafb}::numeric) * 60)
              ELSE 0
            END
          ) <= ${maxMins}
        `);
      }

      // Computed SQL expressions
      const efficiencyExpr = sql`(CAST(${pairings.creditHours} AS numeric) / NULLIF(CAST(${pairings.blockHours} AS numeric), 0))`;

      if (filters.efficiency !== undefined) {
        conditions.push(sql`${efficiencyExpr} >= ${filters.efficiency}`);
      }

      // Filter by layover locations if provided
      if (filters.layoverLocations && filters.layoverLocations.length > 0) {
        // Build the array literal for PostgreSQL
        const citiesArray = `{${filters.layoverLocations.map(c => `"${c}"`).join(',')}}`;
        conditions.push(
          sql`EXISTS (
            SELECT 1 FROM jsonb_array_elements(${pairings.layovers}) AS layover
            WHERE layover->>'city' = ANY(${citiesArray}::text[])
          )`
        );
      }

      // Calculate statistics for the filtered dataset
      const statsQuery = db
        .select({
          likelyToHold: sql<number>`cast(sum(case when ${pairings.holdProbability} IS NOT NULL AND ${pairings.holdProbability} >= 70 then 1 else 0 end) as integer)`,
          highCredit: sql<number>`cast(sum(case when ${pairings.creditHours} IS NOT NULL AND cast(${pairings.creditHours} as numeric) >= 18 then 1 else 0 end) as integer)`,
          excellent: sql<number>`cast(sum(case when (cast(${pairings.creditHours} as numeric) / nullif(cast(${pairings.blockHours} as numeric),0)) >= 1.3 then 1 else 0 end) as integer)`,
          good: sql<number>`cast(sum(case when (cast(${pairings.creditHours} as numeric) / nullif(cast(${pairings.blockHours} as numeric),0)) >= 1.2 and (cast(${pairings.creditHours} as numeric) / nullif(cast(${pairings.blockHours} as numeric),0)) < 1.3 then 1 else 0 end) as integer)`,
          average: sql<number>`cast(sum(case when (cast(${pairings.creditHours} as numeric) / nullif(cast(${pairings.blockHours} as numeric),0)) >= 1.1 and (cast(${pairings.creditHours} as numeric) / nullif(cast(${pairings.blockHours} as numeric),0)) < 1.2 then 1 else 0 end) as integer)`,
          poor: sql<number>`cast(sum(case when (cast(${pairings.creditHours} as numeric) / nullif(cast(${pairings.blockHours} as numeric),0)) < 1.1 then 1 else 0 end) as integer)`,
        })
        .from(pairings)
        .where(and(...conditions));

      const [stats] = await statsQuery.execute();

      // Build sort configuration
      const sortColumn = filters.sortBy || 'pairingNumber';
      const sortDirection = filters.sortOrder === 'desc' ? desc : asc;

      const sortColumnMap: Record<string, any> = {
        pairingNumber: pairings.pairingNumber,
        creditHours: pairings.creditHours,
        blockHours: pairings.blockHours,
        holdProbability: pairings.holdProbability,
        pairingDays: pairings.pairingDays,
        route: pairings.route,
      };

      const tafbMinutesExpr = sql`
        (
          CASE
            WHEN ${pairings.tafb}::text ~ '^[0-9]+:[0-9]{1,2}$' THEN
              (split_part(${pairings.tafb}::text, ':', 1)::int * 60 + split_part(${pairings.tafb}::text, ':', 2)::int)
            WHEN ${pairings.tafb}::text ~ '^[0-9]+\\.[0-9]{1,2}$' THEN
              (split_part(${pairings.tafb}::text, '.', 1)::int * 60 + split_part(${pairings.tafb}::text, '.', 2)::int)
            WHEN ${pairings.tafb}::text ~ '^[0-9]+$' THEN
              (${pairings.tafb}::int * 60)
            ELSE 0
          END
        )`;

      const sortColumnField =
        sortColumn === 'creditBlockRatio'
          ? efficiencyExpr
          : sortColumn === 'tafb'
            ? tafbMinutesExpr
            : sortColumnMap[sortColumn] || pairings.pairingNumber;

      // Query all pairings (no LIMIT/OFFSET)
      const pairingsResult = await db
        .select({
          id: pairings.id,
          bidPackageId: pairings.bidPackageId,
          pairingNumber: pairings.pairingNumber,
          effectiveDates: pairings.effectiveDates,
          route: pairings.route,
          creditHours: pairings.creditHours,
          blockHours: pairings.blockHours,
          tafb: pairings.tafb,
          fdp: pairings.fdp,
          payHours: pairings.payHours,
          sitEdpPay: pairings.sitEdpPay,
          carveouts: pairings.carveouts,
          checkInTime: pairings.checkInTime,
          deadheads: pairings.deadheads,
          layovers: pairings.layovers,
          flightSegments: pairings.flightSegments,
          holdProbability: pairings.holdProbability,
          holdProbabilityReasoning: pairings.holdProbabilityReasoning,
          pairingDays: pairings.pairingDays,
          fullTextBlock: pairings.fullTextBlock,
        })
        .from(pairings)
        .where(and(...conditions))
        .orderBy(sortDirection(sortColumnField))
        .execute();

      return {
        pairings: pairingsResult as Pairing[],
        statistics: {
          likelyToHold: stats.likelyToHold,
          highCredit: stats.highCredit,
          ratioBreakdown: {
            excellent: stats.excellent,
            good: stats.good,
            average: stats.average,
            poor: stats.poor,
          },
        },
      };
    } catch (error) {
      console.error('Error in getAllPairingsForBidPackage:', error);
      // Rethrow instead of returning an empty result — this is the primary
      // data path for the whole app, and swallowing DB errors here made a
      // genuine outage indistinguishable from "this bid package has no
      // pairings," which the client rendered as a normal empty state.
      throw error;
    }
  }

  async createBidHistory(
    bidHistoryData: InsertBidHistory
  ): Promise<BidHistory> {
    const [newBidHistory] = await db
      .insert(bidHistory)
      .values(bidHistoryData)
      .returning();
    return newBidHistory;
  }

  async getBidHistoryForPairing(pairingNumber: string): Promise<BidHistory[]> {
    return await db
      .select()
      .from(bidHistory)
      .where(eq(bidHistory.pairingNumber, pairingNumber))
      .orderBy(desc(bidHistory.awardedAt));
  }

  async createReasonsReportPreferences(
    records: InsertReasonsReportPreference[]
  ): Promise<number> {
    if (records.length === 0) return 0;
    // A composite report yields thousands of rows (14 columns each); one
    // giant INSERT overflows the Neon bind-parameter limit, so batch it.
    const batchSize = 200;
    let insertedCount = 0;
    for (let i = 0; i < records.length; i += batchSize) {
      const inserted = await db
        .insert(reasonsReportPreferences)
        .values(records.slice(i, i + batchSize))
        .returning({ id: reasonsReportPreferences.id });
      insertedCount += inserted.length;
    }
    return insertedCount;
  }

  /**
   * The full roster of category bidders per bid period, from Reasons Report
   * data: every pilot who appears in a period's report, sorted ascending by
   * seniority number. Keyed "JUL-2026". This is what makes seniority numbers
   * comparable across years — percentile-within-period instead of raw number.
   */
  async getCategoryRosters(base: string): Promise<Map<string, number[]>> {
    const rows = await db.execute(sql`
      SELECT year, month,
             array_agg(DISTINCT pilot_seniority_number ORDER BY pilot_seniority_number) AS seniorities
      FROM reasons_report_preferences
      WHERE base = ${base} AND pilot_seniority_number IS NOT NULL
      GROUP BY year, month
    `);
    const rosters = new Map<string, number[]>();
    for (const row of rows.rows as any[]) {
      const month = String(row.month).trim().slice(0, 3).toUpperCase();
      rosters.set(`${month}-${row.year}`, row.seniorities as number[]);
    }
    return rosters;
  }

  /**
   * The category's most common credit window and threshold from the most
   * recent imported Reasons Report period (each pilot's rows carry a
   * "Window 062:00-082:00, Threshold 082:00" banner). Real admin values —
   * the simulator otherwise has to guess ALV±10.
   */
  async getCategoryCreditWindow(base: string): Promise<{
    windowMin: number;
    windowMax: number;
    threshold: number;
    period: string;
  } | null> {
    const rows = await db.execute(sql`
      WITH latest AS (
        SELECT year, month FROM reasons_report_preferences
        WHERE base = ${base}
        ORDER BY year DESC,
          array_position(
            ARRAY['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'],
            upper(left(trim(month), 3))
          ) DESC
        LIMIT 1
      )
      SELECT banner, count(*) AS n, r.month, r.year
      FROM reasons_report_preferences r
      JOIN latest l ON r.year = l.year AND r.month = l.month,
      LATERAL jsonb_array_elements_text(r.report_banners) AS banner
      WHERE r.base = ${base} AND banner LIKE 'Window %'
      GROUP BY banner, r.month, r.year
      ORDER BY n DESC LIMIT 1
    `);
    const row = rows.rows[0] as any;
    if (!row) return null;
    const m = String(row.banner).match(
      /Window\s+(\d{1,3}):(\d{2})-(\d{1,3}):(\d{2}),\s*Threshold\s+(\d{1,3}):(\d{2})/
    );
    if (!m) return null;
    const toHours = (h: string, min: string) =>
      parseInt(h, 10) + parseInt(min, 10) / 60;
    return {
      windowMin: toHours(m[1], m[2]),
      windowMax: toHours(m[3], m[4]),
      threshold: toHours(m[5], m[6]),
      period: `${String(row.month).trim()} ${row.year}`,
    };
  }

  /**
   * Outcome statistics for pilots near a given seniority percentile,
   * aggregated across every imported Reasons Report period. This is what the
   * coach personalizes with: not the whole category, but pilots whose
   * seniority position matches the user's (±10 percentile points).
   */
  async getStrategyStats(
    base: string,
    userPercentile: number
  ): Promise<{
    bandLow: number;
    bandHigh: number;
    periods: number;
    denialModePeriods: number;
    categories: Array<{
      category: string;
      total: number;
      honored: number;
      denied: number;
      producedAward: number;
      avgAwardDepth: number | null;
    }>;
  }> {
    const lo = Math.max(0, (userPercentile - 10) / 100);
    const hi = Math.min(1, (userPercentile + 10) / 100);
    const rows = await db.execute(sql`
      WITH pilot_ranks AS (
        SELECT DISTINCT year, month, pilot_seniority_number,
          percent_rank() OVER (
            PARTITION BY year, month ORDER BY pilot_seniority_number
          ) AS pct
        FROM reasons_report_preferences
        WHERE base = ${base} AND pilot_seniority_number IS NOT NULL
      ),
      banded AS (
        SELECT r.*
        FROM reasons_report_preferences r
        JOIN pilot_ranks p
          ON p.year = r.year AND p.month = r.month
          AND p.pilot_seniority_number = r.pilot_seniority_number
        WHERE r.base = ${base} AND p.pct BETWEEN ${lo} AND ${hi}
      )
      SELECT
        CASE
          WHEN preference_text ILIKE 'prefer off%' THEN 'Prefer Off'
          WHEN preference_text ILIKE 'avoid%' THEN 'Avoid Pairings'
          WHEN preference_text ILIKE 'award%' THEN 'Award Pairings'
          WHEN preference_text ILIKE 'set condition%' THEN 'Set Condition'
          ELSE 'Other'
        END AS category,
        count(*) AS total,
        sum(CASE WHEN outcome = 'Honored' THEN 1 ELSE 0 END) AS honored,
        sum(CASE WHEN outcome IN (
          'Awarded to senior bidder', 'Awarded to senior shadow bidder',
          'Not honored', 'Not considered', 'Bid denied',
          'Below Reduced Lower Limit Cutoff', 'Not used'
        ) THEN 1 ELSE 0 END) AS denied,
        sum(CASE WHEN jsonb_array_length(coalesce(awarded_pairing_numbers, '[]'::jsonb)) > 0
          THEN 1 ELSE 0 END) AS produced_award,
        avg(CASE WHEN jsonb_array_length(coalesce(awarded_pairing_numbers, '[]'::jsonb)) > 0
          THEN preference_number END) AS avg_award_depth,
        count(DISTINCT (year, month)) AS periods
      FROM banded
      GROUP BY 1 ORDER BY total DESC
    `);
    const flags = await db.execute(sql`
      SELECT count(DISTINCT (year, month)) AS n
      FROM reasons_report_preferences
      WHERE base = ${base}
        AND report_banners::text LIKE '%Affected By Denial Mode%'
    `);
    const periodsTotal = await db.execute(sql`
      SELECT count(DISTINCT (year, month)) AS n
      FROM reasons_report_preferences WHERE base = ${base}
    `);
    return {
      bandLow: Math.round(lo * 100),
      bandHigh: Math.round(hi * 100),
      periods: Number((periodsTotal.rows[0] as any)?.n ?? 0),
      denialModePeriods: Number((flags.rows[0] as any)?.n ?? 0),
      categories: (rows.rows as any[]).map(r => ({
        category: r.category,
        total: Number(r.total),
        honored: Number(r.honored),
        denied: Number(r.denied),
        producedAward: Number(r.produced_award),
        avgAwardDepth:
          r.avg_award_depth === null ? null : Number(r.avg_award_depth),
      })),
    };
  }

  async getReasonsReportPreferences(filter?: {
    base?: string;
    aircraft?: string;
    limit?: number;
  }): Promise<ReasonsReportPreference[]> {
    const conditions = [];
    if (filter?.base) {
      conditions.push(eq(reasonsReportPreferences.base, filter.base));
    }
    if (filter?.aircraft) {
      conditions.push(eq(reasonsReportPreferences.aircraft, filter.aircraft));
    }
    const base = db.select().from(reasonsReportPreferences);
    const filtered =
      conditions.length > 0 ? base.where(and(...conditions)) : base;
    return await filtered
      .orderBy(
        desc(reasonsReportPreferences.year),
        desc(reasonsReportPreferences.uploadedAt)
      )
      .limit(filter?.limit ?? 500);
  }

  async addUserFavorite(favorite: InsertUserFavorite): Promise<UserFavorite> {
    // Check if favorite already exists
    const existing = await db
      .select()
      .from(userFavorites)
      .where(
        and(
          eq(userFavorites.userId, favorite.userId),
          eq(userFavorites.pairingId, favorite.pairingId)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      // Return existing favorite instead of creating duplicate
      return existing[0];
    }

    const [newFavorite] = await db
      .insert(userFavorites)
      .values(favorite)
      .returning();
    return newFavorite;
  }

  async removeUserFavorite(userId: number, pairingId: number): Promise<void> {
    await db
      .delete(userFavorites)
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
  async saveChatMessage(message: InsertChatHistory): Promise<ChatMessage> {
    const [savedMessage] = await db
      .insert(chatHistory)
      .values(message)
      .returning();
    return savedMessage;
  }

  async getChatHistory(sessionId: string): Promise<ChatMessage[]> {
    return await db
      .select()
      .from(chatHistory)
      .where(eq(chatHistory.sessionId, sessionId))
      .orderBy(asc(chatHistory.createdAt));
  }

  async clearChatHistory(sessionId: string): Promise<void> {
    await db.delete(chatHistory).where(eq(chatHistory.sessionId, sessionId));
  }

  async getChatSessionsForUser(
    userId: number
  ): Promise<{ sessionId: string; lastMessageAt: Date; preview: string }[]> {
    const rows = await db
      .select()
      .from(chatHistory)
      .where(eq(chatHistory.userId, userId))
      .orderBy(asc(chatHistory.createdAt));

    const bySession = new Map<
      string,
      { sessionId: string; lastMessageAt: Date; preview: string }
    >();
    for (const row of rows) {
      const existing = bySession.get(row.sessionId);
      if (!existing) {
        bySession.set(row.sessionId, {
          sessionId: row.sessionId,
          lastMessageAt: row.createdAt,
          preview: row.content.slice(0, 120),
        });
      } else {
        existing.lastMessageAt = row.createdAt;
      }
    }

    return Array.from(bySession.values()).sort(
      (a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime()
    );
  }

  // Enhanced analytics operations for OpenAI token optimization
  async getTopEfficientPairings(
    bidPackageId: number,
    limit: number = 20
  ): Promise<{ pairings: Pairing[]; stats: any }> {
    const allPairings = await db
      .select()
      .from(pairings)
      .where(eq(pairings.bidPackageId, bidPackageId));

    // Helper function to parse Delta PBS hours format (handles both string and number)
    const parseHours = (hours: any): number => {
      if (typeof hours === 'number') {
        return hours;
      }
      if (typeof hours === 'string') {
        // Handle Delta PBS format like "5.28" or "21.49"
        return parseFloat(hours) || 0;
      }
      return 0;
    };

    // Calculate efficiency (credit hours / block hours ratio)
    // Calculate efficiency (credit hours / block hours ratio)
    const pairingsWithEfficiency = allPairings.map(p => {
      const creditHours = parseHours(p.creditHours);
      const blockHours = parseHours(p.blockHours);
      return {
        ...p,
        efficiency: blockHours > 0 ? creditHours / blockHours : 0,
      };
    });

    // Sort by efficiency descending
    const topPairings = pairingsWithEfficiency
      .sort((a, b) => (b.efficiency || 0) - (a.efficiency || 0))
      .slice(0, limit);

    const stats = {
      totalPairings: allPairings.length,
      avgEfficiency: Number(
        (
          pairingsWithEfficiency.reduce((sum, p) => sum + p.efficiency, 0) /
          pairingsWithEfficiency.length
        ).toFixed(2)
      ),
      topEfficiency: Number((topPairings[0]?.efficiency || 0).toFixed(2)),
      avgCredit: Number(
        (
          pairingsWithEfficiency.reduce(
            (sum, p) => sum + parseDecimal(p.creditHours),
            0
          ) / pairingsWithEfficiency.length
        ).toFixed(2)
      ),
      avgBlock: Number(
        (
          pairingsWithEfficiency.reduce(
            (sum, p) => sum + parseDecimal(p.blockHours),
            0
          ) / pairingsWithEfficiency.length
        ).toFixed(2)
      ),
    };

    return { pairings: topPairings, stats };
  }

  async getTopCreditPairings(
    bidPackageId: number,
    limit: number = 20
  ): Promise<{ pairings: Pairing[]; stats: any }> {
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
      avgCreditHours:
        allPairings.length === 0
          ? 0
          : allPairings.reduce((sum, p) => sum + parseDecimal(p.creditHours), 0) /
            allPairings.length,
      minCredit:
        allPairings.length === 0
          ? 0
          : Math.min(...allPairings.map(p => parseDecimal(p.creditHours))),
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
    avgByDays: { [key: number]: { credit: number; block: number } };
    pairingTypeBreakdown: { [key: number]: number };
    ratioBreakdown: {
      excellent: number;
      good: number;
      average: number;
      poor: number;
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
        blockHours: { min: 0, max: 0, average: 0 },
        avgByDays: {},
        pairingTypeBreakdown: {},
        ratioBreakdown: { excellent: 0, good: 0, average: 0, poor: 0 },
      };
    }

    // Calculate C/B ratios for all pairings
    const ratios = allPairings
      .filter(p => parseDecimal(p.blockHours) > 0) // Avoid division by zero
      .map(p => parseDecimal(p.creditHours) / parseDecimal(p.blockHours));

    const creditHours = allPairings.map(p => parseDecimal(p.creditHours));
    const blockHours = allPairings.map(p => parseDecimal(p.blockHours));

    // Calculate averages by pairing days (1-5 days) and count breakdown
    const avgByDays: { [key: number]: { credit: number; block: number } } = {};
    const pairingTypeBreakdown: { [key: number]: number } = {};
    for (let days = 1; days <= 5; days++) {
      const dayPairings = allPairings.filter((p: any) => p.pairingDays === days);
      if (dayPairings.length > 0) {
        const dayCredit = dayPairings.reduce((sum, p) => sum + parseDecimal(p.creditHours), 0);
        const dayBlock = dayPairings.reduce((sum, p) => sum + parseDecimal(p.blockHours), 0);
        avgByDays[days] = {
          credit: dayCredit / dayPairings.length,
          block: dayBlock / dayPairings.length,
        };
        pairingTypeBreakdown[days] = dayPairings.length;
      }
    }

    // Calculate credit/block ratio breakdown using percentile-based categorization.
    // `ratios` can be empty if every pairing has 0 block hours — guard against
    // Math.min/max on an empty array (Infinity/-Infinity).
    const minRatio = ratios.length > 0 ? Math.min(...ratios) : 1.0;
    const maxRatio = ratios.length > 0 ? Math.max(...ratios) : 1.0;
    const range = maxRatio - minRatio;

    const ratioBreakdown = allPairings.reduce(
      (acc, pairing) => {
        const credit = parseDecimal(pairing.creditHours);
        const block = parseDecimal(pairing.blockHours);
        if (block === 0) return acc; // Skip to avoid division by zero

        const ratio = credit / block;
        const percentile = range > 0 ? (ratio - minRatio) / range : 0;

        if (percentile >= 0.75) {
          acc.excellent++;
        } else if (percentile >= 0.50) {
          acc.good++;
        } else if (percentile >= 0.25) {
          acc.average++;
        } else {
          acc.poor++;
        }
        return acc;
      },
      { excellent: 0, good: 0, average: 0, poor: 0 }
    );

    return {
      totalPairings: allPairings.length,
      creditBlockRatios: {
        min: Math.min(...ratios),
        max: Math.max(...ratios),
        average: ratios.reduce((sum, ratio) => sum + ratio, 0) / ratios.length,
      },
      creditHours: {
        min: Math.min(...creditHours),
        max: Math.max(...creditHours),
        average:
          creditHours.reduce((sum, hours) => sum + hours, 0) /
          creditHours.length,
      },
      blockHours: {
        min: Math.min(...blockHours),
        max: Math.max(...blockHours),
        average:
          blockHours.reduce((sum, hours) => sum + hours, 0) / blockHours.length,
      },
      avgByDays,
      pairingTypeBreakdown,
      ratioBreakdown,
    };
  }

  async getTopHoldProbabilityPairings(
    bidPackageId: number,
    limit: number = 20
  ): Promise<{ pairings: Pairing[]; stats: any }> {
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
      avgHold:
        allPairings.reduce((sum, p) => sum + (p.holdProbability || 0), 0) /
        allPairings.length,
      highHoldCount: allPairings.filter(p => (p.holdProbability || 0) >= 80)
        .length,
    };

    return { pairings: topPairings, stats };
  }

  async getPairingStatsSummary(bidPackageId: number): Promise<any> {
    const allPairings = await db
      .select()
      .from(pairings)
      .where(eq(pairings.bidPackageId, bidPackageId));

    const turnCount = allPairings.filter(
      p => parseNullable(p.pairingDays) === 1
    ).length;
    const multiDayCount = allPairings.filter(
      p => parseNullable(p.pairingDays) > 1
    ).length;
    const deadheadCount = allPairings.filter(
      p =>
        p.fullTextBlock?.includes('DH') ||
        (p.flightSegments &&
          Array.isArray(p.flightSegments) &&
          p.flightSegments.some((seg: any) => seg.isDeadhead === true))
    ).length;

    return {
      totalPairings: allPairings.length,
      avgCreditHours:
        allPairings.reduce((sum, p) => sum + parseDecimal(p.creditHours), 0) /
        allPairings.length,
      avgBlockHours:
        allPairings.reduce((sum, p) => sum + parseDecimal(p.blockHours), 0) /
        allPairings.length,
      avgPairingDays:
        allPairings.reduce((sum, p) => sum + parseNullable(p.pairingDays), 0) /
        allPairings.length,
      avgHoldProbability:
        allPairings.reduce((sum, p) => sum + (p.holdProbability || 0), 0) /
        allPairings.length,
      maxCreditHours: Math.max(
        ...allPairings.map(p => parseDecimal(p.creditHours))
      ),
      minCreditHours: Math.min(
        ...allPairings.map(p => parseDecimal(p.creditHours))
      ),
      maxBlockHours: Math.max(
        ...allPairings.map(p => parseDecimal(p.blockHours))
      ),
      turnCount,
      multiDayCount,
      deadheadCount,
      dayDistribution: {
        '1day': allPairings.filter(p => parseNullable(p.pairingDays) === 1)
          .length,
        '2day': allPairings.filter(p => parseNullable(p.pairingDays) === 2)
          .length,
        '3day': allPairings.filter(p => parseNullable(p.pairingDays) === 3)
          .length,
        '4day': allPairings.filter(p => parseNullable(p.pairingDays) === 4)
          .length,
        '5day+': allPairings.filter(p => parseNullable(p.pairingDays) >= 5)
          .length,
      },
    };
  }

  async analyzePairingsByLayoverSummary(
    bidPackageId: number,
    city?: string
  ): Promise<any> {
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
    const summary = Object.entries(layoverAnalysis)
      .map(([city, data]: [string, any]) => ({
        city,
        count: data.count,
        avgDuration: data.totalDuration / data.count,
        pairings: data.pairings.slice(0, 10), // Limit to first 10 pairings
      }))
      .sort((a, b) => b.count - a.count);

    return {
      totalLayovers: Object.values(layoverAnalysis).reduce(
        (sum: number, data: any) => sum + data.count,
        0
      ),
      uniqueCities: Object.keys(layoverAnalysis).length,
      topCities: summary.slice(0, 10),
      requestedCity: city ? layoverAnalysis[city] : null,
    };
  }

  async getDeadheadAnalysis(bidPackageId: number): Promise<any> {
    const allPairings = await db
      .select()
      .from(pairings)
      .where(eq(pairings.bidPackageId, bidPackageId));

    const deadheadPairings = allPairings.filter(
      p =>
        p.fullTextBlock?.includes('DH') ||
        (p.flightSegments &&
          Array.isArray(p.flightSegments) &&
          p.flightSegments.some((seg: any) => seg.isDeadhead === true))
    );
    const nonDeadheadPairings = allPairings.filter(
      p =>
        !(
          p.fullTextBlock?.includes('DH') ||
          (p.flightSegments &&
            Array.isArray(p.flightSegments) &&
            p.flightSegments.some((seg: any) => seg.isDeadhead === true))
        )
    );

    return {
      totalPairings: allPairings.length,
      deadheadCount: deadheadPairings.length,
      deadheadPercentage:
        allPairings.length === 0
          ? 0
          : (deadheadPairings.length / allPairings.length) * 100,
      avgCreditWithDeadhead:
        deadheadPairings.length === 0
          ? 0
          : deadheadPairings.reduce(
              (sum, p) => sum + parseDecimal(p.creditHours),
              0
            ) / deadheadPairings.length,
      avgCreditWithoutDeadhead:
        nonDeadheadPairings.length === 0
          ? 0
          : nonDeadheadPairings.reduce(
              (sum, p) => sum + parseDecimal(p.creditHours),
              0
            ) / nonDeadheadPairings.length,
      topDeadheadPairings: deadheadPairings
        .sort(
          (a: any, b: any) =>
            parseDecimal(b.creditHours) - parseDecimal(a.creditHours)
        )
        .slice(0, 10)
        .map(p => ({
          pairingNumber: p.pairingNumber,
          creditHours: p.creditHours,
          blockHours: p.blockHours,
        })),
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
      // creditHours/blockHours are decimal columns returned as strings by
      // Drizzle — `+=` on a string does concatenation, not addition, and
      // silently produces NaN once divided below. Parse before accumulating.
      acc[key].totalCredit += parseDecimal(p.creditHours);
      acc[key].totalBlock += parseDecimal(p.blockHours);
      acc[key].pairings.push({
        pairingNumber: p.pairingNumber,
        creditHours: p.creditHours,
        blockHours: p.blockHours,
        holdProbability: p.holdProbability,
      });
      return acc;
    }, {} as any);

    // Calculate averages and sort pairings
    Object.values(durationGroups).forEach((group: any) => {
      group.avgCredit = group.totalCredit / group.count;
      group.avgBlock = group.totalBlock / group.count;
      group.pairings = group.pairings
        .sort((a: any, b: any) => b.creditHours - a.creditHours)
        .slice(0, 10);
    });

    return {
      totalPairings: allPairings.length,
      durationBreakdown: durationGroups,
      mostCommonDuration: Object.entries(durationGroups).sort(
        ([, a]: [string, any], [, b]: [string, any]) => b.count - a.count
      )[0]?.[0],
      avgDuration:
        allPairings.length === 0
          ? 0
          : allPairings.reduce((sum, p) => sum + parseNullable(p.pairingDays), 0) /
            allPairings.length,
    };
  }

  // Calendar event methods
  async addUserCalendarEvent(data: {
    userId: number;
    pairingId: number;
    startDate: Date;
    endDate: Date;
    notes?: string;
  }): Promise<UserCalendarEvent> {
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
      // Update existing event with new times (duty time calculation may have changed)
      const [updated] = await db
        .update(userCalendarEvents)
        .set({
          startDate: data.startDate,
          endDate: data.endDate,
          notes: data.notes,
        })
        .where(eq(userCalendarEvents.id, existing[0].id))
        .returning();

      console.log('Updated existing calendar event with new times:', updated);
      return updated;
    }

    const [result] = await db
      .insert(userCalendarEvents)
      .values(data)
      .returning();

    console.log('Added new calendar event:', result);
    return result;
  }

  async removeUserCalendarEvent(
    userId: number,
    pairingId: number
  ): Promise<void> {
    await db
      .delete(userCalendarEvents)
      .where(
        and(
          eq(userCalendarEvents.userId, userId),
          eq(userCalendarEvents.pairingId, pairingId)
        )
      );
  }

  async getUserCalendarEvents(
    userId: number
  ): Promise<(UserCalendarEvent & { pairing: Pairing })[]> {
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

  async getUserCalendarEventsForMonth(
    userId: number,
    month: number,
    year: number
  ): Promise<(UserCalendarEvent & { pairing: Pairing })[]> {
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

  async getUserCalendarEventsInRange(
    userId: number,
    startDate: Date,
    endDate: Date
  ): Promise<(UserCalendarEvent & { pairing: Pairing })[]> {
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
