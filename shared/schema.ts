import { pgTable, text, serial, integer, boolean, decimal, timestamp, jsonb, varchar, json, index } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod.js";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  seniorityNumber: integer("seniority_number").notNull(),
  base: text("base").notNull(),
  aircraft: text("aircraft").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const bidPackages = pgTable("bid_packages", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  month: text("month").notNull(),
  year: integer("year").notNull(),
  base: text("base").notNull(),
  aircraft: text("aircraft").notNull(),
  uploadedAt: timestamp("uploaded_at").defaultNow().notNull(),
  status: text("status").notNull().default("processing"), // processing, completed, failed
}, (table) => ({
  monthYearIdx: index("bid_packages_month_year_idx").on(table.month, table.year),
  baseAircraftIdx: index("bid_packages_base_aircraft_idx").on(table.base, table.aircraft),
  statusIdx: index("bid_packages_status_idx").on(table.status),
}));

export const pairings = pgTable("pairings", {
  id: serial("id").primaryKey(),
  bidPackageId: integer("bid_package_id").notNull().references(() => bidPackages.id),
  pairingNumber: text("pairing_number").notNull(),
  effectiveDates: text("effective_dates").notNull(),
  route: text("route").notNull(),
  creditHours: decimal("credit_hours", { precision: 4, scale: 2 }).notNull(),
  blockHours: decimal("block_hours", { precision: 4, scale: 2 }).notNull(),
  tafb: text("tafb").notNull(), // Time Away From Base
  fdp: text("fdp"), // Flight Duty Period
  payHours: text("pay_hours"), // Time format like "12:43"
  sitEdpPay: decimal("sit_edp_pay", { precision: 4, scale: 2 }),
  carveouts: text("carveouts"),
  deadheads: integer("deadheads").default(0),
  layovers: jsonb("layovers"), // Array of layover details
  flightSegments: jsonb("flight_segments").notNull(), // Array of flight segment details
  fullTextBlock: text("full_text_block").notNull(), // Complete pairing text from PDF
  holdProbability: integer("hold_probability").default(0), // Percentage 0-100
  pairingDays: integer("pairing_days").default(1), // Number of days (calculated from flight segment day letters)
}, (table) => ({
  bidPackageIdx: index("pairings_bid_package_idx").on(table.bidPackageId),
  pairingNumberIdx: index("pairings_number_idx").on(table.pairingNumber),
  creditHoursIdx: index("pairings_credit_hours_idx").on(table.creditHours),
  blockHoursIdx: index("pairings_block_hours_idx").on(table.blockHours),
  holdProbabilityIdx: index("pairings_hold_probability_idx").on(table.holdProbability),
  pairingDaysIdx: index("pairings_days_idx").on(table.pairingDays),
  compoundSearchIdx: index("pairings_search_idx").on(table.bidPackageId, table.creditHours, table.blockHours),
}));

export const bidHistory = pgTable("bid_history", {
  id: serial("id").primaryKey(),
  pairingNumber: text("pairing_number").notNull(),
  month: text("month").notNull(),
  year: integer("year").notNull(),
  juniorHolderSeniority: integer("junior_holder_seniority").notNull(),
  awardedAt: timestamp("awarded_at").notNull(),
});

export const userFavorites = pgTable("user_favorites", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull(),
  pairingId: integer("pairing_id").references(() => pairings.id).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  userIdIdx: index("user_favorites_user_idx").on(table.userId),
  pairingIdIdx: index("user_favorites_pairing_idx").on(table.pairingId),
  userPairingIdx: index("user_favorites_user_pairing_idx").on(table.userId, table.pairingId),
}));

export const chatHistory = pgTable("chat_history", {
  id: serial("id").primaryKey(),
  sessionId: varchar("session_id", { length: 255 }).notNull(),
  bidPackageId: integer("bid_package_id").references(() => bidPackages.id),
  messageType: varchar("message_type", { length: 20 }).notNull(), // 'user' or 'assistant'
  content: text("content").notNull(),
  messageData: json("message_data"), // For storing any structured data
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Relations
export const bidPackagesRelations = relations(bidPackages, ({ many }) => ({
  pairings: many(pairings),
}));

export const pairingsRelations = relations(pairings, ({ one, many }) => ({
  bidPackage: one(bidPackages, {
    fields: [pairings.bidPackageId],
    references: [bidPackages.id],
  }),
  favorites: many(userFavorites),
}));

export const usersRelations = relations(users, ({ many }) => ({
  favorites: many(userFavorites),
}));

export const userFavoritesRelations = relations(userFavorites, ({ one }) => ({
  user: one(users, {
    fields: [userFavorites.userId],
    references: [users.id],
  }),
  pairing: one(pairings, {
    fields: [userFavorites.pairingId],
    references: [pairings.id],
  }),
}));

// Schemas
export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
});

export const insertBidPackageSchema = createInsertSchema(bidPackages).omit({
  id: true,
  uploadedAt: true,
  status: true,
});

export const insertPairingSchema = createInsertSchema(pairings).omit({
  id: true,
});

export const insertBidHistorySchema = createInsertSchema(bidHistory).omit({
  id: true,
});

export const insertUserFavoriteSchema = createInsertSchema(userFavorites).omit({
  id: true,
  createdAt: true,
});

// Types
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type BidPackage = typeof bidPackages.$inferSelect;
export type InsertBidPackage = z.infer<typeof insertBidPackageSchema>;
export type Pairing = typeof pairings.$inferSelect;
export type InsertPairing = z.infer<typeof insertPairingSchema>;
export type BidHistory = typeof bidHistory.$inferSelect;
export type InsertBidHistory = z.infer<typeof insertBidHistorySchema>;
export type UserFavorite = typeof userFavorites.$inferSelect;
export type InsertUserFavorite = z.infer<typeof insertUserFavoriteSchema>;

export type ChatHistory = typeof chatHistory.$inferSelect;
export type InsertChatHistory = typeof chatHistory.$inferInsert;