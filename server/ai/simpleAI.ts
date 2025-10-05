/**
 * Simple AI - Works like ChatGPT web
 * No complex pipelines, just send the data and let GPT figure it out
 */

import OpenAI from 'openai';
import type { IStorage } from '../storage';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export interface SimpleAIQuery {
  message: string;
  bidPackageId: number;
  userId?: number;
  seniorityPercentile?: number;
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export interface SimpleAIResponse {
  response: string;
  pairingNumbers?: string[]; // Pairing numbers mentioned in response
}

/**
 * Simple AI that works like ChatGPT
 * Just send all the pairing data and let GPT analyze it
 */
export class SimpleAI {
  private storage: IStorage;

  constructor(storage: IStorage) {
    this.storage = storage;
  }

  /**
   * Main query method - works like ChatGPT
   */
  async query(query: SimpleAIQuery): Promise<SimpleAIResponse> {
    try {
      console.log('[SimpleAI] Processing query:', query.message);

      // Get ALL pairings for the bid package
      const pairings = await this.storage.searchPairings({
        bidPackageId: query.bidPackageId,
      });

      console.log(`[SimpleAI] Loaded ${pairings.length} pairings`);

      // Get bid package info for context
      const bidPackage = await this.storage.getBidPackage(query.bidPackageId);

      // Build the context with ALL pairing data
      const pairingsContext = this.buildPairingsContext(pairings);

      // Build system prompt
      const systemPrompt = this.buildSystemPrompt(bidPackage, query.seniorityPercentile);

      // Build messages
      const messages: any[] = [
        {
          role: 'system',
          content: systemPrompt,
        },
      ];

      // Add conversation history if provided
      if (query.conversationHistory && query.conversationHistory.length > 0) {
        messages.push(...query.conversationHistory);
      }

      // Add current query with pairing data
      messages.push({
        role: 'user',
        content: `${pairingsContext}\n\nUser Question: ${query.message}`,
      });

      console.log('[SimpleAI] Sending to GPT-4.1...');

      // Call GPT-4.1
      const completion = await openai.chat.completions.create({
        model: 'gpt-4.1',
        temperature: 0.7,
        max_completion_tokens: 2000,
        messages,
      });

      const response = completion.choices[0]?.message?.content || 'No response generated';

      console.log('[SimpleAI] Response generated');

      // Extract pairing numbers mentioned in the response
      const pairingNumbers = this.extractPairingNumbers(response);

      return {
        response,
        pairingNumbers,
      };
    } catch (error) {
      console.error('[SimpleAI] Error:', error);
      return {
        response: 'I encountered an error processing your request. Please try again.',
      };
    }
  }

  /**
   * Build compact context with all pairing data
   */
  private buildPairingsContext(pairings: any[]): string {
    const lines = ['AVAILABLE PAIRINGS:'];

    pairings.forEach((p) => {
      // Parse layovers
      const layovers = Array.isArray(p.layovers) ? p.layovers : [];
      const layoverInfo = layovers
        .map((l: any) => `${l.city} (${l.duration || 'unknown duration'})`)
        .join(', ');

      lines.push(
        `Pairing ${p.pairingNumber}: ${p.pairingDays}d | ${p.creditHours}cr | ${p.blockHours}blk | ${p.tafb} TAFB | ${p.holdProbability}% hold | Route: ${p.route}${layoverInfo ? ` | Layovers: ${layoverInfo}` : ''}`
      );
    });

    return lines.join('\n');
  }

  /**
   * Build system prompt with context
   */
  private buildSystemPrompt(bidPackage: any, seniorityPercentile?: number): string {
    const packageInfo = bidPackage
      ? `${bidPackage.month} ${bidPackage.year} - ${bidPackage.base} ${bidPackage.aircraft}`
      : 'Unknown package';

    const seniorityInfo = seniorityPercentile !== undefined
      ? `The pilot's seniority is ${seniorityPercentile}% (lower is more senior).`
      : '';

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
  private extractPairingNumbers(response: string): string[] {
    // Match pairing numbers (typically 4-5 digits)
    const matches = response.match(/\b\d{4,5}\b/g);
    return matches ? [...new Set(matches)] : [];
  }
}
