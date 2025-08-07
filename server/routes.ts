import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { seedDatabase } from "./seedData";
import { pdfParser } from "./pdfParser";

import { openaiAssistant } from "./openaiAssistant";
import multer from "multer";
import { z } from "zod";
import { insertBidPackageSchema, insertPairingSchema } from "@shared/schema";

// Configure multer for file uploads
const upload = multer({
  dest: 'uploads/',
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

export async function registerRoutes(app: Express): Promise<Server> {

  // Seed database endpoint (development only)
  app.post("/api/seed", async (req, res) => {
    try {
      await seedDatabase();
      res.json({ success: true, message: "Database seeded successfully" });
    } catch (error) {
      console.error("Error seeding database:", error);
      res.status(500).json({ message: "Failed to seed database" });
    }
  });

  // Get all bid packages
  app.get("/api/bid-packages", async (req, res) => {
    try {
      const bidPackages = await storage.getBidPackages();
      res.json(bidPackages);
    } catch (error) {
      console.error("Error fetching bid packages:", error);
      res.status(500).json({ message: "Failed to fetch bid packages" });
    }
  });

  // Upload bid package PDF
  app.post("/api/upload", upload.single('bidPackage'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      const { name, month, year, base, aircraft } = req.body;

      // Delete all existing bid packages and their associated data
      const existingPackages = await storage.getBidPackages();
      if (existingPackages.length > 0) {
        console.log(`Removing ${existingPackages.length} existing bid packages before uploading new one`);
        await Promise.all(existingPackages.map(pkg => storage.deleteBidPackage(pkg.id)));
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
      pdfParser.parseFile(req.file.path, bidPackage.id, req.file.mimetype)
        .then(async () => {
          console.log(`File parsing completed for bid package ${bidPackage.id}`);
          await storage.updateBidPackageStatus(bidPackage.id, "completed");
        })
        .catch(async (error) => {
          console.error(`File parsing failed for bid package ${bidPackage.id}:`, error);
          await storage.updateBidPackageStatus(bidPackage.id, "failed");
        });

      res.json({
        success: true,
        bidPackage,
        message: "Bid package uploaded successfully. Processing has begun.",
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

  // Get pairings with optional filtering
  app.get("/api/pairings", async (req, res) => {
    try {
      const bidPackageId = req.query.bidPackageId ? parseInt(req.query.bidPackageId as string) : undefined;

      if (bidPackageId) {
        const pairings = await storage.getPairings(bidPackageId);
        res.json(pairings);
      } else {
        const pairings = await storage.getPairings();
        res.json(pairings);
      }
    } catch (error) {
      console.error("Error fetching pairings:", error);
      res.status(500).json({ message: "Failed to fetch pairings" });
    }
  });

  // Pairing search endpoint
  app.post("/api/pairings/search", async (req, res) => {
    try {
      const { bidPackageId, ...filters } = req.body;

      if (!bidPackageId) {
        console.log("No bid package ID provided in search request");
        return res.status(400).json({ message: "Bid package ID is required", pairings: [] });
      }

      console.log(`Searching pairings for bid package ${bidPackageId} with filters:`, filters);
      const pairings = await storage.searchPairings({ bidPackageId, ...filters });

      // Ensure we always return an array
      const safePairings = Array.isArray(pairings) ? pairings : [];
      console.log(`Found ${safePairings.length} pairings`);
      res.json(safePairings);
    } catch (error) {
      console.error("Error searching pairings:", error);
      res.status(500).json({ message: "Failed to search pairings", pairings: [] });
    }
  });

  // Get specific pairing details
  app.get("/api/pairings/:id", async (req, res) => {
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

  // Verify pairing by number endpoint
  app.get("/api/verify-pairing/:pairingNumber", async (req, res) => {
    try {
      const { pairingNumber } = req.params;
      const bidPackageId = req.query.bidPackageId ? parseInt(req.query.bidPackageId as string) : undefined;

      if (!bidPackageId) {
        const bidPackages = await storage.getBidPackages();
        if (bidPackages.length === 0) {
          return res.status(404).json({ message: "No bid packages found" });
        }
        // Use most recent bid package
        const recentBidPackage = bidPackages[0];
        const allPairings = await storage.getPairings(recentBidPackage.id);
        const pairing = allPairings.find(p => p.pairingNumber === pairingNumber);

        if (!pairing) {
          return res.status(404).json({ 
            message: "Pairing not found", 
            pairingNumber, 
            bidPackageId: recentBidPackage.id,
            totalPairings: allPairings.length,
            samplePairings: allPairings.slice(0, 10).map(p => p.pairingNumber)
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
        const pairing = allPairings.find(p => p.pairingNumber === pairingNumber);

        if (!pairing) {
          return res.status(404).json({ 
            message: "Pairing not found", 
            pairingNumber, 
            bidPackageId,
            totalPairings: allPairings.length,
            samplePairings: allPairings.slice(0, 10).map(p => p.pairingNumber)
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

  // Get bid history for a pairing
  app.get("/api/history/:pairingNumber", async (req, res) => {
    try {
      const { pairingNumber } = req.params;
      const history = await storage.getBidHistoryForPairing(pairingNumber);
      res.json(history);
    } catch (error) {
      console.error("Error fetching bid history:", error);
      res.status(500).json({ message: "Failed to fetch bid history" });
    }
  });

  // Create/update user
  app.post('/api/user', async (req, res) => {
    try {
      const { seniorityNumber, base, aircraft } = req.body;

      if (!seniorityNumber || !base || !aircraft) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      const user = await storage.createOrUpdateUser({
        seniorityNumber: parseInt(seniorityNumber),
        base,
        aircraft
      });

      res.json(user);
    } catch (error) {
      console.error('Error creating/updating user:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Add pairing to favorites
  app.post("/api/favorites", async (req, res) => {
    try {
      const { userId, pairingId } = req.body;
      const favorite = await storage.addUserFavorite({ userId, pairingId });
      res.json(favorite);
    } catch (error) {
      console.error("Error adding favorite:", error);
      res.status(500).json({ message: "Failed to add favorite" });
    }
  });

  // Remove pairing from favorites
  app.delete("/api/favorites", async (req, res) => {
    try {
      const { userId, pairingId } = req.body;
      await storage.removeUserFavorite(userId, pairingId);
      res.json({ success: true });
    } catch (error) {
      console.error("Error removing favorite:", error);
      res.status(500).json({ message: "Failed to remove favorite" });
    }
  });

  // Get user favorites
  app.get("/api/favorites/:userId", async (req, res) => {
    try {
      const userId = parseInt(req.params.userId);
      const favorites = await storage.getUserFavorites(userId);
      res.json(favorites);
    } catch (error) {
      console.error("Error fetching favorites:", error);
      res.status(500).json({ message: "Failed to fetch favorites" });
    }
  });

  // Calendar event endpoints
  app.post("/api/calendar", async (req, res) => {
    try {
      const { userId, pairingId, startDate, endDate, notes } = req.body;
      const event = await storage.addUserCalendarEvent({ 
        userId, 
        pairingId, 
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        notes 
      });
      res.json(event);
    } catch (error) {
      console.error("Error adding calendar event:", error);
      res.status(500).json({ message: "Failed to add calendar event" });
    }
  });

  // Remove pairing from calendar
  app.delete("/api/calendar", async (req, res) => {
    try {
      const { userId, pairingId } = req.body;
      await storage.removeUserCalendarEvent(userId, pairingId);
      res.json({ success: true });
    } catch (error) {
      console.error("Error removing calendar event:", error);
      res.status(500).json({ message: "Failed to remove calendar event" });
    }
  });

  // Get user calendar events
  app.get("/api/calendar/:userId", async (req, res) => {
    try {
      const userId = parseInt(req.params.userId);
      const { startDate, endDate } = req.query;
      
      if (startDate && endDate) {
        // Use date range query
        const events = await storage.getUserCalendarEventsInRange(
          userId, 
          new Date(startDate as string), 
          new Date(endDate as string)
        );
        res.json(events);
      } else {
        // Default query for all events
        const events = await storage.getUserCalendarEvents(userId);
        res.json(events);
      }
    } catch (error) {
      console.error("Error fetching calendar events:", error);
      res.status(500).json({ message: "Failed to fetch calendar events" });
    }
  });

  // Get user calendar events for specific month/year
  app.get("/api/calendar/:userId/:month/:year", async (req, res) => {
    try {
      const userId = parseInt(req.params.userId);
      const month = parseInt(req.params.month);
      const year = parseInt(req.params.year);
      const events = await storage.getUserCalendarEventsForMonth(userId, month, year);
      res.json(events);
    } catch (error) {
      console.error("Error fetching calendar events for month:", error);
      res.status(500).json({ message: "Failed to fetch calendar events for month" });
    }
  });

  // Chat history endpoints
  app.get("/api/chat-history/:sessionId", async (req, res) => {
    try {
      const { sessionId } = req.params;
      const history = await storage.getChatHistory(sessionId);
      res.json(history);
    } catch (error) {
      console.error("Error fetching chat history:", error);
      res.status(500).json({ message: "Failed to fetch chat history" });
    }
  });

  app.post("/api/chat-history", async (req, res) => {
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

  app.delete("/api/chat-history/:sessionId", async (req, res) => {
    try {
      const { sessionId } = req.params;
      await storage.clearChatHistory(sessionId);
      res.json({ success: true });
    } catch (error) {
      console.error("Error clearing chat history:", error);
      res.status(500).json({ message: "Failed to clear chat history" });
    }
  });

  // OpenAI Assistant API endpoint with hybrid token optimization
  app.post("/api/askAssistant", async (req, res) => {
    try {
      const { question, bidPackageId } = req.body;

      if (!question) {
        return res.status(400).json({ message: "Question is required" });
      }

      // Extract bidPackageId from question if it contains "bid package #25" pattern
      const bidPackageMatch = question.match(/bid package #(\d+)/);
      let finalBidPackageId = bidPackageId || (bidPackageMatch ? parseInt(bidPackageMatch[1]) : undefined);

      // If no bid package ID found, try to get the most recent one
      if (!finalBidPackageId) {
        const bidPackages = await storage.getBidPackages();
        if (bidPackages.length > 0) {
          finalBidPackageId = bidPackages[0].id;
          console.log(`Using most recent bid package ID: ${finalBidPackageId}`);
        }
      }

      // Try hybrid analysis service first (handles token limits)
      if (finalBidPackageId) {
        try {
          const { hybridService } = await import("./openai");
          const result = await hybridService.analyzeQuery({ 
            message: question, 
            bidPackageId: finalBidPackageId 
          });

          res.json({ 
            reply: result.response, 
            data: result.data,
            truncated: result.truncated 
          });
          return;
        } catch (hybridError) {
          console.log("Hybrid service failed, trying legacy analysis:", hybridError);

          // If it's a rate limit error, provide a specific message
          if (hybridError.message && hybridError.message.includes('rate_limit_exceeded')) {
            res.json({ 
              reply: "I'm experiencing high demand right now. Please try your question again in a moment, or try asking for more specific information to reduce the processing load."
            });
            return;
          }

          // If it's a token limit error, provide helpful guidance
          if (hybridError.message && hybridError.message.includes('context_length_exceeded')) {
            res.json({ 
              reply: "This query involves too much data to process at once. Please refine your search with more specific filters, such as:\n\n• 'Show me high credit 3-day pairings'\n• 'Find efficient turns with good hold probability'\n• 'Analyze layovers in DFW'\n\nThis will help me provide more detailed insights."
            });
            return;
          }

          // Try the legacy analysis service as fallback
          try {
            const { PairingAnalysisService } = await import("./openai");
            const analysisService = new PairingAnalysisService();
            const result = await analysisService.analyzeQuery({ 
              message: question, 
              bidPackageId: finalBidPackageId 
            }, storage);

            res.json({ reply: result.response, data: result.data });
            return;
          } catch (legacyError) {
            console.log("Legacy analysis also failed, falling back to basic assistant:", legacyError);
          }
        }
      }

      // Final fallback to basic assistant
      const reply = await openaiAssistant.askPBSAssistant(question);
      res.json({ reply });

    } catch (error) {
      console.error("Error asking PBS Assistant:", error);
      res.status(500).json({ message: "Failed to get response from PBS Assistant" });
    }
  });

  // Endpoint for bulk pairing creation (used by PDF parser)
  app.post("/api/pairings/bulk", async (req, res) => {
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
      await storage.updateBidPackageStatus(bidPackageId, "completed");

      res.json({
        success: true,
        count: createdPairings.length,
        pairings: createdPairings,
      });
    } catch (error) {
      console.error("Error creating bulk pairings:", error);
      res.status(500).json({ message: "Failed to create pairings" });
    }
  });

  // Database verification endpoint
  app.get("/api/verify-data", async (req, res) => {
    try {
      const bidPackages = await storage.getBidPackages();
      const verification = {};

      for (const bidPackage of bidPackages) {
        const pairings = await storage.getPairings(bidPackage.id);
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
            total: pairings.length,
            sample: pairings.slice(0, 5).map(p => ({
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
            hasPairings: pairings.length > 0,
            hasValidCreditHours: pairings.filter(p => p.creditHours > 0).length,
            hasValidBlockHours: pairings.filter(p => p.blockHours > 0).length,
            hasValidPairingNumbers: pairings.filter(p => p.pairingNumber && p.pairingNumber.length > 0).length,
            hasHoldProbabilities: pairings.filter(p => p.holdProbability !== null && p.holdProbability !== undefined).length
          }
        };
      }

      res.json({
        success: true,
        totalBidPackages: bidPackages.length,
        verification
      });
    } catch (error) {
      console.error("Error verifying data:", error);
      res.status(500).json({ message: "Failed to verify data" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}