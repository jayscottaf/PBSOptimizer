/**
 * Stage 3: Response Generation
 * Generates natural language responses using GPT-5
 * MUST only cite data from Stage 2 (cannot hallucinate)
 */

import OpenAI from 'openai';
import { AI_CONFIG } from './config';
import { getResponseGenerationPrompt } from './prompts';
import type { RankedPairing } from './rankingEngine';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Response Generator Service
 * Uses GPT-5 for high-quality conversational responses
 */
export class ResponseGenerator {
  /**
   * Generate natural language response explaining the data
   *
   * @param userQuery - Original user query
   * @param pairings - Retrieved pairings from database
   * @param rankingExplanation - Optional ranking explanation from Stage 2
   * @param enableCaching - Enable prompt caching for system prompts
   * @returns Natural language response
   */
  async generateResponse(
    userQuery: string,
    pairings: any[],
    rankingExplanation?: string,
    conversationHistory?: Array<{ role: string; content: string }>,
    enableCaching: boolean = AI_CONFIG.ENABLE_CACHING
  ): Promise<string> {
    try {
      // Prepare data description for the AI
      const dataDescription = this.prepareDataDescription(pairings, rankingExplanation);

      // Get response generation prompt
      const systemPrompt = getResponseGenerationPrompt(userQuery, dataDescription);

      // Build messages with optional caching
      const messages: any[] = [
        {
          role: 'system',
          content: systemPrompt,
          // Enable caching for system prompt (static, reused across queries)
          ...(enableCaching && { cache_control: { type: 'ephemeral' } }),
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
        content: `Generate a helpful response for this query: "${userQuery}"`,
      });

      // Create completion with caching support
      const completion = await openai.chat.completions.create({
        model: AI_CONFIG.MODELS.RESPONSE,
        temperature: AI_CONFIG.TEMPERATURES.RESPONSE,
        max_completion_tokens: AI_CONFIG.MAX_TOKENS.RESPONSE, // New models use max_completion_tokens
        messages,
      });

      const response = completion.choices[0]?.message?.content;
      if (!response) {
        throw new Error('No response from GPT-5');
      }

      console.log('[ResponseGenerator] Generated response length:', response.length);

      return response;
    } catch (error) {
      console.error('[ResponseGenerator] Error generating response:', error);
      return this.generateFallbackResponse(userQuery, pairings);
    }
  }

  /**
   * Prepare data description for AI
   * Limits data to prevent token overflow
   */
  private prepareDataDescription(pairings: any[], rankingExplanation?: string): string {
    let description = '';

    // Add pairing count
    description += `PAIRING COUNT: ${pairings.length} pairings found\n\n`;

    // Add ranking explanation if provided
    if (rankingExplanation) {
      description += `RANKING LOGIC:\n${rankingExplanation}\n\n`;
    }

    // Add pairing details (limit to prevent token overflow)
    const maxPairings = Math.min(pairings.length, AI_CONFIG.MAX_PAIRINGS_IN_CONTEXT);
    description += `PAIRING DATA (top ${maxPairings}):\n`;

    pairings.slice(0, maxPairings).forEach((p, index) => {
      description += `\n${index + 1}. Pairing ${p.pairingNumber}\n`;
      description += `   Credit: ${p.creditHours} hours\n`;
      description += `   Block: ${p.blockHours} hours\n`;
      description += `   TAFB: ${p.tafb}\n`;
      description += `   Days: ${p.pairingDays}\n`;
      description += `   Hold Probability: ${p.holdProbability}%\n`;

      if (p.route) {
        description += `   Route: ${p.route}\n`;
      }

      if (p.score !== undefined) {
        description += `   Score: ${p.score.toFixed(2)}\n`;
      }

      if (p.scoreBreakdown) {
        description += `   Score Breakdown: ${JSON.stringify(p.scoreBreakdown, null, 2)}\n`;
      }

      if (p.layovers && p.layovers.length > 0) {
        description += `   Layovers: ${p.layovers.map((l: any) => `${l.airport} (${l.duration})`).join(', ')}\n`;
      }
    });

    if (pairings.length > maxPairings) {
      description += `\n... and ${pairings.length - maxPairings} more pairings\n`;
    }

    return description;
  }

  /**
   * Generate fallback response when AI fails
   */
  private generateFallbackResponse(userQuery: string, pairings: any[]): string {
    if (pairings.length === 0) {
      return `I found 0 pairings matching your criteria for "${userQuery}". Try adjusting your filters or broadening your search.`;
    }

    let response = `I found ${pairings.length} pairings matching your criteria. `;

    // Show top 3 as basic fallback
    const top3 = pairings.slice(0, 3);
    response += 'Here are the top results:\n\n';

    top3.forEach((p, index) => {
      response += `${index + 1}. Pairing ${p.pairingNumber} - ${p.creditHours} credit hours, ${p.holdProbability}% hold probability\n`;
    });

    if (pairings.length > 3) {
      response += `\n... and ${pairings.length - 3} more pairings.`;
    }

    return response;
  }

  /**
   * Generate response for clarification needed
   */
  async generateClarificationResponse(clarificationQuestion: string): Promise<string> {
    return clarificationQuestion;
  }

  /**
   * Generate response for no data found
   */
  async generateNoDataResponse(userQuery: string, filters: any): Promise<string> {
    let response = `I found 0 pairings matching your criteria for "${userQuery}". `;

    const activeFilters = Object.entries(filters)
      .filter(([_, value]) => value !== undefined && value !== null)
      .map(([key, value]) => `${key}: ${value}`);

    if (activeFilters.length > 0) {
      response += `\n\nActive filters:\n${activeFilters.join('\n')}`;
      response += '\n\nTry:\n';
      response += '- Removing some filters\n';
      response += '- Adjusting numeric values (e.g., lower credit minimum)\n';
      response += '- Searching for a different trip length';
    } else {
      response += 'Try adding specific criteria like trip length, credit hours, or hold probability.';
    }

    return response;
  }
}
