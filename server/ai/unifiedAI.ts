/**
 * Unified AI Service
 * Orchestrates the 3-stage pipeline for PBS query analysis
 *
 * Stage 1: Intent Extraction (o4-mini) → Extract structured intent from natural language
 * Stage 2: Data Retrieval (PostgreSQL) → Fetch real pairing data + deterministic ranking
 * Stage 3: Response Generation (GPT-5) → Generate conversational explanation
 */

import { IntentExtractor } from './intentExtractor';
import { PairingRankingEngine, type RankingCriteria } from './rankingEngine';
import { ResponseGenerator } from './responseGenerator';
import type { IStorage } from '../storage';

/**
 * Query input
 */
export interface AIQuery {
  message: string;
  bidPackageId: number;
  seniorityPercentile?: number;
  conversationHistory?: Array<{ role: string; content: string }>;
}

/**
 * AI Response
 */
export interface AIResponse {
  response: string;
  data?: any[];
  intent?: any;
  requiresClarification?: boolean;
  truncated?: boolean;
}

/**
 * Unified AI Service
 * Single entry point for all AI chat functionality
 */
export class UnifiedAI {
  private intentExtractor: IntentExtractor;
  private responseGenerator: ResponseGenerator;
  private storage: IStorage;

  constructor(storage: IStorage) {
    this.storage = storage;
    this.intentExtractor = new IntentExtractor();
    this.responseGenerator = new ResponseGenerator();
  }

  /**
   * Main analysis method
   * Orchestrates all 3 stages of the pipeline
   *
   * @param query - User query with bid package context
   * @returns AI response with data and explanation
   */
  async analyzeQuery(query: AIQuery): Promise<AIResponse> {
    try {
      console.log('[UnifiedAI] Analyzing query:', query.message);

      // ========== STAGE 1: Intent Extraction ==========
      console.log('[UnifiedAI] Stage 1: Extracting intent...');
      const intent = await this.intentExtractor.extractIntent(
        query.message,
        query.conversationHistory
      );

      // Handle clarification requests
      if (intent.needsClarification) {
        console.log('[UnifiedAI] Clarification needed:', intent.clarificationQuestion);
        return {
          response: intent.clarificationQuestion || 'Could you provide more details?',
          intent,
          requiresClarification: true,
        };
      }

      // ========== STAGE 2: Data Retrieval & Ranking ==========
      console.log('[UnifiedAI] Stage 2: Retrieving data...');

      // Convert intent to storage query
      const storageQuery = this.intentExtractor.convertToStorageQuery(intent);
      storageQuery.bidPackageId = query.bidPackageId;

      // Fetch pairings from database
      let pairings = await this.storage.searchPairings(storageQuery);

      console.log(`[UnifiedAI] Found ${pairings.length} pairings`);

      // Handle no results
      if (pairings.length === 0) {
        const noDataResponse = await this.responseGenerator.generateNoDataResponse(
          query.message,
          intent.filters
        );
        return {
          response: noDataResponse,
          data: [],
          intent,
        };
      }

      // Apply deterministic ranking if needed
      let rankingExplanation: string | undefined;

      if (intent.ranking && intent.ranking !== 'overall') {
        // Simple ranking (credit, efficiency, hold_probability)
        pairings = PairingRankingEngine.rankPairings(
          pairings,
          intent.ranking as RankingCriteria,
          query.seniorityPercentile
        );
        rankingExplanation = PairingRankingEngine.generateRankingExplanation(
          pairings,
          intent.ranking as RankingCriteria,
          intent.limit || 10
        );
      } else if (intent.ranking === 'overall') {
        // Composite ranking with weighted scoring
        pairings = PairingRankingEngine.rankPairings(
          pairings,
          'overall',
          query.seniorityPercentile
        );
        rankingExplanation = PairingRankingEngine.generateRankingExplanation(
          pairings,
          'overall',
          intent.limit || 10
        );
      }

      // Apply limit if specified (only truncate if user explicitly requests a limit)
      const limit = intent.limit || pairings.length; // Default to all pairings
      const truncated = pairings.length > limit;
      const displayPairings = pairings.slice(0, limit);

      console.log(`[UnifiedAI] Returning ${displayPairings.length} pairings (truncated: ${truncated})`);

      // ========== STAGE 3: Response Generation ==========
      console.log('[UnifiedAI] Stage 3: Generating response...');
      const response = await this.responseGenerator.generateResponse(
        query.message,
        displayPairings,
        rankingExplanation,
        query.conversationHistory
      );

      return {
        response,
        data: displayPairings,
        intent,
        truncated,
      };
    } catch (error) {
      console.error('[UnifiedAI] Error in analysis pipeline:', error);

      // Return safe fallback response
      return {
        response:
          'I encountered an error processing your query. Please try rephrasing or simplifying your request.',
        data: [],
      };
    }
  }

  /**
   * Analyze specific pairing by number
   */
  async analyzePairing(pairingNumber: string, bidPackageId: number): Promise<AIResponse> {
    try {
      const pairing = await this.storage.getPairingByNumber(pairingNumber, bidPackageId);

      if (!pairing) {
        return {
          response: `I couldn't find pairing ${pairingNumber} in the current bid package.`,
          data: [],
        };
      }

      // Generate detailed explanation for this pairing
      const response = await this.responseGenerator.generateResponse(
        `Tell me about pairing ${pairingNumber}`,
        [pairing]
      );

      return {
        response,
        data: [pairing],
      };
    } catch (error) {
      console.error('[UnifiedAI] Error analyzing pairing:', error);
      return {
        response: `Error retrieving pairing ${pairingNumber}.`,
        data: [],
      };
    }
  }

  /**
   * Compare multiple pairings
   */
  async comparePairings(pairingNumbers: string[], bidPackageId: number): Promise<AIResponse> {
    try {
      const pairings = await Promise.all(
        pairingNumbers.map(num => this.storage.getPairingByNumber(num, bidPackageId))
      );

      const validPairings = pairings.filter((p): p is NonNullable<typeof p> => p !== null);

      if (validPairings.length === 0) {
        return {
          response: `I couldn't find any of the specified pairings.`,
          data: [],
        };
      }

      // Generate comparison
      const response = await this.responseGenerator.generateResponse(
        `Compare these pairings: ${pairingNumbers.join(', ')}`,
        validPairings
      );

      return {
        response,
        data: validPairings,
      };
    } catch (error) {
      console.error('[UnifiedAI] Error comparing pairings:', error);
      return {
        response: 'Error comparing pairings.',
        data: [],
      };
    }
  }
}
