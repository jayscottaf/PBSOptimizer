import { createRequire as _createRequire } from 'module'; const require = _createRequire(import.meta.url);
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// server/progress.ts
var progress_exports = {};
__export(progress_exports, {
  emitProgress: () => emitProgress,
  registerProgressClient: () => registerProgressClient,
  removeProgressClient: () => removeProgressClient
});
function registerProgressClient(bidPackageId, res) {
  let set = bidPackageClients.get(bidPackageId);
  if (!set) {
    set = /* @__PURE__ */ new Set();
    bidPackageClients.set(bidPackageId, set);
  }
  set.add(res);
}
function removeProgressClient(bidPackageId, res) {
  const set = bidPackageClients.get(bidPackageId);
  if (set) {
    set.delete(res);
    if (set.size === 0) {
      bidPackageClients.delete(bidPackageId);
    }
  }
}
function emitProgress(bidPackageId, payload) {
  const set = bidPackageClients.get(bidPackageId);
  if (!set || set.size === 0) {
    return;
  }
  const data = `data: ${JSON.stringify(payload)}

`;
  for (const res of Array.from(set)) {
    try {
      res.write(data);
    } catch {
    }
  }
}
var bidPackageClients;
var init_progress = __esm({
  "server/progress.ts"() {
    "use strict";
    bidPackageClients = /* @__PURE__ */ new Map();
  }
});

// server/ai/simpleAI.ts
var simpleAI_exports = {};
__export(simpleAI_exports, {
  SimpleAI: () => SimpleAI
});
import OpenAI2 from "openai";
var openai2, SimpleAI;
var init_simpleAI = __esm({
  "server/ai/simpleAI.ts"() {
    "use strict";
    openai2 = new OpenAI2({
      apiKey: process.env.OPENAI_API_KEY
    });
    SimpleAI = class {
      constructor(storage2) {
        this.storage = storage2;
      }
      /**
       * Main query method - works like ChatGPT
       */
      async query(query) {
        try {
          console.log("[SimpleAI] Processing query:", query.message);
          const pairings2 = await this.storage.searchPairings({
            bidPackageId: query.bidPackageId
          });
          console.log(`[SimpleAI] Loaded ${pairings2.length} pairings`);
          const bidPackage = await this.storage.getBidPackage(query.bidPackageId);
          const pairingsContext = this.buildPairingsContext(pairings2);
          const systemPrompt = this.buildSystemPrompt(bidPackage, query.seniorityPercentile);
          const messages = [
            {
              role: "system",
              content: systemPrompt
            }
          ];
          if (query.conversationHistory && query.conversationHistory.length > 0) {
            messages.push(...query.conversationHistory);
          }
          messages.push({
            role: "user",
            content: `${pairingsContext}

User Question: ${query.message}`
          });
          console.log("[SimpleAI] Sending to GPT-4.1...");
          const completion = await openai2.chat.completions.create({
            model: "gpt-4.1",
            temperature: 0.7,
            max_completion_tokens: 2e3,
            messages
          });
          const response = completion.choices[0]?.message?.content || "No response generated";
          console.log("[SimpleAI] Response generated");
          const pairingNumbers = this.extractPairingNumbers(response);
          return {
            response,
            pairingNumbers
          };
        } catch (error) {
          console.error("[SimpleAI] Error:", error);
          return {
            response: "I encountered an error processing your request. Please try again."
          };
        }
      }
      /**
       * Build compact context with all pairing data
       */
      buildPairingsContext(pairings2) {
        const lines = ["AVAILABLE PAIRINGS:"];
        pairings2.forEach((p) => {
          const layovers = Array.isArray(p.layovers) ? p.layovers : [];
          const layoverInfo = layovers.map((l) => `${l.city} (${l.duration || "unknown duration"})`).join(", ");
          lines.push(
            `Pairing ${p.pairingNumber}: ${p.pairingDays}d | ${p.creditHours}cr | ${p.blockHours}blk | ${p.tafb} TAFB | ${p.holdProbability}% hold | Route: ${p.route}${layoverInfo ? ` | Layovers: ${layoverInfo}` : ""}`
          );
        });
        return lines.join("\n");
      }
      /**
       * Build system prompt with context
       */
      buildSystemPrompt(bidPackage, seniorityPercentile) {
        const packageInfo = bidPackage ? `${bidPackage.month} ${bidPackage.year} - ${bidPackage.base} ${bidPackage.aircraft}` : "Unknown package";
        const seniorityInfo = seniorityPercentile !== void 0 ? `The pilot's seniority is ${seniorityPercentile}% (lower is more senior).` : "";
        return `You are an expert PBS (Preferential Bidding System) analyst for Delta Airlines pilots.

BID PACKAGE: ${packageInfo}
${seniorityInfo}

Your job is to analyze the pairing data provided and answer the pilot's questions.

IMPORTANT RULES:
1. ANALYZE the actual pairing data provided - don't say "I can't filter by that"
2. Look at ALL the data: days, credit, block, TAFB, layovers, routes, hold probability
3. When asked about "rest time" or "layover duration", analyze the layover durations in the data
4. When asked about "back to back trips", look for pairings that could work together in a schedule
5. When asked about "desirable layovers", consider major cities and longer layovers
6. ALWAYS cite specific pairing numbers in your response
7. Explain WHY you're recommending each pairing

TERMINOLOGY:
- Credit Hours: Pay hours (what pilot gets paid)
- Block Hours: Flight time
- TAFB: Time Away From Base
- Hold Probability: Likelihood of getting the pairing (0-100%)
- Efficiency: Credit/Block ratio (higher = more pay per flight hour)
- Layover: Rest period between flight days

Be helpful, analyze the data thoroughly, and give specific recommendations with pairing numbers.`;
      }
      /**
       * Extract pairing numbers from response
       */
      extractPairingNumbers(response) {
        const matches = response.match(/\b\d{4,5}\b/g);
        return matches ? [...new Set(matches)] : [];
      }
    };
  }
});

// server/vercel-entry.ts
import "dotenv/config";
import express from "express";

// server/routes.ts
import { createServer } from "http";

// shared/schema.ts
var schema_exports = {};
__export(schema_exports, {
  bidHistory: () => bidHistory,
  bidPackages: () => bidPackages,
  bidPackagesRelations: () => bidPackagesRelations,
  chatHistory: () => chatHistory,
  insertBidHistorySchema: () => insertBidHistorySchema,
  insertBidPackageSchema: () => insertBidPackageSchema,
  insertPairingSchema: () => insertPairingSchema,
  insertUserCalendarEventSchema: () => insertUserCalendarEventSchema,
  insertUserFavoriteSchema: () => insertUserFavoriteSchema,
  insertUserSchema: () => insertUserSchema,
  pairings: () => pairings,
  pairingsRelations: () => pairingsRelations,
  userCalendarEvents: () => userCalendarEvents,
  userCalendarEventsRelations: () => userCalendarEventsRelations,
  userFavorites: () => userFavorites,
  userFavoritesRelations: () => userFavoritesRelations,
  users: () => users,
  usersRelations: () => usersRelations
});
import {
  pgTable,
  text,
  serial,
  integer,
  decimal,
  timestamp,
  jsonb,
  varchar,
  json,
  unique,
  date
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
var users = pgTable("users", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }),
  seniorityNumber: integer("seniority_number").notNull(),
  seniorityPercentile: integer("seniority_percentile").default(50),
  // 0-100, lower is more senior
  base: varchar("base", { length: 10 }).notNull(),
  aircraft: varchar("aircraft", { length: 50 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull()
});
var bidPackages = pgTable("bid_packages", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  month: text("month").notNull(),
  year: integer("year").notNull(),
  base: text("base").notNull(),
  aircraft: text("aircraft").notNull(),
  uploadedAt: timestamp("uploaded_at").defaultNow().notNull(),
  status: text("status").notNull().default("processing"),
  // processing, completed, failed
  alvHours: decimal("alv_hours", { precision: 5, scale: 2 }),
  // Average Line Value hours
  alvTable: jsonb("alv_table"),
  // Full ALV table data as JSON
  bidPeriodStart: date("bid_period_start"),
  // First day of bid period (e.g. May 2)
  bidPeriodEnd: date("bid_period_end")
  // Last day of bid period (e.g. June 1)
});
var pairings = pgTable("pairings", {
  id: serial("id").primaryKey(),
  bidPackageId: integer("bid_package_id").notNull().references(() => bidPackages.id),
  pairingNumber: text("pairing_number").notNull(),
  effectiveDates: text("effective_dates").notNull(),
  route: text("route").notNull(),
  creditHours: decimal("credit_hours", { precision: 4, scale: 2 }).notNull(),
  blockHours: decimal("block_hours", { precision: 4, scale: 2 }).notNull(),
  tafb: text("tafb").notNull(),
  // Time Away From Base
  fdp: text("fdp"),
  // Flight Duty Period
  payHours: text("pay_hours"),
  // Time format like "12:43"
  sitEdpPay: decimal("sit_edp_pay", { precision: 4, scale: 2 }),
  carveouts: text("carveouts"),
  checkInTime: text("check_in_time"),
  // Time format like "10.35"
  deadheads: integer("deadheads").default(0),
  layovers: jsonb("layovers"),
  // Array of layover details
  flightSegments: jsonb("flight_segments").notNull(),
  // Array of flight segment details
  fullTextBlock: text("full_text_block").notNull(),
  // Complete pairing text from PDF
  holdProbability: integer("hold_probability").default(0),
  // Percentage 0-100
  holdProbabilityReasoning: jsonb("hold_probability_reasoning"),
  // Array of reasoning strings
  pairingDays: integer("pairing_days").default(1)
  // Number of days (calculated from flight segment day letters)
});
var bidHistory = pgTable("bid_history", {
  id: serial("id").primaryKey(),
  pairingNumber: text("pairing_number").notNull(),
  month: text("month").notNull(),
  year: integer("year").notNull(),
  base: text("base").notNull(),
  aircraft: text("aircraft").notNull(),
  juniorHolderSeniority: integer("junior_holder_seniority").notNull(),
  juniorHolderName: text("junior_holder_name"),
  juniorHolderEmployeeNumber: text("junior_holder_employee_number"),
  awardType: text("award_type"),
  // Regular, Coverage, Open
  // Trip characteristics for fingerprinting
  pairingDays: integer("pairing_days").notNull(),
  creditHours: decimal("credit_hours", { precision: 4, scale: 2 }).notNull(),
  totalCredit: decimal("total_credit", { precision: 4, scale: 2 }),
  // Some pairings have month vs total credit
  layoverCities: text("layover_cities"),
  // e.g., "BOS-14 RDU-14"
  checkInDate: text("check_in_date"),
  // e.g., "10/07 Tue 05:59"
  checkOutDate: text("check_out_date"),
  // e.g., "10/09 Thu 11:55"
  // Link to actual pairing from bid package (for full flight segment data)
  linkedPairingId: integer("linked_pairing_id").references(() => pairings.id),
  // Copied from linked pairing for efficient matching
  layoverCitiesFromPackage: text("layover_cities_from_package"),
  // Actual layovers from bid package
  turnDestination: text("turn_destination"),
  // For 1-day trips: the turnaround airport (e.g., "BOS")
  legSignature: text("leg_signature"),
  // Full leg sequence (e.g., "LGA-BOS-LGA" or "LGA-ORD-LGA-JAX-LGA")
  // Trip fingerprint (computed from characteristics)
  tripFingerprint: jsonb("trip_fingerprint"),
  // Structured fingerprint for matching
  awardedAt: timestamp("awarded_at").notNull(),
  uploadedAt: timestamp("uploaded_at").defaultNow().notNull()
});
var userFavorites = pgTable(
  "user_favorites",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").references(() => users.id).notNull(),
    pairingId: integer("pairing_id").references(() => pairings.id).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull()
  },
  (table) => ({
    // Unique constraint to prevent duplicate favorites
    uniqueUserPairing: unique("unique_user_pairing_favorite").on(
      table.userId,
      table.pairingId
    )
  })
);
var chatHistory = pgTable("chat_history", {
  id: serial("id").primaryKey(),
  sessionId: varchar("session_id", { length: 255 }).notNull(),
  bidPackageId: integer("bid_package_id").references(() => bidPackages.id),
  messageType: varchar("message_type", { length: 20 }).notNull(),
  // 'user' or 'assistant'
  content: text("content").notNull(),
  messageData: json("message_data"),
  // For storing any structured data
  createdAt: timestamp("created_at").defaultNow().notNull()
});
var userCalendarEvents = pgTable("user_calendar_events", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull(),
  pairingId: integer("pairing_id").references(() => pairings.id).notNull(),
  startDate: timestamp("start_date").notNull(),
  endDate: timestamp("end_date").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull()
});
var bidPackagesRelations = relations(bidPackages, ({ many }) => ({
  pairings: many(pairings)
}));
var pairingsRelations = relations(pairings, ({ one, many }) => ({
  bidPackage: one(bidPackages, {
    fields: [pairings.bidPackageId],
    references: [bidPackages.id]
  }),
  favorites: many(userFavorites),
  calendarEvents: many(userCalendarEvents)
}));
var usersRelations = relations(users, ({ many }) => ({
  favorites: many(userFavorites),
  calendarEvents: many(userCalendarEvents)
}));
var userFavoritesRelations = relations(userFavorites, ({ one }) => ({
  user: one(users, {
    fields: [userFavorites.userId],
    references: [users.id]
  }),
  pairing: one(pairings, {
    fields: [userFavorites.pairingId],
    references: [pairings.id]
  })
}));
var userCalendarEventsRelations = relations(
  userCalendarEvents,
  ({ one }) => ({
    user: one(users, {
      fields: [userCalendarEvents.userId],
      references: [users.id]
    }),
    pairing: one(pairings, {
      fields: [userCalendarEvents.pairingId],
      references: [pairings.id]
    })
  })
);
var insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
  updatedAt: true
});
var insertBidPackageSchema = createInsertSchema(bidPackages).omit({
  id: true,
  uploadedAt: true,
  status: true
});
var insertPairingSchema = createInsertSchema(pairings).omit({
  id: true
});
var insertBidHistorySchema = createInsertSchema(bidHistory).omit({
  id: true
});
var insertUserFavoriteSchema = createInsertSchema(userFavorites).omit({
  id: true,
  createdAt: true
});
var insertUserCalendarEventSchema = createInsertSchema(
  userCalendarEvents
).omit({
  id: true,
  createdAt: true
});

// server/db.ts
import { config } from "dotenv";
import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
config();
if (process.env.VERCEL) {
  neonConfig.fetchConnectionCache = true;
} else {
  import("ws").then((ws) => {
    neonConfig.webSocketConstructor = ws.default;
  });
  neonConfig.pipelineTLS = false;
  neonConfig.pipelineConnect = false;
  neonConfig.useSecureWebSocket = true;
}
if (!process.env.DATABASE_URL) {
  console.error("Environment variables:", {
    NODE_ENV: process.env.NODE_ENV,
    hasDbUrl: !!process.env.DATABASE_URL,
    envKeys: Object.keys(process.env).filter(
      (k) => k.includes("DB") || k.includes("URL")
    )
  });
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?"
  );
}
var DatabaseCircuitBreaker = class {
  constructor() {
    this.failures = 0;
    this.lastFailureTime = 0;
    this.state = "CLOSED";
    this.failureThreshold = 5;
    this.recoveryTimeout = 3e4;
    // 30 seconds
    this.resetTimeout = 6e4;
  }
  // 1 minute
  canExecute() {
    if (this.state === "CLOSED") {
      return true;
    }
    if (this.state === "OPEN") {
      if (Date.now() - this.lastFailureTime > this.recoveryTimeout) {
        this.state = "HALF_OPEN";
        return true;
      }
      return false;
    }
    return this.state === "HALF_OPEN";
  }
  onSuccess() {
    this.failures = 0;
    this.state = "CLOSED";
  }
  onFailure() {
    this.failures++;
    this.lastFailureTime = Date.now();
    if (this.failures >= this.failureThreshold) {
      this.state = "OPEN";
      console.log(
        `Database circuit breaker OPEN - too many failures (${this.failures})`
      );
      setTimeout(() => {
        if (this.state === "OPEN") {
          this.state = "HALF_OPEN";
          console.log("Database circuit breaker transitioning to HALF_OPEN");
        }
      }, this.resetTimeout);
    }
  }
  getState() {
    return this.state;
  }
};
var circuitBreaker = new DatabaseCircuitBreaker();
var createPool = () => {
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 3,
    // Further reduced to prevent overload
    min: 0,
    // Allow pool to completely drain
    idleTimeoutMillis: 2e4,
    // Faster cleanup of idle connections
    connectionTimeoutMillis: 8e3,
    // Faster timeout
    maxUses: 5e3,
    // More aggressive connection recycling
    allowExitOnIdle: true
    // Allow pool to exit when no connections
  });
};
var pool = createPool();
var db = drizzle({ client: pool, schema: schema_exports });
var reconnectDatabase = async (attempt = 1) => {
  const maxAttempts = 5;
  const baseDelay = 1e3;
  try {
    console.log(`Database reconnection attempt ${attempt}/${maxAttempts}...`);
    try {
      await pool.end();
    } catch (endError) {
      console.warn("Error ending existing pool:", endError);
    }
    const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), 1e4);
    await new Promise((resolve) => setTimeout(resolve, delay));
    pool = createPool();
    const newDb = drizzle({ client: pool, schema: schema_exports });
    await pool.query("SELECT 1 as test");
    console.log(`\u2705 Database reconnection successful on attempt ${attempt}`);
    circuitBreaker.onSuccess();
    return newDb;
  } catch (error) {
    console.error(`Database reconnection attempt ${attempt} failed:`, error);
    circuitBreaker.onFailure();
    if (attempt < maxAttempts) {
      return await reconnectDatabase(attempt + 1);
    } else {
      throw new Error(
        `Database reconnection failed after ${maxAttempts} attempts: ${error}`
      );
    }
  }
};
pool.on("error", async (err) => {
  console.error("Database pool error:", err);
  circuitBreaker.onFailure();
  const shouldReconnect = err.message.includes("Connection terminated") || err.message.includes("WebSocket") || err.message.includes("ECONNREFUSED") || err.message.includes("connection closed");
  if (shouldReconnect) {
    console.log("Triggering automatic reconnection due to pool error");
    setTimeout(async () => {
      try {
        await reconnectDatabase();
      } catch (reconnectError) {
        console.error("Automatic reconnection failed:", reconnectError);
      }
    }, 2e3);
  }
});
var executeWithRetry = async (operation, operationName = "database operation") => {
  if (!circuitBreaker.canExecute()) {
    throw new Error(
      `Database circuit breaker is ${circuitBreaker.getState()} - operation blocked`
    );
  }
  try {
    const result = await operation();
    circuitBreaker.onSuccess();
    return result;
  } catch (error) {
    console.error(`${operationName} failed:`, error);
    circuitBreaker.onFailure();
    const isConnectionError = error instanceof Error && (error.message.includes("Connection terminated") || error.message.includes("connection closed") || error.message.includes("ECONNREFUSED") || error.message.includes("WebSocket") || error.message.includes("Pool is ending"));
    if (isConnectionError && circuitBreaker.canExecute()) {
      console.log(`Attempting recovery for ${operationName}...`);
      try {
        await reconnectDatabase();
        const result = await operation();
        circuitBreaker.onSuccess();
        return result;
      } catch (retryError) {
        console.error(
          `${operationName} retry after reconnection failed:`,
          retryError
        );
        circuitBreaker.onFailure();
        throw retryError;
      }
    }
    throw error;
  }
};
var getDatabaseHealth = async () => {
  try {
    if (!circuitBreaker.canExecute()) {
      return {
        connected: false,
        circuitBreakerState: circuitBreaker.getState(),
        poolInfo: { status: "blocked by circuit breaker" }
      };
    }
    await pool.query("SELECT 1");
    return {
      connected: true,
      circuitBreakerState: circuitBreaker.getState(),
      poolInfo: {
        totalCount: pool.totalCount,
        idleCount: pool.idleCount,
        waitingCount: pool.waitingCount
      }
    };
  } catch (error) {
    return {
      connected: false,
      circuitBreakerState: circuitBreaker.getState(),
      poolInfo: {
        error: error instanceof Error ? error.message : "Unknown error"
      }
    };
  }
};
var gracefulShutdown = async (signal) => {
  console.log(`${signal} received, shutting down database connections...`);
  try {
    await pool.end();
    console.log("Database connections closed successfully");
  } catch (error) {
    console.error("Error during database shutdown:", error);
  }
  process.exit(0);
};
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
var keepAliveInterval;
var startKeepAlive = () => {
  keepAliveInterval = setInterval(async () => {
    if (circuitBreaker.canExecute()) {
      try {
        await pool.query("SELECT 1");
      } catch (error) {
        console.warn("Keep-alive query failed:", error);
      }
    }
  }, 45e3);
};
startKeepAlive();

// server/storage.ts
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
  inArray
} from "drizzle-orm";
var parseDecimal = (value) => parseFloat(String(value)) || 0;
var parseNullable = (value) => value !== null && value !== void 0 ? parseFloat(String(value)) || 0 : 0;
var DatabaseStorage = class {
  async getUser(id) {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || void 0;
  }
  async getUserByUsername(username) {
    return void 0;
  }
  async createUser(insertUser) {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }
  async createOrUpdateUser(userData) {
    const existingUser = await this.getUserBySeniority(
      userData.seniorityNumber
    );
    if (existingUser) {
      const updateData = {
        base: userData.base,
        aircraft: userData.aircraft,
        updatedAt: /* @__PURE__ */ new Date()
      };
      if (userData.name !== void 0) {
        updateData.name = userData.name;
      }
      if (userData.seniorityPercentile !== void 0) {
        updateData.seniorityPercentile = userData.seniorityPercentile;
      }
      const [updatedUser] = await db.update(users).set(updateData).where(eq(users.seniorityNumber, userData.seniorityNumber)).returning();
      return updatedUser;
    } else {
      const newUserData = {
        seniorityNumber: userData.seniorityNumber,
        base: userData.base,
        aircraft: userData.aircraft,
        seniorityPercentile: userData.seniorityPercentile || 50
        // Default to 50 if not provided
      };
      if (userData.name) {
        newUserData.name = userData.name;
      }
      return await this.createUser(newUserData);
    }
  }
  async getUserBySeniority(seniorityNumber) {
    const [user] = await db.select().from(users).where(eq(users.seniorityNumber, seniorityNumber));
    return user || void 0;
  }
  async createBidPackage(bidPackage) {
    const [newBidPackage] = await db.insert(bidPackages).values(bidPackage).returning();
    return newBidPackage;
  }
  async getBidPackages() {
    return await db.select().from(bidPackages).orderBy(desc(bidPackages.uploadedAt));
  }
  async getBidPackage(id) {
    const [bidPackage] = await db.select().from(bidPackages).where(eq(bidPackages.id, id));
    return bidPackage || void 0;
  }
  async updateBidPackageStatus(id, status) {
    await db.update(bidPackages).set({ status }).where(eq(bidPackages.id, id));
  }
  async updateBidPackageInfo(id, data) {
    const updateData = {};
    if (data.name !== void 0) {
      updateData.name = data.name;
    }
    if (data.month !== void 0) {
      updateData.month = data.month;
    }
    if (data.year !== void 0) {
      updateData.year = data.year;
    }
    if (data.base !== void 0) {
      updateData.base = data.base;
    }
    if (data.aircraft !== void 0) {
      updateData.aircraft = data.aircraft;
    }
    if (data.alvHours !== void 0) {
      updateData.alvHours = data.alvHours.toString();
    }
    if (data.bidPeriodStart !== void 0) {
      updateData.bidPeriodStart = data.bidPeriodStart;
    }
    if (data.bidPeriodEnd !== void 0) {
      updateData.bidPeriodEnd = data.bidPeriodEnd;
    }
    if (data.alvTable !== void 0) {
      updateData.alvTable = data.alvTable;
    }
    if (Object.keys(updateData).length === 0) {
      return;
    }
    await db.update(bidPackages).set(updateData).where(eq(bidPackages.id, id));
  }
  async deleteBidPackage(id) {
    await db.delete(chatHistory).where(eq(chatHistory.bidPackageId, id));
    const pairingIds = await db.select({ id: pairings.id }).from(pairings).where(eq(pairings.bidPackageId, id));
    const pairingIdArray = pairingIds.map((p) => p.id);
    if (pairingIdArray.length > 0) {
      await db.delete(userFavorites).where(inArray(userFavorites.pairingId, pairingIdArray));
      await db.delete(userCalendarEvents).where(inArray(userCalendarEvents.pairingId, pairingIdArray));
    }
    await db.delete(pairings).where(eq(pairings.bidPackageId, id));
    await db.delete(bidPackages).where(eq(bidPackages.id, id));
    console.log(`Deleted bid package ${id} and all associated data`);
  }
  async clearAllData() {
    await db.delete(chatHistory);
    await db.delete(userFavorites);
    await db.delete(userCalendarEvents);
    await db.delete(bidHistory);
    await db.delete(pairings);
    await db.delete(bidPackages);
    console.log("All data cleared from database");
  }
  async createPairing(pairing) {
    const [newPairing] = await db.insert(pairings).values(pairing).returning();
    return newPairing;
  }
  async getPairings(bidPackageId) {
    if (bidPackageId) {
      return await db.select().from(pairings).where(eq(pairings.bidPackageId, bidPackageId)).orderBy(asc(pairings.pairingNumber));
    }
    return await db.select().from(pairings).orderBy(asc(pairings.pairingNumber));
  }
  async getPairing(id) {
    const [pairing] = await db.select().from(pairings).where(eq(pairings.id, id));
    return pairing || void 0;
  }
  async getPairingByNumber(pairingNumber, bidPackageId) {
    const whereConditions = [eq(pairings.pairingNumber, pairingNumber)];
    if (bidPackageId) {
      whereConditions.push(eq(pairings.bidPackageId, bidPackageId));
    }
    const [pairing] = await db.select().from(pairings).where(and(...whereConditions));
    return pairing || void 0;
  }
  async searchPairings(filters) {
    try {
      const conditions = [];
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
      if (filters.creditMin !== void 0) {
        conditions.push(
          sql`CAST(${pairings.creditHours} AS DECIMAL) >= ${filters.creditMin}`
        );
      }
      if (filters.creditMax !== void 0) {
        conditions.push(
          sql`CAST(${pairings.creditHours} AS DECIMAL) <= ${filters.creditMax}`
        );
      }
      if (filters.blockMin !== void 0) {
        conditions.push(
          sql`CAST(${pairings.blockHours} AS DECIMAL) >= ${filters.blockMin}`
        );
      }
      if (filters.blockMax !== void 0) {
        conditions.push(
          sql`CAST(${pairings.blockHours} AS DECIMAL) <= ${filters.blockMax}`
        );
      }
      if (filters.holdProbabilityMin !== void 0) {
        conditions.push(
          gte(pairings.holdProbability, filters.holdProbabilityMin)
        );
      }
      if (filters.pairingDays !== void 0) {
        conditions.push(eq(pairings.pairingDays, filters.pairingDays));
      }
      if (filters.pairingDaysMin !== void 0) {
        conditions.push(gte(pairings.pairingDays, filters.pairingDaysMin));
      }
      if (filters.pairingDaysMax !== void 0) {
        conditions.push(lte(pairings.pairingDays, filters.pairingDaysMax));
      }
      if (filters.tafbMin !== void 0) {
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
      if (filters.tafbMax !== void 0) {
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
        let results = await db.select().from(pairings).where(and(...conditions)).orderBy(asc(pairings.pairingNumber));
        if (filters.efficiency !== void 0) {
          results = results.filter((pairing) => {
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
  async searchPairingsWithPagination(filters) {
    try {
      const conditions = [];
      const page = filters.page || 1;
      const limit = Math.min(filters.limit || 50, 100);
      const offset = (page - 1) * limit;
      if (!filters.bidPackageId) {
        console.error("Bid package ID is required for pairing search");
        return {
          pairings: [],
          pagination: {
            page,
            limit,
            total: 0,
            totalPages: 0,
            hasNext: false,
            hasPrev: false
          },
          statistics: {
            likelyToHold: 0,
            highCredit: 0,
            ratioBreakdown: { excellent: 0, good: 0, average: 0, poor: 0 }
          }
        };
      }
      conditions.push(eq(pairings.bidPackageId, filters.bidPackageId));
      console.log(`searchPairingsWithPagination: bidPackageId=${filters.bidPackageId}, page=${page}, limit=${limit}`);
      const debugCount = await db.select({ count: sql`count(*)` }).from(pairings).where(eq(pairings.bidPackageId, filters.bidPackageId)).execute();
      console.log(`searchPairingsWithPagination: Database has ${debugCount[0]?.count || 0} total pairings for bid package ${filters.bidPackageId}`);
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
      if (filters.creditMin !== void 0) {
        conditions.push(
          sql`CAST(${pairings.creditHours} AS DECIMAL) >= ${filters.creditMin}`
        );
      }
      if (filters.creditMax !== void 0) {
        conditions.push(
          sql`CAST(${pairings.creditHours} AS DECIMAL) <= ${filters.creditMax}`
        );
      }
      if (filters.blockMin !== void 0) {
        conditions.push(
          sql`CAST(${pairings.blockHours} AS DECIMAL) >= ${filters.blockMin}`
        );
      }
      if (filters.blockMax !== void 0) {
        conditions.push(
          sql`CAST(${pairings.blockHours} AS DECIMAL) <= ${filters.blockMax}`
        );
      }
      if (filters.holdProbabilityMin !== void 0) {
        conditions.push(
          gte(pairings.holdProbability, filters.holdProbabilityMin)
        );
      }
      if (filters.pairingDays !== void 0) {
        conditions.push(eq(pairings.pairingDays, filters.pairingDays));
      }
      if (filters.pairingDaysMin !== void 0) {
        conditions.push(gte(pairings.pairingDays, filters.pairingDaysMin));
      }
      if (filters.pairingDaysMax !== void 0) {
        conditions.push(lte(pairings.pairingDays, filters.pairingDaysMax));
      }
      if (filters.tafbMin !== void 0) {
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
      if (filters.tafbMax !== void 0) {
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
      const statsQuery = db.select({
        likelyToHold: sql`cast(sum(case when ${pairings.holdProbability} IS NOT NULL AND ${pairings.holdProbability} >= 70 then 1 else 0 end) as integer)`,
        highCredit: sql`cast(sum(case when ${pairings.creditHours} IS NOT NULL AND cast(${pairings.creditHours} as numeric) >= 18 then 1 else 0 end) as integer)`,
        totalCount: sql`cast(count(*) as integer)`,
        excellent: sql`cast(sum(case when (cast(${pairings.creditHours} as numeric) / nullif(cast(${pairings.blockHours} as numeric),0)) >= 1.3 then 1 else 0 end) as integer)`,
        good: sql`cast(sum(case when (cast(${pairings.creditHours} as numeric) / nullif(cast(${pairings.blockHours} as numeric),0)) >= 1.2 and (cast(${pairings.creditHours} as numeric) / nullif(cast(${pairings.blockHours} as numeric),0)) < 1.3 then 1 else 0 end) as integer)`,
        average: sql`cast(sum(case when (cast(${pairings.creditHours} as numeric) / nullif(cast(${pairings.blockHours} as numeric),0)) >= 1.1 and (cast(${pairings.creditHours} as numeric) / nullif(cast(${pairings.blockHours} as numeric),0)) < 1.2 then 1 else 0 end) as integer)`,
        poor: sql`cast(sum(case when (cast(${pairings.creditHours} as numeric) / nullif(cast(${pairings.blockHours} as numeric),0)) < 1.1 then 1 else 0 end) as integer)`
      }).from(pairings).where(and(...conditions));
      const [stats] = await statsQuery.execute();
      const sortColumn = filters.sortBy || "pairingNumber";
      const sortDirection = filters.sortOrder === "desc" ? desc : asc;
      const sortColumnMap = {
        pairingNumber: pairings.pairingNumber,
        creditHours: pairings.creditHours,
        blockHours: pairings.blockHours,
        holdProbability: pairings.holdProbability,
        pairingDays: pairings.pairingDays,
        route: pairings.route
      };
      const efficiencyExpr = sql`(CAST(${pairings.creditHours} AS numeric) / NULLIF(CAST(${pairings.blockHours} AS numeric), 0))`;
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
      if (filters.efficiency !== void 0) {
        conditions.push(sql`${efficiencyExpr} >= ${filters.efficiency}`);
      }
      const sortColumnField = sortColumn === "creditBlockRatio" ? efficiencyExpr : sortColumn === "tafb" ? tafbMinutesExpr : sortColumnMap[sortColumn] || pairings.pairingNumber;
      const pairingsResult = await db.select({
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
        pairingDays: pairings.pairingDays,
        fullTextBlock: pairings.fullTextBlock,
        totalCount: sql`count(*) over()`
      }).from(pairings).where(and(...conditions)).orderBy(sortDirection(sortColumnField)).limit(limit).offset(offset).execute();
      const total = pairingsResult.length > 0 ? pairingsResult[0].totalCount : 0;
      const totalPages = Math.ceil(total / limit);
      console.log(`searchPairingsWithPagination: Query returned ${pairingsResult.length} rows, total=${total}, totalPages=${totalPages}`);
      let finalResults = pairingsResult.map((r) => {
        const { totalCount, ...rest } = r;
        return rest;
      });
      if (filters.efficiency !== void 0) {
        finalResults = finalResults.filter((pairing) => {
          const creditHours = parseFloat(pairing.creditHours.toString());
          const blockHours = parseFloat(pairing.blockHours.toString());
          const efficiency = blockHours > 0 ? creditHours / blockHours : 0;
          return efficiency >= filters.efficiency;
        });
      }
      return {
        pairings: finalResults,
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1
        },
        statistics: {
          likelyToHold: stats.likelyToHold,
          highCredit: stats.highCredit,
          ratioBreakdown: {
            excellent: stats.excellent,
            good: stats.good,
            average: stats.average,
            poor: stats.poor
          }
        }
      };
    } catch (error) {
      console.error("Error in searchPairingsWithPagination:", error);
      return {
        pairings: [],
        pagination: {
          page: 1,
          limit: 50,
          total: 0,
          totalPages: 0,
          hasNext: false,
          hasPrev: false
        },
        statistics: {
          likelyToHold: 0,
          highCredit: 0,
          ratioBreakdown: { excellent: 0, good: 0, average: 0, poor: 0 }
        }
      };
    }
  }
  async getAllPairingsForBidPackage(filters) {
    try {
      const conditions = [];
      if (!filters.bidPackageId) {
        console.error("Bid package ID is required for pairing search");
        return {
          pairings: [],
          statistics: {
            likelyToHold: 0,
            highCredit: 0,
            ratioBreakdown: { excellent: 0, good: 0, average: 0, poor: 0 }
          }
        };
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
      if (filters.creditMin !== void 0) {
        conditions.push(
          sql`CAST(${pairings.creditHours} AS DECIMAL) >= ${filters.creditMin}`
        );
      }
      if (filters.creditMax !== void 0) {
        conditions.push(
          sql`CAST(${pairings.creditHours} AS DECIMAL) <= ${filters.creditMax}`
        );
      }
      if (filters.blockMin !== void 0) {
        conditions.push(
          sql`CAST(${pairings.blockHours} AS DECIMAL) >= ${filters.blockMin}`
        );
      }
      if (filters.blockMax !== void 0) {
        conditions.push(
          sql`CAST(${pairings.blockHours} AS DECIMAL) <= ${filters.blockMax}`
        );
      }
      if (filters.holdProbabilityMin !== void 0) {
        conditions.push(
          gte(pairings.holdProbability, filters.holdProbabilityMin)
        );
      }
      if (filters.pairingDays !== void 0) {
        conditions.push(eq(pairings.pairingDays, filters.pairingDays));
      }
      if (filters.pairingDaysMin !== void 0) {
        conditions.push(gte(pairings.pairingDays, filters.pairingDaysMin));
      }
      if (filters.pairingDaysMax !== void 0) {
        conditions.push(lte(pairings.pairingDays, filters.pairingDaysMax));
      }
      if (filters.tafbMin !== void 0) {
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
      if (filters.tafbMax !== void 0) {
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
      const efficiencyExpr = sql`(CAST(${pairings.creditHours} AS numeric) / NULLIF(CAST(${pairings.blockHours} AS numeric), 0))`;
      if (filters.efficiency !== void 0) {
        conditions.push(sql`${efficiencyExpr} >= ${filters.efficiency}`);
      }
      if (filters.layoverLocations && filters.layoverLocations.length > 0) {
        const citiesArray = `{${filters.layoverLocations.map((c) => `"${c}"`).join(",")}}`;
        conditions.push(
          sql`EXISTS (
            SELECT 1 FROM jsonb_array_elements(${pairings.layovers}) AS layover
            WHERE layover->>'city' = ANY(${citiesArray}::text[])
          )`
        );
      }
      const statsQuery = db.select({
        likelyToHold: sql`cast(sum(case when ${pairings.holdProbability} IS NOT NULL AND ${pairings.holdProbability} >= 70 then 1 else 0 end) as integer)`,
        highCredit: sql`cast(sum(case when ${pairings.creditHours} IS NOT NULL AND cast(${pairings.creditHours} as numeric) >= 18 then 1 else 0 end) as integer)`,
        excellent: sql`cast(sum(case when (cast(${pairings.creditHours} as numeric) / nullif(cast(${pairings.blockHours} as numeric),0)) >= 1.3 then 1 else 0 end) as integer)`,
        good: sql`cast(sum(case when (cast(${pairings.creditHours} as numeric) / nullif(cast(${pairings.blockHours} as numeric),0)) >= 1.2 and (cast(${pairings.creditHours} as numeric) / nullif(cast(${pairings.blockHours} as numeric),0)) < 1.3 then 1 else 0 end) as integer)`,
        average: sql`cast(sum(case when (cast(${pairings.creditHours} as numeric) / nullif(cast(${pairings.blockHours} as numeric),0)) >= 1.1 and (cast(${pairings.creditHours} as numeric) / nullif(cast(${pairings.blockHours} as numeric),0)) < 1.2 then 1 else 0 end) as integer)`,
        poor: sql`cast(sum(case when (cast(${pairings.creditHours} as numeric) / nullif(cast(${pairings.blockHours} as numeric),0)) < 1.1 then 1 else 0 end) as integer)`
      }).from(pairings).where(and(...conditions));
      const [stats] = await statsQuery.execute();
      const sortColumn = filters.sortBy || "pairingNumber";
      const sortDirection = filters.sortOrder === "desc" ? desc : asc;
      const sortColumnMap = {
        pairingNumber: pairings.pairingNumber,
        creditHours: pairings.creditHours,
        blockHours: pairings.blockHours,
        holdProbability: pairings.holdProbability,
        pairingDays: pairings.pairingDays,
        route: pairings.route
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
      const sortColumnField = sortColumn === "creditBlockRatio" ? efficiencyExpr : sortColumn === "tafb" ? tafbMinutesExpr : sortColumnMap[sortColumn] || pairings.pairingNumber;
      const pairingsResult = await db.select({
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
        fullTextBlock: pairings.fullTextBlock
      }).from(pairings).where(and(...conditions)).orderBy(sortDirection(sortColumnField)).execute();
      return {
        pairings: pairingsResult,
        statistics: {
          likelyToHold: stats.likelyToHold,
          highCredit: stats.highCredit,
          ratioBreakdown: {
            excellent: stats.excellent,
            good: stats.good,
            average: stats.average,
            poor: stats.poor
          }
        }
      };
    } catch (error) {
      console.error("Error in getAllPairingsForBidPackage:", error);
      return {
        pairings: [],
        statistics: {
          likelyToHold: 0,
          highCredit: 0,
          ratioBreakdown: { excellent: 0, good: 0, average: 0, poor: 0 }
        }
      };
    }
  }
  async createBidHistory(bidHistoryData) {
    const [newBidHistory] = await db.insert(bidHistory).values(bidHistoryData).returning();
    return newBidHistory;
  }
  async getBidHistoryForPairing(pairingNumber) {
    return await db.select().from(bidHistory).where(eq(bidHistory.pairingNumber, pairingNumber)).orderBy(desc(bidHistory.awardedAt));
  }
  async addUserFavorite(favorite) {
    const existing = await db.select().from(userFavorites).where(
      and(
        eq(userFavorites.userId, favorite.userId),
        eq(userFavorites.pairingId, favorite.pairingId)
      )
    ).limit(1);
    if (existing.length > 0) {
      return existing[0];
    }
    const [newFavorite] = await db.insert(userFavorites).values(favorite).returning();
    return newFavorite;
  }
  async removeUserFavorite(userId, pairingId) {
    await db.delete(userFavorites).where(
      and(
        eq(userFavorites.userId, userId),
        eq(userFavorites.pairingId, pairingId)
      )
    );
  }
  async getUserFavorites(userId) {
    const result = await db.select({
      pairing: pairings
    }).from(userFavorites).innerJoin(pairings, eq(userFavorites.pairingId, pairings.id)).where(eq(userFavorites.userId, userId));
    return result.map((r) => r.pairing);
  }
  // Chat history methods
  async saveChatMessage(message) {
    const [savedMessage] = await db.insert(chatHistory).values(message).returning();
    return savedMessage;
  }
  async getChatHistory(sessionId) {
    return await db.select().from(chatHistory).where(eq(chatHistory.sessionId, sessionId)).orderBy(asc(chatHistory.createdAt));
  }
  async clearChatHistory(sessionId) {
    await db.delete(chatHistory).where(eq(chatHistory.sessionId, sessionId));
  }
  // Enhanced analytics operations for OpenAI token optimization
  async getTopEfficientPairings(bidPackageId, limit = 20) {
    const allPairings = await db.select().from(pairings).where(eq(pairings.bidPackageId, bidPackageId));
    const parseHours = (hours) => {
      if (typeof hours === "number") {
        return hours;
      }
      if (typeof hours === "string") {
        return parseFloat(hours) || 0;
      }
      return 0;
    };
    const pairingsWithEfficiency = allPairings.map((p) => {
      const creditHours = parseHours(p.creditHours);
      const blockHours = parseHours(p.blockHours);
      return {
        ...p,
        efficiency: blockHours > 0 ? creditHours / blockHours : 0
      };
    });
    const topPairings = pairingsWithEfficiency.sort((a, b) => (b.efficiency || 0) - (a.efficiency || 0)).slice(0, limit);
    const stats = {
      totalPairings: allPairings.length,
      avgEfficiency: Number(
        (pairingsWithEfficiency.reduce((sum, p) => sum + p.efficiency, 0) / pairingsWithEfficiency.length).toFixed(2)
      ),
      topEfficiency: Number((topPairings[0]?.efficiency || 0).toFixed(2)),
      avgCredit: Number(
        (pairingsWithEfficiency.reduce(
          (sum, p) => sum + parseDecimal(p.creditHours),
          0
        ) / pairingsWithEfficiency.length).toFixed(2)
      ),
      avgBlock: Number(
        (pairingsWithEfficiency.reduce(
          (sum, p) => sum + parseDecimal(p.blockHours),
          0
        ) / pairingsWithEfficiency.length).toFixed(2)
      )
    };
    return { pairings: topPairings, stats };
  }
  async getTopCreditPairings(bidPackageId, limit = 20) {
    const topPairings = await db.select().from(pairings).where(eq(pairings.bidPackageId, bidPackageId)).orderBy(desc(pairings.creditHours)).limit(limit);
    const allPairings = await db.select().from(pairings).where(eq(pairings.bidPackageId, bidPackageId));
    const stats = {
      totalPairings: allPairings.length,
      maxCredit: topPairings[0]?.creditHours || 0,
      avgCreditHours: allPairings.reduce((sum, p) => sum + parseDecimal(p.creditHours), 0) / allPairings.length,
      minCredit: Math.min(...allPairings.map((p) => parseDecimal(p.creditHours)))
    };
    return { pairings: topPairings, stats };
  }
  async getBidPackageStats(bidPackageId) {
    const allPairings = await db.select().from(pairings).where(eq(pairings.bidPackageId, bidPackageId));
    if (allPairings.length === 0) {
      return {
        totalPairings: 0,
        creditBlockRatios: { min: 1, max: 1, average: 1 },
        creditHours: { min: 0, max: 0, average: 0 },
        blockHours: { min: 0, max: 0, average: 0 },
        avgByDays: {},
        pairingTypeBreakdown: {},
        ratioBreakdown: { excellent: 0, good: 0, average: 0, poor: 0 }
      };
    }
    const ratios = allPairings.filter((p) => parseDecimal(p.blockHours) > 0).map((p) => parseDecimal(p.creditHours) / parseDecimal(p.blockHours));
    const creditHours = allPairings.map((p) => parseDecimal(p.creditHours));
    const blockHours = allPairings.map((p) => parseDecimal(p.blockHours));
    const avgByDays = {};
    const pairingTypeBreakdown = {};
    for (let days = 1; days <= 5; days++) {
      const dayPairings = allPairings.filter((p) => p.pairingDays === days);
      if (dayPairings.length > 0) {
        const dayCredit = dayPairings.reduce((sum, p) => sum + parseDecimal(p.creditHours), 0);
        const dayBlock = dayPairings.reduce((sum, p) => sum + parseDecimal(p.blockHours), 0);
        avgByDays[days] = {
          credit: dayCredit / dayPairings.length,
          block: dayBlock / dayPairings.length
        };
        pairingTypeBreakdown[days] = dayPairings.length;
      }
    }
    const minRatio = Math.min(...ratios);
    const maxRatio = Math.max(...ratios);
    const range = maxRatio - minRatio;
    const ratioBreakdown = allPairings.reduce(
      (acc, pairing) => {
        const credit = parseDecimal(pairing.creditHours);
        const block = parseDecimal(pairing.blockHours);
        if (block === 0) return acc;
        const ratio = credit / block;
        const percentile = range > 0 ? (ratio - minRatio) / range : 0;
        if (percentile >= 0.75) {
          acc.excellent++;
        } else if (percentile >= 0.5) {
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
      },
      avgByDays,
      pairingTypeBreakdown,
      ratioBreakdown
    };
  }
  async getTopHoldProbabilityPairings(bidPackageId, limit = 20) {
    const topPairings = await db.select().from(pairings).where(eq(pairings.bidPackageId, bidPackageId)).orderBy(desc(pairings.holdProbability)).limit(limit);
    const allPairings = await db.select().from(pairings).where(eq(pairings.bidPackageId, bidPackageId));
    const stats = {
      totalPairings: allPairings.length,
      maxHold: topPairings[0]?.holdProbability || 0,
      avgHold: allPairings.reduce((sum, p) => sum + (p.holdProbability || 0), 0) / allPairings.length,
      highHoldCount: allPairings.filter((p) => (p.holdProbability || 0) >= 80).length
    };
    return { pairings: topPairings, stats };
  }
  async getPairingStatsSummary(bidPackageId) {
    const allPairings = await db.select().from(pairings).where(eq(pairings.bidPackageId, bidPackageId));
    const turnCount = allPairings.filter(
      (p) => parseNullable(p.pairingDays) === 1
    ).length;
    const multiDayCount = allPairings.filter(
      (p) => parseNullable(p.pairingDays) > 1
    ).length;
    const deadheadCount = allPairings.filter(
      (p) => p.fullTextBlock?.includes("DH") || p.flightSegments && Array.isArray(p.flightSegments) && p.flightSegments.some((seg) => seg.isDeadhead === true)
    ).length;
    return {
      totalPairings: allPairings.length,
      avgCreditHours: allPairings.reduce((sum, p) => sum + parseDecimal(p.creditHours), 0) / allPairings.length,
      avgBlockHours: allPairings.reduce((sum, p) => sum + parseDecimal(p.blockHours), 0) / allPairings.length,
      avgPairingDays: allPairings.reduce((sum, p) => sum + parseNullable(p.pairingDays), 0) / allPairings.length,
      avgHoldProbability: allPairings.reduce((sum, p) => sum + (p.holdProbability || 0), 0) / allPairings.length,
      maxCreditHours: Math.max(
        ...allPairings.map((p) => parseDecimal(p.creditHours))
      ),
      minCreditHours: Math.min(
        ...allPairings.map((p) => parseDecimal(p.creditHours))
      ),
      maxBlockHours: Math.max(
        ...allPairings.map((p) => parseDecimal(p.blockHours))
      ),
      turnCount,
      multiDayCount,
      deadheadCount,
      dayDistribution: {
        "1day": allPairings.filter((p) => parseNullable(p.pairingDays) === 1).length,
        "2day": allPairings.filter((p) => parseNullable(p.pairingDays) === 2).length,
        "3day": allPairings.filter((p) => parseNullable(p.pairingDays) === 3).length,
        "4day": allPairings.filter((p) => parseNullable(p.pairingDays) === 4).length,
        "5day+": allPairings.filter((p) => parseNullable(p.pairingDays) >= 5).length
      }
    };
  }
  async analyzePairingsByLayoverSummary(bidPackageId, city) {
    const allPairings = await db.select().from(pairings).where(eq(pairings.bidPackageId, bidPackageId));
    const layoverAnalysis = allPairings.reduce((acc, p) => {
      if (p.layovers && Array.isArray(p.layovers)) {
        p.layovers.forEach((layover) => {
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
    }, {});
    const summary = Object.entries(layoverAnalysis).map(([city2, data]) => ({
      city: city2,
      count: data.count,
      avgDuration: data.totalDuration / data.count,
      pairings: data.pairings.slice(0, 10)
      // Limit to first 10 pairings
    })).sort((a, b) => b.count - a.count);
    return {
      totalLayovers: Object.values(layoverAnalysis).reduce(
        (sum, data) => sum + data.count,
        0
      ),
      uniqueCities: Object.keys(layoverAnalysis).length,
      topCities: summary.slice(0, 10),
      requestedCity: city ? layoverAnalysis[city] : null
    };
  }
  async getDeadheadAnalysis(bidPackageId) {
    const allPairings = await db.select().from(pairings).where(eq(pairings.bidPackageId, bidPackageId));
    const deadheadPairings = allPairings.filter(
      (p) => p.fullTextBlock?.includes("DH") || p.flightSegments && Array.isArray(p.flightSegments) && p.flightSegments.some((seg) => seg.isDeadhead === true)
    );
    const nonDeadheadPairings = allPairings.filter(
      (p) => !(p.fullTextBlock?.includes("DH") || p.flightSegments && Array.isArray(p.flightSegments) && p.flightSegments.some((seg) => seg.isDeadhead === true))
    );
    return {
      totalPairings: allPairings.length,
      deadheadCount: deadheadPairings.length,
      deadheadPercentage: deadheadPairings.length / allPairings.length * 100,
      avgCreditWithDeadhead: deadheadPairings.reduce(
        (sum, p) => sum + parseDecimal(p.creditHours),
        0
      ) / deadheadPairings.length,
      avgCreditWithoutDeadhead: nonDeadheadPairings.reduce(
        (sum, p) => sum + parseDecimal(p.creditHours),
        0
      ) / nonDeadheadPairings.length,
      topDeadheadPairings: deadheadPairings.sort(
        (a, b) => parseDecimal(b.creditHours) - parseDecimal(a.creditHours)
      ).slice(0, 10).map((p) => ({
        pairingNumber: p.pairingNumber,
        creditHours: p.creditHours,
        blockHours: p.blockHours
      }))
    };
  }
  async getPairingDurationAnalysis(bidPackageId) {
    const allPairings = await db.select().from(pairings).where(eq(pairings.bidPackageId, bidPackageId));
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
    }, {});
    Object.values(durationGroups).forEach((group) => {
      group.avgCredit = group.totalCredit / group.count;
      group.avgBlock = group.totalBlock / group.count;
      group.pairings = group.pairings.sort((a, b) => b.creditHours - a.creditHours).slice(0, 10);
    });
    return {
      totalPairings: allPairings.length,
      durationBreakdown: durationGroups,
      mostCommonDuration: Object.entries(durationGroups).sort(
        ([, a], [, b]) => b.count - a.count
      )[0]?.[0],
      avgDuration: allPairings.reduce((sum, p) => sum + parseNullable(p.pairingDays), 0) / allPairings.length
    };
  }
  // Calendar event methods
  async addUserCalendarEvent(data) {
    const existing = await db.select().from(userCalendarEvents).where(
      and(
        eq(userCalendarEvents.userId, data.userId),
        eq(userCalendarEvents.pairingId, data.pairingId)
      )
    );
    if (existing.length > 0) {
      const [updated] = await db.update(userCalendarEvents).set({
        startDate: data.startDate,
        endDate: data.endDate,
        notes: data.notes
      }).where(eq(userCalendarEvents.id, existing[0].id)).returning();
      console.log("Updated existing calendar event with new times:", updated);
      return updated;
    }
    const [result] = await db.insert(userCalendarEvents).values(data).returning();
    console.log("Added new calendar event:", result);
    return result;
  }
  async removeUserCalendarEvent(userId, pairingId) {
    await db.delete(userCalendarEvents).where(
      and(
        eq(userCalendarEvents.userId, userId),
        eq(userCalendarEvents.pairingId, pairingId)
      )
    );
  }
  async getUserCalendarEvents(userId) {
    const result = await db.select({
      calendarEvent: userCalendarEvents,
      pairing: pairings
    }).from(userCalendarEvents).innerJoin(pairings, eq(userCalendarEvents.pairingId, pairings.id)).where(eq(userCalendarEvents.userId, userId)).orderBy(asc(userCalendarEvents.startDate));
    return result.map((r) => ({ ...r.calendarEvent, pairing: r.pairing }));
  }
  async getUserCalendarEventsForMonth(userId, month, year) {
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59);
    const result = await db.select({
      calendarEvent: userCalendarEvents,
      pairing: pairings
    }).from(userCalendarEvents).innerJoin(pairings, eq(userCalendarEvents.pairingId, pairings.id)).where(
      and(
        eq(userCalendarEvents.userId, userId),
        // Event overlaps with month if: event_start <= month_end AND event_end >= month_start
        lte(userCalendarEvents.startDate, endDate),
        gte(userCalendarEvents.endDate, startDate)
      )
    ).orderBy(asc(userCalendarEvents.startDate));
    return result.map((r) => ({ ...r.calendarEvent, pairing: r.pairing }));
  }
  async getUserCalendarEventsInRange(userId, startDate, endDate) {
    const result = await db.select({
      calendarEvent: userCalendarEvents,
      pairing: pairings
    }).from(userCalendarEvents).innerJoin(pairings, eq(userCalendarEvents.pairingId, pairings.id)).where(
      and(
        eq(userCalendarEvents.userId, userId),
        // Event overlaps with range if: event_start <= range_end AND event_end >= range_start
        lte(userCalendarEvents.startDate, endDate),
        gte(userCalendarEvents.endDate, startDate)
      )
    ).orderBy(asc(userCalendarEvents.startDate));
    return result.map((r) => ({ ...r.calendarEvent, pairing: r.pairing }));
  }
};
var storage = new DatabaseStorage();

// server/seedData.ts
async function seedDatabase() {
  try {
    console.log("Starting database seeding...");
    const bidPackage = await storage.createBidPackage({
      name: "NYC A220 August 2025 Bid Package",
      month: "August",
      year: 2025,
      base: "NYC",
      aircraft: "A220"
    });
    console.log("Created bid package:", bidPackage.id);
    const samplePairings = [
      {
        bidPackageId: bidPackage.id,
        pairingNumber: "7666",
        effectiveDates: "01AUG-31AUG",
        route: "JFK-BOS-JFK-DCA-JFK",
        creditHours: "5.75",
        blockHours: "4.45",
        tafb: "3d 02:15",
        fdp: "11:30",
        payHours: "5.75",
        sitEdpPay: "0.30",
        carveouts: "None",
        deadheads: 0,
        layovers: [
          { city: "BOS", hotel: "Marriott Boston", duration: "10:30" },
          { city: "DCA", hotel: "Hyatt Arlington", duration: "12:45" }
        ],
        flightSegments: [
          {
            day: 1,
            date: "01AUG",
            flightNumber: "DL2145",
            departure: "JFK",
            departureTime: "06:00",
            arrival: "BOS",
            arrivalTime: "07:25",
            blockTime: "1:25",
            turnTime: "0:45"
          },
          {
            day: 1,
            date: "01AUG",
            flightNumber: "DL1876",
            departure: "BOS",
            departureTime: "08:10",
            arrival: "JFK",
            arrivalTime: "09:35",
            blockTime: "1:25"
          }
        ],
        fullTextBlock: `PAIRING: 7666    EFFECTIVE: 01AUG-31AUG
JFK-BOS-JFK-DCA-JFK
01AUG  DL2145  JFK  0600  BOS  0725  1:25  :45
       DL1876  BOS  0810  JFK  0935  1:25
       LAYOVER BOS 10:30 MARRIOTT BOSTON
02AUG  DL1234  JFK  1400  DCA  1530  1:30  :30
       DL5678  DCA  1600  JFK  1725  1:25
       
CREDIT: 5:75  BLOCK: 4:45  TAFB: 3d02:15  FDP: 11:30
PAY: 5:75  SIT/EDP: 0:30  CARVEOUTS: NONE  DH: 0`,
        holdProbability: 85
      },
      {
        bidPackageId: bidPackage.id,
        pairingNumber: "7890",
        effectiveDates: "01AUG-31AUG",
        route: "JFK-LAX-JFK",
        creditHours: "6.25",
        blockHours: "5.15",
        tafb: "4d 08:30",
        fdp: "13:15",
        payHours: "6.25",
        sitEdpPay: "0.50",
        carveouts: "None",
        deadheads: 1,
        layovers: [{ city: "LAX", hotel: "Hilton LAX", duration: "24:30" }],
        flightSegments: [
          {
            day: 1,
            date: "05AUG",
            flightNumber: "DL159",
            departure: "JFK",
            departureTime: "08:00",
            arrival: "LAX",
            arrivalTime: "11:30",
            blockTime: "6:30",
            turnTime: "24:30"
          },
          {
            day: 2,
            date: "06AUG",
            flightNumber: "DL160",
            departure: "LAX",
            departureTime: "12:00",
            arrival: "JFK",
            arrivalTime: "20:30",
            blockTime: "5:30"
          }
        ],
        fullTextBlock: `PAIRING: 7890    EFFECTIVE: 01AUG-31AUG
JFK-LAX-JFK
05AUG  DL159   JFK  0800  LAX  1130  6:30  24:30
       LAYOVER LAX 24:30 HILTON LAX
06AUG  DL160   LAX  1200  JFK  2030  5:30
       
CREDIT: 6:25  BLOCK: 5:15  TAFB: 4d08:30  FDP: 13:15
PAY: 6:25  SIT/EDP: 0:50  CARVEOUTS: NONE  DH: 1`,
        holdProbability: 42
      },
      {
        bidPackageId: bidPackage.id,
        pairingNumber: "8123",
        effectiveDates: "01AUG-31AUG",
        route: "JFK-MIA-JFK-ATL-JFK",
        creditHours: "5.45",
        blockHours: "4.20",
        tafb: "3d 15:45",
        fdp: "12:00",
        payHours: "5.45",
        sitEdpPay: "0.25",
        carveouts: "None",
        deadheads: 0,
        layovers: [
          { city: "MIA", hotel: "Marriott Miami", duration: "14:15" },
          { city: "ATL", hotel: "Hilton Atlanta", duration: "11:30" }
        ],
        flightSegments: [
          {
            day: 1,
            date: "10AUG",
            flightNumber: "DL1089",
            departure: "JFK",
            departureTime: "07:30",
            arrival: "MIA",
            arrivalTime: "10:45",
            blockTime: "3:15",
            turnTime: "14:15"
          },
          {
            day: 2,
            date: "11AUG",
            flightNumber: "DL1090",
            departure: "MIA",
            departureTime: "01:00",
            arrival: "JFK",
            arrivalTime: "03:55",
            blockTime: "2:55",
            turnTime: "4:05"
          }
        ],
        fullTextBlock: `PAIRING: 8123    EFFECTIVE: 01AUG-31AUG
JFK-MIA-JFK-ATL-JFK
10AUG  DL1089  JFK  0730  MIA  1045  3:15  14:15
       LAYOVER MIA 14:15 MARRIOTT MIAMI
11AUG  DL1090  MIA  0100  JFK  0355  2:55  4:05
       DL1456  JFK  0800  ATL  1015  2:15  11:30
       LAYOVER ATL 11:30 HILTON ATLANTA
12AUG  DL1457  ATL  2045  JFK  2315  2:30
       
CREDIT: 5:45  BLOCK: 4:20  TAFB: 3d15:45  FDP: 12:00
PAY: 5:45  SIT/EDP: 0:25  CARVEOUTS: NONE  DH: 0`,
        holdProbability: 73
      },
      {
        bidPackageId: bidPackage.id,
        pairingNumber: "9001",
        effectiveDates: "01AUG-31AUG",
        route: "JFK-SEA-JFK",
        creditHours: "6.45",
        blockHours: "5.35",
        tafb: "2d 22:15",
        fdp: "12:45",
        payHours: "6.45",
        sitEdpPay: "0.60",
        carveouts: "None",
        deadheads: 0,
        layovers: [{ city: "SEA", hotel: "Hyatt Seattle", duration: "22:15" }],
        flightSegments: [
          {
            day: 1,
            date: "15AUG",
            flightNumber: "DL2567",
            departure: "JFK",
            departureTime: "10:30",
            arrival: "SEA",
            arrivalTime: "13:45",
            blockTime: "6:15",
            turnTime: "22:15"
          },
          {
            day: 2,
            date: "16AUG",
            flightNumber: "DL2568",
            departure: "SEA",
            departureTime: "12:00",
            arrival: "JFK",
            arrivalTime: "19:20",
            blockTime: "5:20"
          }
        ],
        fullTextBlock: `PAIRING: 9001    EFFECTIVE: 01AUG-31AUG
JFK-SEA-JFK
15AUG  DL2567  JFK  1030  SEA  1345  6:15  22:15
       LAYOVER SEA 22:15 HYATT SEATTLE
16AUG  DL2568  SEA  1200  JFK  1920  5:20
       
CREDIT: 6:45  BLOCK: 5:35  TAFB: 2d22:15  FDP: 12:45
PAY: 6:45  SIT/EDP: 0:60  CARVEOUTS: NONE  DH: 0`,
        holdProbability: 95
      },
      {
        bidPackageId: bidPackage.id,
        pairingNumber: "9876",
        effectiveDates: "01AUG-31AUG",
        route: "JFK-ORD-DEN-JFK",
        creditHours: "5.15",
        blockHours: "3.85",
        tafb: "4d 12:30",
        fdp: "10:30",
        payHours: "5.15",
        sitEdpPay: "0.15",
        carveouts: "None",
        deadheads: 2,
        layovers: [
          { city: "ORD", hotel: "O'Hare Marriott", duration: "18:45" },
          { city: "DEN", hotel: "Westin Denver", duration: "20:30" }
        ],
        flightSegments: [
          {
            day: 1,
            date: "20AUG",
            flightNumber: "DL1432",
            departure: "JFK",
            departureTime: "14:20",
            arrival: "ORD",
            arrivalTime: "16:45",
            blockTime: "2:25",
            turnTime: "18:45"
          },
          {
            day: 2,
            date: "21AUG",
            flightNumber: "DL2234",
            departure: "ORD",
            departureTime: "11:30",
            arrival: "DEN",
            arrivalTime: "12:45",
            blockTime: "2:15",
            turnTime: "20:30"
          }
        ],
        fullTextBlock: `PAIRING: 9876    EFFECTIVE: 01AUG-31AUG
JFK-ORD-DEN-JFK
20AUG  DL1432  JFK  1420  ORD  1645  2:25  18:45
       LAYOVER ORD 18:45 O'HARE MARRIOTT
21AUG  DL2234  ORD  1130  DEN  1245  2:15  20:30
       LAYOVER DEN 20:30 WESTIN DENVER
22AUG  DHD     DEN  0800  JFK  1430  DEADHEAD
       DHD     JFK  1600  JFK  1600  DEADHEAD
       
CREDIT: 5:15  BLOCK: 3:85  TAFB: 4d12:30  FDP: 10:30
PAY: 5:15  SIT/EDP: 0:15  CARVEOUTS: NONE  DH: 2`,
        holdProbability: 28
      }
    ];
    for (const pairingData of samplePairings) {
      const pairing = await storage.createPairing(pairingData);
      console.log(`Created pairing: ${pairing.pairingNumber}`);
    }
    await storage.updateBidPackageStatus(bidPackage.id, "completed");
    const bidHistoryData = [
      {
        pairingNumber: "7666",
        base: "NYC",
        aircraft: "A220",
        month: "July",
        year: 2025,
        creditHours: "19:45",
        pairingDays: 3,
        juniorHolderSeniority: 15750,
        awardedAt: /* @__PURE__ */ new Date("2025-07-15")
      },
      {
        pairingNumber: "7666",
        base: "NYC",
        aircraft: "A220",
        month: "June",
        year: 2025,
        creditHours: "19:45",
        pairingDays: 3,
        juniorHolderSeniority: 15820,
        awardedAt: /* @__PURE__ */ new Date("2025-06-15")
      },
      {
        pairingNumber: "7890",
        base: "NYC",
        aircraft: "A220",
        month: "July",
        year: 2025,
        creditHours: "22:15",
        pairingDays: 4,
        juniorHolderSeniority: 14500,
        awardedAt: /* @__PURE__ */ new Date("2025-07-15")
      },
      {
        pairingNumber: "9001",
        base: "NYC",
        aircraft: "A220",
        month: "July",
        year: 2025,
        creditHours: "16:30",
        pairingDays: 2,
        juniorHolderSeniority: 16200,
        awardedAt: /* @__PURE__ */ new Date("2025-07-15")
      }
    ];
    for (const historyData of bidHistoryData) {
      await storage.createBidHistory(historyData);
    }
    const user = await storage.createUser({
      seniorityNumber: 15860,
      base: "NYC",
      aircraft: "A220"
    });
    console.log("Database seeding completed successfully!");
    console.log(`Created bid package: ${bidPackage.id}`);
    console.log(`Created ${samplePairings.length} pairings`);
    console.log(`Created user with seniority: ${user.seniorityNumber}`);
  } catch (error) {
    console.error("Error seeding database:", error);
    throw error;
  }
}

// server/pdfParser.ts
import fs from "fs";
import pdfParse from "pdf-parse/lib/pdf-parse.js";

// server/holdProbabilityCalculator.ts
import { and as and2, eq as eq2 } from "drizzle-orm";

// server/tripMatcher.ts
var MONTH_NAME_TO_NUMBER = {
  "jan": 1,
  "january": 1,
  "feb": 2,
  "february": 2,
  "mar": 3,
  "march": 3,
  "apr": 4,
  "april": 4,
  "may": 5,
  "jun": 6,
  "june": 6,
  "jul": 7,
  "july": 7,
  "aug": 8,
  "august": 8,
  "sep": 9,
  "sept": 9,
  "september": 9,
  "oct": 10,
  "october": 10,
  "nov": 11,
  "november": 11,
  "dec": 12,
  "december": 12
};
var TripMatcher = class {
  /**
   * Get season from month (supports numeric 1-12 or string month names)
   */
  static getSeason(month) {
    let numericMonth;
    if (typeof month === "string") {
      numericMonth = MONTH_NAME_TO_NUMBER[month.toLowerCase()] || parseInt(month) || (/* @__PURE__ */ new Date()).getMonth() + 1;
    } else if (typeof month === "number") {
      numericMonth = month;
    } else {
      numericMonth = (/* @__PURE__ */ new Date()).getMonth() + 1;
    }
    if (numericMonth === 12 || numericMonth === 1 || numericMonth === 2) return "winter";
    if (numericMonth >= 3 && numericMonth <= 5) return "spring";
    if (numericMonth >= 6 && numericMonth <= 8) return "summer";
    return "fall";
  }
  /**
   * Calculate similarity between two trip fingerprints
   * Returns a score from 0-100 with confidence level
   * 
   * NOTE: Days is now a HARD FILTER (handled in findBestMatches) - only trips
   * with the same number of days are compared. daysMatch is always 100 here.
   * 
   * Weights (after days filter):
   * - Layovers: 45% (most important - which cities you visit)
   * - Times: 20% (check-in/check-out time preferences for commutability)
   * - Season: 15% (seasonal patterns - pilots may prefer different trips by season)
   * - Credit: 15% (pay hours preference)
   * - Efficiency: 5% (credit per day preference)
   */
  static calculateSimilarity(trip1, trip2) {
    const breakdown = {
      layoverMatch: 0,
      daysMatch: 100,
      // Always 100 since days is a hard filter now
      timeMatch: 0,
      creditMatch: 0,
      efficiencyMatch: 0,
      seasonMatch: 0
    };
    if (trip1.layoverPattern === trip2.layoverPattern) {
      breakdown.layoverMatch = 100;
    } else {
      const cities1 = new Set(trip1.layoverCities);
      const cities2 = new Set(trip2.layoverCities);
      const intersection = new Set(
        [...cities1].filter((city) => cities2.has(city))
      );
      const union = /* @__PURE__ */ new Set([...cities1, ...cities2]);
      if (union.size > 0) {
        breakdown.layoverMatch = intersection.size / union.size * 100;
      }
    }
    let timeScore = 0;
    if (trip1.checkInTimeOfDay === trip2.checkInTimeOfDay) {
      timeScore += 50;
    } else {
      const timeOrder = ["morning", "afternoon", "evening"];
      const idx1 = timeOrder.indexOf(trip1.checkInTimeOfDay);
      const idx2 = timeOrder.indexOf(trip2.checkInTimeOfDay);
      if (Math.abs(idx1 - idx2) === 1) {
        timeScore += 25;
      }
    }
    if (trip1.checkOutTimeOfDay === trip2.checkOutTimeOfDay) {
      timeScore += 50;
    } else {
      const timeOrder = ["morning", "afternoon", "evening"];
      const idx1 = timeOrder.indexOf(trip1.checkOutTimeOfDay);
      const idx2 = timeOrder.indexOf(trip2.checkOutTimeOfDay);
      if (Math.abs(idx1 - idx2) === 1) {
        timeScore += 25;
      }
    }
    breakdown.timeMatch = timeScore;
    const season1 = this.getSeason(trip1.checkInMonth);
    const season2 = this.getSeason(trip2.checkInMonth);
    if (season1 === season2) {
      breakdown.seasonMatch = 100;
    } else {
      const seasonOrder = ["winter", "spring", "summer", "fall"];
      const idx1 = seasonOrder.indexOf(season1);
      const idx2 = seasonOrder.indexOf(season2);
      const diff = Math.abs(idx1 - idx2);
      if (diff === 1 || diff === 3) {
        breakdown.seasonMatch = 50;
      } else {
        breakdown.seasonMatch = 0;
      }
    }
    if (trip1.creditHours !== void 0 && trip2.creditHours !== void 0) {
      const creditDiff = Math.abs(trip1.creditHours - trip2.creditHours);
      if (creditDiff <= 0.02) {
        breakdown.creditMatch = 100;
      } else if (creditDiff <= 0.1) {
        breakdown.creditMatch = 90;
      } else if (creditDiff <= 0.25) {
        breakdown.creditMatch = 80;
      } else if (creditDiff <= 0.5) {
        breakdown.creditMatch = 70;
      } else if (creditDiff <= 1) {
        breakdown.creditMatch = 50;
      } else {
        breakdown.creditMatch = Math.max(0, 30 - (creditDiff - 1) * 10);
      }
    } else if (trip1.creditBucket === trip2.creditBucket) {
      breakdown.creditMatch = 100;
    } else {
      const creditDiff = Math.abs(trip1.creditBucket - trip2.creditBucket);
      breakdown.creditMatch = Math.max(0, 100 - creditDiff * 10);
    }
    if (trip1.efficiencyBucket === trip2.efficiencyBucket) {
      breakdown.efficiencyMatch = 100;
    } else {
      const effDiff = Math.abs(trip1.efficiencyBucket - trip2.efficiencyBucket);
      breakdown.efficiencyMatch = Math.max(0, 100 - effDiff * 20);
    }
    const score = breakdown.layoverMatch * 0.45 + breakdown.timeMatch * 0.2 + breakdown.seasonMatch * 0.15 + breakdown.creditMatch * 0.15 + breakdown.efficiencyMatch * 0.05;
    let confidence;
    if (score >= 100) {
      confidence = "exact";
    } else if (score >= 90) {
      confidence = "high";
    } else if (score >= 70) {
      confidence = "medium";
    } else {
      confidence = "low";
    }
    return {
      score: Math.round(score),
      confidence,
      breakdown
    };
  }
  /**
   * Find best matches from a list of historical trips
   * Days is a HARD FILTER - only trips with the same number of days are compared
   */
  static findBestMatches(currentTrip, historicalTrips, minScore = 50) {
    const sameDayTrips = historicalTrips.filter(
      (trip) => trip.pairingDays === currentTrip.pairingDays
    );
    const matches = sameDayTrips.map((historicalTrip) => ({
      trip: historicalTrip,
      similarity: this.calculateSimilarity(currentTrip, historicalTrip)
    })).filter((match) => match.similarity.score >= minScore).sort((a, b) => b.similarity.score - a.similarity.score);
    return matches;
  }
};

// server/locationDesirability.ts
var CITY_DATABASE = {
  // Tropical/Beach destinations - High base desirability
  "MIA": { baseDesirability: 90, climate: "tropical", isInternational: false, isBeach: true, isMajorHub: true },
  "FLL": { baseDesirability: 85, climate: "tropical", isInternational: false, isBeach: true, isMajorHub: false },
  "TPA": { baseDesirability: 80, climate: "tropical", isInternational: false, isBeach: true, isMajorHub: false },
  "MCO": { baseDesirability: 75, climate: "tropical", isInternational: false, isBeach: false, isMajorHub: true },
  "RSW": { baseDesirability: 80, climate: "tropical", isInternational: false, isBeach: true, isMajorHub: false },
  "PBI": { baseDesirability: 85, climate: "tropical", isInternational: false, isBeach: true, isMajorHub: false },
  "SJU": { baseDesirability: 95, climate: "tropical", isInternational: false, isBeach: true, isMajorHub: false },
  "HNL": { baseDesirability: 98, climate: "tropical", isInternational: false, isBeach: true, isMajorHub: true },
  "OGG": { baseDesirability: 95, climate: "tropical", isInternational: false, isBeach: true, isMajorHub: false },
  "LIH": { baseDesirability: 92, climate: "tropical", isInternational: false, isBeach: true, isMajorHub: false },
  "KOA": { baseDesirability: 90, climate: "tropical", isInternational: false, isBeach: true, isMajorHub: false },
  // International destinations - Very high desirability
  "CUN": { baseDesirability: 92, climate: "tropical", isInternational: true, isBeach: true, isMajorHub: false },
  "SXM": { baseDesirability: 90, climate: "tropical", isInternational: true, isBeach: true, isMajorHub: false },
  "NAS": { baseDesirability: 88, climate: "tropical", isInternational: true, isBeach: true, isMajorHub: false },
  "AUA": { baseDesirability: 88, climate: "tropical", isInternational: true, isBeach: true, isMajorHub: false },
  "MBJ": { baseDesirability: 85, climate: "tropical", isInternational: true, isBeach: true, isMajorHub: false },
  "PUJ": { baseDesirability: 85, climate: "tropical", isInternational: true, isBeach: true, isMajorHub: false },
  "LHR": { baseDesirability: 90, climate: "mild", isInternational: true, isBeach: false, isMajorHub: true },
  "CDG": { baseDesirability: 92, climate: "mild", isInternational: true, isBeach: false, isMajorHub: true },
  "FCO": { baseDesirability: 90, climate: "mild", isInternational: true, isBeach: false, isMajorHub: true },
  "BCN": { baseDesirability: 88, climate: "mild", isInternational: true, isBeach: true, isMajorHub: false },
  "AMS": { baseDesirability: 85, climate: "mild", isInternational: true, isBeach: false, isMajorHub: true },
  "NRT": { baseDesirability: 80, climate: "mild", isInternational: true, isBeach: false, isMajorHub: true },
  "HND": { baseDesirability: 82, climate: "mild", isInternational: true, isBeach: false, isMajorHub: true },
  "ICN": { baseDesirability: 75, climate: "mild", isInternational: true, isBeach: false, isMajorHub: true },
  // California/West Coast - High desirability, mild climate
  "LAX": { baseDesirability: 85, climate: "mild", isInternational: false, isBeach: true, isMajorHub: true },
  "SAN": { baseDesirability: 88, climate: "mild", isInternational: false, isBeach: true, isMajorHub: false },
  "SFO": { baseDesirability: 82, climate: "mild", isInternational: false, isBeach: false, isMajorHub: true },
  "OAK": { baseDesirability: 65, climate: "mild", isInternational: false, isBeach: false, isMajorHub: false },
  "SJC": { baseDesirability: 68, climate: "mild", isInternational: false, isBeach: false, isMajorHub: false },
  "SNA": { baseDesirability: 78, climate: "mild", isInternational: false, isBeach: true, isMajorHub: false },
  "BUR": { baseDesirability: 65, climate: "mild", isInternational: false, isBeach: false, isMajorHub: false },
  "SMF": { baseDesirability: 55, climate: "hot_dry", isInternational: false, isBeach: false, isMajorHub: false },
  "PSP": { baseDesirability: 70, climate: "hot_dry", isInternational: false, isBeach: false, isMajorHub: false },
  "SBA": { baseDesirability: 80, climate: "mild", isInternational: false, isBeach: true, isMajorHub: false },
  // Pacific Northwest - Mild/cool, moderate desirability
  "SEA": { baseDesirability: 70, climate: "mild", isInternational: false, isBeach: false, isMajorHub: true },
  "PDX": { baseDesirability: 68, climate: "mild", isInternational: false, isBeach: false, isMajorHub: false },
  // Mountain West - Variable desirability
  "DEN": { baseDesirability: 65, climate: "cold", isInternational: false, isBeach: false, isMajorHub: true },
  "SLC": { baseDesirability: 60, climate: "cold", isInternational: false, isBeach: false, isMajorHub: true },
  "PHX": { baseDesirability: 70, climate: "hot_dry", isInternational: false, isBeach: false, isMajorHub: true },
  "TUS": { baseDesirability: 55, climate: "hot_dry", isInternational: false, isBeach: false, isMajorHub: false },
  "ABQ": { baseDesirability: 50, climate: "hot_dry", isInternational: false, isBeach: false, isMajorHub: false },
  "LAS": { baseDesirability: 78, climate: "hot_dry", isInternational: false, isBeach: false, isMajorHub: true },
  "RNO": { baseDesirability: 55, climate: "cold", isInternational: false, isBeach: false, isMajorHub: false },
  "BOI": { baseDesirability: 50, climate: "cold", isInternational: false, isBeach: false, isMajorHub: false },
  "IDA": { baseDesirability: 40, climate: "cold", isInternational: false, isBeach: false, isMajorHub: false },
  "JAC": { baseDesirability: 65, climate: "cold", isInternational: false, isBeach: false, isMajorHub: false },
  "ASE": { baseDesirability: 75, climate: "cold", isInternational: false, isBeach: false, isMajorHub: false },
  "EGE": { baseDesirability: 70, climate: "cold", isInternational: false, isBeach: false, isMajorHub: false },
  // Texas - Warm climate, variable desirability
  "DFW": { baseDesirability: 55, climate: "warm", isInternational: false, isBeach: false, isMajorHub: true },
  "IAH": { baseDesirability: 50, climate: "warm", isInternational: false, isBeach: false, isMajorHub: true },
  "HOU": { baseDesirability: 48, climate: "warm", isInternational: false, isBeach: false, isMajorHub: false },
  "AUS": { baseDesirability: 70, climate: "warm", isInternational: false, isBeach: false, isMajorHub: false },
  "SAT": { baseDesirability: 55, climate: "warm", isInternational: false, isBeach: false, isMajorHub: false },
  // Northeast - Cold climate, variable desirability
  "JFK": { baseDesirability: 70, climate: "cold", isInternational: false, isBeach: false, isMajorHub: true },
  "LGA": { baseDesirability: 65, climate: "cold", isInternational: false, isBeach: false, isMajorHub: true },
  "EWR": { baseDesirability: 55, climate: "cold", isInternational: false, isBeach: false, isMajorHub: true },
  "BOS": { baseDesirability: 72, climate: "cold", isInternational: false, isBeach: false, isMajorHub: true },
  "PHL": { baseDesirability: 55, climate: "cold", isInternational: false, isBeach: false, isMajorHub: true },
  "DCA": { baseDesirability: 65, climate: "cold", isInternational: false, isBeach: false, isMajorHub: true },
  "IAD": { baseDesirability: 55, climate: "cold", isInternational: false, isBeach: false, isMajorHub: true },
  "BWI": { baseDesirability: 52, climate: "cold", isInternational: false, isBeach: false, isMajorHub: false },
  "PIT": { baseDesirability: 45, climate: "cold", isInternational: false, isBeach: false, isMajorHub: false },
  "BDL": { baseDesirability: 45, climate: "cold", isInternational: false, isBeach: false, isMajorHub: false },
  "PVD": { baseDesirability: 48, climate: "cold", isInternational: false, isBeach: false, isMajorHub: false },
  "SYR": { baseDesirability: 40, climate: "cold", isInternational: false, isBeach: false, isMajorHub: false },
  "BUF": { baseDesirability: 40, climate: "cold", isInternational: false, isBeach: false, isMajorHub: false },
  "ROC": { baseDesirability: 42, climate: "cold", isInternational: false, isBeach: false, isMajorHub: false },
  "ALB": { baseDesirability: 42, climate: "cold", isInternational: false, isBeach: false, isMajorHub: false },
  // Midwest - Cold climate, generally lower desirability
  "ORD": { baseDesirability: 55, climate: "cold", isInternational: false, isBeach: false, isMajorHub: true },
  "MDW": { baseDesirability: 50, climate: "cold", isInternational: false, isBeach: false, isMajorHub: false },
  "DTW": { baseDesirability: 50, climate: "cold", isInternational: false, isBeach: false, isMajorHub: true },
  "MSP": { baseDesirability: 48, climate: "cold", isInternational: false, isBeach: false, isMajorHub: true },
  "STL": { baseDesirability: 48, climate: "cold", isInternational: false, isBeach: false, isMajorHub: false },
  "MKE": { baseDesirability: 45, climate: "cold", isInternational: false, isBeach: false, isMajorHub: false },
  "IND": { baseDesirability: 45, climate: "cold", isInternational: false, isBeach: false, isMajorHub: false },
  "CLE": { baseDesirability: 42, climate: "cold", isInternational: false, isBeach: false, isMajorHub: false },
  "CMH": { baseDesirability: 45, climate: "cold", isInternational: false, isBeach: false, isMajorHub: false },
  "CVG": { baseDesirability: 48, climate: "cold", isInternational: false, isBeach: false, isMajorHub: false },
  "DSM": { baseDesirability: 38, climate: "cold", isInternational: false, isBeach: false, isMajorHub: false },
  "OMA": { baseDesirability: 40, climate: "cold", isInternational: false, isBeach: false, isMajorHub: false },
  "MCI": { baseDesirability: 45, climate: "cold", isInternational: false, isBeach: false, isMajorHub: false },
  "FAR": { baseDesirability: 30, climate: "cold", isInternational: false, isBeach: false, isMajorHub: false },
  "GFK": { baseDesirability: 28, climate: "cold", isInternational: false, isBeach: false, isMajorHub: false },
  // Southeast - Warm climate, moderate desirability
  "ATL": { baseDesirability: 55, climate: "warm", isInternational: false, isBeach: false, isMajorHub: true },
  "CLT": { baseDesirability: 52, climate: "warm", isInternational: false, isBeach: false, isMajorHub: true },
  "RDU": { baseDesirability: 55, climate: "warm", isInternational: false, isBeach: false, isMajorHub: false },
  "GSO": { baseDesirability: 45, climate: "warm", isInternational: false, isBeach: false, isMajorHub: false },
  "BNA": { baseDesirability: 65, climate: "warm", isInternational: false, isBeach: false, isMajorHub: false },
  "MEM": { baseDesirability: 42, climate: "warm", isInternational: false, isBeach: false, isMajorHub: false },
  "MSY": { baseDesirability: 75, climate: "warm", isInternational: false, isBeach: false, isMajorHub: false },
  "JAX": { baseDesirability: 55, climate: "warm", isInternational: false, isBeach: true, isMajorHub: false },
  "SAV": { baseDesirability: 68, climate: "warm", isInternational: false, isBeach: true, isMajorHub: false },
  "CHS": { baseDesirability: 72, climate: "warm", isInternational: false, isBeach: true, isMajorHub: false },
  "RIC": { baseDesirability: 48, climate: "warm", isInternational: false, isBeach: false, isMajorHub: false },
  "ORF": { baseDesirability: 48, climate: "warm", isInternational: false, isBeach: true, isMajorHub: false },
  "BHM": { baseDesirability: 42, climate: "warm", isInternational: false, isBeach: false, isMajorHub: false },
  "HSV": { baseDesirability: 40, climate: "warm", isInternational: false, isBeach: false, isMajorHub: false },
  "PNS": { baseDesirability: 55, climate: "warm", isInternational: false, isBeach: true, isMajorHub: false },
  "VPS": { baseDesirability: 60, climate: "warm", isInternational: false, isBeach: true, isMajorHub: false },
  // Alaska - Cold, niche appeal
  "ANC": { baseDesirability: 55, climate: "cold", isInternational: false, isBeach: false, isMajorHub: false },
  "FAI": { baseDesirability: 45, climate: "cold", isInternational: false, isBeach: false, isMajorHub: false }
};
function getMonthFromBidPackage(month) {
  const monthMap = {
    "january": 1,
    "jan": 1,
    "01": 1,
    "1": 1,
    "february": 2,
    "feb": 2,
    "02": 2,
    "2": 2,
    "march": 3,
    "mar": 3,
    "03": 3,
    "3": 3,
    "april": 4,
    "apr": 4,
    "04": 4,
    "4": 4,
    "may": 5,
    "05": 5,
    "5": 5,
    "june": 6,
    "jun": 6,
    "06": 6,
    "6": 6,
    "july": 7,
    "jul": 7,
    "07": 7,
    "7": 7,
    "august": 8,
    "aug": 8,
    "08": 8,
    "8": 8,
    "september": 9,
    "sep": 9,
    "sept": 9,
    "09": 9,
    "9": 9,
    "october": 10,
    "oct": 10,
    "10": 10,
    "november": 11,
    "nov": 11,
    "11": 11,
    "december": 12,
    "dec": 12,
    "12": 12
  };
  const normalized = month.toLowerCase().trim();
  for (const [key, value] of Object.entries(monthMap)) {
    if (normalized.includes(key)) {
      return value;
    }
  }
  return (/* @__PURE__ */ new Date()).getMonth() + 1;
}
function getSeason(monthNumber) {
  if (monthNumber >= 11 || monthNumber <= 3) return "winter";
  if (monthNumber >= 4 && monthNumber <= 5) return "spring";
  if (monthNumber >= 6 && monthNumber <= 8) return "summer";
  return "fall";
}
function getSeasonalModifier(climate, season) {
  const modifiers = {
    "tropical": {
      winter: 20,
      // Very desirable in winter
      spring: 10,
      // Still desirable
      summer: 5,
      // Less appeal (hurricane season, hot)
      fall: 15
      // Good shoulder season
    },
    "warm": {
      winter: 15,
      // Escape the cold
      spring: 5,
      summer: -5,
      // Can be too hot
      fall: 5
    },
    "mild": {
      winter: 5,
      // Pleasant year-round
      spring: 10,
      // Nice weather
      summer: 10,
      // Comfortable temps
      fall: 10
      // Beautiful fall
    },
    "cold": {
      winter: -15,
      // Unpleasant, less desirable
      spring: 0,
      summer: 10,
      // Nice escape from heat
      fall: 5
      // Fall colors
    },
    "hot_dry": {
      winter: 15,
      // Pleasant in winter
      spring: 5,
      summer: -20,
      // Extremely hot, avoid
      fall: 5
    }
  };
  return modifiers[climate]?.[season] ?? 0;
}
function getCityData(cityCode) {
  const normalized = cityCode.toUpperCase().trim();
  return CITY_DATABASE[normalized] || null;
}
function calculateLayoverDesirability(layoverCities, bidMonth) {
  const reasoning = [];
  if (!layoverCities || layoverCities.length === 0) {
    return { score: 50, reasoning: ["No layover data available"] };
  }
  const monthNumber = getMonthFromBidPackage(bidMonth);
  const season = getSeason(monthNumber);
  let totalScore = 0;
  let knownCities = 0;
  for (const city of layoverCities) {
    const cityData = getCityData(city);
    if (cityData) {
      const seasonalMod = getSeasonalModifier(cityData.climate, season);
      const cityScore = cityData.baseDesirability + seasonalMod;
      let cityReasoning = `${city}: base ${cityData.baseDesirability}`;
      if (seasonalMod !== 0) {
        const modSign = seasonalMod > 0 ? "+" : "";
        cityReasoning += ` (${season} ${modSign}${seasonalMod})`;
      }
      if (cityData.isInternational) {
        cityReasoning += " [International]";
      }
      if (cityData.isBeach) {
        cityReasoning += " [Beach]";
      }
      reasoning.push(cityReasoning);
      totalScore += cityScore;
      knownCities++;
    } else {
      reasoning.push(`${city}: unknown city (default 50)`);
      totalScore += 50;
      knownCities++;
    }
  }
  const averageScore = knownCities > 0 ? totalScore / knownCities : 50;
  const clampedScore = Math.max(0, Math.min(100, averageScore));
  reasoning.unshift(`Season: ${season} (month ${monthNumber})`);
  return {
    score: Math.round(clampedScore),
    reasoning
  };
}
function getLocationCompetitionAdjustment(layoverCities, bidMonth) {
  const { score } = calculateLayoverDesirability(layoverCities, bidMonth);
  if (score >= 85) return -20;
  if (score >= 75) return -12;
  if (score >= 65) return -5;
  if (score >= 50) return 0;
  if (score >= 40) return 5;
  if (score >= 30) return 10;
  return 15;
}
function isHolidayPeriod(monthNumber) {
  return monthNumber === 11 || monthNumber === 12 || monthNumber === 1;
}
function getHolidayCompetitionPenalty(monthNumber) {
  if (monthNumber === 12) return -10;
  if (monthNumber === 11) return -5;
  if (monthNumber === 1) return -3;
  return 0;
}

// server/holdProbabilityCalculator.ts
var HoldProbabilityCalculator = class {
  /**
   * Normalize various time formats to hour (0-23)
   * Handles: "5.00" (decimal hours), "0500" (HHMM), "05:00" (HH:MM), "5" (hour only)
   */
  static normalizeTimeToHour(timeStr) {
    if (!timeStr) return NaN;
    const str = timeStr.toString().trim();
    if (str.includes(":")) {
      const [hours] = str.split(":");
      return parseInt(hours, 10);
    }
    if (str.includes(".")) {
      const hour = parseFloat(str);
      if (hour >= 0 && hour <= 24) {
        return Math.floor(hour);
      }
    }
    if (/^\d{4}$/.test(str)) {
      return parseInt(str.substring(0, 2), 10);
    }
    if (/^\d{3}$/.test(str)) {
      return parseInt(str.substring(0, 1), 10);
    }
    if (/^\d{1,2}$/.test(str)) {
      const hour = parseInt(str, 10);
      if (hour >= 0 && hour <= 24) {
        return hour;
      }
    }
    const fallback = parseFloat(str);
    return fallback >= 0 && fallback <= 24 ? Math.floor(fallback) : NaN;
  }
  /**
   * Calculate hold probability using historical data when available
   * Now includes bid month for seasonal adjustments
   */
  static async calculateHoldProbabilityWithHistory(pairing, seniorityNumber, seniorityPercentile, base, aircraft, bidMonth) {
    const historicalMatches = await this.findHistoricalMatches(
      pairing,
      base,
      aircraft
    );
    const layoverCities = pairing.layovers?.map((l) => l.city).filter((c) => c) || [];
    if (historicalMatches.length > 0) {
      return this.calculateFromHistoricalData(
        seniorityNumber,
        seniorityPercentile,
        historicalMatches,
        pairing
      );
    } else {
      const desirabilityScore = this.calculateDesirabilityScore(pairing, bidMonth);
      const pairingFrequency = 1;
      const startsOnWeekend = this.startsOnWeekend(pairing);
      const includesWeekendOff = this.includesWeekendOff(pairing);
      return this.calculateHoldProbability({
        seniorityPercentile,
        desirabilityScore,
        pairingFrequency,
        startsOnWeekend,
        includesDeadheads: pairing.deadheads || 0,
        includesWeekendOff,
        bidMonth,
        layoverCities
      });
    }
  }
  /**
   * Find historical matches for a pairing
   */
  static async findHistoricalMatches(pairing, base, aircraft) {
    try {
      const currentFingerprint = this.createFingerprintFromPairing(pairing);
      const historicalData = await db.select().from(bidHistory).where(and2(eq2(bidHistory.base, base), eq2(bidHistory.aircraft, aircraft)));
      const matches = [];
      for (const history of historicalData) {
        if (history.tripFingerprint) {
          const similarity = TripMatcher.calculateSimilarity(
            currentFingerprint,
            history.tripFingerprint
          );
          if (similarity.score >= 50) {
            matches.push({
              seniorityNumber: history.juniorHolderSeniority,
              month: history.month,
              year: history.year,
              similarity: similarity.score,
              confidence: similarity.confidence
            });
          }
        }
      }
      matches.sort((a, b) => b.similarity - a.similarity);
      return matches.slice(0, 10);
    } catch (error) {
      console.error("Error finding historical matches:", error);
      return [];
    }
  }
  /**
   * Create trip fingerprint from a pairing object
   * Made public so it can be reused by the similar history API endpoint
   */
  static createFingerprintFromPairing(pairing) {
    let layoversData = pairing.layovers;
    if (typeof layoversData === "string") {
      try {
        layoversData = JSON.parse(layoversData);
      } catch {
        layoversData = [];
      }
    }
    let layoverCities = Array.isArray(layoversData) ? layoversData.map((l) => l.city).filter(Boolean).sort() : [];
    const pairingDaysValue = pairing.pairingDays || 1;
    if (layoverCities.length === 0 && pairingDaysValue === 1) {
      layoverCities = ["none"];
    }
    let checkInTimeOfDay = "morning";
    if (pairing.checkInTime) {
      const hour = this.normalizeTimeToHour(pairing.checkInTime);
      if (!isNaN(hour)) {
        if (hour >= 12 && hour < 17) checkInTimeOfDay = "afternoon";
        else if (hour >= 17) checkInTimeOfDay = "evening";
      }
    }
    let flightSegmentsData = pairing.flightSegments;
    if (typeof flightSegmentsData === "string") {
      try {
        flightSegmentsData = JSON.parse(flightSegmentsData);
      } catch {
        flightSegmentsData = [];
      }
    }
    const firstSegment = Array.isArray(flightSegmentsData) ? flightSegmentsData[0] : null;
    const lastSegment = Array.isArray(flightSegmentsData) && flightSegmentsData.length > 0 ? flightSegmentsData[flightSegmentsData.length - 1] : null;
    const checkInMonth = firstSegment?.departureDate ? new Date(firstSegment.departureDate).getMonth() + 1 : (/* @__PURE__ */ new Date()).getMonth() + 1;
    let checkOutTimeOfDay = "afternoon";
    let checkOutDetermined = false;
    if (lastSegment?.arrivalTime) {
      const checkOutHour = this.normalizeTimeToHour(lastSegment.arrivalTime);
      if (!isNaN(checkOutHour)) {
        if (checkOutHour < 12) checkOutTimeOfDay = "morning";
        else if (checkOutHour >= 12 && checkOutHour < 17) checkOutTimeOfDay = "afternoon";
        else checkOutTimeOfDay = "evening";
        checkOutDetermined = true;
      }
    }
    if (!checkOutDetermined && pairing.tafb && pairing.pairingDays) {
      const tafbHours = parseFloat(pairing.tafb);
      const days = pairing.pairingDays;
      if (!isNaN(tafbHours) && days > 0) {
        const avgHoursPerDay = tafbHours / days;
        if (avgHoursPerDay > 14) checkOutTimeOfDay = "evening";
        else if (avgHoursPerDay < 10) checkOutTimeOfDay = "morning";
        checkOutDetermined = true;
      }
    }
    const creditHours = parseFloat(pairing.creditHours || 0);
    const pairingDays = pairing.pairingDays || 1;
    return {
      pairingDays,
      layoverCities,
      layoverPattern: layoverCities.join("-"),
      checkInDayOfWeek: 0,
      // Can be enhanced if we parse effectiveDates
      checkInTimeOfDay,
      checkOutTimeOfDay,
      checkInMonth,
      creditBucket: Math.floor(creditHours / 2) * 2,
      isCommutable: false,
      // Can be enhanced
      isWeekendTrip: false,
      includesWeekend: pairingDays >= 3,
      efficiencyBucket: Math.floor(creditHours / pairingDays * 2) / 2
    };
  }
  /**
   * Calculate hold probability from historical award data
   */
  static calculateFromHistoricalData(seniorityNumber, seniorityPercentile, matches, pairing) {
    const reasoning = [];
    const bestMatches = matches.filter((m) => m.similarity >= 70);
    const allMatches = matches;
    if (bestMatches.length > 0) {
      const avgJuniorHolder = bestMatches.reduce((sum, m) => sum + m.seniorityNumber, 0) / bestMatches.length;
      const mostJuniorHolder = Math.max(
        ...bestMatches.map((m) => m.seniorityNumber)
      );
      const mostSeniorHolder = Math.min(
        ...bestMatches.map((m) => m.seniorityNumber)
      );
      reasoning.push(
        `\u{1F4CA} Found ${bestMatches.length} similar trip(s) from past months (${bestMatches[0].similarity}% match)`
      );
      reasoning.push(
        `   Historical range: ${mostSeniorHolder} - ${mostJuniorHolder} (avg: ${Math.round(avgJuniorHolder)})`
      );
      let probability = 0;
      if (seniorityNumber < mostSeniorHolder) {
        probability = 95;
        reasoning.push(
          `\u2705 You're MORE SENIOR than historical holders - excellent chance!`
        );
      } else if (seniorityNumber <= avgJuniorHolder) {
        probability = 75;
        reasoning.push(
          `\u2705 You're within the typical holder range - good chance`
        );
      } else if (seniorityNumber <= mostJuniorHolder) {
        probability = 50;
        reasoning.push(
          `\u2696\uFE0F You're more junior than average holders - moderate chance`
        );
      } else if (seniorityNumber <= mostJuniorHolder + 500) {
        probability = 25;
        reasoning.push(
          `\u26A0\uFE0F You're slightly more junior than past holders - tough but possible`
        );
      } else {
        probability = 10;
        reasoning.push(
          `\u274C You're significantly more junior than past holders - unlikely`
        );
      }
      if (bestMatches[0].confidence === "exact") {
        reasoning.push(
          `   \u{1F3AF} Exact match confidence: prediction is highly accurate`
        );
      } else if (bestMatches[0].confidence === "high") {
        reasoning.push(`   \u2713 High confidence: prediction is reliable`);
      }
      const label = this.getProbabilityLabel(probability);
      return { probability, label, reasoning };
    } else if (allMatches.length > 0) {
      const avgJuniorHolder = allMatches.reduce((sum, m) => sum + m.seniorityNumber, 0) / allMatches.length;
      reasoning.push(
        `\u{1F4CA} Found ${allMatches.length} somewhat similar trip(s) (${allMatches[0].similarity}% match)`
      );
      reasoning.push(
        `   Average junior holder: ${Math.round(avgJuniorHolder)}`
      );
      let probability = 50;
      if (seniorityNumber < avgJuniorHolder - 1e3) {
        probability = 75;
        reasoning.push(
          `\u2705 You're notably more senior - good chance based on trends`
        );
      } else if (seniorityNumber > avgJuniorHolder + 1e3) {
        probability = 25;
        reasoning.push(
          `\u26A0\uFE0F You're notably more junior - lower chance based on trends`
        );
      } else {
        reasoning.push(
          `\u2696\uFE0F You're near the average - moderate chance based on trends`
        );
      }
      reasoning.push(
        `   \u26A0\uFE0F Medium confidence: less certain due to lower similarity`
      );
      const label = this.getProbabilityLabel(probability);
      return { probability, label, reasoning };
    }
    return this.calculateHoldProbability({
      seniorityPercentile,
      desirabilityScore: this.calculateDesirabilityScore(pairing),
      pairingFrequency: 1,
      startsOnWeekend: false,
      includesDeadheads: pairing.deadheads || 0,
      includesWeekendOff: false
    });
  }
  /**
   * Get probability label from percentage
   */
  static getProbabilityLabel(probability) {
    if (probability >= 75) return "Very Likely";
    if (probability >= 50) return "Likely";
    if (probability >= 25) return "Unlikely";
    return "Very Unlikely";
  }
  /**
   * Calculate hold probability using seniority-based logic
   */
  static calculateHoldProbability(params) {
    const {
      seniorityPercentile,
      desirabilityScore,
      pairingFrequency,
      startsOnWeekend,
      includesDeadheads,
      includesWeekendOff,
      bidMonth,
      layoverCities
    } = params;
    const reasoning = [];
    let baseProbability = 50;
    let label = "Unlikely";
    let seniorityFloor = 0;
    if (seniorityPercentile <= 10) {
      if (seniorityPercentile <= 2) {
        seniorityFloor = 98;
      } else if (seniorityPercentile <= 5) {
        seniorityFloor = 95;
      } else {
        seniorityFloor = 90;
      }
      baseProbability = Math.max(90, seniorityFloor);
      label = "Very Likely";
      reasoning.push(
        `\u2705 Very senior pilot (top ${seniorityPercentile.toFixed(1)}%) - high hold probability`
      );
      if (desirabilityScore > 90) {
        baseProbability = Math.max(seniorityFloor, 90);
        reasoning.push("\u26A0\uFE0F Extremely desirable pairing (senior floor applied)");
      }
    } else if (seniorityPercentile <= 25) {
      baseProbability = 75;
      label = "Likely";
      reasoning.push(
        `\u2705 Senior pilot (top ${seniorityPercentile.toFixed(1)}%) - good hold probability`
      );
      if (desirabilityScore > 85) {
        baseProbability = 50;
        label = "Unlikely";
        reasoning.push(
          "\u26A0\uFE0F Very desirable pairing - competition from more senior pilots"
        );
      }
    } else if (seniorityPercentile <= 50) {
      baseProbability = 50;
      label = "Unlikely";
      reasoning.push(
        `\u2696\uFE0F Mid-seniority pilot (${seniorityPercentile.toFixed(1)}th percentile)`
      );
      if (desirabilityScore < 50) {
        baseProbability = 75;
        label = "Likely";
        reasoning.push("\u2705 Less desirable pairing - better chance to hold");
      } else if (desirabilityScore > 75) {
        baseProbability = 25;
        label = "Very Unlikely";
        reasoning.push("\u274C Desirable pairing - senior pilots will take it");
      }
    } else if (seniorityPercentile <= 75) {
      baseProbability = 25;
      label = "Very Unlikely";
      reasoning.push(
        `\u274C Junior-mid pilot (${seniorityPercentile.toFixed(1)}th percentile) - tough competition`
      );
      if (desirabilityScore < 40 && pairingFrequency >= 3) {
        baseProbability = 75;
        label = "Likely";
        reasoning.push(
          "\u2705 Undesirable pairing with multiple instances - good chance"
        );
      } else if (desirabilityScore < 55) {
        baseProbability = 50;
        label = "Unlikely";
        reasoning.push("\u2696\uFE0F Moderately undesirable pairing - some chance");
      }
    } else {
      baseProbability = 10;
      label = "Very Unlikely";
      reasoning.push(
        `\u274C Very junior pilot (${seniorityPercentile.toFixed(1)}th percentile) - extremely tough competition`
      );
      if (desirabilityScore < 30 && pairingFrequency >= 4 && startsOnWeekend && includesDeadheads >= 2) {
        baseProbability = 50;
        label = "Unlikely";
        reasoning.push("\u2696\uFE0F Very undesirable frequent pairing - some hope");
      } else if (desirabilityScore < 40 && pairingFrequency >= 3) {
        baseProbability = 25;
        label = "Very Unlikely";
        reasoning.push("\u26A0\uFE0F Undesirable frequent pairing - slight chance");
      }
    }
    if (pairingFrequency >= 4) {
      reasoning.push("\u2022 Frequent pairing (+5% boost)");
    }
    if (includesDeadheads >= 3) {
      reasoning.push("\u2022 Many deadheads - less competition");
    }
    if (startsOnWeekend && seniorityPercentile > 50) {
      reasoning.push("\u2022 Weekend start - less popular with senior pilots");
    }
    let locationAdjustment = 0;
    if (bidMonth && layoverCities && layoverCities.length > 0) {
      const { score: layoverScore, reasoning: layoverReasoning } = calculateLayoverDesirability(layoverCities, bidMonth);
      locationAdjustment = getLocationCompetitionAdjustment(layoverCities, bidMonth);
      const monthNumber = getMonthFromBidPackage(bidMonth);
      const season = getSeason(monthNumber);
      if (layoverScore >= 80) {
        reasoning.push(`\u{1F334} High-demand layover(s) in ${season} - more competition`);
      } else if (layoverScore <= 40) {
        reasoning.push(`\u2744\uFE0F Less desirable layover(s) in ${season} - less competition`);
      }
      if (isHolidayPeriod(monthNumber)) {
        const holidayPenalty = getHolidayCompetitionPenalty(monthNumber);
        locationAdjustment += holidayPenalty;
        if (holidayPenalty < 0) {
          reasoning.push("\u{1F384} Holiday period - increased competition for good trips");
        }
      }
    }
    const randomAdjustment = seniorityPercentile <= 10 ? 0 : (Math.random() - 0.5) * 6;
    let finalProbability = Math.max(
      0,
      Math.min(100, baseProbability + randomAdjustment + locationAdjustment)
    );
    if (seniorityFloor > 0) {
      finalProbability = Math.max(finalProbability, seniorityFloor);
    }
    const roundedProbability = Math.round(finalProbability / 5) * 5;
    if (process.env.NODE_ENV === "development" && process.env.LOG_HOLD_DEBUG === "1") {
      console.log(`Hold Probability Calculation for pairing:`);
      console.log(`  Seniority Percentile: ${seniorityPercentile}%`);
      console.log(`  Desirability Score: ${desirabilityScore}`);
      console.log(`  Pairing Frequency: ${pairingFrequency}`);
      console.log(`  Starts on Weekend: ${startsOnWeekend}`);
      console.log(`  Deadheads: ${includesDeadheads}`);
      console.log(`  Weekend Off: ${includesWeekendOff}`);
      console.log(`  Result: ${roundedProbability}% - ${label}`);
      reasoning.forEach((reason) => console.log(`  ${reason}`));
    }
    return {
      probability: roundedProbability,
      label,
      reasoning
    };
  }
  /**
   * Calculate desirability score based on pairing characteristics
   * Now includes location and seasonal factors when bid month is provided
   */
  static calculateDesirabilityScore(pairing, bidMonth) {
    let score = 50;
    const creditHours = parseFloat(pairing.creditHours) || 0;
    const blockHours = parseFloat(pairing.blockHours) || 0;
    const pairingDays = pairing.pairingDays || 1;
    const deadheads = pairing.deadheads || 0;
    if (creditHours >= 25) {
      score += 30;
    } else if (creditHours >= 20) {
      score += 20;
    } else if (creditHours >= 15) {
      score += 10;
    } else if (creditHours < 10) {
      score -= 15;
    }
    const efficiency = blockHours > 0 ? creditHours / blockHours : 1;
    if (efficiency >= 1.5) {
      score += 20;
    } else if (efficiency >= 1.3) {
      score += 10;
    } else if (efficiency < 1.1) {
      score -= 10;
    }
    if (pairingDays === 1 && creditHours >= 5) {
      score += 15;
    }
    if (pairingDays >= 4) {
      score -= 5;
    }
    score -= deadheads * 8;
    if (pairing.startsOnWeekend) {
      score -= 10;
    }
    if (bidMonth && pairing.layovers && Array.isArray(pairing.layovers)) {
      const layoverCities = pairing.layovers.map((l) => l.city).filter((c) => c);
      if (layoverCities.length > 0) {
        const { score: locationScore } = calculateLayoverDesirability(layoverCities, bidMonth);
        score = score * 0.7 + locationScore * 0.3;
      }
    }
    return Math.max(0, Math.min(100, Math.round(score)));
  }
  /**
   * Determine if pairing starts on weekend
   */
  static startsOnWeekend(pairing) {
    return false;
  }
  /**
   * Determine if pairing includes weekend off
   */
  static includesWeekendOff(pairing) {
    return false;
  }
  /**
   * Calculate pairing frequency in bid package
   */
  static calculatePairingFrequency(pairingNumber, allPairings) {
    return allPairings.filter((p) => p.pairingNumber === pairingNumber).length;
  }
};

// server/pdfParser.ts
var PDFParser = class {
  // Calculate hold probability using new tiered logic with seasonal adjustments
  calculateHoldProbability(pairing, allPairings, userSeniorityPercentile, bidMonth) {
    const seniorityPercentile = userSeniorityPercentile !== void 0 ? userSeniorityPercentile : 50;
    const layoverCities = pairing.layovers?.map((l) => l.city).filter((c) => c) || [];
    const desirabilityScore = HoldProbabilityCalculator.calculateDesirabilityScore(pairing, bidMonth);
    const pairingFrequency = HoldProbabilityCalculator.calculatePairingFrequency(
      pairing.pairingNumber,
      allPairings
    );
    const startsOnWeekend = HoldProbabilityCalculator.startsOnWeekend(pairing);
    const includesWeekendOff = HoldProbabilityCalculator.includesWeekendOff(pairing);
    const result = HoldProbabilityCalculator.calculateHoldProbability({
      seniorityPercentile,
      desirabilityScore,
      pairingFrequency,
      startsOnWeekend,
      includesDeadheads: pairing.deadheads,
      includesWeekendOff,
      bidMonth,
      layoverCities
    });
    return result.probability;
  }
  extractTafbDays(tafb) {
    const match = tafb.match(/(\d+)d/);
    return match ? parseInt(match[1]) : 1;
  }
  parseRoute(flightSegments) {
    const routePath = [];
    if (flightSegments.length === 0) {
      return "";
    }
    const sortedSegments = [...flightSegments].sort((a, b) => {
      const dateCompare = a.date.localeCompare(b.date);
      if (dateCompare !== 0) {
        return dateCompare;
      }
      return a.departureTime.localeCompare(b.departureTime);
    });
    if (sortedSegments.length > 0) {
      routePath.push(sortedSegments[0].departure);
    }
    for (const segment of sortedSegments) {
      routePath.push(segment.arrival);
    }
    const cleanedRoute = [];
    for (let i = 0; i < routePath.length; i++) {
      if (i === 0 || routePath[i] !== routePath[i - 1]) {
        cleanedRoute.push(routePath[i]);
      }
    }
    return cleanedRoute.join("-");
  }
  extractALVTable(text2) {
    const lines = text2.split("\n");
    const alvTable = [];
    let defaultALV = null;
    let inALVSection = false;
    console.log("Starting ALV table extraction...");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.match(/ALV|Average\s+Line\s+Value/i)) {
        inALVSection = true;
        console.log(`ALV section detected at line ${i}: "${line}"`);
        const alvHeaderMatch = line.match(/ALV[:\s]+(\d{1,3})[:\.](\d{2})/i);
        if (alvHeaderMatch && !defaultALV) {
          const hours = parseInt(alvHeaderMatch[1]);
          const minutes = parseInt(alvHeaderMatch[2]);
          defaultALV = hours + minutes / 60;
          console.log(`\u2705 Found default ALV in header: ${defaultALV.toFixed(2)} hours`);
        }
      }
      if (inALVSection && line.match(/^(PAIRING|#\d{4}|EFFECTIVE|DAY\s+[A-E])/)) {
        console.log(`ALV section ended at line ${i}`);
        break;
      }
      if (!inALVSection && i > 100) continue;
      const alvRowMatch = line.match(/^([A-Z]{2,3})\s+([\w\d-]+)\s+([A-Z]{1,2})\s+(\d{1,3})[:\.](\d{2})/);
      if (alvRowMatch) {
        const base = alvRowMatch[1];
        const aircraft = alvRowMatch[2];
        const position = alvRowMatch[3];
        const hours = parseInt(alvRowMatch[4]);
        const minutes = parseInt(alvRowMatch[5]);
        const alvHours = hours + minutes / 60;
        const exists = alvTable.some(
          (row) => row.base === base && row.aircraft === aircraft && row.position === position
        );
        if (!exists) {
          alvTable.push({
            base,
            aircraft,
            position,
            alvHours,
            displayName: `${base} ${aircraft} ${position}`
          });
          console.log(`\u2705 Found ALV row: ${base} ${aircraft} ${position} = ${alvHours.toFixed(2)}h`);
        }
      }
      const alvRowAltMatch = line.match(/^(NEW\s+YORK\s+CITY|NEWARK|LOS\s+ANGELES|SAN\s+FRANCISCO)\s+([\w\d-]+)\s+([A-Z]{1,2})\s+(\d{1,3})[:\.](\d{2})/i);
      if (alvRowAltMatch) {
        const baseFull = alvRowAltMatch[1];
        const baseMap = {
          "NEW YORK CITY": "NYC",
          "NEWARK": "EWR",
          "LOS ANGELES": "LAX",
          "SAN FRANCISCO": "SFO"
        };
        const base = baseMap[baseFull.toUpperCase().trim()] || baseFull.substring(0, 3).toUpperCase();
        const aircraft = alvRowAltMatch[2];
        const position = alvRowAltMatch[3];
        const hours = parseInt(alvRowAltMatch[4]);
        const minutes = parseInt(alvRowAltMatch[5]);
        const alvHours = hours + minutes / 60;
        const exists = alvTable.some(
          (row) => row.base === base && row.aircraft === aircraft && row.position === position
        );
        if (!exists) {
          alvTable.push({
            base,
            aircraft,
            position,
            alvHours,
            displayName: `${base} ${aircraft} ${position}`
          });
          console.log(`\u2705 Found ALV row (full name): ${base} ${aircraft} ${position} = ${alvHours.toFixed(2)}h`);
        }
      }
    }
    console.log(`
=== ALV Extraction Summary ===`);
    console.log(`Total entries found: ${alvTable.length}`);
    console.log(`Default ALV: ${defaultALV ? defaultALV.toFixed(2) + "h" : "Not found"}`);
    if (alvTable.length > 0) {
      console.log("Entries:");
      alvTable.forEach((entry) => {
        console.log(`  - ${entry.displayName}: ${entry.alvHours.toFixed(2)}h`);
      });
    }
    console.log(`==============================
`);
    return { alvTable, defaultALV };
  }
  extractBidPeriod(text2) {
    const lines = text2.split("\n");
    const monthMap = {
      january: 0,
      jan: 0,
      february: 1,
      feb: 1,
      march: 2,
      mar: 2,
      april: 3,
      apr: 3,
      may: 4,
      june: 5,
      jun: 5,
      july: 6,
      jul: 6,
      august: 7,
      aug: 7,
      september: 8,
      sep: 8,
      sept: 8,
      october: 9,
      oct: 9,
      november: 10,
      nov: 10,
      december: 11,
      dec: 11
    };
    for (let i = 0; i < Math.min(20, lines.length); i++) {
      const line = lines[i].trim();
      const m = line.match(
        /([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})\s*[–-]\s*([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})/
      );
      if (!m) continue;
      const sm = monthMap[m[1].toLowerCase()];
      const em = monthMap[m[4].toLowerCase()];
      if (sm === void 0 || em === void 0) continue;
      const startDate = new Date(parseInt(m[3]), sm, parseInt(m[2]));
      const endDate = new Date(parseInt(m[6]), em, parseInt(m[5]));
      const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      return { startDate: iso(startDate), endDate: iso(endDate) };
    }
    return null;
  }
  extractBidPackageDate(text2) {
    const lines = text2.split("\n");
    for (let i = 0; i < Math.min(20, lines.length); i++) {
      const line = lines[i].trim();
      const bidPackageMatch = line.match(
        /PILOT\s+BID\s+PACKAGE\s+([A-Za-z]+\s+\d{4})/i
      );
      if (bidPackageMatch) {
        const monthYear = bidPackageMatch[1];
        console.log(`Found bid package date from header: ${monthYear}`);
        return monthYear;
      }
      const monthYearMatch = line.match(
        /\b(January|February|March|April|May|June|July|August|September|October|November|December|JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+\d{4}\b/i
      );
      if (monthYearMatch) {
        const monthYear = monthYearMatch[0];
        console.log(
          `Found bid package date from month/year pattern: ${monthYear}`
        );
        return monthYear;
      }
    }
    for (let i = 0; i < Math.min(20, lines.length); i++) {
      const line = lines[i].trim();
      if (line.includes("PILOT BID PACKAGE")) {
        console.log(`Found PILOT BID PACKAGE header on line ${i}: "${line}"`);
        for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
          const nextLine = lines[j].trim();
          const monthYearMatch = nextLine.match(
            /\b(January|February|March|April|May|June|July|August|September|October|November|December|JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+\d{4}\b/i
          );
          if (monthYearMatch) {
            const monthYear = monthYearMatch[0];
            console.log(
              `Found bid package date near PILOT BID PACKAGE header: ${monthYear}`
            );
            return monthYear;
          }
        }
      }
    }
    for (let i = 0; i < Math.min(20, lines.length); i++) {
      const line = lines[i].trim();
      const dateRangeMatch = line.match(
        /([A-Za-z]+)\s+\d{1,2},\s+(\d{4})\s*[–-]\s*([A-Za-z]+)\s+\d{1,2},\s+(\d{4})/
      );
      if (dateRangeMatch) {
        const startMonth = dateRangeMatch[1];
        const startYear = dateRangeMatch[2];
        const endMonth = dateRangeMatch[3];
        const endYear = dateRangeMatch[4];
        if (startMonth !== endMonth || startYear !== endYear) {
          const monthYear = `${startMonth} ${startYear}`;
          console.log(
            `Found bid package date from date range (using start month): ${monthYear}`
          );
          console.log(
            `Note: Date range spans ${startMonth} ${startYear} to ${endMonth} ${endYear}`
          );
          return monthYear;
        } else {
          const monthYear = `${startMonth} ${startYear}`;
          console.log(`Found bid package date from date range: ${monthYear}`);
          return monthYear;
        }
      }
    }
    console.log("Could not extract bid package date from PDF header");
    return null;
  }
  extractPairingBlocks(text2) {
    const pairingBlocks = [];
    const lines = text2.split("\n");
    let currentBlock = "";
    let inPairing = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.match(/^#[A-Z]?\d{3,5}\s+[A-Z]{2}/)) {
        if (currentBlock && inPairing) {
          pairingBlocks.push(currentBlock.trim());
        }
        currentBlock = line + "\n";
        inPairing = true;
      } else if (inPairing) {
        currentBlock += line + "\n";
        if (i + 1 < lines.length) {
          const nextLine = lines[i + 1].trim();
          if (nextLine.match(/^#[A-Z]?\d{3,5}\s+[A-Z]{2}/)) {
            pairingBlocks.push(currentBlock.trim());
            currentBlock = "";
            inPairing = false;
          }
        }
      }
    }
    if (currentBlock && inPairing) {
      pairingBlocks.push(currentBlock.trim());
    }
    return pairingBlocks;
  }
  parsePairingBlock(block, bidPackageDate) {
    const lines = block.split("\n");
    if (lines.length < 2) {
      return null;
    }
    const headerMatch = lines[0].match(/^#([A-Z]?\d{3,5})\s+([A-Z]{2})/);
    if (!headerMatch) {
      return null;
    }
    const pairingNumber = headerMatch[1];
    const dayCode = headerMatch[2];
    const flightSegments = [];
    const layovers = [];
    let creditHours = "0.00";
    let blockHours = "0.00";
    let tafb = "0d 00:00";
    const fdp = "";
    let payHours = "";
    const sitEdpPay = "";
    const carveouts = "";
    let deadheads = 0;
    let effectiveDates = "";
    let checkInTime = "";
    let currentDay = "A";
    const headerCheckInMatch = lines[0].match(/CHECK-IN AT\s+([\d:.]+)/i);
    if (headerCheckInMatch) {
      checkInTime = headerCheckInMatch[1];
    }
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.includes("EFFECTIVE")) {
        const effectiveIndex = line.indexOf("EFFECTIVE");
        let tail = line.substring(effectiveIndex + "EFFECTIVE".length).trim();
        tail = tail.split(/CHECK-IN|DAY\s+[A-Z]/)[0].trim();
        effectiveDates = tail;
        console.log("Found EFFECTIVE line:", line);
        console.log("Extracted effectiveDates:", effectiveDates);
      }
      const dayFlightMatch = line.match(
        /^([A-E])\s*(?:DH\s+)?(\d{3,4})\s+\*?([A-Z]{3})\s+(\d{4})\s+\*?([A-Z]{3})\s+(\d{4})(?:\*)?\s+(\d{1,2}\.\d{2})/
      );
      if (dayFlightMatch) {
        currentDay = dayFlightMatch[1];
        const isDeadhead = line.includes("DH");
        const isDuplicate = flightSegments.some(
          (seg) => seg.flightNumber === dayFlightMatch[2] && seg.departure === dayFlightMatch[3] && seg.departureTime === dayFlightMatch[4] && seg.date === currentDay
        );
        if (!isDuplicate) {
          const segment = {
            date: currentDay,
            flightNumber: dayFlightMatch[2],
            departure: dayFlightMatch[3],
            departureTime: dayFlightMatch[4],
            arrival: dayFlightMatch[5],
            arrivalTime: dayFlightMatch[6],
            blockTime: dayFlightMatch[7],
            isDeadhead
          };
          if (segment.isDeadhead) {
            deadheads++;
          }
          flightSegments.push(segment);
        }
        for (let j = i + 1; j < lines.length; j++) {
          const nextLine = lines[j].trim();
          if (nextLine.match(/^[A-E]\s/) || nextLine.includes("TOTAL") || nextLine.includes("TAFB") || nextLine === "") {
            break;
          }
          const contFlightMatch = nextLine.match(
            /^\s*(?:DH\s+)?(\d{3,4})\s+\*?([A-Z]{3})\s+(\d{4})\s+\*?([A-Z]{3})\s+(\d{4})(?:\*?)?\s+(\d{1,2}\.\d{2})/
          );
          if (contFlightMatch) {
            const isContDeadhead = nextLine.includes("DH");
            const contSegment = {
              date: currentDay,
              flightNumber: contFlightMatch[1],
              departure: contFlightMatch[2],
              departureTime: contFlightMatch[3],
              arrival: contFlightMatch[4],
              arrivalTime: contFlightMatch[5],
              blockTime: contFlightMatch[6],
              isDeadhead: isContDeadhead
            };
            if (isContDeadhead) {
              deadheads++;
            }
            flightSegments.push(contSegment);
            i = j;
            continue;
          }
          const multiLegMatch = nextLine.match(
            /^\s+\*?([A-Z]{3})\s+(\d{4})\s+\*?([A-Z]{3})\s+(\d{4})\s+(\d{1,2}\.\d{2})/
          );
          if (multiLegMatch && flightSegments.length > 0) {
            const lastFlight = flightSegments[flightSegments.length - 1];
            const multiLegSegment = {
              date: currentDay,
              flightNumber: lastFlight.flightNumber,
              // Same flight number
              departure: multiLegMatch[1],
              departureTime: multiLegMatch[2],
              arrival: multiLegMatch[3],
              arrivalTime: multiLegMatch[4],
              blockTime: multiLegMatch[5],
              isDeadhead: false
            };
            flightSegments.push(multiLegSegment);
            i = j;
            continue;
          }
          const continuationMatch = nextLine.match(
            /^\s+([A-Z]{3})\s+(\d{4})\s+([A-Z]{3})\s+(\d{4})\s+(\d{1,2}\.\d{2})/
          );
          if (continuationMatch && flightSegments.length > 0) {
            const lastFlight = flightSegments[flightSegments.length - 1];
            const continuationSegment = {
              date: currentDay,
              flightNumber: lastFlight.flightNumber,
              // Same flight number as previous
              departure: continuationMatch[1],
              departureTime: continuationMatch[2],
              arrival: continuationMatch[3],
              arrivalTime: continuationMatch[4],
              blockTime: continuationMatch[5],
              isDeadhead: false
            };
            flightSegments.push(continuationSegment);
            i = j;
            continue;
          }
          const deadheadMatch = nextLine.match(
            /^\s*DH\s+(\d{3,4})\s+([A-Z]{3})\s+(\d{4})\s+([A-Z]{3})\s+(\d{4})\s+(\d{1,2}\.\d{2})/
          );
          if (deadheadMatch) {
            const dhSegment = {
              date: currentDay,
              flightNumber: deadheadMatch[1],
              departure: deadheadMatch[2],
              departureTime: deadheadMatch[3],
              arrival: deadheadMatch[4],
              arrivalTime: deadheadMatch[5],
              blockTime: deadheadMatch[6],
              isDeadhead: true
            };
            deadheads++;
            flightSegments.push(dhSegment);
            i = j;
            continue;
          }
          break;
        }
      }
      const standaloneFlight = line.match(
        /^\s*(\d{3,4})\s+([A-Z]{3})\s+(\d{4})\s+([A-Z]{3})\s+(\d{4})(?:\*)?\s+(\d{0,2}\.?\d{1,2})/
      );
      if (standaloneFlight && currentDay) {
        let blockTime = standaloneFlight[6];
        if (blockTime.startsWith(".")) {
          blockTime = "0" + blockTime;
        }
        const isDuplicate = flightSegments.some(
          (seg) => seg.flightNumber === standaloneFlight[1] && seg.departure === standaloneFlight[2] && seg.departureTime === standaloneFlight[3] && seg.date === currentDay
        );
        if (!isDuplicate) {
          const segment = {
            date: currentDay,
            flightNumber: standaloneFlight[1],
            departure: standaloneFlight[2],
            departureTime: standaloneFlight[3],
            arrival: standaloneFlight[4],
            arrivalTime: standaloneFlight[5],
            blockTime,
            isDeadhead: false
          };
          flightSegments.push(segment);
        }
      }
      const dayStartMatch = line.match(
        /^([A-E])\s+(\d{3,4})\s+\*?([A-Z]{3})\s+(\d{4})\s+\*?([A-Z]{3})\s+(\d{4})(?:\*)?\s+(\d{0,2}\.?\d{2})/
      );
      if (dayStartMatch) {
        currentDay = dayStartMatch[1];
        let blockTime = dayStartMatch[7];
        if (blockTime.startsWith(".")) {
          blockTime = "0" + blockTime;
        }
        const isDuplicate = flightSegments.some(
          (seg) => seg.flightNumber === dayStartMatch[2] && seg.departure === dayStartMatch[3] && seg.departureTime === dayStartMatch[4] && seg.date === currentDay
        );
        if (!isDuplicate) {
          const segment = {
            date: currentDay,
            flightNumber: dayStartMatch[2],
            departure: dayStartMatch[3],
            departureTime: dayStartMatch[4],
            arrival: dayStartMatch[5],
            arrivalTime: dayStartMatch[6],
            blockTime,
            isDeadhead: false
          };
          flightSegments.push(segment);
        }
      }
      const singleDayFlight = line.match(
        /^([A-E])\s+(\d{3,4})\s+\*?([A-Z]{3})\s+(\d{4})\s+\*?([A-Z]{3})\s+(\d{4})\s+(\d{1,2}\.\d{2})/
      );
      if (singleDayFlight && !dayStartMatch) {
        currentDay = singleDayFlight[1];
        const isDuplicate = flightSegments.some(
          (seg) => seg.flightNumber === singleDayFlight[2] && seg.departure === singleDayFlight[3] && seg.departureTime === singleDayFlight[4] && seg.date === currentDay
        );
        if (!isDuplicate) {
          const segment = {
            date: currentDay,
            flightNumber: singleDayFlight[2],
            departure: singleDayFlight[3],
            departureTime: singleDayFlight[4],
            arrival: singleDayFlight[5],
            arrivalTime: singleDayFlight[6],
            blockTime: singleDayFlight[7],
            isDeadhead: false
          };
          flightSegments.push(segment);
        }
      }
      const continuationFlightMatch = line.match(
        /^\s*\*?([A-Z]{3})\s+(\d{4})\s+\*?([A-Z]{3})\s+(\d{4})(?:\*)?\s+(\d{1,2}\.\d{2})/
      );
      if (continuationFlightMatch && flightSegments.length > 0 && !standaloneFlight && !dayStartMatch && !singleDayFlight) {
        const lastFlight = flightSegments[flightSegments.length - 1];
        const contSegment = {
          date: currentDay,
          flightNumber: lastFlight.flightNumber,
          // Use previous flight number
          departure: continuationFlightMatch[1],
          departureTime: continuationFlightMatch[2],
          arrival: continuationFlightMatch[3],
          arrivalTime: continuationFlightMatch[4],
          blockTime: continuationFlightMatch[5],
          isDeadhead: false
        };
        flightSegments.push(contSegment);
      }
      const layoverMatch = line.match(
        /([A-Z]{3})\s+(\d{1,2}\.\d{2})\/([A-Z][A-Z\s]+)/
      );
      if (layoverMatch) {
        const duration = parseFloat(layoverMatch[2]);
        const hotel = layoverMatch[3].trim();
        if (duration > 0 && hotel.length >= 3) {
          layovers.push({
            city: layoverMatch[1],
            duration: layoverMatch[2],
            hotel
          });
        }
      }
      const checkInMatch = line.match(/CHECK-IN AT\s+([\d:.]+)/i);
      if (checkInMatch) {
        checkInTime = checkInMatch[1];
      }
      const totalCreditMatch = line.match(
        /TOTAL CREDIT\s+(\d{1,2}\.\d{2})TL\s+(\d{1,2}\.\d{2})BL/
      );
      if (totalCreditMatch) {
        creditHours = totalCreditMatch[1];
        blockHours = totalCreditMatch[2];
      }
      const tafbMatch = line.match(/TAFB\s+(\d{1,3}\.\d{2})/);
      if (tafbMatch) {
        tafb = tafbMatch[1];
      }
      const totalPayMatch = line.match(/TOTAL PAY\s+(\d{1,2}:\d{2})TL/);
      if (totalPayMatch) {
        payHours = totalPayMatch[1];
      }
    }
    const route = this.parseRoute(flightSegments);
    if (!effectiveDates) {
      if (bidPackageDate) {
        const monthMatch = bidPackageDate.match(
          /(January|February|March|April|May|June|July|August|September|October|November|December|JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)/i
        );
        if (monthMatch) {
          const month = monthMatch[1].toUpperCase();
          const yearMatch = bidPackageDate.match(/\d{4}/);
          const year = yearMatch ? yearMatch[0] : "2025";
          const monthMap = {
            JANUARY: "JAN",
            FEBRUARY: "FEB",
            MARCH: "MAR",
            APRIL: "APR",
            MAY: "MAY",
            JUNE: "JUN",
            JULY: "JUL",
            AUGUST: "AUG",
            SEPTEMBER: "SEP",
            OCTOBER: "OCT",
            NOVEMBER: "NOV",
            DECEMBER: "DEC"
          };
          const monthAbbr = monthMap[month] || month;
          effectiveDates = `${monthAbbr}01-${monthAbbr}30`;
          console.log(
            `Formatted bid package date as effective dates: ${effectiveDates}`
          );
        } else {
          effectiveDates = bidPackageDate;
        }
      } else {
        const monthPattern = /\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\d{2}(?:-\w+)?\b/i;
        const monthMatch = block.match(monthPattern);
        if (monthMatch) {
          effectiveDates = monthMatch[0];
          console.log(
            `Inferred effective dates from month pattern: ${effectiveDates}`
          );
        } else {
          effectiveDates = "SEP01-SEP30";
          console.log(
            "Defaulting effective dates to SEP01-SEP30 as bid package date could not be extracted."
          );
        }
      }
    }
    let pairingDays = 1;
    const dayPatternMatches = block.match(/^([A-E])\s/gm);
    if (dayPatternMatches) {
      const allDayLetters = dayPatternMatches.map(
        (match) => match.trim().charAt(0)
      );
      const uniqueDayLetters = Array.from(new Set(allDayLetters)).sort();
      if (uniqueDayLetters.length > 0) {
        const lastDayLetter = uniqueDayLetters[uniqueDayLetters.length - 1];
        pairingDays = lastDayLetter.charCodeAt(0) - "A".charCodeAt(0) + 1;
        console.log(
          `Pairing ${pairingNumber}: Day letters found: ${uniqueDayLetters.join(", ")}, Last day: ${lastDayLetter}, Pairing days: ${pairingDays}`
        );
      }
    }
    if (pairingDays === 1 && flightSegments.length > 0) {
      const flightDays = Array.from(
        new Set(flightSegments.map((seg) => seg.date))
      ).sort();
      if (flightDays.length > 0) {
        const lastFlightDay = flightDays[flightDays.length - 1];
        pairingDays = Math.max(
          pairingDays,
          lastFlightDay.charCodeAt(0) - "A".charCodeAt(0) + 1
        );
      }
    }
    const uniqueLayovers = [];
    const seenCities = /* @__PURE__ */ new Set();
    for (const layover of layovers) {
      const cityUpper = layover.city.toUpperCase();
      if (!seenCities.has(cityUpper)) {
        uniqueLayovers.push(layover);
        seenCities.add(cityUpper);
      }
    }
    const maxAllowedLayovers = Math.max(0, pairingDays - 1);
    const validatedLayovers = uniqueLayovers.slice(0, maxAllowedLayovers);
    const pairing = {
      pairingNumber,
      effectiveDates,
      route,
      creditHours: creditHours || "0.00",
      blockHours: blockHours || "0.00",
      tafb: tafb || "0.00",
      fdp: fdp || void 0,
      payHours: payHours || void 0,
      sitEdpPay: sitEdpPay || void 0,
      carveouts: carveouts || void 0,
      deadheads,
      layovers: validatedLayovers,
      flightSegments,
      fullTextBlock: block,
      holdProbability: 0,
      // Will be calculated
      pairingDays,
      checkInTime: checkInTime || void 0
    };
    return pairing;
  }
  async extractTextFromTXT(filePath) {
    try {
      console.log(`Reading text from: ${filePath}`);
      if (!fs.existsSync(filePath)) {
        throw new Error(`TXT file not found: ${filePath}`);
      }
      const text2 = fs.readFileSync(filePath, "utf8");
      console.log(`TXT file read successfully: ${text2.length} characters`);
      return text2;
    } catch (error) {
      console.error("Error reading TXT file:", error);
      throw new Error(
        `Failed to read TXT file: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  async extractTextFromPDF(filePath) {
    try {
      console.log(`Attempting to extract text from: ${filePath}`);
      if (!fs.existsSync(filePath)) {
        throw new Error(`PDF file not found: ${filePath}`);
      }
      const buffer = fs.readFileSync(filePath);
      const data = await pdfParse(buffer);
      console.log(
        `PDF parsed successfully: ${data.text.length} characters extracted`
      );
      return data.text;
    } catch (error) {
      console.error("Error extracting text from PDF:", error);
      throw new Error(
        `Failed to extract text from PDF: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  async parseFile(fileData, bidPackageId, mimeType, userSeniorityPercentile = 50) {
    let tempFilePath = null;
    try {
      console.log(`Starting file parsing for bid package ${bidPackageId}`);
      let text2;
      if (Buffer.isBuffer(fileData) || fileData instanceof Uint8Array) {
        const bufferData = Buffer.isBuffer(fileData) ? fileData : Buffer.from(fileData);
        console.log(`Received buffer of size: ${bufferData.length} bytes`);
        tempFilePath = `/tmp/bid-package-${bidPackageId}-${Date.now()}.${mimeType === "text/plain" ? "txt" : "pdf"}`;
        fs.writeFileSync(tempFilePath, bufferData);
        if (mimeType === "text/plain") {
          text2 = await this.extractTextFromTXT(tempFilePath);
          console.log(`TXT file parsed successfully, ${text2.length} characters`);
        } else {
          text2 = await this.extractTextFromPDF(tempFilePath);
          console.log(`PDF parsed successfully, ${text2.length} characters`);
        }
      } else {
        if (mimeType === "text/plain") {
          text2 = await this.extractTextFromTXT(fileData);
          console.log(`TXT file parsed successfully, ${text2.length} characters`);
        } else {
          text2 = await this.extractTextFromPDF(fileData);
          console.log(`PDF parsed successfully, ${text2.length} characters`);
        }
      }
      const bidPackageDate = this.extractBidPackageDate(text2);
      if (bidPackageDate) {
        console.log(`Extracted bid package date: ${bidPackageDate}`);
        const monthMatch = bidPackageDate.match(
          /(January|February|March|April|May|June|July|August|September|October|November|December|JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)/i
        );
        const yearMatch = bidPackageDate.match(/\d{4}/);
        if (monthMatch && yearMatch) {
          const monthFull = monthMatch[1];
          const normalize = (m) => ({
            JAN: "January",
            FEB: "February",
            MAR: "March",
            APR: "April",
            MAY: "May",
            JUN: "June",
            JUL: "July",
            AUG: "August",
            SEP: "September",
            OCT: "October",
            NOV: "November",
            DEC: "December"
          })[m.toUpperCase()] || m;
          const normalizedMonth = normalize(monthFull);
          await storage.updateBidPackageInfo(bidPackageId, {
            month: normalizedMonth,
            year: parseInt(yearMatch[0])
          });
        }
      } else {
        console.log(
          "Could not extract bid package date, proceeding with individual pairing dates only"
        );
      }
      const bidPeriod = this.extractBidPeriod(text2);
      if (bidPeriod) {
        console.log(
          `Extracted bid period: ${bidPeriod.startDate} \u2192 ${bidPeriod.endDate}`
        );
        await storage.updateBidPackageInfo(bidPackageId, {
          bidPeriodStart: bidPeriod.startDate,
          bidPeriodEnd: bidPeriod.endDate
        });
      }
      const { alvTable, defaultALV } = this.extractALVTable(text2);
      if (alvTable.length > 0 || defaultALV !== null) {
        console.log(`Extracted ALV data: ${alvTable.length} table entries, default: ${defaultALV}`);
        await storage.updateBidPackageInfo(bidPackageId, {
          alvTable: alvTable.length > 0 ? alvTable : void 0,
          alvHours: defaultALV !== null ? defaultALV : void 0
        });
      } else {
        console.log("Could not extract ALV data from bid package");
      }
      const pairingBlocks = this.extractPairingBlocks(text2);
      console.log(`Found ${pairingBlocks.length} pairing blocks`);
      const parsedPairings = [];
      for (const block of pairingBlocks) {
        const pairing = this.parsePairingBlock(block, null);
        if (pairing) {
          parsedPairings.push(pairing);
        }
      }
      console.log(
        `Successfully parsed ${parsedPairings.length} pairings from PDF`
      );
      const bidPackageInfo = await storage.getBidPackage(bidPackageId);
      const bidMonth = bidPackageInfo?.month;
      console.log(`Calculating hold probabilities (month: ${bidMonth || "unknown"})...`);
      for (const pairing of parsedPairings) {
        pairing.holdProbability = this.calculateHoldProbability(
          pairing,
          parsedPairings,
          userSeniorityPercentile,
          bidMonth
        );
      }
      const batchSize = 50;
      const total = parsedPairings.length;
      let processed = 0;
      const emit = async (status) => {
        try {
          const { emitProgress: emitProgress2 } = await Promise.resolve().then(() => (init_progress(), progress_exports));
          const percent = total === 0 ? 0 : Math.min(Math.round(processed / total * 100), 100);
          emitProgress2(bidPackageId, { status, processed, total, percent });
        } catch {
        }
      };
      await emit("processing");
      for (let i = 0; i < parsedPairings.length; i += batchSize) {
        const batch = parsedPairings.slice(i, i + batchSize);
        for (const pairing of batch) {
          const pairingData = {
            bidPackageId,
            pairingNumber: pairing.pairingNumber,
            effectiveDates: pairing.effectiveDates,
            route: pairing.route || "TBD",
            creditHours: pairing.creditHours,
            blockHours: pairing.blockHours,
            tafb: pairing.tafb,
            fdp: pairing.fdp || void 0,
            payHours: pairing.payHours || void 0,
            sitEdpPay: pairing.sitEdpPay || void 0,
            carveouts: pairing.carveouts || void 0,
            deadheads: pairing.deadheads,
            layovers: pairing.layovers,
            flightSegments: pairing.flightSegments,
            fullTextBlock: pairing.fullTextBlock,
            holdProbability: pairing.holdProbability,
            pairingDays: pairing.pairingDays,
            checkInTime: pairing.checkInTime
          };
          await storage.createPairing(pairingData);
        }
        console.log(
          `Saved batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(parsedPairings.length / batchSize)} (${batch.length} pairings)`
        );
        processed += batch.length;
        await emit("processing");
      }
      await storage.updateBidPackageStatus(bidPackageId, "completed");
      processed = total;
      await emit("completed");
      console.log(`File parsing completed for bid package ${bidPackageId}`);
    } catch (error) {
      console.error("Error parsing file:", error);
      await storage.updateBidPackageStatus(bidPackageId, "failed");
      try {
        const { emitProgress: emitProgress2 } = await Promise.resolve().then(() => (init_progress(), progress_exports));
        emitProgress2(bidPackageId, {
          status: "failed",
          processed: 0,
          total: 0,
          percent: 0
        });
      } catch {
      }
      throw error;
    } finally {
      if (tempFilePath && fs.existsSync(tempFilePath)) {
        try {
          fs.unlinkSync(tempFilePath);
          console.log(`Cleaned up temp file: ${tempFilePath}`);
        } catch (e) {
          console.error(`Failed to clean up temp file: ${tempFilePath}`, e);
        }
      }
    }
  }
  async parsePDF(filePath, bidPackageId, userSeniorityPercentile = 50) {
    return this.parseFile(
      filePath,
      bidPackageId,
      "application/pdf",
      userSeniorityPercentile
    );
  }
};
var pdfParser = new PDFParser();

// server/routes.ts
import {
  eq as eq3,
  gte as gte3,
  lte as lte3,
  sql as sql4,
  and as and3
} from "drizzle-orm";

// server/holdProbabilityUpdate.ts
import { sql as sql3 } from "drizzle-orm";
function buildHoldProbabilityBulkUpdate(updates) {
  if (updates.length === 0) {
    return null;
  }
  const probWhens = updates.map(
    (u) => sql3`WHEN ${u.id} THEN ${u.holdProbability}`
  );
  const reasoningWhens = updates.map(
    (u) => u.reasoning !== void 0 ? sql3`WHEN ${u.id} THEN ${JSON.stringify(u.reasoning)}::jsonb` : sql3`WHEN ${u.id} THEN hold_probability_reasoning`
  );
  const ids = updates.map((u) => sql3`${u.id}`);
  return sql3`UPDATE pairings SET hold_probability = CASE id ${sql3.join(
    probWhens,
    sql3.raw(" ")
  )} END, hold_probability_reasoning = CASE id ${sql3.join(
    reasoningWhens,
    sql3.raw(" ")
  )} END WHERE id IN (${sql3.join(ids, sql3`, `)})`;
}

// server/openaiAssistant.ts
import OpenAI from "openai";
var openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});
var OpenAIAssistantService = class {
  /**
   * Ask the PBS Assistant a question and get a response using chat completion
   */
  async askPBSAssistant(question) {
    try {
      console.log("Starting PBS Assistant chat completion...");
      if (!process.env.OPENAI_API_KEY) {
        throw new Error("OPENAI_API_KEY environment variable is not set");
      }
      const completion = await openai.chat.completions.create({
        model: "gpt-5",
        messages: [
          {
            role: "system",
            content: `You are an expert Delta Airlines pilot bid analysis assistant specializing in PBS (Preferential Bidding System). You help pilots understand their bid packages, analyze pairings, and make informed bidding decisions.

TERMINOLOGY:
- Pairings/Trips: Flight sequences with the same crew
- Credit Hours: Pay time (what you get paid for)
- Block Hours: Actual flight time
- TAFB: Time Away From Base (total trip duration)
- Layovers: Rest periods between flights
- Hold Probability: Likelihood of being awarded the pairing (0-100%)
- Turns: 1-day trips (out and back same day)
- Multi-day: 2+ day trips with overnight layovers
- Deadheads: Traveling as passenger to position for duty

ANALYSIS CAPABILITIES:
- Search and filter pairings by credit hours, block time, TAFB
- Analyze layover cities and durations
- Compare hold probabilities across pairings
- Identify high-value vs efficient pairings
- Explain bidding strategies

Provide helpful, conversational responses with clear explanations. When discussing specific pairings, reference their key metrics (credit hours, block time, TAFB, layovers).`
          },
          {
            role: "user",
            content: question
          }
        ],
        max_tokens: 1e3,
        temperature: 0.7
      });
      const response = completion.choices[0]?.message?.content;
      if (!response) {
        throw new Error("No response from OpenAI");
      }
      console.log(
        "Chat completion response received:",
        response.substring(0, 100) + "..."
      );
      return response;
    } catch (error) {
      console.error("OpenAI Chat Completion error:", error);
      if (error instanceof Error && error.message.includes("API key")) {
        throw new Error(
          "OpenAI API key is missing or invalid. Please check your configuration."
        );
      } else if (error instanceof Error && error.message.includes("rate limit")) {
        throw new Error(
          "OpenAI rate limit exceeded. Please try again in a moment."
        );
      } else {
        throw new Error(
          `Failed to get response from PBS Assistant: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }
};
var openaiAssistant = new OpenAIAssistantService();

// server/reasonsReportParser.ts
import * as cheerio from "cheerio";
import * as fs2 from "fs/promises";
var ReasonsReportParser = class {
  /**
   * Parse a Delta Airlines Reasons Report HTML file
   */
  static async parseReasonsReport(filePath) {
    const htmlContent = await fs2.readFile(filePath, "utf-8");
    return this.parseReasonsReportFromContent(htmlContent);
  }
  static async parseReasonsReportFromContent(htmlContent) {
    const $ = cheerio.load(htmlContent);
    const awards = [];
    $("table tbody tr").each((_, row) => {
      const $row = $(row);
      const cells = $row.find("td");
      if (cells.length >= 11) {
        const pairingNumber = $(cells[0]).text().trim();
        const checkInDate = $(cells[1]).text().trim();
        const checkOutDate = $(cells[2]).text().trim();
        const pairingDaysText = $(cells[3]).text().trim();
        const monthCredit = $(cells[4]).text().trim();
        const totalCredit = $(cells[5]).text().trim();
        const layoverCities = $(cells[6]).text().trim();
        const seniorityText = $(cells[7]).text().trim();
        const employeeNumber = $(cells[8]).text().trim();
        const pilotName = $(cells[9]).text().trim();
        const awardType = $(cells[10]).text().trim();
        if (pairingNumber && !pairingNumber.includes("Pair") && seniorityText && !isNaN(parseInt(seniorityText))) {
          awards.push({
            pairingNumber,
            pilotName,
            seniorityNumber: parseInt(seniorityText),
            employeeNumber,
            awardType: awardType || "Regular",
            pairingDays: parseInt(pairingDaysText) || 1,
            monthCredit,
            totalCredit,
            layoverCities,
            checkInDate,
            checkOutDate
          });
        }
      }
    });
    return awards;
  }
  /**
   * Extract metadata (base, aircraft, month, year) from HTML content
   */
  static extractMetadata(htmlContent) {
    const $ = cheerio.load(htmlContent);
    const title = $("title").text();
    const baseMatch = title.match(/([A-Z]{3})-/);
    const base = baseMatch ? baseMatch[1] : "";
    const aircraftMatch = title.match(/-(\d{3}[-]?[A-Z]?)/);
    const aircraft = aircraftMatch ? aircraftMatch[1] : "";
    const monthMatch = title.match(/(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)/i);
    const month = monthMatch ? monthMatch[1].toUpperCase() : "";
    const yearMatch = title.match(/(20\d{2})/);
    const year = yearMatch ? parseInt(yearMatch[1]) : (/* @__PURE__ */ new Date()).getFullYear();
    if (base && aircraft && month) {
      return { base, aircraft, month, year };
    }
    return null;
  }
  /**
   * Create a trip fingerprint from an award for similarity matching
   */
  static createTripFingerprint(award) {
    let layoverCities = award.layoverCities.split(/\s+/).filter((city) => city.length > 0).map((city) => city.replace(/-\d+$/, "")).filter((city) => city.toLowerCase() !== "none").sort();
    if (layoverCities.length === 0 && award.pairingDays === 1) {
      layoverCities = ["none"];
    }
    const checkInMatch = award.checkInDate.match(
      /(\d{2})\/(\d{2})\s+(\w{3})\s+(\d{2}):(\d{2})/
    );
    const checkInMonth = checkInMatch ? parseInt(checkInMatch[1]) : 1;
    const checkInDay = checkInMatch ? parseInt(checkInMatch[2]) : 1;
    const checkInHour = checkInMatch ? parseInt(checkInMatch[4]) : 6;
    let checkInTimeOfDay = "morning";
    if (checkInHour >= 12 && checkInHour < 17) checkInTimeOfDay = "afternoon";
    else if (checkInHour >= 17) checkInTimeOfDay = "evening";
    const checkOutMatch = award.checkOutDate.match(/(\d{2}):(\d{2})/);
    const checkOutHour = checkOutMatch ? parseInt(checkOutMatch[1]) : 12;
    let checkOutTimeOfDay = "morning";
    if (checkOutHour >= 12 && checkOutHour < 17)
      checkOutTimeOfDay = "afternoon";
    else if (checkOutHour >= 17) checkOutTimeOfDay = "evening";
    const checkInDayOfWeek = checkInDay % 7;
    const creditHours = parseFloat(
      award.monthCredit.replace(":", ".")
    );
    const efficiency = creditHours / award.pairingDays;
    return {
      pairingDays: award.pairingDays,
      layoverCities,
      layoverPattern: layoverCities.join("-"),
      checkInDayOfWeek,
      checkInTimeOfDay,
      checkOutTimeOfDay,
      checkInMonth,
      creditBucket: Math.floor(creditHours / 2) * 2,
      // Bucket by 2-hour increments
      isCommutable: false,
      // Could be enhanced based on check-in time
      isWeekendTrip: checkInDayOfWeek === 0 || checkInDayOfWeek === 6,
      includesWeekend: award.pairingDays >= 3,
      efficiencyBucket: Math.floor(efficiency * 2) / 2
      // Bucket by 0.5 increments
    };
  }
};

// server/routes.ts
import multer from "multer";
import { z } from "zod";
async function recalculateHoldProbabilitiesOptimized(bidPackageId, seniorityPercentile, seniorityNumber) {
  try {
    console.log(
      `Starting optimized hold probability recalculation for bid package ${bidPackageId} with seniority ${seniorityPercentile}%`
    );
    const [bidPackage] = await db.select().from(bidPackages).where(eq3(bidPackages.id, bidPackageId)).limit(1);
    if (!bidPackage) {
      console.log("Bid package not found");
      return;
    }
    const allPairings = await db.select().from(pairings).where(eq3(pairings.bidPackageId, bidPackageId));
    if (allPairings.length === 0) {
      console.log("No pairings found for recalculation");
      return;
    }
    const updates = [];
    const useHistoricalData = seniorityNumber !== void 0;
    for (const pairing of allPairings) {
      let holdProbabilityResult;
      const layoverCities = pairing.layovers?.map((l) => l.city).filter((c) => c) || [];
      if (useHistoricalData && seniorityNumber) {
        holdProbabilityResult = await HoldProbabilityCalculator.calculateHoldProbabilityWithHistory(
          pairing,
          seniorityNumber,
          seniorityPercentile,
          bidPackage.base,
          bidPackage.aircraft,
          bidPackage.month
        );
      } else {
        const desirabilityScore = HoldProbabilityCalculator.calculateDesirabilityScore(
          pairing,
          bidPackage.month
        );
        const pairingFrequency = HoldProbabilityCalculator.calculatePairingFrequency(
          pairing.pairingNumber,
          allPairings
        );
        const startsOnWeekend = HoldProbabilityCalculator.startsOnWeekend(pairing);
        const includesWeekendOff = HoldProbabilityCalculator.includesWeekendOff(pairing);
        holdProbabilityResult = HoldProbabilityCalculator.calculateHoldProbability({
          seniorityPercentile,
          desirabilityScore,
          pairingFrequency,
          startsOnWeekend,
          includesDeadheads: pairing.deadheads || 0,
          includesWeekendOff,
          bidMonth: bidPackage.month,
          layoverCities
        });
      }
      updates.push({
        id: pairing.id,
        holdProbability: holdProbabilityResult.probability,
        reasoning: holdProbabilityResult.reasoning
      });
    }
    const batchSize = 500;
    for (let i = 0; i < updates.length; i += batchSize) {
      const batch = updates.slice(i, i + batchSize);
      const stmt = buildHoldProbabilityBulkUpdate(batch);
      if (stmt) {
        await db.execute(stmt);
      }
    }
    console.log(
      `\u2705 Optimized recalculation completed: ${updates.length} pairings updated in ${Math.ceil(updates.length / batchSize)} batches`
    );
  } catch (error) {
    console.error("Error in optimized hold probability recalculation:", error);
    throw error;
  }
}
async function recalculateHoldProbabilitiesBackground(bidPackageId, seniorityPercentile, seniorityNumber) {
  Promise.resolve().then(async () => {
    try {
      console.log(
        `\u{1F504} Background recalculation triggered for bid package ${bidPackageId}`
      );
      await recalculateHoldProbabilitiesOptimized(
        bidPackageId,
        seniorityPercentile,
        seniorityNumber
      );
    } catch (error) {
      console.error("Background hold probability recalculation failed:", error);
    }
  });
}
var upload = multer({
  storage: multer.memoryStorage(),
  // Use memory storage instead of disk for Vercel
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "application/pdf" || file.mimetype === "text/plain") {
      cb(null, true);
    } else {
      cb(new Error("Only PDF and TXT files are allowed"));
    }
  },
  limits: {
    fileSize: 10 * 1024 * 1024
    // 10MB limit
  }
});
var uploadReasonsReport = multer({
  storage: multer.memoryStorage(),
  // Use memory storage instead of disk for Vercel
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "text/html" || file.originalname.endsWith(".htm") || file.originalname.endsWith(".html")) {
      cb(null, true);
    } else {
      cb(new Error("Only HTML files are allowed for reasons reports"));
    }
  },
  limits: {
    fileSize: 10 * 1024 * 1024
    // 10MB limit
  }
});
var searchFiltersSchema = z.object({
  bidPackageId: z.number().optional(),
  search: z.string().optional(),
  creditMin: z.number().optional(),
  creditMax: z.number().optional(),
  blockMin: z.number().optional(),
  blockMax: z.number().optional(),
  tafb: z.string().optional(),
  tafbMin: z.number().optional(),
  tafbMax: z.number().optional(),
  holdProbabilityMin: z.number().optional(),
  pairingDays: z.number().optional(),
  pairingDaysMin: z.number().optional(),
  pairingDaysMax: z.number().optional(),
  efficiency: z.number().optional()
});
var withDatabaseRetry = executeWithRetry;
async function registerRoutes(app2) {
  app2.head("/api/health", (req, res) => {
    res.status(200).end();
  });
  app2.get("/api/health", async (req, res) => {
    try {
      const dbHealth = await getDatabaseHealth();
      res.status(dbHealth.connected ? 200 : 503).json({
        status: dbHealth.connected ? "ok" : "error",
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        uptime: process.uptime(),
        version: "1.2.0",
        environment: process.env.NODE_ENV || "development",
        database: dbHealth.connected ? "connected" : "disconnected",
        circuitBreaker: dbHealth.circuitBreakerState,
        poolInfo: dbHealth.poolInfo,
        config: {
          hasDatabaseUrl: !!process.env.DATABASE_URL,
          port: process.env.PORT || "5000"
        }
      });
    } catch (error) {
      res.status(503).json({
        status: "error",
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        uptime: process.uptime(),
        version: "1.2.0",
        environment: process.env.NODE_ENV || "development",
        database: "disconnected",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });
  app2.post("/api/seed", async (req, res) => {
    try {
      await seedDatabase();
      res.json({ success: true, message: "Database seeded successfully" });
    } catch (error) {
      console.error("Error seeding database:", error);
      res.status(500).json({ message: "Failed to seed database" });
    }
  });
  app2.get("/api/bid-packages", async (req, res) => {
    try {
      res.set({
        "Cache-Control": "no-cache, no-store, must-revalidate",
        Pragma: "no-cache",
        Expires: "0"
      });
      const packages = await withDatabaseRetry(async () => {
        return await storage.getBidPackages();
      });
      const packagesWithCurrent = packages.map((pkg, index) => ({
        ...pkg,
        isCurrent: index === 0
        // First one is most recent (ordered by uploadedAt desc)
      }));
      res.json(packagesWithCurrent);
    } catch (error) {
      console.error("Error fetching bid packages:", error);
      res.status(500).json({ error: "Failed to fetch bid packages" });
    }
  });
  app2.get("/api/bid-packages/:id", async (req, res) => {
    try {
      const bidPackageId = parseInt(req.params.id);
      if (isNaN(bidPackageId)) {
        return res.status(400).json({ error: "Invalid bid package ID" });
      }
      res.set({
        "Cache-Control": "no-cache, no-store, must-revalidate",
        Pragma: "no-cache",
        Expires: "0"
      });
      const bidPackage = await storage.getBidPackage(bidPackageId);
      if (!bidPackage) {
        return res.status(404).json({ error: "Bid package not found" });
      }
      res.json(bidPackage);
    } catch (error) {
      console.error("Error fetching bid package:", error);
      res.status(500).json({ error: "Failed to fetch bid package" });
    }
  });
  const normalizeMonth = (month) => {
    const upper = month.toUpperCase();
    const monthMap = {
      JANUARY: "JAN",
      FEBRUARY: "FEB",
      MARCH: "MAR",
      APRIL: "APR",
      MAY: "MAY",
      JUNE: "JUN",
      JULY: "JUL",
      AUGUST: "AUG",
      SEPTEMBER: "SEP",
      OCTOBER: "OCT",
      NOVEMBER: "NOV",
      DECEMBER: "DEC"
    };
    return monthMap[upper] || upper.substring(0, 3);
  };
  const parseAircraftCode = (aircraft) => {
    const normalized = aircraft.toUpperCase().replace(/\s+/g, "");
    const suffixMatch = normalized.match(/^([A-Z0-9]+?)-?([AB])$/);
    if (suffixMatch) {
      let baseType = suffixMatch[1];
      const position = suffixMatch[2];
      const prefixNumeric = baseType.match(/^[A-Z](\d{3})$/);
      if (prefixNumeric) {
        baseType = prefixNumeric[1];
      }
      return { baseType, position };
    }
    const prefixMatch = normalized.match(/^[A-Z](\d{3})$/);
    if (prefixMatch) {
      return { baseType: prefixMatch[1], position: null };
    }
    return { baseType: normalized, position: null };
  };
  app2.get("/api/data-health", async (req, res) => {
    try {
      const packages = await storage.getBidPackages();
      const historyCount = await db.select({ count: sql4`count(*)::int` }).from(bidHistory);
      const linkedCount = await db.select({ count: sql4`count(*)::int` }).from(bidHistory).where(sql4`linked_pairing_id IS NOT NULL`);
      const historyMonths = await db.select({
        month: bidHistory.month,
        year: bidHistory.year,
        count: sql4`count(*)::int`
      }).from(bidHistory).groupBy(bidHistory.month, bidHistory.year).orderBy(sql4`${bidHistory.year} DESC, ${bidHistory.month}`);
      const reasonsReports = await db.select({
        month: bidHistory.month,
        year: bidHistory.year,
        base: bidHistory.base,
        aircraft: bidHistory.aircraft,
        count: sql4`count(*)::int`,
        linkedCount: sql4`count(linked_pairing_id)::int`
      }).from(bidHistory).groupBy(
        bidHistory.month,
        bidHistory.year,
        bidHistory.base,
        bidHistory.aircraft
      );
      const reasonsMap = /* @__PURE__ */ new Map();
      for (const r of reasonsReports) {
        const { baseType, position } = parseAircraftCode(r.aircraft);
        const key = `${normalizeMonth(r.month)}-${r.year}-${r.base}-${baseType}`;
        const existing = reasonsMap.get(key);
        if (existing) {
          existing.count += r.count;
          existing.linkedCount += r.linkedCount;
          if (position) {
            existing.positions.push({
              position: position === "A" ? "Captain" : "First Officer",
              count: r.count,
              linkedCount: r.linkedCount
            });
          }
        } else {
          reasonsMap.set(key, {
            count: r.count,
            linkedCount: r.linkedCount,
            positions: position ? [
              {
                position: position === "A" ? "Captain" : "First Officer",
                count: r.count,
                linkedCount: r.linkedCount
              }
            ] : []
          });
        }
      }
      const currentPackage = packages.find((p) => p.status === "completed");
      const currentPackageId = currentPackage?.id;
      const enrichedPackages = packages.map((p) => {
        const { baseType } = parseAircraftCode(p.aircraft);
        const key = `${normalizeMonth(p.month)}-${p.year}-${p.base}-${baseType}`;
        const reasons = reasonsMap.get(key);
        return {
          id: p.id,
          month: p.month,
          year: p.year,
          base: p.base,
          aircraft: p.aircraft,
          status: p.status,
          uploadedAt: p.uploadedAt instanceof Date ? p.uploadedAt.toISOString() : p.uploadedAt,
          isCurrent: p.id === currentPackageId,
          hasReasonsReport: !!reasons,
          reasonsReportCount: reasons?.count || 0,
          linkedRecords: reasons?.linkedCount || 0,
          positions: reasons?.positions || []
        };
      });
      const packageMonthYears = new Set(
        packages.map((p) => `${normalizeMonth(p.month)}-${p.year}`)
      );
      const missingPackageMonths = historyMonths.filter(
        (h) => !packageMonthYears.has(`${normalizeMonth(h.month)}-${h.year}`)
      );
      res.json({
        bidPackages: {
          total: packages.length,
          current: currentPackage ? `${currentPackage.month} ${currentPackage.year}` : null,
          list: enrichedPackages
        },
        historicalRecords: {
          total: historyCount[0]?.count || 0,
          linkedToBidPackage: linkedCount[0]?.count || 0,
          unlinked: (historyCount[0]?.count || 0) - (linkedCount[0]?.count || 0),
          unlinkedMonths: missingPackageMonths.map((m) => ({
            month: m.month,
            year: m.year,
            count: m.count
          }))
        }
      });
    } catch (error) {
      console.error("Error fetching data health:", error);
      res.status(500).json({ error: "Failed to fetch data health" });
    }
  });
  app2.get("/api/progress/stream", async (req, res) => {
    try {
      const bidPackageId = parseInt(req.query.bidPackageId || "");
      if (!bidPackageId) {
        return res.status(400).end("bidPackageId required");
      }
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders?.();
      const { registerProgressClient: registerProgressClient2, removeProgressClient: removeProgressClient2 } = await Promise.resolve().then(() => (init_progress(), progress_exports));
      registerProgressClient2(bidPackageId, res);
      req.on("close", () => {
        removeProgressClient2(bidPackageId, res);
        res.end();
      });
    } catch (error) {
      res.status(500).end("failed to open stream");
    }
  });
  app2.get("/api/bid-packages/:id/stats", async (req, res) => {
    try {
      const bidPackageId = parseInt(req.params.id);
      const stats = await storage.getBidPackageStats(bidPackageId);
      res.json(stats);
    } catch (error) {
      console.error("Error fetching bid package stats:", error);
      res.status(500).json({ error: "Failed to fetch bid package stats" });
    }
  });
  app2.post("/api/upload", upload.single("bidPackage"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }
      const { name, month, year, base, aircraft } = req.body;
      const bidPackageData = insertBidPackageSchema.parse({
        name,
        month,
        year: parseInt(year),
        base,
        aircraft
      });
      const bidPackage = await storage.createBidPackage(bidPackageData);
      try {
        await pdfParser.parseFile(
          req.file.buffer,
          bidPackage.id,
          req.file.mimetype
        );
        console.log(`File parsing completed for bid package ${bidPackage.id}`);
        try {
          const freshBidPackage = await storage.getBidPackage(bidPackage.id);
          if (!freshBidPackage) {
            console.error(
              `Auto-linking: Could not find bid package ${bidPackage.id}`
            );
            return;
          }
          const fetchedPairings = await storage.getPairings(freshBidPackage.id);
          console.log(
            `Auto-linking: Found ${fetchedPairings.length} pairings for bid package ${freshBidPackage.id}`
          );
          if (fetchedPairings.length > 0) {
            const { baseType: pkgAircraftBase } = parseAircraftCode(
              freshBidPackage.aircraft
            );
            const pkgMonthNorm = normalizeMonth(freshBidPackage.month);
            console.log(
              `Auto-linking: Package criteria - month: ${pkgMonthNorm}, year: ${freshBidPackage.year}, base: ${freshBidPackage.base}, aircraft: ${pkgAircraftBase}`
            );
            const unlinkedRecords = await db.select().from(bidHistory).where(sql4`linked_pairing_id IS NULL`);
            console.log(
              `Auto-linking: Found ${unlinkedRecords.length} unlinked bid_history records`
            );
            const pairingMap = new Map(
              fetchedPairings.map((p) => [p.pairingNumber, p])
            );
            let linkedCount = 0;
            let matchingRecords = 0;
            for (const record of unlinkedRecords) {
              const { baseType: histAircraftBase } = parseAircraftCode(
                record.aircraft
              );
              const histMonthNorm = normalizeMonth(record.month);
              if (histMonthNorm === pkgMonthNorm && record.year === freshBidPackage.year && record.base === freshBidPackage.base && histAircraftBase === pkgAircraftBase) {
                matchingRecords++;
                const matchingPairing = pairingMap.get(record.pairingNumber);
                if (matchingPairing) {
                  await db.update(bidHistory).set({ linkedPairingId: matchingPairing.id }).where(sql4`id = ${record.id}`);
                  linkedCount++;
                }
              }
            }
            console.log(
              `Auto-linking: ${matchingRecords} records matched criteria, ${linkedCount} successfully linked`
            );
            const allPackages = await storage.getBidPackages();
            const { baseType: freshAircraftBase, position: freshPosition } = parseAircraftCode(freshBidPackage.aircraft);
            const freshMonth = normalizeMonth(freshBidPackage.month);
            const duplicates = allPackages.filter((pkg) => {
              if (pkg.id === freshBidPackage.id) return false;
              const pkgMonth = normalizeMonth(pkg.month);
              const { baseType: pkgAircraftBase2, position: pkgPosition } = parseAircraftCode(pkg.aircraft);
              return pkgMonth === freshMonth && pkg.year === freshBidPackage.year && pkg.base === freshBidPackage.base && pkgAircraftBase2 === freshAircraftBase && pkgPosition === freshPosition;
            });
            if (duplicates.length > 0) {
              console.log(
                `Auto-linking: Found ${duplicates.length} duplicate packages to clean up`
              );
              for (const dup of duplicates) {
                console.log(
                  `Auto-linking: Deleting duplicate package ${dup.id} (${dup.month} ${dup.year} ${dup.aircraft})`
                );
                try {
                  const dupPairings = await storage.getPairings(dup.id);
                  if (dupPairings.length > 0) {
                    console.log(
                      `Auto-linking: Unlinking ${dupPairings.length} pairings from bid_history before deletion`
                    );
                    for (const pairing of dupPairings) {
                      await db.update(bidHistory).set({ linkedPairingId: null }).where(sql4`linked_pairing_id = ${pairing.id}`);
                    }
                    console.log(
                      `Auto-linking: Successfully unlinked bid_history records`
                    );
                  }
                  await storage.deleteBidPackage(dup.id);
                  console.log(
                    `Auto-linking: Successfully deleted duplicate package ${dup.id}`
                  );
                } catch (deleteError) {
                  console.error(
                    `Auto-linking: Failed to delete duplicate package ${dup.id}:`,
                    deleteError
                  );
                }
              }
              console.log(
                `Auto-linking: Re-linking bid_history records to new package ${freshBidPackage.id}`
              );
              const newPairingMap = new Map(
                fetchedPairings.map((p) => [p.pairingNumber, p])
              );
              const unlinkedAfterCleanup = await db.select().from(bidHistory).where(sql4`linked_pairing_id IS NULL`);
              let relinkedCount = 0;
              for (const record of unlinkedAfterCleanup) {
                const { baseType: histAircraftBase, position: histPosition } = parseAircraftCode(record.aircraft);
                const histMonthNorm = normalizeMonth(record.month);
                if (histMonthNorm === freshMonth && record.year === freshBidPackage.year && record.base === freshBidPackage.base && histAircraftBase === freshAircraftBase && histPosition === freshPosition) {
                  const matchingPairing = newPairingMap.get(
                    record.pairingNumber
                  );
                  if (matchingPairing) {
                    await db.update(bidHistory).set({ linkedPairingId: matchingPairing.id }).where(sql4`id = ${record.id}`);
                    relinkedCount++;
                  }
                }
              }
              console.log(
                `Auto-linking: Re-linked ${relinkedCount} bid_history records to new package (position: ${freshPosition || "none"})`
              );
            }
          }
        } catch (linkError) {
          console.error(
            "Error linking existing bid_history records:",
            linkError
          );
        }
      } catch (parseError) {
        console.error(
          `File parsing failed for bid package ${bidPackage.id}:`,
          parseError
        );
        await storage.updateBidPackageStatus(bidPackage.id, "failed");
        return res.status(500).json({
          success: false,
          message: "Failed to parse bid package PDF."
        });
      }
      res.json({
        success: true,
        bidPackage,
        message: "Bid package uploaded and processed successfully."
      });
    } catch (error) {
      console.error("Error uploading bid package:", error);
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: "Invalid bid package data", errors: error.errors });
      } else {
        res.status(500).json({ message: "Failed to upload bid package" });
      }
    }
  });
  app2.post(
    "/api/upload-reasons-report",
    uploadReasonsReport.single("reasonsReport"),
    async (req, res) => {
      try {
        if (!req.file) {
          return res.status(400).json({ message: "No file uploaded" });
        }
        console.log("Processing reasons report:", req.file.originalname);
        const htmlContent = req.file.buffer.toString("utf-8");
        const awards = await ReasonsReportParser.parseReasonsReportFromContent(htmlContent);
        const metadata = ReasonsReportParser.extractMetadata(htmlContent);
        if (!metadata) {
          return res.status(400).json({
            message: "Could not extract base/aircraft/month from HTML. Please check file format."
          });
        }
        const allPackages = await storage.getBidPackages();
        const { baseType: metadataAircraftBase } = parseAircraftCode(
          metadata.aircraft
        );
        const matchingPackage = allPackages.find((pkg) => {
          const { baseType: pkgAircraftBase } = parseAircraftCode(pkg.aircraft);
          return normalizeMonth(pkg.month) === normalizeMonth(metadata.month) && pkg.year === metadata.year && pkg.base === metadata.base && pkgAircraftBase === metadataAircraftBase;
        });
        let packagePairings = [];
        if (matchingPackage) {
          packagePairings = await storage.getPairings(matchingPackage.id);
          console.log(
            `Found matching bid package (ID: ${matchingPackage.id}) with ${packagePairings.length} pairings`
          );
        } else {
          console.log(
            `WARNING: No matching bid package found for ${metadata.base} ${metadata.aircraft} ${metadata.month} ${metadata.year}`
          );
          console.log(
            `Historical records will be stored without leg/layover data from package`
          );
        }
        const pairingMap = /* @__PURE__ */ new Map();
        for (const p of packagePairings) {
          pairingMap.set(p.pairingNumber, p);
        }
        const computeLegSignature = (segments) => {
          if (!segments || segments.length === 0) return "";
          const legs = [];
          for (let i = 0; i < segments.length; i++) {
            if (i === 0) {
              legs.push(segments[i].departure);
            }
            legs.push(segments[i].arrival);
          }
          return legs.join("-");
        };
        const getTurnDestination = (segments, pairingDays) => {
          if (pairingDays !== 1 || !segments || segments.length === 0)
            return null;
          const arrivals = segments.map((s) => s.arrival);
          const departures = segments.map((s) => s.departure);
          const base = departures[0];
          const destinations = arrivals.filter((a) => a !== base);
          const uniqueDests = [...new Set(destinations)];
          return uniqueDests.length > 0 ? uniqueDests.join("-") : null;
        };
        let storedCount = 0;
        let skippedCount = 0;
        let linkedCount = 0;
        let unlinkedCount = 0;
        console.log(
          `Processing ${awards.length} awards for ${metadata.base} ${metadata.aircraft} ${metadata.month} ${metadata.year}`
        );
        for (const award of awards) {
          try {
            const existingAward = await db.select().from(bidHistory).where(
              and3(
                eq3(bidHistory.pairingNumber, award.pairingNumber),
                eq3(bidHistory.month, metadata.month),
                eq3(bidHistory.year, metadata.year),
                eq3(bidHistory.base, metadata.base),
                eq3(bidHistory.aircraft, metadata.aircraft),
                eq3(bidHistory.juniorHolderSeniority, award.seniorityNumber)
              )
            ).limit(1);
            if (existingAward.length > 0) {
              skippedCount++;
              continue;
            }
            const fingerprint = ReasonsReportParser.createTripFingerprint(award);
            const creditHours = parseFloat(
              award.monthCredit.replace(":", ".").replace(/[^\d.]/g, "")
            );
            const totalCredit = parseFloat(
              award.totalCredit.replace(":", ".").replace(/[^\d.]/g, "")
            );
            const matchingPairing = pairingMap.get(award.pairingNumber);
            let linkedPairingId = null;
            let layoverCitiesFromPackage = null;
            let turnDestination = null;
            let legSignature = null;
            if (matchingPairing) {
              linkedPairingId = matchingPairing.id;
              linkedCount++;
              const layovers = typeof matchingPairing.layovers === "string" ? JSON.parse(matchingPairing.layovers) : matchingPairing.layovers;
              if (Array.isArray(layovers) && layovers.length > 0) {
                layoverCitiesFromPackage = layovers.map((l) => l.city).sort().join("-");
              }
              const segments = typeof matchingPairing.flightSegments === "string" ? JSON.parse(matchingPairing.flightSegments) : matchingPairing.flightSegments;
              if (Array.isArray(segments)) {
                legSignature = computeLegSignature(segments);
                turnDestination = getTurnDestination(
                  segments,
                  matchingPairing.pairingDays || award.pairingDays
                );
              }
              if (layoverCitiesFromPackage) {
                fingerprint.layoverCities = layoverCitiesFromPackage.split("-").sort();
                fingerprint.layoverPattern = layoverCitiesFromPackage;
              }
            } else {
              unlinkedCount++;
            }
            await db.insert(bidHistory).values({
              pairingNumber: award.pairingNumber,
              month: metadata.month,
              year: metadata.year,
              base: metadata.base,
              aircraft: metadata.aircraft,
              juniorHolderSeniority: award.seniorityNumber,
              juniorHolderName: award.pilotName,
              juniorHolderEmployeeNumber: award.employeeNumber,
              awardType: award.awardType,
              pairingDays: award.pairingDays,
              creditHours: creditHours.toString(),
              totalCredit: totalCredit.toString(),
              layoverCities: award.layoverCities,
              checkInDate: award.checkInDate,
              checkOutDate: award.checkOutDate,
              linkedPairingId,
              layoverCitiesFromPackage,
              turnDestination,
              legSignature,
              tripFingerprint: fingerprint,
              awardedAt: /* @__PURE__ */ new Date(
                `${metadata.year}-${monthToNumber(metadata.month)}-01`
              )
            });
            storedCount++;
          } catch (error) {
            console.error(
              `Error storing award for pairing ${award.pairingNumber}:`,
              error
            );
          }
        }
        console.log(
          `Upload complete: ${storedCount} stored, ${skippedCount} skipped, ${linkedCount} linked to bid package, ${unlinkedCount} unlinked`
        );
        res.json({
          success: true,
          message: skippedCount > 0 ? `Reasons report processed: ${storedCount} new awards stored, ${skippedCount} duplicates skipped, ${linkedCount} linked to bid package` : `Reasons report processed: ${storedCount} awards stored, ${linkedCount} linked to bid package`,
          stats: {
            totalParsed: awards.length,
            stored: storedCount,
            skipped: skippedCount,
            linked: linkedCount,
            unlinked: unlinkedCount,
            base: metadata.base,
            aircraft: metadata.aircraft,
            month: metadata.month,
            year: metadata.year
          },
          warning: unlinkedCount > 0 && linkedCount === 0 ? `No matching bid package found for ${metadata.month} ${metadata.year}. Upload the bid package first for accurate leg/layover data.` : void 0
        });
      } catch (error) {
        console.error("Error processing reasons report:", error);
        res.status(500).json({ message: "Failed to process reasons report", error });
      }
    }
  );
  app2.get("/api/reasons-reports", async (req, res) => {
    try {
      const reports = await db.select({
        month: bidHistory.month,
        year: bidHistory.year,
        base: bidHistory.base,
        aircraft: bidHistory.aircraft,
        count: sql4`count(*)::int`,
        uploadedAt: sql4`max(${bidHistory.uploadedAt})`
      }).from(bidHistory).groupBy(
        bidHistory.month,
        bidHistory.year,
        bidHistory.base,
        bidHistory.aircraft
      ).orderBy(sql4`${bidHistory.year} desc`, sql4`${bidHistory.month} desc`);
      res.json(reports);
    } catch (error) {
      console.error("Error fetching reasons reports:", error);
      res.status(500).json({ message: "Failed to fetch reasons reports" });
    }
  });
  function monthToNumber(month) {
    const months = {
      JAN: 1,
      FEB: 2,
      MAR: 3,
      APR: 4,
      MAY: 5,
      JUN: 6,
      JUL: 7,
      AUG: 8,
      SEP: 9,
      OCT: 10,
      NOV: 11,
      DEC: 12
    };
    return months[month.toUpperCase()] || 1;
  }
  app2.get("/api/pairings", async (req, res) => {
    try {
      res.set({
        "Cache-Control": "no-cache, no-store, must-revalidate",
        Pragma: "no-cache",
        Expires: "0"
      });
      const {
        bidPackageId,
        search,
        creditMin,
        creditMax,
        blockMin,
        blockMax,
        tafb,
        tafbMin,
        tafbMax,
        holdProbabilityMin,
        pairingDays,
        pairingDaysMin,
        pairingDaysMax,
        efficiency,
        seniorityPercentile
      } = req.query;
      console.log("GET /api/pairings query params:", {
        creditMin,
        creditMax,
        blockMin,
        blockMax,
        search,
        bidPackageId
      });
      console.log("All query params:", req.query);
      if (!bidPackageId) {
        return res.status(400).json({ error: "bidPackageId is required" });
      }
      const conditions = [
        eq3(pairings.bidPackageId, parseInt(bidPackageId))
      ];
      if (search) {
        conditions.push(sql4`
          pairingNumber ILIKE ${`%${search}%`} OR
          base ILIKE ${`%${search}%`} OR
          aircraft ILIKE ${`%${search}%`} OR
          notes ILIKE ${`%${search}%`}
        `);
      }
      if (creditMin) {
        conditions.push(gte3(pairings.creditHours, creditMin));
      }
      if (creditMax) {
        conditions.push(lte3(pairings.creditHours, creditMax));
      }
      if (blockMin) {
        conditions.push(gte3(pairings.blockHours, blockMin));
      }
      if (blockMax) {
        conditions.push(lte3(pairings.blockHours, blockMax));
      }
      if (tafb) {
        conditions.push(eq3(pairings.tafb, tafb));
      }
      if (tafbMin) {
        conditions.push(gte3(pairings.tafb, tafbMin));
      }
      if (tafbMax) {
        conditions.push(lte3(pairings.tafb, tafbMax));
      }
      if (holdProbabilityMin) {
        conditions.push(
          gte3(
            pairings.holdProbability,
            parseFloat(holdProbabilityMin)
          )
        );
      }
      if (pairingDays) {
        conditions.push(
          eq3(pairings.pairingDays, parseInt(pairingDays))
        );
      }
      if (pairingDaysMin) {
        conditions.push(
          gte3(pairings.pairingDays, parseInt(pairingDaysMin))
        );
      }
      if (pairingDaysMax) {
        conditions.push(
          lte3(pairings.pairingDays, parseInt(pairingDaysMax))
        );
      }
      const query = db.select().from(pairings).where(and3(...conditions));
      const pairingsResult = await query.execute();
      if (seniorityPercentile) {
        const allForPackage = await db.select().from(pairings).where(eq3(pairings.bidPackageId, parseInt(bidPackageId)));
        const [bidPkg] = await db.select({ month: bidPackages.month }).from(bidPackages).where(eq3(bidPackages.id, parseInt(bidPackageId))).limit(1);
        const bidMonth = bidPkg?.month;
        const seniorityValue = parseFloat(seniorityPercentile);
        for (const p of pairingsResult) {
          const layoverCities = p.layovers?.map((l) => l.city).filter((c) => c) || [];
          const desirability = HoldProbabilityCalculator.calculateDesirabilityScore(p, bidMonth);
          const freq = HoldProbabilityCalculator.calculatePairingFrequency(
            p.pairingNumber,
            allForPackage
          );
          const hp = HoldProbabilityCalculator.calculateHoldProbability({
            seniorityPercentile: seniorityValue,
            desirabilityScore: desirability,
            pairingFrequency: freq,
            startsOnWeekend: HoldProbabilityCalculator.startsOnWeekend(p),
            includesDeadheads: p.deadheads || 0,
            includesWeekendOff: HoldProbabilityCalculator.includesWeekendOff(p),
            bidMonth,
            layoverCities
          });
          p.holdProbability = hp.probability;
        }
      }
      res.json(pairingsResult);
    } catch (error) {
      console.error("Error fetching pairings:", error);
      res.status(500).json({ message: "Failed to fetch pairings" });
    }
  });
  app2.post("/api/pairings/search", async (req, res) => {
    try {
      res.set({
        "Cache-Control": "no-cache, no-store, must-revalidate",
        Pragma: "no-cache",
        Expires: "0"
      });
      console.log("POST /api/pairings/search", { path: req.path });
      const {
        bidPackageId,
        sortBy = "pairingNumber",
        sortOrder = "asc",
        layoverLocations,
        ...filters
      } = req.body;
      if (!bidPackageId) {
        console.log("No bid package ID provided in search request");
        return res.status(400).json({
          message: "Bid package ID is required",
          pairings: [],
          statistics: {
            likelyToHold: 0,
            highCredit: 0,
            ratioBreakdown: { excellent: 0, good: 0, average: 0, poor: 0 }
          }
        });
      }
      if (process.env.LOG_LEVEL === "debug") {
        console.log("Search params:", {
          bidPackageId,
          sortBy,
          sortOrder,
          efficiency: filters?.efficiency,
          holdProbabilityMin: filters?.holdProbabilityMin,
          pairingDays: filters?.pairingDays,
          seniorityPercentile: filters?.seniorityPercentile,
          seniorityPercentage: filters?.seniorityPercentage
        });
      }
      const result = await storage.getAllPairingsForBidPackage({
        bidPackageId,
        sortBy,
        sortOrder,
        layoverLocations,
        ...filters
      });
      const seniorityValueRaw = filters?.seniorityPercentile || filters?.seniorityPercentage;
      if (seniorityValueRaw) {
        const seniorityValue = parseFloat(seniorityValueRaw);
        const needsRecalc = result.pairings.some(
          (p) => p.holdProbability === null || p.holdProbability === void 0
        );
        if (needsRecalc) {
          const allForPackage = await db.select().from(pairings).where(eq3(pairings.bidPackageId, bidPackageId));
          for (const p of result.pairings) {
            if (p.holdProbability !== null && p.holdProbability !== void 0) {
              continue;
            }
            const desirability = HoldProbabilityCalculator.calculateDesirabilityScore(p);
            const freq = HoldProbabilityCalculator.calculatePairingFrequency(
              p.pairingNumber,
              allForPackage
            );
            const hp = HoldProbabilityCalculator.calculateHoldProbability({
              seniorityPercentile: seniorityValue,
              desirabilityScore: desirability,
              pairingFrequency: freq,
              startsOnWeekend: HoldProbabilityCalculator.startsOnWeekend(p),
              includesDeadheads: p.deadheads || 0,
              includesWeekendOff: HoldProbabilityCalculator.includesWeekendOff(p)
            });
            p.holdProbability = hp.probability;
          }
        }
      }
      if (process.env.LOG_LEVEL === "debug") {
        console.log(`Found ${result.pairings.length} pairings`);
      }
      res.json(result);
    } catch (error) {
      console.error("Error searching pairings:", error);
      res.status(500).json({
        message: "Failed to search pairings",
        pairings: [],
        statistics: {
          likelyToHold: 0,
          highCredit: 0,
          ratioBreakdown: { excellent: 0, good: 0, average: 0, poor: 0 }
        }
      });
    }
  });
  app2.get("/api/pairings/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const pairing = await storage.getPairing(id);
      if (!pairing) {
        return res.status(404).json({ message: "Pairing not found" });
      }
      res.json(pairing);
    } catch (error) {
      console.error("Error fetching pairing:", error);
      res.status(500).json({ message: "Failed to fetch pairing" });
    }
  });
  app2.get("/api/verify-pairing/:pairingNumber", async (req, res) => {
    try {
      const { pairingNumber } = req.params;
      const bidPackageId = req.query.bidPackageId ? parseInt(req.query.bidPackageId) : void 0;
      if (!bidPackageId) {
        const bidPackages2 = await storage.getBidPackages();
        if (bidPackages2.length === 0) {
          return res.status(404).json({ message: "No bid packages found" });
        }
        const recentBidPackage = bidPackages2[0];
        const allPairings = await storage.getPairings(recentBidPackage.id);
        const pairing = allPairings.find(
          (p) => p.pairingNumber === pairingNumber
        );
        if (!pairing) {
          return res.status(404).json({
            message: "Pairing not found",
            pairingNumber,
            bidPackageId: recentBidPackage.id,
            totalPairings: allPairings.length,
            samplePairings: allPairings.slice(0, 10).map((p) => p.pairingNumber)
          });
        }
        res.json({
          found: true,
          pairing,
          bidPackageId: recentBidPackage.id,
          verified: true
        });
      } else {
        const allPairings = await storage.getPairings(bidPackageId);
        const pairing = allPairings.find(
          (p) => p.pairingNumber === pairingNumber
        );
        if (!pairing) {
          return res.status(404).json({
            message: "Pairing not found",
            pairingNumber,
            bidPackageId,
            totalPairings: allPairings.length,
            samplePairings: allPairings.slice(0, 10).map((p) => p.pairingNumber)
          });
        }
        res.json({
          found: true,
          pairing,
          bidPackageId,
          verified: true
        });
      }
    } catch (error) {
      console.error("Error verifying pairing:", error);
      res.status(500).json({ message: "Failed to verify pairing" });
    }
  });
  app2.get("/api/history/:pairingNumber", async (req, res) => {
    try {
      const { pairingNumber } = req.params;
      const history = await storage.getBidHistoryForPairing(pairingNumber);
      res.json(history);
    } catch (error) {
      console.error("Error fetching bid history:", error);
      res.status(500).json({ message: "Failed to fetch bid history" });
    }
  });
  app2.get("/api/history/similar/:pairingId", async (req, res) => {
    try {
      const pairingId = parseInt(req.params.pairingId);
      const pairing = await db.select().from(pairings).where(eq3(pairings.id, pairingId)).limit(1);
      if (pairing.length === 0) {
        return res.status(404).json({ message: "Pairing not found" });
      }
      const currentPairing = pairing[0];
      const bidPackageResult = await db.select().from(bidPackages).where(eq3(bidPackages.id, currentPairing.bidPackageId)).limit(1);
      const bidPackage = bidPackageResult[0];
      const rawMonth = bidPackage?.month || "JAN";
      const currentMonth = rawMonth.substring(0, 3).toUpperCase();
      const currentYear = bidPackage?.year || (/* @__PURE__ */ new Date()).getFullYear();
      const parsedPairing = {
        ...currentPairing,
        layovers: typeof currentPairing.layovers === "string" ? JSON.parse(currentPairing.layovers) : currentPairing.layovers,
        flightSegments: typeof currentPairing.flightSegments === "string" ? JSON.parse(currentPairing.flightSegments) : currentPairing.flightSegments
      };
      const currentFingerprint = HoldProbabilityCalculator.createFingerprintFromPairing(parsedPairing);
      currentFingerprint.creditHours = parseFloat(
        currentPairing.creditHours?.toString() || "0"
      );
      const layoverCities = Array.isArray(parsedPairing.layovers) ? parsedPairing.layovers.map((l) => l.city).sort() : [];
      const creditHours = parseFloat(
        currentPairing.creditHours?.toString() || "0"
      );
      const pairingDays = currentPairing.pairingDays || 1;
      let currentTurnDestination = null;
      let currentLegSignature = null;
      if (pairingDays === 1 && Array.isArray(parsedPairing.flightSegments)) {
        const segments = parsedPairing.flightSegments;
        const legs = [];
        for (let i = 0; i < segments.length; i++) {
          if (i === 0) legs.push(segments[i].departure);
          legs.push(segments[i].arrival);
        }
        currentLegSignature = legs.join("-");
        const base = segments[0]?.departure;
        const destinations = segments.map((s) => s.arrival).filter((a) => a !== base);
        const uniqueDests = [...new Set(destinations)];
        currentTurnDestination = uniqueDests.length > 0 ? uniqueDests.join("-") : null;
      }
      const currentLayoverPattern = layoverCities.length > 0 ? layoverCities.join("-") : "none";
      const historicalData = await db.select().from(bidHistory);
      const matches = [];
      for (const history of historicalData) {
        if (history.tripFingerprint) {
          let histFingerprint = history.tripFingerprint;
          if (typeof histFingerprint === "string") {
            try {
              histFingerprint = JSON.parse(histFingerprint);
            } catch {
              continue;
            }
          }
          if (history.pairingDays !== void 0 && history.pairingDays !== null && history.pairingDays > 0) {
            histFingerprint.pairingDays = history.pairingDays;
          } else {
            continue;
          }
          if (histFingerprint.pairingDays !== pairingDays) {
            continue;
          }
          if (history.layoverCities !== void 0 && history.layoverCities !== null) {
            let parsedCities = [];
            if (typeof history.layoverCities === "string" && history.layoverCities.length > 0) {
              parsedCities = history.layoverCities.split(/\s+/).map((city) => city.replace(/-\d+(\.\d+)?$/, "")).filter((city) => city.length > 0);
            } else if (Array.isArray(history.layoverCities)) {
              parsedCities = history.layoverCities;
            }
            histFingerprint.layoverCities = parsedCities.sort();
            histFingerprint.layoverPattern = parsedCities.length > 0 ? parsedCities.sort().join("-") : "none";
          }
          if (!Array.isArray(histFingerprint.layoverCities)) {
            histFingerprint.layoverCities = [];
          }
          if (history.creditHours !== null && history.creditHours !== void 0) {
            histFingerprint.creditHours = parseFloat(
              history.creditHours.toString()
            );
          }
          const isSamePairing = history.pairingNumber === currentPairing.pairingNumber && history.month === currentMonth && history.year === currentYear;
          if (pairingDays === 1) {
            const histTurnDest = history.turnDestination;
            const histLegSig = history.legSignature;
            if (histLegSig && currentLegSignature) {
              if (histLegSig !== currentLegSignature) {
                continue;
              }
            } else if (histTurnDest && currentTurnDestination) {
              if (histTurnDest !== currentTurnDestination) {
                continue;
              }
            } else if (!isSamePairing) {
              continue;
            }
          }
          if (pairingDays > 1 && history.layoverCitiesFromPackage) {
            const packageLayovers = history.layoverCitiesFromPackage.split("-").sort();
            histFingerprint.layoverCities = packageLayovers;
            histFingerprint.layoverPattern = packageLayovers.join("-");
          }
          let similarity;
          if (isSamePairing) {
            similarity = {
              score: 100,
              confidence: "exact",
              breakdown: {
                layoverMatch: 100,
                daysMatch: 100,
                timeMatch: 100,
                creditMatch: 100,
                efficiencyMatch: 100,
                seasonMatch: 100
              }
            };
          } else {
            similarity = TripMatcher.calculateSimilarity(
              currentFingerprint,
              histFingerprint
            );
          }
          if (similarity.score >= 60) {
            let displayLayovers = "";
            if (history.layoverCities) {
              if (typeof history.layoverCities === "string") {
                displayLayovers = history.layoverCities.split(/\s+/).map((city) => city.replace(/-\d+$/, "")).filter((city) => city.length > 0).sort().join("-");
              } else if (Array.isArray(history.layoverCities)) {
                displayLayovers = history.layoverCities.sort().join("-");
              }
            }
            matches.push({
              pairingNumber: history.pairingNumber,
              month: history.month,
              year: history.year,
              juniorHolderSeniority: history.juniorHolderSeniority,
              checkInDate: history.checkInDate ?? void 0,
              // Include check-in date for grouping
              similarity: similarity.score,
              confidence: similarity.confidence,
              breakdown: similarity.breakdown,
              historicalLayovers: displayLayovers || "None",
              historicalDays: history.pairingDays,
              historicalCredit: history.creditHours?.toString() || "0"
            });
          }
        }
      }
      const groupedMatches = /* @__PURE__ */ new Map();
      for (const match of matches) {
        const key = `${match.pairingNumber}-${match.month}-${match.year}`;
        const existing = groupedMatches.get(key);
        if (existing) {
          existing.awards.push({
            seniority: match.juniorHolderSeniority,
            checkInDate: match.checkInDate
          });
          if (match.similarity > existing.similarity) {
            existing.similarity = match.similarity;
            existing.confidence = match.confidence;
            existing.breakdown = match.breakdown;
          }
        } else {
          groupedMatches.set(key, {
            pairingNumber: match.pairingNumber,
            month: match.month,
            year: match.year,
            similarity: match.similarity,
            confidence: match.confidence,
            breakdown: match.breakdown,
            historicalLayovers: match.historicalLayovers,
            historicalDays: match.historicalDays,
            historicalCredit: match.historicalCredit,
            awards: [
              {
                seniority: match.juniorHolderSeniority,
                checkInDate: match.checkInDate
              }
            ],
            isExactPairing: match.pairingNumber === currentPairing.pairingNumber
          });
        }
      }
      const sortedMatches = Array.from(groupedMatches.values()).sort((a, b) => {
        if (a.isExactPairing && !b.isExactPairing) return -1;
        if (!a.isExactPairing && b.isExactPairing) return 1;
        if (b.similarity !== a.similarity) return b.similarity - a.similarity;
        if (b.year !== a.year) return b.year - a.year;
        const monthOrder = [
          "JAN",
          "FEB",
          "MAR",
          "APR",
          "MAY",
          "JUN",
          "JUL",
          "AUG",
          "SEP",
          "OCT",
          "NOV",
          "DEC"
        ];
        return monthOrder.indexOf(b.month) - monthOrder.indexOf(a.month);
      });
      const formattedMatches = sortedMatches.slice(0, 10).map((m) => {
        const formattedAwards = m.awards.map((a) => {
          const dateMatch = a.checkInDate?.match(
            /^(\d{2}\/\d{2})\s*(\w{3})?/
          );
          const date2 = dateMatch?.[1] || "";
          const dayOfWeek = dateMatch?.[2] || "";
          return {
            date: date2,
            dayOfWeek,
            seniority: a.seniority,
            fullDate: a.checkInDate || ""
          };
        }).sort((a, b) => a.date.localeCompare(b.date));
        const dates = formattedAwards.map((a) => a.date).filter(Boolean);
        const dateRange = dates.length > 1 ? `${dates[0]} - ${dates[dates.length - 1]}` : dates[0] || "";
        return {
          pairingNumber: m.pairingNumber,
          month: m.month,
          year: m.year,
          similarity: m.similarity,
          confidence: m.confidence,
          breakdown: m.breakdown,
          historicalLayovers: m.historicalLayovers,
          historicalDays: m.historicalDays,
          historicalCredit: m.historicalCredit,
          isExactPairing: m.isExactPairing,
          awardCount: m.awards.length,
          juniorHolderSeniority: Math.max(...m.awards.map((a) => a.seniority)),
          // Most junior
          seniorHolderSeniority: Math.min(...m.awards.map((a) => a.seniority)),
          // Most senior
          awards: formattedAwards,
          // Individual awards with date+seniority pairs
          dateRange
          // e.g., "12/20 - 12/28" for multiple awards (for summary)
        };
      });
      res.json({
        currentPairing: {
          pairingNumber: currentPairing.pairingNumber,
          layovers: layoverCities.join("-") || "None",
          days: pairingDays,
          credit: creditHours.toFixed(2)
        },
        similarMatches: formattedMatches
      });
    } catch (error) {
      console.error("Error fetching similar bid history:", error);
      res.status(500).json({ message: "Failed to fetch similar bid history" });
    }
  });
  app2.post("/api/user", async (req, res) => {
    try {
      const { name, seniorityNumber, seniorityPercentile, base, aircraft } = req.body;
      if (!seniorityNumber || !base || !aircraft) {
        return res.status(400).json({ error: "Missing required fields" });
      }
      const user = await storage.createOrUpdateUser({
        name,
        seniorityNumber: parseInt(seniorityNumber),
        seniorityPercentile: seniorityPercentile ? parseFloat(seniorityPercentile) : 50,
        base,
        aircraft
      });
      res.json(user);
    } catch (error) {
      console.error("Error creating/updating user:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });
  app2.post("/api/recalculate-probabilities", async (req, res) => {
    try {
      const { bidPackageId, seniorityPercentile, seniorityNumber } = req.body;
      if (!bidPackageId || seniorityPercentile === void 0) {
        return res.status(400).json({ error: "Missing required fields" });
      }
      recalculateHoldProbabilitiesBackground(
        bidPackageId,
        seniorityPercentile,
        seniorityNumber
      );
      res.json({ success: true, message: "Recalculation started" });
    } catch (error) {
      console.error("Error triggering recalculation:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });
  app2.post("/api/favorites", async (req, res) => {
    try {
      const { userId, pairingId } = req.body;
      console.log("Adding favorite - userId:", userId, "pairingId:", pairingId);
      if (!userId || !pairingId) {
        console.error("Missing required fields:", { userId, pairingId });
        return res.status(400).json({ message: "Missing userId or pairingId" });
      }
      const favorite = await storage.addUserFavorite({ userId, pairingId });
      console.log("Favorite added successfully:", favorite);
      res.json(favorite);
    } catch (error) {
      console.error("Error adding favorite:", error);
      console.error("Error details:", {
        message: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : "No stack trace",
        userId: req.body?.userId,
        pairingId: req.body?.pairingId
      });
      res.status(500).json({
        message: "Failed to add favorite",
        error: process.env.NODE_ENV === "development" ? error.message : void 0
      });
    }
  });
  app2.delete("/api/favorites", async (req, res) => {
    try {
      const { userId, pairingId } = req.body;
      await storage.removeUserFavorite(userId, pairingId);
      res.json({ success: true });
    } catch (error) {
      console.error("Error removing favorite:", error);
      res.status(500).json({ message: "Failed to remove favorite" });
    }
  });
  app2.get("/api/favorites/:userId", async (req, res) => {
    try {
      const userId = parseInt(req.params.userId);
      const favorites = await storage.getUserFavorites(userId);
      res.json(favorites);
    } catch (error) {
      console.error("Error fetching favorites:", error);
      res.status(500).json({ message: "Failed to fetch favorites" });
    }
  });
  app2.post("/api/calendar", async (req, res) => {
    try {
      const { userId, pairingId, startDate, endDate, notes } = req.body;
      console.log("Calendar POST request:", {
        userId,
        pairingId,
        startDate,
        endDate,
        notes
      });
      console.log(
        "Database connection status:",
        db ? "Connected" : "Not connected"
      );
      if (!userId || !pairingId || !startDate || !endDate) {
        console.error("Missing required fields:", {
          userId,
          pairingId,
          startDate,
          endDate
        });
        return res.status(400).json({
          message: "Missing required fields: userId, pairingId, startDate, endDate"
        });
      }
      const event = await storage.addUserCalendarEvent({
        userId: parseInt(userId),
        pairingId: parseInt(pairingId),
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        notes
      });
      console.log("Calendar event created successfully:", event);
      res.json(event);
    } catch (error) {
      console.error("Error adding calendar event:", error);
      console.error("Error details:", {
        message: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : "No stack trace",
        userId: req.body?.userId,
        pairingId: req.body?.pairingId,
        startDate: req.body?.startDate,
        endDate: req.body?.endDate
      });
      res.status(500).json({
        message: error instanceof Error ? error.message : "Failed to add calendar event",
        error: process.env.NODE_ENV === "development" ? error.message : void 0
      });
    }
  });
  app2.delete("/api/calendar", async (req, res) => {
    try {
      const { userId, pairingId } = req.body;
      await storage.removeUserCalendarEvent(userId, pairingId);
      res.json({ success: true });
    } catch (error) {
      console.error("Error removing calendar event:", error);
      res.status(500).json({ message: "Failed to remove calendar event" });
    }
  });
  app2.get("/api/calendar/:userId", async (req, res) => {
    try {
      const userId = parseInt(req.params.userId);
      const { startDate, endDate } = req.query;
      console.log(
        "Fetching calendar events for userId:",
        userId,
        "dateRange:",
        { startDate, endDate }
      );
      console.log(
        "Database connection status:",
        db ? "Connected" : "Not connected"
      );
      if (isNaN(userId)) {
        console.error("Invalid userId:", req.params.userId);
        return res.status(400).json({ message: "Invalid userId" });
      }
      if (startDate && endDate) {
        const events = await storage.getUserCalendarEventsInRange(
          userId,
          new Date(startDate),
          new Date(endDate)
        );
        console.log("Calendar events found (date range):", events.length);
        res.json(events);
      } else {
        const events = await storage.getUserCalendarEvents(userId);
        console.log("Calendar events found (all):", events.length);
        res.json(events);
      }
    } catch (error) {
      console.error("Error fetching calendar events:", error);
      console.error("Error details:", {
        message: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : "No stack trace",
        userId: req.params.userId,
        startDate: req.query.startDate,
        endDate: req.query.endDate
      });
      res.status(500).json({
        message: "Failed to fetch calendar events",
        error: process.env.NODE_ENV === "development" ? error.message : void 0
      });
    }
  });
  app2.get("/api/calendar/:userId/:month/:year", async (req, res) => {
    try {
      const userId = parseInt(req.params.userId);
      const month = parseInt(req.params.month);
      const year = parseInt(req.params.year);
      const events = await storage.getUserCalendarEventsForMonth(
        userId,
        month,
        year
      );
      res.json(events);
    } catch (error) {
      console.error("Error fetching calendar events for month:", error);
      res.status(500).json({ message: "Failed to fetch calendar events for month" });
    }
  });
  app2.get("/api/chat-history/:sessionId", async (req, res) => {
    try {
      const { sessionId } = req.params;
      const history = await storage.getChatHistory(sessionId);
      res.json(history);
    } catch (error) {
      console.error("Error fetching chat history:", error);
      res.status(500).json({ message: "Failed to fetch chat history" });
    }
  });
  app2.post("/api/chat-history", async (req, res) => {
    try {
      const { sessionId, bidPackageId, messageType, content, messageData } = req.body;
      const savedMessage = await storage.saveChatMessage({
        sessionId,
        bidPackageId,
        messageType,
        content,
        messageData
      });
      res.json(savedMessage);
    } catch (error) {
      console.error("Error saving chat message:", error);
      res.status(500).json({ message: "Failed to save chat message" });
    }
  });
  app2.delete("/api/chat-history/:sessionId", async (req, res) => {
    try {
      const { sessionId } = req.params;
      await storage.clearChatHistory(sessionId);
      res.json({ success: true });
    } catch (error) {
      console.error("Error clearing chat history:", error);
      res.status(500).json({ message: "Failed to clear chat history" });
    }
  });
  app2.post("/api/askAssistant", async (req, res) => {
    try {
      const { question, bidPackageId, seniorityPercentile, sessionId, userId } = req.body;
      if (!question) {
        return res.status(400).json({ message: "Question is required" });
      }
      const bidPackageMatch = question.match(/bid package #(\d+)/);
      let finalBidPackageId = bidPackageId || (bidPackageMatch ? parseInt(bidPackageMatch[1]) : void 0);
      if (!finalBidPackageId) {
        const bidPackages2 = await storage.getBidPackages();
        if (bidPackages2.length > 0) {
          finalBidPackageId = bidPackages2[0].id;
          console.log(`Using most recent bid package ID: ${finalBidPackageId}`);
        }
      }
      if (finalBidPackageId) {
        try {
          const { SimpleAI: SimpleAI2 } = await Promise.resolve().then(() => (init_simpleAI(), simpleAI_exports));
          const simpleAI = new SimpleAI2(storage);
          let conversationHistory = [];
          if (sessionId) {
            const history = await storage.getChatHistory(sessionId);
            conversationHistory = history.map((msg) => ({
              role: msg.messageType === "user" ? "user" : "assistant",
              content: msg.content
            }));
          }
          const result = await simpleAI.query({
            message: question,
            bidPackageId: finalBidPackageId,
            userId: typeof userId === "number" ? userId : void 0,
            seniorityPercentile: typeof seniorityPercentile === "number" ? seniorityPercentile : void 0,
            conversationHistory
          });
          res.json({
            reply: result.response,
            pairingNumbers: result.pairingNumbers
          });
          return;
        } catch (unifiedError) {
          console.error("Unified AI failed:", unifiedError);
          if (unifiedError && typeof unifiedError === "object" && "message" in unifiedError && typeof unifiedError.message === "string") {
            const msg = unifiedError.message;
            if (msg.includes("rate_limit_exceeded")) {
              res.json({
                reply: "I'm experiencing high demand right now. Please try again in a moment."
              });
              return;
            }
            if (msg.includes("context_length_exceeded")) {
              res.json({
                reply: "This request is very large. Try narrowing your question (e.g., by day count or destination) and I'll go deeper."
              });
              return;
            }
          }
        }
      }
      const reply = await openaiAssistant.askPBSAssistant(question);
      res.json({ reply });
    } catch (error) {
      console.error("Error asking PBS Assistant:", error);
      res.status(500).json({ message: "Failed to get response from PBS Assistant" });
    }
  });
  app2.post("/api/pairings/bulk", async (req, res) => {
    try {
      const { bidPackageId, pairings: pairings2 } = req.body;
      const createdPairings = [];
      for (const pairingData of pairings2) {
        const pairing = await storage.createPairing({
          ...pairingData,
          bidPackageId
        });
        createdPairings.push(pairing);
      }
      await storage.updateBidPackageStatus(bidPackageId, "completed");
      res.json({
        success: true,
        count: createdPairings.length,
        pairings: createdPairings
      });
    } catch (error) {
      console.error("Error creating bulk pairings:", error);
      res.status(500).json({ message: "Failed to create pairings" });
    }
  });
  app2.get("/api/verify-data", async (req, res) => {
    try {
      const verification = {};
      const bidPackages2 = await storage.getBidPackages();
      for (const bidPackage of bidPackages2) {
        const pairings2 = await storage.getPairings(bidPackage.id);
        const stats = await storage.getPairingStatsSummary(bidPackage.id);
        verification[bidPackage.id] = {
          bidPackage: {
            id: bidPackage.id,
            name: bidPackage.name,
            month: bidPackage.month,
            year: bidPackage.year,
            status: bidPackage.status
          },
          pairings: {
            total: pairings2.length,
            sample: pairings2.slice(0, 5).map((p) => ({
              pairingNumber: p.pairingNumber,
              creditHours: p.creditHours,
              blockHours: p.blockHours,
              pairingDays: p.pairingDays,
              holdProbability: p.holdProbability
            }))
          },
          stats: {
            totalPairings: stats.totalPairings,
            avgCreditHours: stats.avgCreditHours.toFixed(2),
            avgBlockHours: stats.avgBlockHours.toFixed(2),
            avgPairingDays: stats.avgPairingDays.toFixed(1),
            dayDistribution: stats.dayDistribution
          },
          dataIntegrity: {
            hasPairings: pairings2.length > 0,
            hasValidCreditHours: pairings2.filter(
              (p) => parseFloat(String(p.creditHours)) > 0
            ).length,
            hasValidBlockHours: pairings2.filter(
              (p) => parseFloat(String(p.blockHours)) > 0
            ).length,
            hasValidPairingNumbers: pairings2.filter(
              (p) => p.pairingNumber && p.pairingNumber.length > 0
            ).length,
            hasHoldProbabilities: pairings2.filter(
              (p) => p.holdProbability !== null && p.holdProbability !== void 0
            ).length
          }
        };
      }
      res.json({
        success: true,
        totalBidPackages: bidPackages2.length,
        verification
      });
    } catch (error) {
      console.error("Error verifying data:", error);
      res.status(500).json({ message: "Failed to verify data" });
    }
  });
  app2.get("/api/layover-locations", async (req, res) => {
    try {
      const bidPackageId = parseInt(req.query.bidPackageId);
      if (!bidPackageId) {
        return res.status(400).json({ error: "bidPackageId is required" });
      }
      const pairingsList = await db.select({ layovers: pairings.layovers }).from(pairings).where(eq3(pairings.bidPackageId, bidPackageId));
      const uniqueLocations = /* @__PURE__ */ new Set();
      for (const p of pairingsList) {
        if (p.layovers && Array.isArray(p.layovers)) {
          for (const layover of p.layovers) {
            if (layover.city) {
              uniqueLocations.add(layover.city);
            }
          }
        }
      }
      res.json(Array.from(uniqueLocations).sort());
    } catch (error) {
      console.error("Error fetching layover locations:", error);
      res.status(500).json({ error: "Failed to fetch layover locations" });
    }
  });
  app2.get("/api/users/:userId/calendar", async (req, res) => {
    try {
      const userId = parseInt(req.params.userId);
      const { startDate, endDate } = req.query;
      const events = await db.select({
        id: userCalendarEvents.id,
        userId: userCalendarEvents.userId,
        pairingId: userCalendarEvents.pairingId,
        startDate: userCalendarEvents.startDate,
        endDate: userCalendarEvents.endDate,
        notes: userCalendarEvents.notes,
        pairing: {
          id: pairings.id,
          pairingNumber: pairings.pairingNumber,
          route: pairings.route,
          creditHours: pairings.creditHours,
          blockHours: pairings.blockHours,
          tafb: pairings.tafb,
          checkInTime: pairings.checkInTime,
          pairingDays: pairings.pairingDays,
          layovers: pairings.layovers,
          flightSegments: pairings.flightSegments
        }
      }).from(userCalendarEvents).leftJoin(pairings, eq3(userCalendarEvents.pairingId, pairings.id)).where(
        and3(
          eq3(userCalendarEvents.userId, userId),
          startDate ? gte3(userCalendarEvents.endDate, new Date(startDate)) : void 0,
          endDate ? lte3(userCalendarEvents.startDate, new Date(endDate)) : void 0
        )
      );
      res.json(events);
    } catch (error) {
      console.error("Error fetching calendar events:", error);
      res.status(500).json({ error: "Failed to fetch calendar events" });
    }
  });
  app2.delete("/api/users/:userId/calendar/:pairingId", async (req, res) => {
    try {
      const userId = parseInt(req.params.userId);
      const pairingId = parseInt(req.params.pairingId);
      await db.delete(userCalendarEvents).where(
        and3(
          eq3(userCalendarEvents.userId, userId),
          eq3(userCalendarEvents.pairingId, pairingId)
        )
      );
      res.json({ success: true });
    } catch (error) {
      console.error("Error removing from calendar:", error);
      res.status(500).json({ error: "Failed to remove from calendar" });
    }
  });
  app2.get("/api/users/:userId/favorites", async (req, res) => {
    try {
      const userId = parseInt(req.params.userId);
      const favorites = await storage.getUserFavorites(userId);
      res.json(favorites);
    } catch (error) {
      console.error("Error fetching favorites:", error);
      res.status(500).json({ error: "Failed to fetch favorites" });
    }
  });
  const httpServer = createServer(app2);
  return httpServer;
}

// server/vercel-entry.ts
var app = express();
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: false, limit: "50mb" }));
var initialized = false;
var initPromise = registerRoutes(app).then(() => {
  initialized = true;
});
async function handler(req, res) {
  try {
    if (!initialized) {
      await initPromise;
    }
    return new Promise((resolve, reject) => {
      const originalEnd = res.end.bind(res);
      res.end = function(...args) {
        originalEnd(...args);
        resolve(void 0);
        return res;
      };
      app(req, res);
    });
  } catch (error) {
    console.error("Error in serverless handler:", error);
    if (!res.headersSent) {
      res.status(500).json({
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  }
}
export {
  handler as default
};
