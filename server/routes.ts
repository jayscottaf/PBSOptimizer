import type { Express } from 'express';
import { createServer, type Server } from 'http';
import { storage } from './storage';
import { seedDatabase } from './seedData';
import { pdfParser } from './pdfParser';
import {
  db,
  reconnectDatabase,
  executeWithRetry,
  getDatabaseHealth,
} from './db';
import {
  eq,
  gte,
  lte,
  sql,
  and,
  or,
  like,
  asc,
  desc,
  inArray,
} from 'drizzle-orm';
import {
  pairings,
  bidPackages,
  users,
  userFavorites,
  userCalendarEvents,
} from '../shared/schema';
import { HoldProbabilityCalculator } from './holdProbabilityCalculator';
import { openaiAssistant } from './openaiAssistant';
import { ReasonsReportParser } from './reasonsReportParser';
import { TripMatcher } from './tripMatcher';
import multer from 'multer';
import { z } from 'zod';
import {
  insertBidPackageSchema,
  insertPairingSchema,
  bidHistory,
} from '../shared/schema';
import * as fs from 'fs/promises';

// Optimized hold probability recalculation with batching
async function recalculateHoldProbabilitiesOptimized(
  bidPackageId: number,
  seniorityPercentile: number,
  seniorityNumber?: number
) {
  try {
    console.log(
      `Starting optimized hold probability recalculation for bid package ${bidPackageId} with seniority ${seniorityPercentile}%`
    );

    // Fetch bid package to get base/aircraft
    const [bidPackage] = await db
      .select()
      .from(bidPackages)
      .where(eq(bidPackages.id, bidPackageId))
      .limit(1);

    if (!bidPackage) {
      console.log('Bid package not found');
      return;
    }

    // Fetch all pairings in one query
    const allPairings = await db
      .select()
      .from(pairings)
      .where(eq(pairings.bidPackageId, bidPackageId));

    if (allPairings.length === 0) {
      console.log('No pairings found for recalculation');
      return;
    }

    // Calculate all hold probabilities in memory
    const updates: Array<{ id: number; holdProbability: number; reasoning?: string[] }> = [];

    // Use historical data if seniority number is provided
    const useHistoricalData = seniorityNumber !== undefined;

    for (const pairing of allPairings) {
      let holdProbabilityResult;
      
      // Extract layover cities for location-based adjustments
      const layoverCities = (pairing.layovers as any[])?.map((l: any) => l.city).filter((c: string) => c) || [];

      if (useHistoricalData && seniorityNumber) {
        // Try historical calculation first (now with bid month for seasonal adjustments)
        holdProbabilityResult =
          await HoldProbabilityCalculator.calculateHoldProbabilityWithHistory(
            pairing,
            seniorityNumber,
            seniorityPercentile,
            bidPackage.base,
            bidPackage.aircraft,
            bidPackage.month
          );
      } else {
        // Fall back to estimate-based calculation with location data
        const desirabilityScore =
          HoldProbabilityCalculator.calculateDesirabilityScore(pairing, bidPackage.month);
        const pairingFrequency =
          HoldProbabilityCalculator.calculatePairingFrequency(
            pairing.pairingNumber,
            allPairings
          );
        const startsOnWeekend =
          HoldProbabilityCalculator.startsOnWeekend(pairing);
        const includesWeekendOff =
          HoldProbabilityCalculator.includesWeekendOff(pairing);

        holdProbabilityResult =
          HoldProbabilityCalculator.calculateHoldProbability({
            seniorityPercentile,
            desirabilityScore,
            pairingFrequency,
            startsOnWeekend,
            includesDeadheads: pairing.deadheads || 0,
            includesWeekendOff,
            bidMonth: bidPackage.month,
            layoverCities,
          });
      }

      updates.push({
        id: pairing.id,
        holdProbability: holdProbabilityResult.probability,
        reasoning: holdProbabilityResult.reasoning,
      });
    }

    // Batch update all pairings in chunks of 50
    const batchSize = 50;
    for (let i = 0; i < updates.length; i += batchSize) {
      const batch = updates.slice(i, i + batchSize);
      // Use straightforward per-row updates to avoid SQL builder edge-cases
      for (const u of batch) {
        await db
          .update(pairings)
          .set({
            holdProbability: u.holdProbability,
            holdProbabilityReasoning: u.reasoning,
          })
          .where(eq(pairings.id, u.id));
      }
    }

    console.log(
      `✅ Optimized recalculation completed: ${updates.length} pairings updated in ${Math.ceil(updates.length / batchSize)} batches`
    );
  } catch (error) {
    console.error('Error in optimized hold probability recalculation:', error);
    throw error;
  }
}

// Background recalculation function (non-blocking)
async function recalculateHoldProbabilitiesBackground(
  bidPackageId: number,
  seniorityPercentile: number,
  seniorityNumber?: number
) {
  // Start recalculation in background without awaiting
  Promise.resolve().then(async () => {
    try {
      console.log(`🔄 Background recalculation triggered for bid package ${bidPackageId}`);
      await recalculateHoldProbabilitiesOptimized(
        bidPackageId,
        seniorityPercentile,
        seniorityNumber
      );
    } catch (error) {
      console.error('Background hold probability recalculation failed:', error);
    }
  });
}

// Configure multer for file uploads - use memory storage for serverless
const upload = multer({
  storage: multer.memoryStorage(), // Use memory storage instead of disk for Vercel
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf' || file.mimetype === 'text/plain') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF and TXT files are allowed'));
    }
  },
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
});

// Configure multer for reasons report HTML uploads
const uploadReasonsReport = multer({
  storage: multer.memoryStorage(), // Use memory storage instead of disk for Vercel
  fileFilter: (req, file, cb) => {
    if (
      file.mimetype === 'text/html' ||
      file.originalname.endsWith('.htm') ||
      file.originalname.endsWith('.html')
    ) {
      cb(null, true);
    } else {
      cb(new Error('Only HTML files are allowed for reasons reports'));
    }
  },
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
});

const searchFiltersSchema = z.object({
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
  efficiency: z.number().optional(),
});

// Use the new circuit breaker-enabled database execution
const withDatabaseRetry = executeWithRetry;

export async function registerRoutes(app: Express) {
  // Health check endpoint (enhanced for PWA Stage 7)
  app.head('/api/health', (req, res) => {
    res.status(200).end();
  });

  app.get('/api/health', async (req, res) => {
    try {
      const dbHealth = await getDatabaseHealth();

      res.status(dbHealth.connected ? 200 : 503).json({
        status: dbHealth.connected ? 'ok' : 'error',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version: '1.2.0',
        environment: process.env.NODE_ENV || 'development',
        database: dbHealth.connected ? 'connected' : 'disconnected',
        circuitBreaker: dbHealth.circuitBreakerState,
        poolInfo: dbHealth.poolInfo,
        config: {
          hasDatabaseUrl: !!process.env.DATABASE_URL,
          port: process.env.PORT || '5000',
        },
      });
    } catch (error) {
      res.status(503).json({
        status: 'error',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version: '1.2.0',
        environment: process.env.NODE_ENV || 'development',
        database: 'disconnected',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // Seed database endpoint (development only)
  app.post('/api/seed', async (req, res) => {
    try {
      await seedDatabase();
      res.json({ success: true, message: 'Database seeded successfully' });
    } catch (error) {
      console.error('Error seeding database:', error);
      res.status(500).json({ message: 'Failed to seed database' });
    }
  });

  // Get all bid packages
  app.get('/api/bid-packages', async (req, res) => {
    try {
      // Add cache control headers to prevent browser caching
      res.set({
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache',
        Expires: '0',
      });

      const packages = await withDatabaseRetry(async () => {
        return await storage.getBidPackages();
      });

      res.json(packages);
    } catch (error) {
      console.error('Error fetching bid packages:', error);
      res.status(500).json({ error: 'Failed to fetch bid packages' });
    }
  });

  // Progress stream via Server-Sent Events
  app.get('/api/progress/stream', async (req, res) => {
    try {
      const bidPackageId = parseInt((req.query.bidPackageId as string) || '');
      if (!bidPackageId) {
        return res.status(400).end('bidPackageId required');
      }

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders?.();

      const { registerProgressClient, removeProgressClient } = await import(
        './progress'
      );
      registerProgressClient(bidPackageId, res);

      req.on('close', () => {
        removeProgressClient(bidPackageId, res);
        res.end();
      });
    } catch (error) {
      res.status(500).end('failed to open stream');
    }
  });

  // Get bid package statistics (C/B ratio ranges, etc.)
  app.get('/api/bid-packages/:id/stats', async (req, res) => {
    try {
      const bidPackageId = parseInt(req.params.id);
      const stats = await storage.getBidPackageStats(bidPackageId);
      res.json(stats);
    } catch (error) {
      console.error('Error fetching bid package stats:', error);
      res.status(500).json({ error: 'Failed to fetch bid package stats' });
    }
  });

  // Upload bid package PDF
  app.post('/api/upload', upload.single('bidPackage'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: 'No file uploaded' });
      }

      const { name, month, year, base, aircraft } = req.body;

      // Delete all existing bid packages and their associated data
      const existingPackages = await storage.getBidPackages();
      if (existingPackages.length > 0) {
        console.log(
          `Removing ${existingPackages.length} existing bid packages before uploading new one`
        );
        await Promise.all(
          existingPackages.map(pkg => storage.deleteBidPackage(pkg.id))
        );
      }

      const bidPackageData = insertBidPackageSchema.parse({
        name,
        month,
        year: parseInt(year),
        base,
        aircraft,
      });

      const bidPackage = await storage.createBidPackage(bidPackageData);

      // Parse file asynchronously and update status
      // With memory storage, use buffer instead of path
      pdfParser
        .parseFile(req.file.buffer, bidPackage.id, req.file.mimetype)
        .then(async () => {
          console.log(
            `File parsing completed for bid package ${bidPackage.id}`
          );
          // Status is set to 'completed' inside parseFile() after all batch inserts finish
          // Removed duplicate status update that was causing race condition
        })
        .catch(async error => {
          console.error(
            `File parsing failed for bid package ${bidPackage.id}:`,
            error
          );
          await storage.updateBidPackageStatus(bidPackage.id, 'failed');
        });

      res.json({
        success: true,
        bidPackage,
        message: 'Bid package uploaded successfully. Processing has begun.',
      });
    } catch (error) {
      console.error('Error uploading bid package:', error);
      if (error instanceof z.ZodError) {
        res
          .status(400)
          .json({ message: 'Invalid bid package data', errors: error.errors });
      } else {
        res.status(500).json({ message: 'Failed to upload bid package' });
      }
    }
  });

  // Upload reasons report (HTML)
  app.post(
    '/api/upload-reasons-report',
    uploadReasonsReport.single('reasonsReport'),
    async (req, res) => {
      try {
        if (!req.file) {
          return res.status(400).json({ message: 'No file uploaded' });
        }

        console.log('Processing reasons report:', req.file.originalname);

        // Parse the HTML file from buffer
        const htmlContent = req.file.buffer.toString('utf-8');
        const awards = await ReasonsReportParser.parseReasonsReportFromContent(
          htmlContent
        );

        // Extract metadata from HTML
        const metadata = ReasonsReportParser.extractMetadata(htmlContent);

        if (!metadata) {
          return res.status(400).json({
            message:
              'Could not extract base/aircraft/month from HTML. Please check file format.',
          });
        }

        // Store awards in bidHistory table
        let storedCount = 0;
        let skippedCount = 0;
        console.log(`Processing ${awards.length} awards for ${metadata.base} ${metadata.aircraft} ${metadata.month} ${metadata.year}`);

        for (const award of awards) {
          try {
            // Check if this award already exists (duplicate detection)
            const existingAward = await db
              .select()
              .from(bidHistory)
              .where(
                and(
                  eq(bidHistory.pairingNumber, award.pairingNumber),
                  eq(bidHistory.month, metadata.month),
                  eq(bidHistory.year, metadata.year),
                  eq(bidHistory.base, metadata.base),
                  eq(bidHistory.aircraft, metadata.aircraft),
                  eq(bidHistory.juniorHolderSeniority, award.seniorityNumber)
                )
              )
              .limit(1);

            // Skip if duplicate found
            if (existingAward.length > 0) {
              skippedCount++;
              continue;
            }

            // Create trip fingerprint
            const fingerprint =
              ReasonsReportParser.createTripFingerprint(award);

            // Parse credit hours as decimal
            const creditHours = parseFloat(
              award.monthCredit.replace(':', '.').replace(/[^\d.]/g, '')
            );
            const totalCredit = parseFloat(
              award.totalCredit.replace(':', '.').replace(/[^\d.]/g, '')
            );

            // Insert into database
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
              tripFingerprint: fingerprint,
              awardedAt: new Date(`${metadata.year}-${monthToNumber(metadata.month)}-01`),
            });

            storedCount++;
          } catch (error) {
            console.error(
              `Error storing award for pairing ${award.pairingNumber}:`,
              error
            );
          }
        }

        // No need to clean up - file is in memory and will be garbage collected

        console.log(`Upload complete: ${storedCount} stored, ${skippedCount} skipped`);

        res.json({
          success: true,
          message: skippedCount > 0
            ? `Reasons report processed: ${storedCount} new awards stored, ${skippedCount} duplicates skipped`
            : `Reasons report processed successfully`,
          stats: {
            totalParsed: awards.length,
            stored: storedCount,
            skipped: skippedCount,
            base: metadata.base,
            aircraft: metadata.aircraft,
            month: metadata.month,
            year: metadata.year,
          },
        });
      } catch (error) {
        console.error('Error processing reasons report:', error);
        res
          .status(500)
          .json({ message: 'Failed to process reasons report', error });
      }
    }
  );

  // Get list of uploaded reasons reports (summary by month/year/base/aircraft)
  app.get('/api/reasons-reports', async (req, res) => {
    try {
      // Get distinct reports with count of awards
      const reports = await db
        .select({
          month: bidHistory.month,
          year: bidHistory.year,
          base: bidHistory.base,
          aircraft: bidHistory.aircraft,
          count: sql<number>`count(*)::int`,
          uploadedAt: sql<Date>`max(${bidHistory.uploadedAt})`,
        })
        .from(bidHistory)
        .groupBy(
          bidHistory.month,
          bidHistory.year,
          bidHistory.base,
          bidHistory.aircraft
        )
        .orderBy(
          sql`${bidHistory.year} desc`,
          sql`${bidHistory.month} desc`
        );

      res.json(reports);
    } catch (error) {
      console.error('Error fetching reasons reports:', error);
      res.status(500).json({ message: 'Failed to fetch reasons reports' });
    }
  });

  // Helper function to convert month name to number
  function monthToNumber(month: string): number {
    const months: Record<string, number> = {
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
      DEC: 12,
    };
    return months[month.toUpperCase()] || 1;
  }

  // Get pairings with optional filtering
  app.get('/api/pairings', async (req, res) => {
    try {
      // Add cache control headers to prevent browser caching
      res.set({
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache',
        Expires: '0',
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
        seniorityPercentile,
      } = req.query;

      console.log('GET /api/pairings query params:', {
        creditMin,
        creditMax,
        blockMin,
        blockMax,
        search,
        bidPackageId,
      });
      console.log('All query params:', req.query);

      if (!bidPackageId) {
        return res.status(400).json({ error: 'bidPackageId is required' });
      }

      // Do not mutate DB on seniority changes; compute per-request below

      // Build all conditions first, then apply with and()
      const conditions = [
        eq(pairings.bidPackageId, parseInt(bidPackageId as string)),
      ];

      if (search) {
        conditions.push(sql`
          pairingNumber ILIKE ${`%${search}%`} OR
          base ILIKE ${`%${search}%`} OR
          aircraft ILIKE ${`%${search}%`} OR
          notes ILIKE ${`%${search}%`}
        `);
      }
      if (creditMin) {
        conditions.push(gte(pairings.creditHours, creditMin as string));
      }
      if (creditMax) {
        conditions.push(lte(pairings.creditHours, creditMax as string));
      }
      if (blockMin) {
        conditions.push(gte(pairings.blockHours, blockMin as string));
      }
      if (blockMax) {
        conditions.push(lte(pairings.blockHours, blockMax as string));
      }
      if (tafb) {
        conditions.push(eq(pairings.tafb, tafb as string));
      }
      if (tafbMin) {
        conditions.push(gte(pairings.tafb, tafbMin as string));
      }
      if (tafbMax) {
        conditions.push(lte(pairings.tafb, tafbMax as string));
      }
      if (holdProbabilityMin) {
        conditions.push(
          gte(
            pairings.holdProbability,
            parseFloat(holdProbabilityMin as string)
          )
        );
      }
      if (pairingDays) {
        conditions.push(
          eq(pairings.pairingDays, parseInt(pairingDays as string))
        );
      }
      if (pairingDaysMin) {
        conditions.push(
          gte(pairings.pairingDays, parseInt(pairingDaysMin as string))
        );
      }
      if (pairingDaysMax) {
        conditions.push(
          lte(pairings.pairingDays, parseInt(pairingDaysMax as string))
        );
      }

      const query = db
        .select()
        .from(pairings)
        .where(and(...conditions));
      const pairingsResult = await query.execute();

      // If seniority provided, compute holdProbability per-request (no DB writes)
      if (seniorityPercentile) {
        const allForPackage = await db
          .select()
          .from(pairings)
          .where(eq(pairings.bidPackageId, parseInt(bidPackageId as string)));
        
        // Get bid package month for seasonal adjustments
        const [bidPkg] = await db
          .select({ month: bidPackages.month })
          .from(bidPackages)
          .where(eq(bidPackages.id, parseInt(bidPackageId as string)))
          .limit(1);
        const bidMonth = bidPkg?.month;

        const seniorityValue = parseFloat(seniorityPercentile as string);
        for (const p of pairingsResult) {
          // Extract layover cities for location-based adjustments
          const layoverCities = (p.layovers as any[])?.map((l: any) => l.city).filter((c: string) => c) || [];
          
          const desirability =
            HoldProbabilityCalculator.calculateDesirabilityScore(p, bidMonth);
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
            layoverCities,
          });
          // Only update holdProbability, preserve all other stored values including pairingDays
          (p as any).holdProbability = hp.probability;
        }
      }

      res.json(pairingsResult);
    } catch (error) {
      console.error('Error fetching pairings:', error);
      res.status(500).json({ message: 'Failed to fetch pairings' });
    }
  });

  // Pairing search endpoint
  app.post('/api/pairings/search', async (req, res) => {
    try {
      // Add cache control headers to prevent browser caching
      res.set({
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache',
        Expires: '0',
      });

      console.log('POST /api/pairings/search', { path: req.path });

      const {
        bidPackageId,
        sortBy = 'pairingNumber',
        sortOrder = 'asc',
        ...filters
      } = req.body;

      if (!bidPackageId) {
        console.log('No bid package ID provided in search request');
        return res.status(400).json({
          message: 'Bid package ID is required',
          pairings: [],
          statistics: {
            likelyToHold: 0,
            highCredit: 0,
            ratioBreakdown: { excellent: 0, good: 0, average: 0, poor: 0 },
          },
        });
      }

      // Log only key filter knobs for debugging (only in debug mode)
      if (process.env.LOG_LEVEL === 'debug') {
        console.log('Search params:', {
          bidPackageId,
          sortBy,
          sortOrder,
          efficiency: (filters as any)?.efficiency,
          holdProbabilityMin: (filters as any)?.holdProbabilityMin,
          pairingDays: (filters as any)?.pairingDays,
          seniorityPercentile: (filters as any)?.seniorityPercentile,
          seniorityPercentage: (filters as any)?.seniorityPercentage,
        });
      }

      const result = await storage.getAllPairingsForBidPackage({
        bidPackageId,
        sortBy,
        sortOrder,
        ...filters,
      });

      // If seniority provided and pairings don't have stored probabilities, compute holdProbability per-response
      const seniorityValueRaw =
        (filters as any)?.seniorityPercentile ||
        (filters as any)?.seniorityPercentage;
      if (seniorityValueRaw) {
        const seniorityValue = parseFloat(seniorityValueRaw);

        // Check if we need to recalculate (only if pairings don't have stored probabilities)
        const needsRecalc = result.pairings.some(p => (p as any).holdProbability === null || (p as any).holdProbability === undefined);

        if (needsRecalc) {
          const allForPackage = await db
            .select()
            .from(pairings)
            .where(eq(pairings.bidPackageId, bidPackageId));

          for (const p of result.pairings) {
            // Skip if this pairing already has a calculated probability
            if ((p as any).holdProbability !== null && (p as any).holdProbability !== undefined) {
              continue;
            }

            const desirability =
              HoldProbabilityCalculator.calculateDesirabilityScore(p as any);
            const freq = HoldProbabilityCalculator.calculatePairingFrequency(
              (p as any).pairingNumber,
              allForPackage as any
            );
            const hp = HoldProbabilityCalculator.calculateHoldProbability({
              seniorityPercentile: seniorityValue,
              desirabilityScore: desirability,
              pairingFrequency: freq,
              startsOnWeekend: HoldProbabilityCalculator.startsOnWeekend(p),
              includesDeadheads: (p as any).deadheads || 0,
              includesWeekendOff: HoldProbabilityCalculator.includesWeekendOff(p),
            });
            (p as any).holdProbability = hp.probability;
          }
        }
      }

      // Only log in debug mode to reduce noise
      if (process.env.LOG_LEVEL === 'debug') {
        console.log(`Found ${result.pairings.length} pairings`);
      }
      res.json(result);
    } catch (error) {
      console.error('Error searching pairings:', error);
      res.status(500).json({
        message: 'Failed to search pairings',
        pairings: [],
        statistics: {
          likelyToHold: 0,
          highCredit: 0,
          ratioBreakdown: { excellent: 0, good: 0, average: 0, poor: 0 },
        },
      });
    }
  });

  // Get specific pairing details
  app.get('/api/pairings/:id', async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const pairing = await storage.getPairing(id);

      if (!pairing) {
        return res.status(404).json({ message: 'Pairing not found' });
      }

      res.json(pairing);
    } catch (error) {
      console.error('Error fetching pairing:', error);
      res.status(500).json({ message: 'Failed to fetch pairing' });
    }
  });

  // Verify pairing by number endpoint
  app.get('/api/verify-pairing/:pairingNumber', async (req, res) => {
    try {
      const { pairingNumber } = req.params;
      const bidPackageId = req.query.bidPackageId
        ? parseInt(req.query.bidPackageId as string)
        : undefined;

      if (!bidPackageId) {
        const bidPackages = await storage.getBidPackages();
        if (bidPackages.length === 0) {
          return res.status(404).json({ message: 'No bid packages found' });
        }
        // Use most recent bid package
        const recentBidPackage = bidPackages[0];
        const allPairings = await storage.getPairings(recentBidPackage.id);
        const pairing = allPairings.find(
          p => p.pairingNumber === pairingNumber
        );

        if (!pairing) {
          return res.status(404).json({
            message: 'Pairing not found',
            pairingNumber,
            bidPackageId: recentBidPackage.id,
            totalPairings: allPairings.length,
            samplePairings: allPairings.slice(0, 10).map(p => p.pairingNumber),
          });
        }

        res.json({
          found: true,
          pairing,
          bidPackageId: recentBidPackage.id,
          verified: true,
        });
      } else {
        const allPairings = await storage.getPairings(bidPackageId);
        const pairing = allPairings.find(
          p => p.pairingNumber === pairingNumber
        );

        if (!pairing) {
          return res.status(404).json({
            message: 'Pairing not found',
            pairingNumber,
            bidPackageId,
            totalPairings: allPairings.length,
            samplePairings: allPairings.slice(0, 10).map(p => p.pairingNumber),
          });
        }

        res.json({
          found: true,
          pairing,
          bidPackageId,
          verified: true,
        });
      }
    } catch (error) {
      console.error('Error verifying pairing:', error);
      res.status(500).json({ message: 'Failed to verify pairing' });
    }
  });

  // Get bid history for a pairing
  app.get('/api/history/:pairingNumber', async (req, res) => {
    try {
      const { pairingNumber } = req.params;
      const history = await storage.getBidHistoryForPairing(pairingNumber);
      res.json(history);
    } catch (error) {
      console.error('Error fetching bid history:', error);
      res.status(500).json({ message: 'Failed to fetch bid history' });
    }
  });

  // Create/update user
  app.post('/api/user', async (req, res) => {
    try {
      const { name, seniorityNumber, seniorityPercentile, base, aircraft } = req.body;

      if (!seniorityNumber || !base || !aircraft) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      const user = await storage.createOrUpdateUser({
        name,
        seniorityNumber: parseInt(seniorityNumber),
        seniorityPercentile: seniorityPercentile
          ? parseFloat(seniorityPercentile)
          : 50,
        base,
        aircraft,
      });

      res.json(user);
    } catch (error) {
      console.error('Error creating/updating user:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Recalculate hold probabilities with historical data
  app.post('/api/recalculate-probabilities', async (req, res) => {
    try {
      const { bidPackageId, seniorityPercentile, seniorityNumber } = req.body;

      if (!bidPackageId || seniorityPercentile === undefined) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      // Trigger recalculation in background
      recalculateHoldProbabilitiesBackground(
        bidPackageId,
        seniorityPercentile,
        seniorityNumber
      );

      res.json({ success: true, message: 'Recalculation started' });
    } catch (error) {
      console.error('Error triggering recalculation:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Add pairing to favorites
  app.post('/api/favorites', async (req, res) => {
    try {
      const { userId, pairingId } = req.body;
      console.log('Adding favorite - userId:', userId, 'pairingId:', pairingId);

      if (!userId || !pairingId) {
        console.error('Missing required fields:', { userId, pairingId });
        return res.status(400).json({ message: 'Missing userId or pairingId' });
      }

      const favorite = await storage.addUserFavorite({ userId, pairingId });
      console.log('Favorite added successfully:', favorite);
      res.json(favorite);
    } catch (error) {
      console.error('Error adding favorite:', error);
      console.error('Error details:', {
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : 'No stack trace',
        userId: req.body?.userId,
        pairingId: req.body?.pairingId,
      });
      res.status(500).json({
        message: 'Failed to add favorite',
        error:
          process.env.NODE_ENV === 'development' ? (error as Error).message : undefined,
      });
    }
  });

  // Remove pairing from favorites
  app.delete('/api/favorites', async (req, res) => {
    try {
      const { userId, pairingId } = req.body;
      await storage.removeUserFavorite(userId, pairingId);
      res.json({ success: true });
    } catch (error) {
      console.error('Error removing favorite:', error);
      res.status(500).json({ message: 'Failed to remove favorite' });
    }
  });

  // Get user favorites
  app.get('/api/favorites/:userId', async (req, res) => {
    try {
      const userId = parseInt(req.params.userId);
      const favorites = await storage.getUserFavorites(userId);
      res.json(favorites);
    } catch (error) {
      console.error('Error fetching favorites:', error);
      res.status(500).json({ message: 'Failed to fetch favorites' });
    }
  });

  // Calendar event endpoints
  app.post('/api/calendar', async (req, res) => {
    try {
      const { userId, pairingId, startDate, endDate, notes } = req.body;

      console.log('Calendar POST request:', {
        userId,
        pairingId,
        startDate,
        endDate,
        notes,
      });
      console.log(
        'Database connection status:',
        db ? 'Connected' : 'Not connected'
      );

      if (!userId || !pairingId || !startDate || !endDate) {
        console.error('Missing required fields:', {
          userId,
          pairingId,
          startDate,
          endDate,
        });
        return res.status(400).json({
          message:
            'Missing required fields: userId, pairingId, startDate, endDate',
        });
      }

      const event = await storage.addUserCalendarEvent({
        userId: parseInt(userId),
        pairingId: parseInt(pairingId),
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        notes,
      });

      console.log('Calendar event created successfully:', event);
      res.json(event);
    } catch (error) {
      console.error('Error adding calendar event:', error);
      console.error('Error details:', {
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : 'No stack trace',
        userId: req.body?.userId,
        pairingId: req.body?.pairingId,
        startDate: req.body?.startDate,
        endDate: req.body?.endDate,
      });
      res.status(500).json({
        message:
          error instanceof Error
            ? error.message
            : 'Failed to add calendar event',
        error:
          process.env.NODE_ENV === 'development' ? (error as Error).message : undefined,
      });
    }
  });

  // Remove pairing from calendar
  app.delete('/api/calendar', async (req, res) => {
    try {
      const { userId, pairingId } = req.body;
      await storage.removeUserCalendarEvent(userId, pairingId);
      res.json({ success: true });
    } catch (error) {
      console.error('Error removing calendar event:', error);
      res.status(500).json({ message: 'Failed to remove calendar event' });
    }
  });

  // Get user calendar events
  app.get('/api/calendar/:userId', async (req, res) => {
    try {
      const userId = parseInt(req.params.userId);
      const { startDate, endDate } = req.query;

      console.log(
        'Fetching calendar events for userId:',
        userId,
        'dateRange:',
        { startDate, endDate }
      );
      console.log(
        'Database connection status:',
        db ? 'Connected' : 'Not connected'
      );

      if (isNaN(userId)) {
        console.error('Invalid userId:', req.params.userId);
        return res.status(400).json({ message: 'Invalid userId' });
      }

      if (startDate && endDate) {
        // Use date range query
        const events = await storage.getUserCalendarEventsInRange(
          userId,
          new Date(startDate as string),
          new Date(endDate as string)
        );
        console.log('Calendar events found (date range):', events.length);
        res.json(events);
      } else {
        // Default query for all events
        const events = await storage.getUserCalendarEvents(userId);
        console.log('Calendar events found (all):', events.length);
        res.json(events);
      }
    } catch (error) {
      console.error('Error fetching calendar events:', error);
      console.error('Error details:', {
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : 'No stack trace',
        userId: req.params.userId,
        startDate: req.query.startDate,
        endDate: req.query.endDate,
      });
      res.status(500).json({
        message: 'Failed to fetch calendar events',
        error:
          process.env.NODE_ENV === 'development' ? (error as Error).message : undefined,
      });
    }
  });

  // Get user calendar events for specific month/year
  app.get('/api/calendar/:userId/:month/:year', async (req, res) => {
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
      console.error('Error fetching calendar events for month:', error);
      res
        .status(500)
        .json({ message: 'Failed to fetch calendar events for month' });
    }
  });

  // Chat history endpoints
  app.get('/api/chat-history/:sessionId', async (req, res) => {
    try {
      const { sessionId } = req.params;
      const history = await storage.getChatHistory(sessionId);
      res.json(history);
    } catch (error) {
      console.error('Error fetching chat history:', error);
      res.status(500).json({ message: 'Failed to fetch chat history' });
    }
  });

  app.post('/api/chat-history', async (req, res) => {
    try {
      const { sessionId, bidPackageId, messageType, content, messageData } =
        req.body;
      const savedMessage = await storage.saveChatMessage({
        sessionId,
        bidPackageId,
        messageType,
        content,
        messageData,
      });
      res.json(savedMessage);
    } catch (error) {
      console.error('Error saving chat message:', error);
      res.status(500).json({ message: 'Failed to save chat message' });
    }
  });

  app.delete('/api/chat-history/:sessionId', async (req, res) => {
    try {
      const { sessionId } = req.params;
      await storage.clearChatHistory(sessionId);
      res.json({ success: true });
    } catch (error) {
      console.error('Error clearing chat history:', error);
      res.status(500).json({ message: 'Failed to clear chat history' });
    }
  });

  // OpenAI Assistant API endpoint with hybrid token optimization
  app.post('/api/askAssistant', async (req, res) => {
    try {
      const { question, bidPackageId, seniorityPercentile, sessionId, userId } = req.body;

      if (!question) {
        return res.status(400).json({ message: 'Question is required' });
      }

      // Extract bidPackageId from question if it contains "bid package #25" pattern
      const bidPackageMatch = question.match(/bid package #(\d+)/);
      let finalBidPackageId =
        bidPackageId ||
        (bidPackageMatch ? parseInt(bidPackageMatch[1]) : undefined);

      // If no bid package ID found, try to get the most recent one
      if (!finalBidPackageId) {
        const bidPackages = await storage.getBidPackages();
        if (bidPackages.length > 0) {
          finalBidPackageId = bidPackages[0].id;
          console.log(`Using most recent bid package ID: ${finalBidPackageId}`);
        }
      }

      // Use unified AI pipeline (replaces dual system)
      if (finalBidPackageId) {
        try {
          const { SimpleAI } = await import('./ai/simpleAI');
          const simpleAI = new SimpleAI(storage);

          // Get conversation history if sessionId provided
          let conversationHistory: any[] = [];
          if (sessionId) {
            const history = await storage.getChatHistory(sessionId);
            conversationHistory = history.map(msg => ({
              role: msg.messageType === 'user' ? 'user' : 'assistant',
              content: msg.content,
            }));
          }

          const result = await simpleAI.query({
            message: question,
            bidPackageId: finalBidPackageId,
            userId: typeof userId === 'number' ? userId : undefined,
            seniorityPercentile: typeof seniorityPercentile === 'number'
              ? seniorityPercentile
              : undefined,
            conversationHistory,
          });

          res.json({
            reply: result.response,
            pairingNumbers: result.pairingNumbers,
          });
          return;
        } catch (unifiedError) {
          console.error('Unified AI failed:', unifiedError);

          // Graceful error handling
          if (
            unifiedError &&
            typeof unifiedError === 'object' &&
            'message' in unifiedError &&
            typeof (unifiedError as any).message === 'string'
          ) {
            const msg = (unifiedError as any).message as string;
            if (msg.includes('rate_limit_exceeded')) {
              res.json({
                reply:
                  "I'm experiencing high demand right now. Please try again in a moment.",
              });
              return;
            }
            if (msg.includes('context_length_exceeded')) {
              res.json({
                reply:
                  "This request is very large. Try narrowing your question (e.g., by day count or destination) and I'll go deeper.",
              });
              return;
            }
          }

          // Fall through to basic assistant
        }
      }

      // Final fallback to basic assistant
      const reply = await openaiAssistant.askPBSAssistant(question);
      res.json({ reply });
    } catch (error) {
      console.error('Error asking PBS Assistant:', error);
      res
        .status(500)
        .json({ message: 'Failed to get response from PBS Assistant' });
    }
  });

  // Endpoint for bulk pairing creation (used by PDF parser)
  app.post('/api/pairings/bulk', async (req, res) => {
    try {
      const { bidPackageId, pairings } = req.body;

      const createdPairings = [];
      for (const pairingData of pairings) {
        const pairing = await storage.createPairing({
          ...pairingData,
          bidPackageId,
        });
        createdPairings.push(pairing);
      }

      // Update bid package status to completed
      await storage.updateBidPackageStatus(bidPackageId, 'completed');

      res.json({
        success: true,
        count: createdPairings.length,
        pairings: createdPairings,
      });
    } catch (error) {
      console.error('Error creating bulk pairings:', error);
      res.status(500).json({ message: 'Failed to create pairings' });
    }
  });

  // Database verification endpoint
  app.get('/api/verify-data', async (req, res) => {
    try {
      const verification = {} as Record<number, any>;
      const bidPackages = await storage.getBidPackages();

      for (const bidPackage of bidPackages) {
        const pairings = await storage.getPairings(bidPackage.id);
        const stats = await storage.getPairingStatsSummary(bidPackage.id);

        verification[bidPackage.id] = {
          bidPackage: {
            id: bidPackage.id,
            name: bidPackage.name,
            month: bidPackage.month,
            year: bidPackage.year,
            status: bidPackage.status,
          },
          pairings: {
            total: pairings.length,
            sample: pairings.slice(0, 5).map(p => ({
              pairingNumber: p.pairingNumber,
              creditHours: p.creditHours,
              blockHours: p.blockHours,
              pairingDays: p.pairingDays,
              holdProbability: p.holdProbability,
            })),
          },
          stats: {
            totalPairings: stats.totalPairings,
            avgCreditHours: stats.avgCreditHours.toFixed(2),
            avgBlockHours: stats.avgBlockHours.toFixed(2),
            avgPairingDays: stats.avgPairingDays.toFixed(1),
            dayDistribution: stats.dayDistribution,
          },
          dataIntegrity: {
            hasPairings: pairings.length > 0,
            hasValidCreditHours: pairings.filter(
              p => parseFloat(String(p.creditHours)) > 0
            ).length,
            hasValidBlockHours: pairings.filter(
              p => parseFloat(String(p.blockHours)) > 0
            ).length,
            hasValidPairingNumbers: pairings.filter(
              p => p.pairingNumber && p.pairingNumber.length > 0
            ).length,
            hasHoldProbabilities: pairings.filter(
              p => p.holdProbability !== null && p.holdProbability !== undefined
            ).length,
          },
        };
      }

      res.json({
        success: true,
        totalBidPackages: bidPackages.length,
        verification,
      });
    } catch (error) {
      console.error('Error verifying data:', error);
      res.status(500).json({ message: 'Failed to verify data' });
    }
  });

  // User calendar events
  app.get('/api/users/:userId/calendar', async (req, res) => {
    try {
      const userId = parseInt(req.params.userId);
      const { startDate, endDate } = req.query;

      const events = await db
        .select({
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
          },
        })
        .from(userCalendarEvents)
        .leftJoin(pairings, eq(userCalendarEvents.pairingId, pairings.id))
        .where(
          and(
            eq(userCalendarEvents.userId, userId),
            startDate
              ? gte(userCalendarEvents.endDate, new Date(startDate as string))
              : undefined,
            endDate
              ? lte(userCalendarEvents.startDate, new Date(endDate as string))
              : undefined
          )
        );

      res.json(events);
    } catch (error) {
      console.error('Error fetching calendar events:', error);
      res.status(500).json({ error: 'Failed to fetch calendar events' });
    }
  });

  app.delete('/api/users/:userId/calendar/:pairingId', async (req, res) => {
    try {
      const userId = parseInt(req.params.userId);
      const pairingId = parseInt(req.params.pairingId);

      await db
        .delete(userCalendarEvents)
        .where(
          and(
            eq(userCalendarEvents.userId, userId),
            eq(userCalendarEvents.pairingId, pairingId)
          )
        );

      res.json({ success: true });
    } catch (error) {
      console.error('Error removing from calendar:', error);
      res.status(500).json({ error: 'Failed to remove from calendar' });
    }
  });

  // User favorites
  app.get('/api/users/:userId/favorites', async (req, res) => {
    try {
      const userId = parseInt(req.params.userId);
      const favorites = await storage.getUserFavorites(userId);
      res.json(favorites);
    } catch (error) {
      console.error('Error fetching favorites:', error);
      res.status(500).json({ error: 'Failed to fetch favorites' });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
