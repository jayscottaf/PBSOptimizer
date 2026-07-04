/**
 * Simple AI - Works like ChatGPT web
 * No complex pipelines, just send the data and let GPT figure it out
 */

import OpenAI from 'openai';
import type { IStorage } from '../storage';
import { buildBiddingCoachKnowledgeContext } from './biddingCoachKnowledge';
import { buildStrategyContext } from './reasonsMiner';
import { COACH_TOOL_DEFINITIONS, executeCoachTool } from './coachTools';

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

      // Personalization context: outcome statistics for pilots near the
      // user's seniority percentile, aggregated in SQL across every
      // imported Reasons Report period (96k+ rows — far too many to feed
      // into the prompt directly).
      let historyContext = '';
      try {
        if (bidPackage?.base) {
          const stats = await this.storage.getStrategyStats(
            bidPackage.base,
            query.seniorityPercentile ?? 50
          );
          historyContext = buildStrategyContext(stats);
        }
      } catch (error) {
        console.warn('[SimpleAI] Strategy history unavailable:', error);
      }

      // Build system prompt
      const systemPrompt = this.buildSystemPrompt(
        bidPackage,
        query.seniorityPercentile,
        historyContext
      );

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

      // Tool-calling loop: the coach may call simulate_bid / export_bid to
      // ground its draft before answering. Bounded rounds prevent runaway.
      const realWindow = bidPackage?.base
        ? await this.storage
            .getCategoryCreditWindow(bidPackage.base)
            .catch(() => null)
        : null;
      const base = bidPackage?.base;
      const toolContext = {
        pairings,
        alv: bidPackage?.alvHours
          ? parseFloat(String(bidPackage.alvHours))
          : undefined,
        threshold: realWindow?.threshold,
        windowMin: realWindow?.windowMin,
        windowMax: realWindow?.windowMax,
        windowSource: realWindow
          ? `the ${realWindow.period} Reasons Report`
          : undefined,
        fetchHistoricTrends: base
          ? (month?: string) => this.fetchHistoricTrendsDigest(base, month)
          : undefined,
      };
      const MAX_TOOL_ROUNDS = 4;
      let rawResponse = 'No response generated';

      for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
        const completion = await openai.chat.completions.create({
          model: 'gpt-4.1',
          temperature: 0.7,
          max_completion_tokens: 2000,
          messages,
          tools: COACH_TOOL_DEFINITIONS,
        });

        const choice = completion.choices[0]?.message;
        if (!choice) break;

        const toolCalls = choice.tool_calls;
        if (!toolCalls || toolCalls.length === 0 || round === MAX_TOOL_ROUNDS) {
          rawResponse = choice.content || rawResponse;
          break;
        }

        messages.push(choice);
        for (const call of toolCalls) {
          if (call.type !== 'function') continue;
          console.log(`[SimpleAI] Tool call: ${call.function.name}`);
          const result = await executeCoachTool(
            call.function.name,
            call.function.arguments,
            toolContext
          );
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify(result),
          });
        }
      }

      const response = this.sanitizeCoachResponse(rawResponse);

      console.log('[SimpleAI] Response generated');

      // Extract pairing numbers mentioned in the response
      const pairingNumbers = this.extractPairingNumbers(response);

      return {
        response,
        pairingNumbers,
      };
    } catch (error) {
      console.error('[SimpleAI] Error:', error);
      // Rethrow (don't swallow): the caller classifies rate-limit /
      // context-length errors into specific user-facing messages, and a
      // caught-here-and-returned generic string made that dead code.
      throw error;
    }
  }

  /**
   * Backs the coach's query_historic_trends tool. Pulls the same numbers
   * the Trends/Bid Patterns pages show, condensed to a compact digest so a
   * tool-call round trip doesn't blow up the token budget.
   */
  private async fetchHistoricTrendsDigest(
    base: string,
    month?: string
  ): Promise<object> {
    const [trends, patterns] = await Promise.all([
      this.storage.getTrendsSummary(base, month),
      this.storage.getBidPatterns(base, month),
    ]);

    if (trends.periods.length === 0) {
      return {
        month: month ?? null,
        message: month
          ? `No imported Reasons Report data for ${month} specifically — try omitting the month for the full multi-year picture.`
          : 'No Reasons Report history imported yet for this category.',
      };
    }

    const avgLostToSenior =
      trends.periods.reduce((s, p) => s + p.lostToSenior / p.totalPrefs, 0) /
      trends.periods.length;
    const avgPrefsPerPilot =
      patterns.typeMixByPeriod.reduce((s, p) => s + p.avgPrefsPerPilot, 0) /
      Math.max(1, patterns.typeMixByPeriod.length);

    const boundariesByDays = new Map<number, number[]>();
    for (const b of trends.holdBoundaries) {
      if (b.juniorMostPercentile === null) continue;
      if (!boundariesByDays.has(b.pairingDays)) {
        boundariesByDays.set(b.pairingDays, []);
      }
      boundariesByDays.get(b.pairingDays)!.push(b.juniorMostPercentile);
    }
    const holdBoundariesByTripLength = [...boundariesByDays.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([days, pcts]) => ({
        pairingDays: days,
        minPercentile: Math.round(Math.min(...pcts)),
        maxPercentile: Math.round(Math.max(...pcts)),
      }));

    return {
      month: month ?? null,
      periodsCovered: trends.periods.length,
      spanningYears: [...new Set(trends.periods.map(p => p.period.split(' ')[1]))]
        .sort(),
      avgPctPreferencesLostToSeniorBidders: Math.round(avgLostToSenior * 100),
      avgPreferencesPerPilot: Math.round(avgPrefsPerPilot),
      holdBoundariesByTripLength,
      topRequestedLayovers: patterns.topRequestedLayovers.slice(0, 5),
      topAvoidedLayovers: patterns.topAvoidedLayovers.slice(0, 5),
      preferredCheckInHours: patterns.earlyCheckInAvoidance
        .slice()
        .sort((a, b) => b.count - a.count)
        .slice(0, 3)
        .map(h => h.hour),
      mostCommonConsecutiveDaysOff: patterns.daysOffPatterns
        .slice()
        .sort((a, b) => b.count - a.count)
        .slice(0, 3)
        .map(d => d.days),
      creditWindow: trends.window,
    };
  }

  /**
   * Build compact context with all pairing data
   */
  private buildPairingsContext(pairings: any[]): string {
    const lines = ['AVAILABLE PAIRINGS:'];

    pairings.forEach(p => {
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
  private buildSystemPrompt(
    bidPackage: any,
    seniorityPercentile?: number,
    historyContext = ''
  ): string {
    const packageInfo = bidPackage
      ? `${bidPackage.month} ${bidPackage.year} - ${bidPackage.base} ${bidPackage.aircraft}`
      : 'Unknown package';

    const seniorityInfo =
      seniorityPercentile !== undefined
        ? `The pilot's seniority is ${seniorityPercentile}% (lower is more senior).`
        : '';

    const coachKnowledge = buildBiddingCoachKnowledgeContext();

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
- Layover: Overnight stay at an away station between duty days (city and duration shown in the data)

${coachKnowledge}

${historyContext}

TOOLS YOU CAN CALL:
- simulate_bid: evaluate a structured draft bid against this bid package. Returns predicted awards with hold probabilities, credit totals, and explicit caveats.
- export_bid: render a draft bid to review-ready NAVBLUE text with structure warnings.
- query_historic_trends: look up real historic data mined from every imported Reasons Report period — category competitiveness, how junior each trip length has gone, bid complexity, top requested/avoided layover cities, preferred check-in hour, common days-off request length. Pass a 3-letter month (e.g. "AUG") to compare a specific calendar month the pilot may be about to bid against the multi-year average, or omit it for the full picture. Call this whenever the pilot asks about trends, seasons, competitiveness, or "how did this month do historically" instead of guessing or relying only on the fixed seniority-band summary above.
When the pilot wants a bid drafted: interview briefly if goals are unclear, construct the DraftBid JSON (negatives BEFORE awards, specific before general, exits in every group except the last, reserve group last), call simulate_bid, refine if the result is weak (empty awards, incomplete line, inert preferences), then call export_bid and present the final text inside a code block along with the simulation summary and its caveats. Never present a draft you have not simulated.

Be helpful, analyze the data thoroughly, and give specific recommendations with pairing numbers.`;
  }

  /**
   * Keep Phase 0 bidding-coach output aligned with the product boundary even
   * when the model drifts into overconfident phrasing.
   */
  private sanitizeCoachResponse(response: string): string {
    const sanitized = response
      .replace(/\bEnsures that if\b/g, 'Sets up the fallback so if')
      .replace(/\bensures that if\b/g, 'sets up the fallback so if')
      .replace(/\bEnsures PBS can build\b/g, 'Helps PBS build')
      .replace(/\bensures PBS can build\b/g, 'helps PBS build')
      .replace(/\bEnsures PBS builds\b/g, 'Helps PBS build')
      .replace(/\bensures PBS builds\b/g, 'helps PBS build')
      .replace(/\bEnsures PBS moves\b/g, 'Lets PBS move')
      .replace(/\bensures PBS moves\b/g, 'lets PBS move')
      .replace(/\bEnsures you can\b/g, 'Improves your chance to')
      .replace(/\bensures you can\b/g, 'improves your chance to')
      .replace(/\bEnsures\b/g, 'Helps')
      .replace(/\bensures\b/g, 'helps')
      .replace(/\bwill still get\b/gi, 'may still be considered for')
      .replace(/\bguarantees that\b/gi, 'makes it more likely that')
      .replace(/\bGuarantees\b/g, 'Improves the odds of')
      .replace(/\bguarantees\b/g, 'improves the odds of')
      .replace(/(?<!\bnot\s)(?<!\bnever\s)(?<!\bno\s)\bguaranteed\b/gi, 'likely')
      .replace(/\byou'll get\b/gi, 'you may get')
      .replace(/\bwill get\b/gi, 'may get')
      .replace(/\bwill be awarded\b/gi, 'may be awarded')
      .replace(/\bwill hold\b/gi, 'should have a good chance to hold')
      .replace(/\bLocks in\b/g, 'Aims to secure')
      .replace(/\blocks in\b/g, 'aims to secure')
      .replace(/\bcopy-and-paste-ready\b/gi, 'review-ready')
      .replace(/\bcopy paste ready\b/gi, 'review-ready');

    const looksLikeBidDraft =
      /\b(NAVBLUE|Prefer Off|Award Pairings|Bid Group)\b/i.test(sanitized);
    const alreadyHasGuaranteeNote =
      /\b(no guarantee|not guaranteed|not a guarantee|no result is guaranteed)\b/i.test(
        sanitized
      );

    if (looksLikeBidDraft && !alreadyHasGuaranteeNote) {
      return `${sanitized}\n\nNote: This is a review-ready starting draft, not a guarantee of an award, day off, or pairing result.`;
    }

    return sanitized;
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
