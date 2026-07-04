import type { Express, NextFunction, Request, Response } from 'express';
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
  type SQL,
} from 'drizzle-orm';
import {
  pairings,
  bidPackages,
  users,
  userFavorites,
  userCalendarEvents,
} from '../shared/schema';
import { HoldProbabilityCalculator } from './holdProbabilityCalculator';
import { buildHoldProbabilityBulkUpdate } from './holdProbabilityUpdate';
import { openaiAssistant } from './openaiAssistant';
import { ReasonsReportParser } from './reasonsReportParser';
import { TripMatcher } from './tripMatcher';
import multer from 'multer';
import { z } from 'zod';
import {
  insertBidPackageSchema,
  bidHistory,
  reasonsReportPreferences,
  type Pairing,
} from '../shared/schema';
import { simulateBid } from './lib/bidSimulator';
import { exportBid } from './lib/bidExporter';
import { parseAircraftCode } from './lib/aircraft';
import { percentileWithin } from './lib/empiricalHold';
import type { DraftBid } from '../shared/bidTypes';
import * as fs from 'fs/promises';

type ApiErrorCode =
  | 'INVALID_FILE_TYPE'
  | 'FILE_TOO_LARGE'
  | 'MISSING_FILE'
  | 'INVALID_UPLOAD_DATA'
  | 'BID_PACKAGE_PARSE_FAILED'
  | 'REASONS_METADATA_FAILED'
  | 'REASONS_PROCESSING_FAILED'
  | 'UPLOAD_FAILED'
  | 'INVALID_SIMULATION_REQUEST'
  | 'INVALID_EXPORT_REQUEST'
  | 'NOT_FOUND';

function sendApiError(
  res: Response,
  status: number,
  message: string,
  code: ApiErrorCode,
  details?: unknown
) {
  return res.status(status).json({
    message,
    code,
    ...(details ? { details } : {}),
  });
}

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
    const updates: Array<{
      id: number;
      holdProbability: number;
      reasoning?: string[];
    }> = [];

    // Use historical data if seniority number is provided
    const useHistoricalData = seniorityNumber !== undefined;

    // Fetch base history once and precompute pairing frequency once, instead
    // of re-querying/re-scanning per pairing (was an N+1 / O(n^2) pattern
    // that made "optimized" recalculation the opposite of optimized).
    // Aircraft is matched on normalized base type: packages say "A220" while
    // Reasons Reports say "220-B" — an exact-string filter returns nothing.
    const pkgAircraftBase = parseAircraftCode(bidPackage.aircraft).baseType;
    const historicalData = useHistoricalData
      ? (
          await db
            .select()
            .from(bidHistory)
            .where(eq(bidHistory.base, bidPackage.base))
        ).filter(
          h => parseAircraftCode(h.aircraft).baseType === pkgAircraftBase
        )
      : [];
    // Period rosters make seniority numbers comparable across years —
    // the empirical hold path needs them to convert awards to percentiles.
    const rosters = useHistoricalData
      ? await storage.getCategoryRosters(bidPackage.base)
      : new Map<string, number[]>();
    const frequencyMap =
      HoldProbabilityCalculator.buildPairingFrequencyMap(allPairings);

    for (const pairing of allPairings) {
      let holdProbabilityResult;

      // Extract layover cities for location-based adjustments
      const layoverCities =
        (pairing.layovers as any[])
          ?.map((l: any) => l.city)
          .filter((c: string) => c) || [];

      if (useHistoricalData && seniorityNumber) {
        // Try historical calculation first (now with bid month for seasonal adjustments)
        holdProbabilityResult =
          HoldProbabilityCalculator.calculateHoldProbabilityWithHistory(
            pairing,
            seniorityNumber,
            seniorityPercentile,
            historicalData,
            bidPackage.month,
            rosters
          );
      } else {
        // Fall back to estimate-based calculation with location data
        const desirabilityScore =
          HoldProbabilityCalculator.calculateDesirabilityScore(
            pairing,
            bidPackage.month
          );
        const pairingFrequency = frequencyMap.get(pairing.pairingNumber) || 0;
        holdProbabilityResult =
          HoldProbabilityCalculator.calculateHoldProbability({
            seniorityPercentile,
            desirabilityScore,
            pairingFrequency,
            includesDeadheads: pairing.deadheads || 0,
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

    // Bulk update via a single CASE-based UPDATE per batch. This collapses
    // thousands of round-trips to Neon into a handful of statements.
    const batchSize = 500;
    for (let i = 0; i < updates.length; i += batchSize) {
      const batch = updates.slice(i, i + batchSize);
      const stmt = buildHoldProbabilityBulkUpdate(batch);
      if (stmt) {
        await db.execute(stmt);
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

// Tracks in-flight recalculations per bid package so concurrent requests for
// the same package coalesce onto one run instead of racing separate batch
// UPDATEs against each other with different seniority values.
const inFlightRecalculations = new Map<number, Promise<void>>();

// Runs (and awaits) recalculation, serialized per bid package. Must be
// awaited by the caller before responding — a fire-and-forget
// `.then()` here never completes once the HTTP response is sent on a
// serverless runtime like Vercel, which kills the function immediately after.
async function recalculateHoldProbabilitiesSerialized(
  bidPackageId: number,
  seniorityPercentile: number,
  seniorityNumber?: number
): Promise<void> {
  const existing = inFlightRecalculations.get(bidPackageId);
  if (existing) {
    await existing;
  }

  const run = recalculateHoldProbabilitiesOptimized(
    bidPackageId,
    seniorityPercentile,
    seniorityNumber
  ).finally(() => {
    if (inFlightRecalculations.get(bidPackageId) === run) {
      inFlightRecalculations.delete(bidPackageId);
    }
  });

  inFlightRecalculations.set(bidPackageId, run);
  await run;
}

// Configure multer for file uploads - use memory storage for serverless
const upload = multer({
  storage: multer.memoryStorage(), // Use memory storage instead of disk for Vercel
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf' || file.mimetype === 'text/plain') {
      cb(null, true);
    } else {
      cb(
        Object.assign(new Error('Only PDF and TXT files are allowed'), {
          code: 'INVALID_FILE_TYPE',
          status: 400,
        })
      );
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
      cb(
        Object.assign(
          new Error('Only HTML files are allowed for reasons reports'),
          {
            code: 'INVALID_FILE_TYPE',
            status: 400,
          }
        )
      );
    }
  },
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
});

function handleMulterUpload(
  middleware: (req: Request, res: Response, next: NextFunction) => void
) {
  return (req: Request, res: Response, next: NextFunction) => {
    middleware(req, res, error => {
      if (!error) {
        next();
        return;
      }

      if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
          sendApiError(
            res,
            413,
            'File is too large. Maximum upload size is 10 MB.',
            'FILE_TOO_LARGE'
          );
          return;
        }

        sendApiError(res, 400, error.message, 'UPLOAD_FAILED');
        return;
      }

      const uploadError = error as Error & {
        status?: number;
        code?: ApiErrorCode;
      };
      sendApiError(
        res,
        uploadError.status || 400,
        uploadError.message || 'Upload failed',
        uploadError.code || 'UPLOAD_FAILED'
      );
    });
  };
}

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
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({ message: 'Not available in production' });
    }
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

      // Opportunistic sweep: a package can get stuck in 'processing' forever
      // if the server crashes or a serverless invocation is killed mid-parse.
      // There's no cron here, so catch it lazily on the list endpoint the
      // dashboard already polls, instead of leaving pilots staring at a
      // progress bar that will never move.
      const STUCK_PROCESSING_THRESHOLD_MS = 15 * 60 * 1000;
      const now = Date.now();
      for (const pkg of packages) {
        if (
          pkg.status === 'processing' &&
          now - new Date(pkg.uploadedAt).getTime() > STUCK_PROCESSING_THRESHOLD_MS
        ) {
          console.warn(
            `Bid package ${pkg.id} has been stuck in 'processing' for over 15 minutes — marking failed`
          );
          await storage.updateBidPackageStatus(pkg.id, 'failed');
          await storage.deletePairingsForBidPackage(pkg.id);
          pkg.status = 'failed';
        }
      }

      // Mark the most recent package as current (for UI display)
      const packagesWithCurrent = packages.map((pkg, index) => ({
        ...pkg,
        isCurrent: index === 0, // First one is most recent (ordered by uploadedAt desc)
      }));

      res.json(packagesWithCurrent);
    } catch (error) {
      console.error('Error fetching bid packages:', error);
      res.status(500).json({ error: 'Failed to fetch bid packages' });
    }
  });

  // Get single bid package by ID (used for polling status during upload)
  app.get('/api/bid-packages/:id', async (req, res) => {
    try {
      const bidPackageId = parseInt(req.params.id);
      if (isNaN(bidPackageId)) {
        return res.status(400).json({ error: 'Invalid bid package ID' });
      }

      res.set({
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache',
        Expires: '0',
      });

      const bidPackage = await storage.getBidPackage(bidPackageId);
      if (!bidPackage) {
        return res.status(404).json({ error: 'Bid package not found' });
      }

      res.json(bidPackage);
    } catch (error) {
      console.error('Error fetching bid package:', error);
      res.status(500).json({ error: 'Failed to fetch bid package' });
    }
  });

  // Normalize month to uppercase 3-letter abbreviation for consistent matching
  const normalizeMonth = (month: string): string => {
    const upper = month.toUpperCase();
    const monthMap: Record<string, string> = {
      JANUARY: 'JAN',
      FEBRUARY: 'FEB',
      MARCH: 'MAR',
      APRIL: 'APR',
      MAY: 'MAY',
      JUNE: 'JUN',
      JULY: 'JUL',
      AUGUST: 'AUG',
      SEPTEMBER: 'SEP',
      OCTOBER: 'OCT',
      NOVEMBER: 'NOV',
      DECEMBER: 'DEC',
    };
    return monthMap[upper] || upper.substring(0, 3);
  };

  // Get data health stats (bid package and history counts)
  app.get('/api/data-health', async (req, res) => {
    try {
      const packages = await storage.getBidPackages();
      const historyCount = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(bidHistory);
      const linkedCount = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(bidHistory)
        .where(sql`linked_pairing_id IS NOT NULL`);
      const pairingCounts = await db
        .select({
          bidPackageId: pairings.bidPackageId,
          count: sql<number>`count(*)::int`,
        })
        .from(pairings)
        .groupBy(pairings.bidPackageId);
      const pairingCountMap = new Map(
        pairingCounts.map(row => [row.bidPackageId, row.count])
      );

      // Get all months from bidHistory (for later comparison with packages)
      const historyMonths = await db
        .select({
          month: bidHistory.month,
          year: bidHistory.year,
          count: sql<number>`count(*)::int`,
        })
        .from(bidHistory)
        .groupBy(bidHistory.month, bidHistory.year)
        .orderBy(sql`${bidHistory.year} DESC, ${bidHistory.month}`);

      // Get reasons reports grouped by month/year/base/aircraft
      const reasonsReports = await db
        .select({
          month: bidHistory.month,
          year: bidHistory.year,
          base: bidHistory.base,
          aircraft: bidHistory.aircraft,
          count: sql<number>`count(*)::int`,
          linkedCount: sql<number>`count(linked_pairing_id)::int`,
        })
        .from(bidHistory)
        .groupBy(
          bidHistory.month,
          bidHistory.year,
          bidHistory.base,
          bidHistory.aircraft
        );

      // Create lookup map for reasons reports using normalized aircraft base type
      // Key format: MONTH-YEAR-BASE-AIRCRAFT_BASE_TYPE
      // Also track per-position details
      const reasonsMap = new Map<
        string,
        {
          count: number;
          linkedCount: number;
          positions: { position: string; count: number; linkedCount: number }[];
        }
      >();

      for (const r of reasonsReports) {
        const { baseType, position } = parseAircraftCode(r.aircraft);
        const key = `${normalizeMonth(r.month)}-${r.year}-${r.base}-${baseType}`;

        const existing = reasonsMap.get(key);
        if (existing) {
          existing.count += r.count;
          existing.linkedCount += r.linkedCount;
          if (position) {
            existing.positions.push({
              position: position === 'A' ? 'Captain' : 'First Officer',
              count: r.count,
              linkedCount: r.linkedCount,
            });
          }
        } else {
          reasonsMap.set(key, {
            count: r.count,
            linkedCount: r.linkedCount,
            positions: position
              ? [
                  {
                    position: position === 'A' ? 'Captain' : 'First Officer',
                    count: r.count,
                    linkedCount: r.linkedCount,
                  },
                ]
              : [],
          });
        }
      }

      // Get current package: the most recently uploaded completed package
      // (packages are already sorted by uploadedAt desc, so find first completed one)
      const currentPackage = packages.find(p => p.status === 'completed');
      const currentPackageId = currentPackage?.id;

      // Build enriched package list with reasons report status
      const enrichedPackages = packages.map(p => {
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
          uploadedAt:
            p.uploadedAt instanceof Date
              ? p.uploadedAt.toISOString()
              : p.uploadedAt,
          isCurrent: p.id === currentPackageId,
          hasReasonsReport: !!reasons,
          reasonsReportCount: reasons?.count || 0,
          linkedRecords: reasons?.linkedCount || 0,
          pairingCount: pairingCountMap.get(p.id) || 0,
          positions: reasons?.positions || [],
        };
      });

      // Find months in history that don't have a corresponding bid package
      const packageMonthYears = new Set(
        packages.map(p => `${normalizeMonth(p.month)}-${p.year}`)
      );
      const missingPackageMonths = historyMonths.filter(
        h => !packageMonthYears.has(`${normalizeMonth(h.month)}-${h.year}`)
      );

      res.json({
        bidPackages: {
          total: packages.length,
          current: currentPackage
            ? `${currentPackage.month} ${currentPackage.year}`
            : null,
          statusCounts: packages.reduce<Record<string, number>>((acc, p) => {
            acc[p.status] = (acc[p.status] || 0) + 1;
            return acc;
          }, {}),
          list: enrichedPackages,
        },
        historicalRecords: {
          total: historyCount[0]?.count || 0,
          linkedToBidPackage: linkedCount[0]?.count || 0,
          unlinked:
            (historyCount[0]?.count || 0) - (linkedCount[0]?.count || 0),
          unlinkedMonths: missingPackageMonths.map(m => ({
            month: m.month,
            year: m.year,
            count: m.count,
          })),
        },
      });
    } catch (error) {
      console.error('Error fetching data health:', error);
      res.status(500).json({ error: 'Failed to fetch data health' });
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
  app.post('/api/upload', handleMulterUpload(upload.single('bidPackage')), async (req, res) => {
    try {
      if (!req.file) {
        return sendApiError(
          res,
          400,
          'No bid package file was uploaded.',
          'MISSING_FILE'
        );
      }

      // multer's fileFilter only checked the client-supplied mimetype header,
      // which is trivially spoofable. Sniff the actual PDF magic bytes for
      // anything claiming to be a PDF before handing it to the parser.
      if (
        req.file.mimetype === 'application/pdf' &&
        req.file.buffer.subarray(0, 5).toString('latin1') !== '%PDF-'
      ) {
        return sendApiError(
          res,
          400,
          'File does not appear to be a valid PDF.',
          'INVALID_FILE_TYPE'
        );
      }

      const { name, month, year, base, aircraft } = req.body;

      // Don't pre-check for duplicates here — month/year/base/aircraft from the
      // client are placeholders until the parser extracts the real values from
      // the PDF. Pre-checking would delete unrelated packages that happen to
      // match the placeholder (e.g. "August 2025 NYC A220"). The post-parsing
      // cleanup further down does the correct dedup using real metadata.
      const bidPackageData = insertBidPackageSchema.parse({
        name,
        month,
        year: parseInt(year),
        base,
        aircraft,
      });

      const bidPackage = await storage.createBidPackage(bidPackageData);

      // Parse file synchronously so processing completes before the serverless
      // function terminates. On Vercel, the runtime is killed once the response
      // is sent — background .then() chains never execute.
      try {
        await pdfParser.parseFile(
          req.file.buffer,
          bidPackage.id,
          req.file.mimetype
        );
        console.log(`File parsing completed for bid package ${bidPackage.id}`);
        // Status is set to 'completed' inside parseFile() after all batch inserts finish

        // Link any existing unlinked bid_history records to the new pairings
        try {
          // IMPORTANT: Fetch fresh bid package data from DB since parsing may have updated month/year/base/aircraft
          const freshBidPackage = await storage.getBidPackage(bidPackage.id);
          if (!freshBidPackage) {
            // Throw (not `return`) so this is caught by the enclosing
            // catch below and auto-linking is skipped as best-effort —
            // a bare `return` here previously exited the whole route
            // handler before the success response was sent, hanging the
            // client's upload request until it timed out.
            throw new Error(
              `Auto-linking: Could not find bid package ${bidPackage.id}`
            );
          }

          const fetchedPairings = await storage.getPairings(freshBidPackage.id);
          console.log(
            `Auto-linking: Found ${fetchedPairings.length} pairings for bid package ${freshBidPackage.id}`
          );

          if (fetchedPairings.length > 0) {
            // Find unlinked bid_history records that match this package
            const { baseType: pkgAircraftBase } = parseAircraftCode(
              freshBidPackage.aircraft
            );
            const pkgMonthNorm = normalizeMonth(freshBidPackage.month);
            console.log(
              `Auto-linking: Package criteria - month: ${pkgMonthNorm}, year: ${freshBidPackage.year}, base: ${freshBidPackage.base}, aircraft: ${pkgAircraftBase}`
            );

            // Get all unlinked history records
            const unlinkedRecords = await db
              .select()
              .from(bidHistory)
              .where(sql`linked_pairing_id IS NULL`);
            console.log(
              `Auto-linking: Found ${unlinkedRecords.length} unlinked bid_history records`
            );

            // Build a map of pairing numbers for fast lookup
            const pairingMap = new Map(
              fetchedPairings.map(p => [p.pairingNumber, p])
            );

            let linkedCount = 0;
            let matchingRecords = 0;
            // Group history record ids by target pairing so we can issue one
            // UPDATE per pairing instead of one per matched history record —
            // this loop can otherwise be hundreds of sequential round-trips
            // inside the synchronous upload request.
            const recordIdsByPairingId = new Map<number, number[]>();
            for (const record of unlinkedRecords) {
              const { baseType: histAircraftBase } = parseAircraftCode(
                record.aircraft
              );
              const histMonthNorm = normalizeMonth(record.month);

              // Check if this record matches the bid package
              if (
                histMonthNorm === pkgMonthNorm &&
                record.year === freshBidPackage.year &&
                record.base === freshBidPackage.base &&
                histAircraftBase === pkgAircraftBase
              ) {
                matchingRecords++;
                // Find matching pairing by number
                const matchingPairing = pairingMap.get(record.pairingNumber);
                if (matchingPairing) {
                  const ids = recordIdsByPairingId.get(matchingPairing.id) || [];
                  ids.push(record.id);
                  recordIdsByPairingId.set(matchingPairing.id, ids);
                  linkedCount++;
                }
              }
            }

            for (const [pairingId, recordIds] of recordIdsByPairingId) {
              await db
                .update(bidHistory)
                .set({ linkedPairingId: pairingId })
                .where(inArray(bidHistory.id, recordIds));
            }

            console.log(
              `Auto-linking: ${matchingRecords} records matched criteria, ${linkedCount} successfully linked`
            );

            // After linking, check if there's a duplicate package with the same normalized aircraft (baseType + position)
            const allPackages = await storage.getBidPackages();
            const { baseType: freshAircraftBase, position: freshPosition } =
              parseAircraftCode(freshBidPackage.aircraft);
            const freshMonth = normalizeMonth(freshBidPackage.month);

            const duplicates = allPackages.filter(pkg => {
              if (pkg.id === freshBidPackage.id) return false;
              const pkgMonth = normalizeMonth(pkg.month);
              const { baseType: pkgAircraftBase, position: pkgPosition } =
                parseAircraftCode(pkg.aircraft);
              // Use normalized comparison: baseType + position to handle format differences
              // e.g., "A220" vs "220", "220-A" vs "A220-A" should match if they're the same aircraft+position
              return (
                pkgMonth === freshMonth &&
                pkg.year === freshBidPackage.year &&
                pkg.base === freshBidPackage.base &&
                pkgAircraftBase === freshAircraftBase &&
                pkgPosition === freshPosition
              );
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
                  // CRITICAL: Must unlink bid_history records BEFORE deleting pairings/package
                  // Foreign key constraint on linked_pairing_id will block deletion otherwise
                  const dupPairings = await storage.getPairings(dup.id);
                  if (dupPairings.length > 0) {
                    console.log(
                      `Auto-linking: Unlinking ${dupPairings.length} pairings from bid_history before deletion`
                    );

                    // Unlink all bid_history records pointing to these pairings one by one
                    for (const pairing of dupPairings) {
                      await db
                        .update(bidHistory)
                        .set({ linkedPairingId: null })
                        .where(sql`linked_pairing_id = ${pairing.id}`);
                    }
                    console.log(
                      `Auto-linking: Successfully unlinked bid_history records`
                    );
                  }

                  // Now safe to delete the package (will cascade delete pairings)
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

              // Re-link bid_history records to the new package's pairings
              console.log(
                `Auto-linking: Re-linking bid_history records to new package ${freshBidPackage.id}`
              );
              const newPairingMap = new Map(
                fetchedPairings.map(p => [p.pairingNumber, p])
              );
              const unlinkedAfterCleanup = await db
                .select()
                .from(bidHistory)
                .where(sql`linked_pairing_id IS NULL`);

              let relinkedCount = 0;
              const relinkRecordIdsByPairingId = new Map<number, number[]>();
              for (const record of unlinkedAfterCleanup) {
                const { baseType: histAircraftBase, position: histPosition } =
                  parseAircraftCode(record.aircraft);
                const histMonthNorm = normalizeMonth(record.month);

                // Must match month/year/base AND position to preserve Captain/FO segregation
                if (
                  histMonthNorm === freshMonth &&
                  record.year === freshBidPackage.year &&
                  record.base === freshBidPackage.base &&
                  histAircraftBase === freshAircraftBase &&
                  histPosition === freshPosition
                ) {
                  const matchingPairing = newPairingMap.get(
                    record.pairingNumber
                  );
                  if (matchingPairing) {
                    const ids =
                      relinkRecordIdsByPairingId.get(matchingPairing.id) || [];
                    ids.push(record.id);
                    relinkRecordIdsByPairingId.set(matchingPairing.id, ids);
                    relinkedCount++;
                  }
                }
              }
              for (const [pairingId, recordIds] of relinkRecordIdsByPairingId) {
                await db
                  .update(bidHistory)
                  .set({ linkedPairingId: pairingId })
                  .where(inArray(bidHistory.id, recordIds));
              }
              console.log(
                `Auto-linking: Re-linked ${relinkedCount} bid_history records to new package (position: ${freshPosition || 'none'})`
              );
            }
          }
        } catch (linkError) {
          console.error(
            'Error linking existing bid_history records:',
            linkError
          );
        }
      } catch (parseError) {
        console.error(
          `File parsing failed for bid package ${bidPackage.id}:`,
          parseError
        );
        await storage.updateBidPackageStatus(bidPackage.id, 'failed');
        return sendApiError(
          res,
          500,
          'Failed to parse bid package PDF. Check that the file is a Delta PBS bid package PDF or TXT export.',
          'BID_PACKAGE_PARSE_FAILED'
        );
      }

      res.json({
        success: true,
        bidPackage,
        message: 'Bid package uploaded and processed successfully.',
      });
    } catch (error) {
      console.error('Error uploading bid package:', error);
      if (error instanceof z.ZodError) {
        sendApiError(
          res,
          400,
          'Invalid bid package upload details.',
          'INVALID_UPLOAD_DATA',
          error.errors
        );
      } else {
        sendApiError(
          res,
          500,
          'Failed to upload bid package.',
          'UPLOAD_FAILED'
        );
      }
    }
  });

  // Upload reasons report (HTML)
  app.post(
    '/api/upload-reasons-report',
    handleMulterUpload(uploadReasonsReport.single('reasonsReport')),
    async (req, res) => {
      try {
        if (!req.file) {
          return sendApiError(
            res,
            400,
            'No Reasons Report file was uploaded.',
            'MISSING_FILE'
          );
        }

        console.log('Processing reasons report:', req.file.originalname);

        // Real NAVBLUE composite exports are Windows-1252-ish and use \xA0
        // (NBSP) as visual spacing throughout. Decoding those bytes as UTF-8
        // turns every \xA0 into U+FFFD, which silently breaks all Reasons-pane
        // phrase matching — so fall back to latin1 when the buffer isn't
        // valid UTF-8 (U+FFFD in the decoded text is the tell).
        let htmlContent = req.file.buffer.toString('utf-8');
        if (htmlContent.includes('\uFFFD')) {
          htmlContent = req.file.buffer.toString('latin1');
        }
        const awards =
          await ReasonsReportParser.parseReasonsReportFromContent(htmlContent);

        // Extract metadata from HTML
        const metadata = ReasonsReportParser.extractMetadata(htmlContent);

        if (!metadata) {
          return sendApiError(
            res,
            400,
            'Could not extract base, aircraft, or month from the Reasons Report HTML. Check that this is a NAVBLUE Reasons Report export.',
            'REASONS_METADATA_FAILED'
          );
        }

        // Find the matching bid package to look up pairing details
        // Use normalized aircraft type for matching (A220 matches 220-A and 220-B)
        const allPackages = await storage.getBidPackages();
        const { baseType: metadataAircraftBase } = parseAircraftCode(
          metadata.aircraft
        );
        const matchingPackage = allPackages.find(pkg => {
          const { baseType: pkgAircraftBase } = parseAircraftCode(pkg.aircraft);
          return (
            normalizeMonth(pkg.month) === normalizeMonth(metadata.month) &&
            pkg.year === metadata.year &&
            pkg.base === metadata.base &&
            pkgAircraftBase === metadataAircraftBase
          );
        });

        // Get all pairings from the matching package for efficient lookup
        let packagePairings: Pairing[] = [];
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

        // Create a map for fast pairing lookup
        const pairingMap = new Map<string, Pairing>();
        for (const p of packagePairings) {
          pairingMap.set(p.pairingNumber, p);
        }

        // Helper function to compute leg signature from flight segments
        const computeLegSignature = (segments: any[]): string => {
          if (!segments || segments.length === 0) return '';
          // Build sequence: departure -> arrival -> next departure -> ... -> final arrival
          const legs: string[] = [];
          for (let i = 0; i < segments.length; i++) {
            if (i === 0) {
              legs.push(segments[i].departure);
            }
            legs.push(segments[i].arrival);
          }
          return legs.join('-');
        };

        // Helper function to get turn destination for 1-day trips
        const getTurnDestination = (
          segments: any[],
          pairingDays: number
        ): string | null => {
          if (pairingDays !== 1 || !segments || segments.length === 0)
            return null;
          // For a turn, the destination is typically the furthest point from base
          // Usually the arrival of the first leg that's not a return
          const arrivals = segments.map((s: any) => s.arrival);
          const departures = segments.map((s: any) => s.departure);
          // The base is the first departure (and last arrival)
          const base = departures[0];
          // Find destinations that aren't the base
          const destinations = arrivals.filter((a: string) => a !== base);
          // Return unique destinations joined, or the first one
          const uniqueDests = [...new Set(destinations)];
          return uniqueDests.length > 0 ? uniqueDests.join('-') : null;
        };

        // Store awards in bidHistory table
        let storedCount = 0;
        let skippedCount = 0;
        let linkedCount = 0;
        let unlinkedCount = 0;
        console.log(
          `Processing ${awards.length} awards for ${metadata.base} ${metadata.aircraft} ${metadata.month} ${metadata.year}`
        );

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

            // Look up matching pairing from bid package
            const matchingPairing = pairingMap.get(award.pairingNumber);
            let linkedPairingId: number | null = null;
            let layoverCitiesFromPackage: string | null = null;
            let turnDestination: string | null = null;
            let legSignature: string | null = null;

            if (matchingPairing) {
              linkedPairingId = matchingPairing.id;
              linkedCount++;

              // Extract layovers from pairing
              const layovers =
                typeof matchingPairing.layovers === 'string'
                  ? JSON.parse(matchingPairing.layovers)
                  : matchingPairing.layovers;
              if (Array.isArray(layovers) && layovers.length > 0) {
                layoverCitiesFromPackage = layovers
                  .map((l: any) => l.city)
                  .sort()
                  .join('-');
              }

              // Extract flight segments and compute signatures
              const segments =
                typeof matchingPairing.flightSegments === 'string'
                  ? JSON.parse(matchingPairing.flightSegments)
                  : matchingPairing.flightSegments;

              if (Array.isArray(segments)) {
                legSignature = computeLegSignature(segments);
                turnDestination = getTurnDestination(
                  segments,
                  matchingPairing.pairingDays || award.pairingDays
                );
              }

              // Update fingerprint with real data from package
              if (layoverCitiesFromPackage) {
                fingerprint.layoverCities = layoverCitiesFromPackage
                  .split('-')
                  .sort();
                fingerprint.layoverPattern = layoverCitiesFromPackage;
              }
            } else {
              unlinkedCount++;
            }

            // Insert into database with new fields
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
              awardedAt: new Date(
                `${metadata.year}-${monthToNumber(metadata.month)}-01`
              ),
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

        console.log(
          `Upload complete: ${storedCount} stored, ${skippedCount} skipped, ${linkedCount} linked to bid package, ${unlinkedCount} unlinked`
        );

        // Parse the Reasons pane (per-preference outcomes) when present.
        // Replace any previously stored outcomes for the same report month
        // so re-uploads do not duplicate rows.
        let preferencesParsed = 0;
        try {
          const pane = ReasonsReportParser.parseReasonsPane(htmlContent);
          if (pane.preferences.length > 0) {
            await db
              .delete(reasonsReportPreferences)
              .where(
                and(
                  eq(reasonsReportPreferences.month, metadata.month),
                  eq(reasonsReportPreferences.year, metadata.year),
                  eq(reasonsReportPreferences.base, metadata.base),
                  eq(reasonsReportPreferences.aircraft, metadata.aircraft)
                )
              );
            preferencesParsed = await storage.createReasonsReportPreferences(
              pane.preferences.map(pref => ({
                month: metadata.month,
                year: metadata.year,
                base: metadata.base,
                aircraft: metadata.aircraft,
                pilotSeniorityNumber: pref.pilotSeniorityNumber,
                pilotEmployeeNumber: pref.pilotEmployeeNumber,
                preferenceNumber: pref.preferenceNumber,
                preferenceText: pref.preferenceText,
                outcome: pref.outcome,
                outcomeDetail: pref.outcomeDetail,
                awardedPairingNumbers: pref.awardedPairingNumbers,
                // Per-pilot credit-window line rides along with any global
                // banners — real threshold data the simulator otherwise
                // has to guess.
                reportBanners: pref.windowInfo
                  ? [...pane.banners, pref.windowInfo]
                  : pane.banners,
              }))
            );
            console.log(
              `Reasons pane: ${preferencesParsed} preference outcomes stored (banners: ${pane.banners.join(', ') || 'none'})`
            );
          } else {
            console.log(
              'Reasons pane: no per-preference outcomes recognized in this report format'
            );
          }
        } catch (error) {
          console.error('Reasons pane parsing failed (non-fatal):', error);
        }

        res.json({
          success: true,
          message:
            skippedCount > 0
              ? `Reasons report processed: ${storedCount} new awards stored, ${skippedCount} duplicates skipped, ${linkedCount} linked to bid package`
              : `Reasons report processed: ${storedCount} awards stored, ${linkedCount} linked to bid package`,
          stats: {
            totalParsed: awards.length,
            stored: storedCount,
            skipped: skippedCount,
            preferencesParsed,
            linked: linkedCount,
            unlinked: unlinkedCount,
            base: metadata.base,
            aircraft: metadata.aircraft,
            month: metadata.month,
            year: metadata.year,
          },
          warning:
            unlinkedCount > 0 && linkedCount === 0
              ? `No matching bid package found for ${metadata.month} ${metadata.year}. Upload the bid package first for accurate leg/layover data.`
              : undefined,
        });
      } catch (error) {
        console.error('Error processing reasons report:', error);
        sendApiError(
          res,
          500,
          'Failed to process Reasons Report.',
          'REASONS_PROCESSING_FAILED'
        );
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
        .orderBy(sql`${bidHistory.year} desc`, sql`${bidHistory.month} desc`);

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
      const conditions: (SQL<unknown> | undefined)[] = [
        eq(pairings.bidPackageId, parseInt(bidPackageId as string)),
      ];

      if (search) {
        conditions.push(
          or(
            like(pairings.route, `%${search}%`),
            like(pairings.pairingNumber, `%${search}%`),
            like(pairings.effectiveDates, `%${search}%`),
            like(pairings.fullTextBlock, `%${search}%`)
          )
        );
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
      // TAFB min/max compare as minutes, not raw text (handles 'HH:MM' and decimal formats)
      if (tafbMin) {
        const minMins = parseFloat(tafbMin as string) * 60;
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
      if (tafbMax) {
        const maxMins = parseFloat(tafbMax as string) * 60;
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
        const frequencyMap =
          HoldProbabilityCalculator.buildPairingFrequencyMap(allForPackage);
        for (const p of pairingsResult) {
          // Extract layover cities for location-based adjustments
          const layoverCities =
            (p.layovers as any[])
              ?.map((l: any) => l.city)
              .filter((c: string) => c) || [];

          const desirability =
            HoldProbabilityCalculator.calculateDesirabilityScore(p, bidMonth);
          const freq = frequencyMap.get(p.pairingNumber) || 0;
          const hp = HoldProbabilityCalculator.calculateHoldProbability({
            seniorityPercentile: seniorityValue,
            desirabilityScore: desirability,
            pairingFrequency: freq,
            includesDeadheads: p.deadheads || 0,
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

  // Simulate a structured draft bid against a bid package (static first
  // pass - see server/lib/bidSimulator.ts for what is and is not modeled)
  app.post('/api/bid/simulate', async (req, res) => {
    try {
      const { bidPackageId, bid, alv, threshold, aircraftCategory } =
        req.body as {
          bidPackageId: number;
          bid: DraftBid;
          alv?: number;
          threshold?: number;
          aircraftCategory?: 'narrowbody' | 'widebody';
        };
      if (!bidPackageId || !bid || !Array.isArray(bid.groups)) {
        return sendApiError(
          res,
          400,
          'bidPackageId and bid.groups are required.',
          'INVALID_SIMULATION_REQUEST'
        );
      }
      const bidPackage = await storage.getBidPackage(bidPackageId);
      if (!bidPackage) {
        return sendApiError(res, 404, 'Bid package not found.', 'NOT_FOUND');
      }
      const packagePairings = await storage.getPairings(bidPackageId);
      const packageAlv =
        alv ??
        (bidPackage.alvHours ? parseFloat(String(bidPackage.alvHours)) : undefined);
      // Real credit window/threshold from the latest imported Reasons Report
      // (explicit request values still win).
      const realWindow = await storage.getCategoryCreditWindow(bidPackage.base);
      const result = simulateBid(bid, packagePairings, {
        alv: packageAlv,
        threshold: threshold ?? realWindow?.threshold,
        aircraftCategory,
        windowMin: realWindow?.windowMin,
        windowMax: realWindow?.windowMax,
        windowSource: realWindow
          ? `the ${realWindow.period} Reasons Report`
          : undefined,
      });
      res.json(result);
    } catch (error) {
      console.error('Error simulating bid:', error);
      res.status(500).json({ message: 'Failed to simulate bid' });
    }
  });

  // Longitudinal category trends mined from imported Reasons Reports:
  // per-period contention, category size, and how junior each trip length
  // went (percentile of the junior-most holder).
  app.get('/api/trends', async (req, res) => {
    try {
      const base = String(req.query.base || 'NYC');

      const contention = await db.execute(sql`
        SELECT year, month,
          count(*) AS total_prefs,
          count(DISTINCT pilot_seniority_number) AS pilots,
          sum(CASE WHEN outcome = 'Honored' THEN 1 ELSE 0 END) AS honored,
          sum(CASE WHEN outcome IN ('Awarded to senior bidder', 'Awarded to senior shadow bidder') THEN 1 ELSE 0 END) AS lost_to_senior
        FROM reasons_report_preferences
        WHERE base = ${base}
        GROUP BY year, month
      `);

      const boundaries = await db.execute(sql`
        SELECT year, month, pairing_days,
          max(junior_holder_seniority) AS junior_most,
          count(*) AS awards
        FROM bid_history
        WHERE base = ${base}
          AND (award_type IS NULL OR award_type NOT ILIKE '%coverage%')
        GROUP BY year, month, pairing_days
      `);

      const rosters = await storage.getCategoryRosters(base);
      const window = await storage.getCategoryCreditWindow(base);

      const monthNum = (m: string) => {
        const idx = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC']
          .indexOf(String(m).trim().slice(0, 3).toUpperCase());
        return idx === -1 ? 0 : idx + 1;
      };
      const sortKey = (r: any) => Number(r.year) * 100 + monthNum(r.month);

      const periods = (contention.rows as any[])
        .sort((a, b) => sortKey(a) - sortKey(b))
        .map(r => ({
          period: `${String(r.month).trim().slice(0, 3).toUpperCase()} ${r.year}`,
          pilots: Number(r.pilots),
          totalPrefs: Number(r.total_prefs),
          honored: Number(r.honored),
          lostToSenior: Number(r.lost_to_senior),
        }));

      const holdBoundaries = (boundaries.rows as any[])
        .sort((a, b) => sortKey(a) - sortKey(b))
        .map(r => {
          const key = `${String(r.month).trim().slice(0, 3).toUpperCase()}-${r.year}`;
          const roster = rosters.get(key);
          const pct = roster
            ? percentileWithin(roster, Number(r.junior_most))
            : null;
          return {
            period: `${String(r.month).trim().slice(0, 3).toUpperCase()} ${r.year}`,
            pairingDays: Number(r.pairing_days),
            juniorMostPercentile: pct,
            awards: Number(r.awards),
          };
        })
        .filter(r => r.juniorMostPercentile !== null);

      res.json({ base, periods, holdBoundaries, window });
    } catch (error) {
      console.error('Error building trends:', error);
      res.status(500).json({ message: 'Failed to build trends' });
    }
  });

  // How pilots actually bid (preference text mining), not just outcomes:
  // type mix, bid complexity over time, most requested/avoided layover
  // cities, check-in time and station preferences, days-off patterns.
  app.get('/api/bid-patterns', async (req, res) => {
    try {
      const base = String(req.query.base || 'NYC');
      const patterns = await storage.getBidPatterns(base);
      res.json({ base, ...patterns });
    } catch (error) {
      console.error('Error building bid patterns:', error);
      res.status(500).json({ message: 'Failed to build bid patterns' });
    }
  });

  // Render a structured draft bid to review-ready NAVBLUE preference text
  app.post('/api/bid/export', async (req, res) => {
    try {
      const { bid } = req.body as { bid: DraftBid };
      if (!bid || !Array.isArray(bid.groups)) {
        return sendApiError(
          res,
          400,
          'bid.groups is required.',
          'INVALID_EXPORT_REQUEST'
        );
      }
      res.json(exportBid(bid));
    } catch (error) {
      console.error('Error exporting bid:', error);
      res.status(500).json({ message: 'Failed to export bid' });
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
        layoverLocations,
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
        layoverLocations,
        ...filters,
      });

      // If seniority provided and pairings don't have stored probabilities, compute holdProbability per-response
      const seniorityValueRaw =
        (filters as any)?.seniorityPercentile ||
        (filters as any)?.seniorityPercentage;
      if (seniorityValueRaw) {
        const seniorityValue = parseFloat(seniorityValueRaw);

        // Check if we need to recalculate (only if pairings don't have stored probabilities)
        const needsRecalc = result.pairings.some(
          p =>
            (p as any).holdProbability === null ||
            (p as any).holdProbability === undefined
        );

        if (needsRecalc) {
          const allForPackage = await db
            .select()
            .from(pairings)
            .where(eq(pairings.bidPackageId, bidPackageId));

          const frequencyMap =
            HoldProbabilityCalculator.buildPairingFrequencyMap(allForPackage);
          for (const p of result.pairings) {
            // Skip if this pairing already has a calculated probability
            if (
              (p as any).holdProbability !== null &&
              (p as any).holdProbability !== undefined
            ) {
              continue;
            }

            const desirability =
              HoldProbabilityCalculator.calculateDesirabilityScore(p as any);
            const freq = frequencyMap.get((p as any).pairingNumber) || 0;
            const hp = HoldProbabilityCalculator.calculateHoldProbability({
              seniorityPercentile: seniorityValue,
              desirabilityScore: desirability,
              pairingFrequency: freq,
              includesDeadheads: (p as any).deadheads || 0,
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

  // Get bid history for a pairing (DEPRECATED - use /api/history/similar/:pairingId instead)
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

  // Get similar historical pairings using fingerprint matching (CORRECT approach)
  app.get('/api/history/similar/:pairingId', async (req, res) => {
    try {
      const pairingId = parseInt(req.params.pairingId);

      // Get the pairing
      const pairing = await db
        .select()
        .from(pairings)
        .where(eq(pairings.id, pairingId))
        .limit(1);

      if (pairing.length === 0) {
        return res.status(404).json({ message: 'Pairing not found' });
      }

      const currentPairing = pairing[0];

      // Get bid package info for month/year
      const bidPackageResult = await db
        .select()
        .from(bidPackages)
        .where(eq(bidPackages.id, currentPairing.bidPackageId))
        .limit(1);

      const bidPackage = bidPackageResult[0];
      // Normalize month to 3-letter uppercase format (e.g., "January" -> "JAN")
      const rawMonth = bidPackage?.month || 'JAN';
      const currentMonth = rawMonth.substring(0, 3).toUpperCase();
      const currentYear = bidPackage?.year || new Date().getFullYear();

      // Ensure JSONB fields are properly parsed (Drizzle should do this, but be explicit)
      const parsedPairing = {
        ...currentPairing,
        layovers:
          typeof currentPairing.layovers === 'string'
            ? JSON.parse(currentPairing.layovers)
            : currentPairing.layovers,
        flightSegments:
          typeof currentPairing.flightSegments === 'string'
            ? JSON.parse(currentPairing.flightSegments)
            : currentPairing.flightSegments,
      };

      // Use the canonical fingerprint creation from HoldProbabilityCalculator
      const currentFingerprint =
        HoldProbabilityCalculator.createFingerprintFromPairing(parsedPairing);
      // Add actual credit hours to fingerprint for accurate comparison
      currentFingerprint.creditHours = parseFloat(
        currentPairing.creditHours?.toString() || '0'
      );

      // Extract layover info for display
      const layoverCities = Array.isArray(parsedPairing.layovers)
        ? parsedPairing.layovers.map((l: any) => l.city).sort()
        : [];
      const creditHours = parseFloat(
        currentPairing.creditHours?.toString() || '0'
      );
      const pairingDays = currentPairing.pairingDays || 1;

      // Compute turn destination for current pairing (for 1-day trip matching)
      let currentTurnDestination: string | null = null;
      let currentLegSignature: string | null = null;
      if (pairingDays === 1 && Array.isArray(parsedPairing.flightSegments)) {
        const segments = parsedPairing.flightSegments;
        // Compute leg signature
        const legs: string[] = [];
        for (let i = 0; i < segments.length; i++) {
          if (i === 0) legs.push(segments[i].departure);
          legs.push(segments[i].arrival);
        }
        currentLegSignature = legs.join('-');

        // Get turn destination (non-base airports)
        const base = segments[0]?.departure;
        const destinations = segments
          .map((s: any) => s.arrival)
          .filter((a: string) => a !== base);
        const uniqueDests = [...new Set(destinations)];
        currentTurnDestination =
          uniqueDests.length > 0 ? uniqueDests.join('-') : null;
      }

      // Compute layover pattern for current pairing (for multi-day trip matching)
      const currentLayoverPattern =
        layoverCities.length > 0 ? layoverCities.join('-') : 'none';

      // Get all historical data - fingerprint matching already ensures relevant trips match
      // No base/aircraft filter needed since similarity scoring handles relevance
      const historicalData = await db.select().from(bidHistory);

      // Find similar matches using fingerprint comparison
      const matches: Array<{
        pairingNumber: string;
        month: string;
        year: number;
        juniorHolderSeniority: number;
        checkInDate?: string;
        similarity: number;
        confidence: string;
        breakdown: {
          layoverMatch: number;
          daysMatch: number;
          timeMatch: number;
          creditMatch: number;
          efficiencyMatch: number;
          seasonMatch: number;
        };
        historicalLayovers: string;
        historicalDays: number;
        historicalCredit: string;
      }> = [];

      for (const history of historicalData) {
        if (history.tripFingerprint) {
          // Parse historical fingerprint if it's a string (Drizzle may not auto-parse JSONB)
          let histFingerprint = history.tripFingerprint as any;
          if (typeof histFingerprint === 'string') {
            try {
              histFingerprint = JSON.parse(histFingerprint);
            } catch {
              continue; // Skip invalid fingerprints
            }
          }

          // CRITICAL: Override fingerprint values with authoritative record data
          // The stored fingerprint may have stale/incorrect values

          // 1. Override pairingDays with the authoritative record value (for days hard filter)
          // If authoritative value is null/undefined/0, skip this record entirely
          if (
            history.pairingDays !== undefined &&
            history.pairingDays !== null &&
            history.pairingDays > 0
          ) {
            histFingerprint.pairingDays = history.pairingDays;
          } else {
            // Skip records with unknown/invalid days - can't reliably match them
            continue;
          }

          // HARD FILTER: Skip records where days don't match
          // Days must be identical - a 3-day trip should only match other 3-day trips
          if (histFingerprint.pairingDays !== pairingDays) {
            continue; // Skip this historical record - days don't match
          }

          // 2. Override layoverCities/layoverPattern with authoritative record data
          // Always prefer database values over stale fingerprint values
          if (
            history.layoverCities !== undefined &&
            history.layoverCities !== null
          ) {
            // Parse layover cities from format like "IAD-15 SNA-18" to ["IAD", "SNA"]
            let parsedCities: string[] = [];
            if (
              typeof history.layoverCities === 'string' &&
              history.layoverCities.length > 0
            ) {
              parsedCities = history.layoverCities
                .split(/\s+/)
                .map(city => city.replace(/-\d+(\.\d+)?$/, '')) // Remove duration suffix
                .filter(city => city.length > 0);
            } else if (Array.isArray(history.layoverCities)) {
              parsedCities = history.layoverCities as string[];
            }

            // Always override - even with empty array to replace stale data
            histFingerprint.layoverCities = parsedCities.sort();
            histFingerprint.layoverPattern =
              parsedCities.length > 0 ? parsedCities.sort().join('-') : 'none';
          }

          // Ensure layoverCities is an array
          if (!Array.isArray(histFingerprint.layoverCities)) {
            histFingerprint.layoverCities = [];
          }

          // 3. Add actual credit hours for more accurate matching
          if (
            history.creditHours !== null &&
            history.creditHours !== undefined
          ) {
            histFingerprint.creditHours = parseFloat(
              history.creditHours.toString()
            );
          }

          // Check if this is the EXACT same pairing number from the same month/year
          const isSamePairing =
            history.pairingNumber === currentPairing.pairingNumber &&
            history.month === currentMonth &&
            history.year === currentYear;

          // For ONE-DAY TRIPS: Match by turn destination (the airports visited)
          // This allows matching turns to the same city across different months
          // e.g., a BOS turn in January should match a BOS turn in December
          if (pairingDays === 1) {
            // Get historical turn destination from the new field
            const histTurnDest = history.turnDestination;
            const histLegSig = history.legSignature;

            // If historical record has leg signature, match by that (most accurate)
            // Otherwise, if it has turn destination, match by that
            // If neither exists (old data without bid package), skip unless same pairing number in same month
            if (histLegSig && currentLegSignature) {
              // Exact leg sequence match
              if (histLegSig !== currentLegSignature) {
                continue; // Different leg sequence - not a match
              }
            } else if (histTurnDest && currentTurnDestination) {
              // Turn destination match
              if (histTurnDest !== currentTurnDestination) {
                continue; // Different destinations - not a match
              }
            } else if (!isSamePairing) {
              // No leg data available - only match if it's the exact same pairing from same month
              // This handles legacy data that wasn't linked to a bid package
              continue;
            }
          }

          // For MULTI-DAY TRIPS: Use layover cities from package if available
          if (pairingDays > 1 && history.layoverCitiesFromPackage) {
            // Override fingerprint with accurate layover data from bid package
            const packageLayovers = history.layoverCitiesFromPackage
              .split('-')
              .sort();
            histFingerprint.layoverCities = packageLayovers;
            histFingerprint.layoverPattern = packageLayovers.join('-');
          }

          let similarity: { score: number; confidence: string; breakdown: any };

          if (isSamePairing) {
            // SAME pairing number from same bid package = 100% exact match always
            // This is the actual historical version of this exact pairing
            similarity = {
              score: 100,
              confidence: 'exact',
              breakdown: {
                layoverMatch: 100,
                daysMatch: 100,
                timeMatch: 100,
                creditMatch: 100,
                efficiencyMatch: 100,
                seasonMatch: 100,
              },
            };
          } else {
            similarity = TripMatcher.calculateSimilarity(
              currentFingerprint,
              histFingerprint
            );
          }

          // Only include matches with >= 60% similarity
          if (similarity.score >= 60) {
            // Normalize layover cities for display (handle both string and array formats)
            // IMPORTANT: Sort alphabetically to match fingerprint comparison order
            let displayLayovers = '';
            if (history.layoverCities) {
              if (typeof history.layoverCities === 'string') {
                // Parse string format like "BOS-14 RDU-14" to just cities, then sort
                displayLayovers = history.layoverCities
                  .split(/\s+/)
                  .map(city => city.replace(/-\d+$/, ''))
                  .filter(city => city.length > 0)
                  .sort()
                  .join('-');
              } else if (Array.isArray(history.layoverCities)) {
                displayLayovers = (history.layoverCities as string[])
                  .sort()
                  .join('-');
              }
            }

            matches.push({
              pairingNumber: history.pairingNumber,
              month: history.month,
              year: history.year,
              juniorHolderSeniority: history.juniorHolderSeniority,
              checkInDate: history.checkInDate ?? undefined, // Include check-in date for grouping
              similarity: similarity.score,
              confidence: similarity.confidence,
              breakdown: similarity.breakdown,
              historicalLayovers: displayLayovers || 'None',
              historicalDays: history.pairingDays,
              historicalCredit: history.creditHours?.toString() || '0',
            });
          }
        }
      }

      // Group matches by pairing number + month + year
      // This consolidates multiple awards of the same pairing (different pilots/dates)
      const groupedMatches = new Map<
        string,
        {
          pairingNumber: string;
          month: string;
          year: number;
          similarity: number;
          confidence: string;
          breakdown: (typeof matches)[0]['breakdown'];
          historicalLayovers: string;
          historicalDays: number;
          historicalCredit: string;
          awards: Array<{ seniority: number; checkInDate?: string }>;
          isExactPairing: boolean; // True if same pairing number as current
        }
      >();

      for (const match of matches) {
        const key = `${match.pairingNumber}-${match.month}-${match.year}`;
        const existing = groupedMatches.get(key);

        if (existing) {
          // Add this award to the existing group
          existing.awards.push({
            seniority: match.juniorHolderSeniority,
            checkInDate: match.checkInDate,
          });
          // Keep the highest similarity score
          if (match.similarity > existing.similarity) {
            existing.similarity = match.similarity;
            existing.confidence = match.confidence;
            existing.breakdown = match.breakdown;
          }
        } else {
          // Create new group
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
                checkInDate: match.checkInDate,
              },
            ],
            isExactPairing:
              match.pairingNumber === currentPairing.pairingNumber,
          });
        }
      }

      // Convert to array and sort:
      // 1. Exact pairing number matches first (historical versions of THIS pairing)
      // 2. Then by similarity (highest first)
      // 3. Then by most recent (year/month)
      const sortedMatches = Array.from(groupedMatches.values()).sort((a, b) => {
        // Exact pairing matches come first
        if (a.isExactPairing && !b.isExactPairing) return -1;
        if (!a.isExactPairing && b.isExactPairing) return 1;

        // Then by similarity
        if (b.similarity !== a.similarity) return b.similarity - a.similarity;

        // Then by most recent
        if (b.year !== a.year) return b.year - a.year;
        const monthOrder = [
          'JAN',
          'FEB',
          'MAR',
          'APR',
          'MAY',
          'JUN',
          'JUL',
          'AUG',
          'SEP',
          'OCT',
          'NOV',
          'DEC',
        ];
        return monthOrder.indexOf(b.month) - monthOrder.indexOf(a.month);
      });

      // Format for response - include individual awards with date+seniority pairs
      const formattedMatches = sortedMatches.slice(0, 10).map(m => {
        // Format individual awards with date and seniority paired together
        const formattedAwards = m.awards
          .map(a => {
            // Parse format like "12/20 Sat 07:25" to extract date and day of week
            const dateMatch = a.checkInDate?.match(
              /^(\d{2}\/\d{2})\s*(\w{3})?/
            );
            const date = dateMatch?.[1] || '';
            const dayOfWeek = dateMatch?.[2] || '';
            return {
              date,
              dayOfWeek,
              seniority: a.seniority,
              fullDate: a.checkInDate || '',
            };
          })
          .sort((a, b) => a.date.localeCompare(b.date)); // Sort by date

        // Still compute date range for summary badge
        const dates = formattedAwards.map(a => a.date).filter(Boolean);
        const dateRange =
          dates.length > 1
            ? `${dates[0]} - ${dates[dates.length - 1]}`
            : dates[0] || '';

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
          juniorHolderSeniority: Math.max(...m.awards.map(a => a.seniority)), // Most junior
          seniorHolderSeniority: Math.min(...m.awards.map(a => a.seniority)), // Most senior
          awards: formattedAwards, // Individual awards with date+seniority pairs
          dateRange, // e.g., "12/20 - 12/28" for multiple awards (for summary)
        };
      });

      res.json({
        currentPairing: {
          pairingNumber: currentPairing.pairingNumber,
          layovers: layoverCities.join('-') || 'None',
          days: pairingDays,
          credit: creditHours.toFixed(2),
        },
        similarMatches: formattedMatches,
      });
    } catch (error) {
      console.error('Error fetching similar bid history:', error);
      res.status(500).json({ message: 'Failed to fetch similar bid history' });
    }
  });

  // Create/update user
  app.post('/api/user', async (req, res) => {
    try {
      const { name, seniorityNumber, seniorityPercentile, base, aircraft } =
        req.body;

      if (!seniorityNumber || !base || !aircraft) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      const parsedSeniorityNumber = parseInt(seniorityNumber);
      if (Number.isNaN(parsedSeniorityNumber)) {
        return res.status(400).json({ error: 'Invalid seniorityNumber' });
      }

      // users.seniorityPercentile is an integer column — round, don't just
      // truncate via parseFloat, or a value like "47.6" 500s on insert.
      let parsedPercentile = 50;
      if (seniorityPercentile !== undefined && seniorityPercentile !== null && seniorityPercentile !== '') {
        const rounded = Math.round(Number(seniorityPercentile));
        if (Number.isNaN(rounded)) {
          return res.status(400).json({ error: 'Invalid seniorityPercentile' });
        }
        parsedPercentile = rounded;
      }

      const user = await storage.createOrUpdateUser({
        name,
        seniorityNumber: parsedSeniorityNumber,
        seniorityPercentile: parsedPercentile,
        base,
        aircraft,
      });

      res.json(user);
    } catch (error) {
      console.error('Error creating/updating user:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Link a new device to the pilot's existing profile using their sync PIN.
  // This is how the app stays login-free while still syncing across devices:
  // there is exactly one canonical user, and the PIN is the only thing that
  // proves "this new browser belongs to the same pilot."
  app.post('/api/user/link-device', async (req, res) => {
    try {
      const { pin } = req.body;

      if (!pin || typeof pin !== 'string') {
        return res.status(400).json({ error: 'Missing pin' });
      }

      const user = await storage.getUserByPin(pin);

      if (!user) {
        return res.status(404).json({ error: 'Invalid PIN' });
      }

      res.json(user);
    } catch (error) {
      console.error('Error linking device:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Set or change the sync PIN used to link additional devices.
  app.patch('/api/user/pin', async (req, res) => {
    try {
      const { userId, pin } = req.body;

      if (!userId || !pin || typeof pin !== 'string') {
        return res.status(400).json({ error: 'Missing userId or pin' });
      }

      const user = await storage.setSyncPin(parseInt(userId), pin);
      res.json(user);
    } catch (error) {
      console.error('Error setting sync pin:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Recalculate hold probabilities with historical data
  app.post('/api/recalculate-probabilities', async (req, res) => {
    try {
      const { bidPackageId, seniorityPercentile, seniorityNumber } = req.body;

      const parsedPercentile = Number(seniorityPercentile);
      if (!bidPackageId || seniorityPercentile === undefined || Number.isNaN(parsedPercentile)) {
        return res.status(400).json({ error: 'Missing or invalid required fields' });
      }
      const parsedSeniorityNumber =
        seniorityNumber === undefined ? undefined : Number(seniorityNumber);
      if (parsedSeniorityNumber !== undefined && Number.isNaN(parsedSeniorityNumber)) {
        return res.status(400).json({ error: 'Invalid seniorityNumber' });
      }

      // Awaited (not fire-and-forget): on serverless platforms the function
      // is killed once the response is sent, so a detached background task
      // never finishes. Serialized per bid package to avoid concurrent runs
      // racing each other's batch UPDATEs.
      await recalculateHoldProbabilitiesSerialized(
        bidPackageId,
        parsedPercentile,
        parsedSeniorityNumber
      );

      res.json({ success: true, message: 'Recalculation completed' });
    } catch (error) {
      console.error('Error recalculating hold probabilities:', error);
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
          process.env.NODE_ENV === 'development'
            ? (error as Error).message
            : undefined,
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
          process.env.NODE_ENV === 'development'
            ? (error as Error).message
            : undefined,
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
          process.env.NODE_ENV === 'development'
            ? (error as Error).message
            : undefined,
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
      const {
        sessionId,
        userId,
        bidPackageId,
        messageType,
        content,
        messageData,
      } = req.body;
      const savedMessage = await storage.saveChatMessage({
        sessionId,
        userId: typeof userId === 'number' ? userId : undefined,
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

  // List a pilot's past AI-coach conversation sessions, so a newly linked
  // device can see and reopen conversations started elsewhere.
  app.get('/api/chat-history/user/:userId/sessions', async (req, res) => {
    try {
      const userId = parseInt(req.params.userId);
      const sessions = await storage.getChatSessionsForUser(userId);
      res.json(sessions);
    } catch (error) {
      console.error('Error fetching chat sessions for user:', error);
      res.status(500).json({ message: 'Failed to fetch chat sessions' });
    }
  });

  // OpenAI Assistant API endpoint with hybrid token optimization
  app.post('/api/askAssistant', async (req, res) => {
    try {
      const { question, bidPackageId, seniorityPercentile, sessionId, userId } =
        req.body;

      if (!question || typeof question !== 'string') {
        return res.status(400).json({ message: 'Question is required' });
      }
      if (question.length > 4000) {
        return res.status(400).json({
          message: 'Question is too long — please ask something shorter.',
        });
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

          // Get conversation history if sessionId provided. Capped to the
          // most recent messages — sending an ever-growing full transcript
          // on every message balloons token usage and cost as a session goes on.
          let conversationHistory: any[] = [];
          const MAX_HISTORY_MESSAGES = 8;
          if (sessionId) {
            const history = await storage.getChatHistory(sessionId);
            conversationHistory = history
              .slice(-MAX_HISTORY_MESSAGES)
              .map(msg => ({
                role: msg.messageType === 'user' ? 'user' : 'assistant',
                content: msg.content,
              }));
          }

          const result = await simpleAI.query({
            message: question,
            bidPackageId: finalBidPackageId,
            userId: typeof userId === 'number' ? userId : undefined,
            seniorityPercentile:
              typeof seniorityPercentile === 'number'
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

  // Get unique layover locations for a bid package
  app.get('/api/layover-locations', async (req, res) => {
    try {
      const bidPackageId = parseInt(req.query.bidPackageId as string);

      if (!bidPackageId) {
        return res.status(400).json({ error: 'bidPackageId is required' });
      }

      const pairingsList = await db
        .select({ layovers: pairings.layovers })
        .from(pairings)
        .where(eq(pairings.bidPackageId, bidPackageId));

      const uniqueLocations = new Set<string>();

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
      console.error('Error fetching layover locations:', error);
      res.status(500).json({ error: 'Failed to fetch layover locations' });
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
            layovers: pairings.layovers,
            flightSegments: pairings.flightSegments,
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
