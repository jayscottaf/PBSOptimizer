/**
 * Stage 1: Intent Extraction
 * Extracts structured intent from natural language queries using AI
 */

import OpenAI from 'openai';
import { AI_CONFIG } from './config';
import { getIntentExtractionPrompt } from './prompts';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Extracted intent structure
 */
export interface ExtractedIntent {
  filters: {
    pairingNumber?: string;
    pairingDays?: number;
    pairingDaysMin?: number;
    pairingDaysMax?: number;
    creditMin?: number;
    creditMax?: number;
    blockMin?: number;
    blockMax?: number;
    holdProbabilityMin?: number;
    efficiency?: number;
    city?: string;
    tafbMin?: number;
    tafbMax?: number;
  };
  ranking?: 'credit' | 'efficiency' | 'hold_probability' | 'overall' | null;
  limit?: number | null;
  needsClarification: boolean;
  clarificationQuestion?: string;
}

/**
 * Intent Extractor Service
 * Uses o4-mini with low temperature for consistent JSON extraction
 */
export class IntentExtractor {
  /**
   * Extract structured intent from user query
   *
   * @param query - Natural language query from user
   * @param conversationHistory - Previous conversation messages for context
   * @returns Extracted intent with filters and ranking preferences
   */
  async extractIntent(
    query: string,
    conversationHistory?: Array<{ role: string; content: string }>
  ): Promise<ExtractedIntent> {
    try {
      const systemPrompt = getIntentExtractionPrompt();

      // Build messages with caching for system prompt
      const messages: any[] = [
        {
          role: 'system',
          content: systemPrompt,
          // Enable caching for system prompt (reused across all intent extractions)
          ...(AI_CONFIG.ENABLE_CACHING && { cache_control: { type: 'ephemeral' } }),
        },
      ];

      // Add conversation history if provided (for context)
      if (conversationHistory && conversationHistory.length > 0) {
        // Only include last 4 messages to avoid token bloat
        const recentHistory = conversationHistory.slice(-4);
        messages.push(...recentHistory);
      }

      // Add current query
      messages.push({
        role: 'user',
        content: query,
      });

      const completion = await openai.chat.completions.create({
        model: AI_CONFIG.MODELS.INTENT,
        // o4-mini doesn't support custom temperature - omit to use default
        max_completion_tokens: AI_CONFIG.MAX_TOKENS.INTENT,
        response_format: { type: 'json_object' }, // Force JSON output
        messages,
      });

      const content = completion.choices[0]?.message?.content;
      if (!content) {
        throw new Error('No response from intent extraction');
      }

      // Parse JSON response
      const intent = JSON.parse(content) as ExtractedIntent;

      // Validate required fields
      if (typeof intent.needsClarification !== 'boolean') {
        throw new Error('Invalid intent response: missing needsClarification');
      }

      // If needs clarification but no question provided, generate default
      if (intent.needsClarification && !intent.clarificationQuestion) {
        intent.clarificationQuestion =
          'Could you provide more details about what you\'re looking for? (e.g., trip length, credit hours, hold probability)';
      }

      // Log intent for debugging
      console.log('[IntentExtractor] Extracted intent:', JSON.stringify(intent, null, 2));

      return intent;
    } catch (error) {
      console.error('[IntentExtractor] Error extracting intent:', error);

      // Return a safe fallback intent
      return {
        filters: {},
        ranking: null,
        limit: null,
        needsClarification: true,
        clarificationQuestion:
          'I had trouble understanding your query. Could you rephrase it? (e.g., "show me 4-day pairings" or "high credit trips for senior pilots")',
      };
    }
  }

  /**
   * Validate that intent has at least some criteria
   * If completely empty, it needs clarification
   */
  private validateIntent(intent: ExtractedIntent): boolean {
    const hasFilters = Object.keys(intent.filters).length > 0;
    const hasRanking = intent.ranking !== null && intent.ranking !== undefined;
    return hasFilters || hasRanking;
  }

  /**
   * Convert extracted intent to storage query parameters
   * Maps AI-extracted intent to database query format
   */
  convertToStorageQuery(intent: ExtractedIntent): any {
    const query: any = {};

    // Copy all filters, with special handling for certain fields
    Object.entries(intent.filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        // Map city and pairingNumber filters to search parameter
        if (key === 'city' || key === 'pairingNumber') {
          query.search = value;
        } else {
          query[key] = value;
        }
      }
    });

    // Add sorting if ranking is specified
    if (intent.ranking) {
      switch (intent.ranking) {
        case 'credit':
          query.sortBy = 'creditHours';
          query.sortOrder = 'desc';
          break;
        case 'efficiency':
          query.sortBy = 'creditBlockRatio';
          query.sortOrder = 'desc';
          break;
        case 'hold_probability':
          query.sortBy = 'holdProbability';
          query.sortOrder = 'desc';
          break;
        case 'overall':
          // For overall, we'll use the ranking engine to compute scores
          query.sortBy = 'overall';
          query.sortOrder = 'desc';
          break;
      }
    }

    return query;
  }
}
