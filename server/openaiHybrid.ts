import OpenAI from 'openai';
import { DatabaseStorage } from './storage';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export interface HybridAnalysisQuery {
  message: string;
  bidPackageId: number;
}

export interface HybridAnalysisResponse {
  response: string;
  data?: any;
  truncated?: boolean;
}

/**
 * Hybrid OpenAI Service that implements token optimization by:
 * 1. Using backend functions to pre-process large datasets
 * 2. Sending only small JSON summaries to OpenAI
 * 3. Falling back to direct DB results for very large queries
 * 4. Implementing truncation awareness
 */
export class HybridOpenAIService {
  private storage: DatabaseStorage;
  private readonly TOKEN_LIMIT = 8000; // Conservative limit for GPT-4
  private readonly MAX_PAIRINGS_TO_SEND = 20; // Max pairings to include in OpenAI context

  constructor(storage: DatabaseStorage) {
    this.storage = storage;
  }

  /**
   * Analyze pilot queries using pre-processed summaries to avoid token limits
   */
  async analyzeQuery(query: HybridAnalysisQuery): Promise<HybridAnalysisResponse> {
    try {
      console.log('Starting hybrid analysis for query:', query.message.substring(0, 100));

      // Get bid package information for proper formatting
      let bidPackageInfo = null;
      if (query.bidPackageId) {
        try {
          const bidPackages = await this.storage.getBidPackages();
          bidPackageInfo = bidPackages.find(pkg => pkg.id === query.bidPackageId);
        } catch (error) {
          console.log('Could not fetch bid package info:', error);
        }
      }

      // Check if this is a large dataset request that should skip OpenAI
      if (this.shouldSkipOpenAI(query.message)) {
        console.log('Large dataset request detected, using direct DB fallback');
        return await this.handleLargeDatasetRequest(query);
      }

      // Pre-process data based on query intent
      const processedData = await this.preprocessDataForQuery(query);

      // Debug token estimation
      const dataString = JSON.stringify(processedData, null, 2);
      console.log(`Processed data length: ${dataString.length} chars`);
      console.log(`Processed data type: ${processedData.type}`);

      // Estimate token count
      const estimatedTokens = this.estimateTokens(processedData);
      if (estimatedTokens > this.TOKEN_LIMIT) {
        console.log(`Data too large (${estimatedTokens} tokens), using summary approach`);
        return await this.handleWithSummaryOnly(query);
      }

      // Call OpenAI with tool_calls (replaces deprecated function_call)
      const completion = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          { role: "system", content: this.getSystemPrompt(bidPackageInfo) },
          { role: "user", content: `${query.message}\n\nAvailable Data Summary:\n${dataString}` }
        ],
        tools: this.getAvailableFunctions(),
        max_tokens: 1000,
        temperature: 0.7
      });

      const response = completion.choices[0]?.message?.content;
      const toolCall = completion.choices[0]?.message?.tool_calls?.[0]?.function;

      if (toolCall) {
        console.log('Tool call requested:', toolCall.name);
        const functionResult = await this.handleFunctionCall(toolCall, query.bidPackageId);
        return functionResult;
      }

      if (!response) {
        throw new Error('No response from OpenAI');
      }

      return {
        response,
        data: processedData,
        truncated: processedData.truncated
      };

    } catch (error: unknown) {
      console.error('Hybrid analysis error:', error);

      if (error instanceof Error && error.message.includes('rate_limit_exceeded')) {
        throw new Error('OpenAI rate limit exceeded. Please try again shortly.');
      }

      if (error instanceof Error && error.message.includes('context_length_exceeded')) {
        console.log('Context length exceeded, falling back to summary approach');
        return await this.handleWithSummaryOnly(query);
      }

      throw new Error(`Failed to analyze query: ${(error as Error).message}`);
    }
  }

  private async preprocessDataForQuery(query: HybridAnalysisQuery): Promise<any> {
    const message = query.message.toLowerCase();

    // Extract pairing duration from the message FIRST (1-day, 2-day, etc.)
    const durationMatch = message.match(/(\d+)[-\s]?day/);
    const requestedDays = durationMatch ? parseInt(durationMatch[1]) : null;

    // Handle specific duration requests (1-day, 2-day, 3-day, 4-day, 5-day, etc.)
    if (requestedDays) {
      return await this.handleDurationSpecificQuery(query, requestedDays, message);
    }

    // Check for specific pairing number requests (only very explicit pairing requests)
    const pairingMatch = message.match(/(?:pairing|show\s+me\s+pairing)\s+#?(\d{4,5})/i) || 
                         message.match(/#(\d{4,5})/i) ||
                         (message.match(/\b(\d{4,5})\b/) && (message.includes('pairing') || message.match(/^(?:show\s+me\s+)?(\d{4,5})$/)));

    if (pairingMatch) {
      const pairingNumber = pairingMatch[1];
      const pairing = await this.storage.getPairingByNumber(pairingNumber, query.bidPackageId);

      if (pairing) {
        return {
          type: 'specific_pairing',
          pairing: {
            pairingNumber: pairing.pairingNumber,
            creditHours: pairing.creditHours.toString(),
            blockHours: pairing.blockHours.toString(),
            tafb: pairing.tafb,
            route: pairing.route,
            pairingDays: pairing.pairingDays,
            holdProbability: pairing.holdProbability,
            deadheads: pairing.deadheads,
            effectiveDates: pairing.effectiveDates,
            flightSegments: pairing.flightSegments,
            layovers: pairing.layovers,
            fullTextBlock: pairing.fullText
          },
          truncated: false
        };
      } else {
        return {
          type: 'pairing_not_found',
          pairingNumber,
          truncated: false
        };
      }
    }

    // Handle turn queries (1-day pairings)
    if (message.includes('turn') || message.includes('turns')) {
      return await this.handleDurationSpecificQuery(query, 1, message);
    }

    // Handle layover queries
    if (message.includes('layover') || message.includes('layovers')) {
      return await this.handleLayoverQuery(query, message);
    }

    // Handle multi-day queries without specific duration
    if (message.includes('multi-day') || message.includes('long trip')) {
      return await this.handleMultiDayQuery(query, message);
    }

    // Handle short trip queries
    if (message.includes('short trip') || message.includes('day trip')) {
      return await this.handleShortTripQuery(query, message);
    }

    if (message.includes('efficient') || message.includes('credit per block')) {
      const result = await this.storage.getTopEfficientPairings(query.bidPackageId, this.MAX_PAIRINGS_TO_SEND);
      return {
        type: 'efficiency_analysis',
        topPairings: result.pairings.map(p => ({
          pairingNumber: p.pairingNumber,
          creditHours: this.formatHours(parseFloat(p.creditHours.toString())),
          blockHours: this.formatHours(parseFloat(p.blockHours.toString())),
          efficiency: (parseFloat(p.creditHours.toString()) / parseFloat(p.blockHours.toString())).toFixed(2),
          holdProbability: p.holdProbability,
          pairingDays: p.pairingDays
        })),
        summaryStats: {
          totalPairings: result.stats.totalPairings,
          avgEfficiency: result.stats.avgEfficiency.toFixed(2),
          topEfficiency: result.stats.topEfficiency.toFixed(2),
          avgCredit: this.formatHours(parseFloat(result.stats.avgCredit.toString())),
          avgBlock: this.formatHours(parseFloat(result.stats.avgBlock.toString()))
        },
        truncated: result.pairings.length < result.stats.totalPairings
      };
    }

    const result = await this.storage.getPairingStatsSummary(query.bidPackageId);
    return {
      type: 'general_stats',
      summary: result,
      truncated: false
    };
  }

  private async handleDurationSpecificQuery(query: HybridAnalysisQuery, days: number, message: string): Promise<any> {
    const allPairings = await this.storage.getPairings(query.bidPackageId);

    // Filter for specific duration pairings
    const durationPairings = allPairings.filter(p => p.pairingDays === days);

    // Check for additional criteria
    let filteredPairings = durationPairings;
    const filterCriteria: any = { pairingDays: days };

    // Apply efficiency filter if mentioned
    if (message.includes('credit-to-block') || message.includes('efficient')) {
      const minEfficiency = this.extractEfficiencyThreshold(message);
      filteredPairings = filteredPairings.filter(p => {
        const creditHours = parseFloat(p.creditHours.toString());
        const blockHours = parseFloat(p.blockHours.toString());
        const efficiency = blockHours > 0 ? creditHours / blockHours : 0;
        return efficiency >= minEfficiency;
      });
      filterCriteria.minEfficiency = minEfficiency;
    }

    // Apply hold probability filter if mentioned
    if (message.includes('hold prob') || message.includes('senior') || message.includes('junior')) {
      const minHoldProb = this.extractHoldProbabilityThreshold(message);
      filteredPairings = filteredPairings.filter(p => {
        const holdProb = parseInt(p.holdProbability?.toString() || '0');
        return holdProb >= minHoldProb;
      });
      filterCriteria.minHoldProbability = minHoldProb;
    }

    // Sort by credit hours (or efficiency if efficiency filter applied)
    const sortedPairings = filteredPairings
      .sort((a, b) => {
        if (filterCriteria.minEfficiency) {
          const effA = parseFloat(a.creditHours.toString()) / parseFloat(a.blockHours.toString());
          const effB = parseFloat(b.creditHours.toString()) / parseFloat(b.blockHours.toString());
          return effB - effA;
        }
        return parseFloat(b.creditHours.toString()) - parseFloat(a.creditHours.toString());
      })
      .slice(0, this.MAX_PAIRINGS_TO_SEND);

    return {
      type: `duration_${days}day_analysis`,
      matchingPairings: sortedPairings.map(p => ({
        pairingNumber: p.pairingNumber,
        creditHours: this.formatHours(parseFloat(p.creditHours.toString())),
        blockHours: this.formatHours(parseFloat(p.blockHours.toString())),
        efficiency: (parseFloat(p.creditHours.toString()) / parseFloat(p.blockHours.toString())).toFixed(2),
        holdProbability: p.holdProbability,
        pairingDays: p.pairingDays,
        route: p.route,
        tafb: p.tafb,
        layovers: p.layovers
      })),
      filterCriteria,
      totalMatching: filteredPairings.length,
      totalSearched: allPairings.length,
      truncated: sortedPairings.length < filteredPairings.length
    };
  }

  private async handleMultiDayQuery(query: HybridAnalysisQuery, message: string): Promise<any> {
    const allPairings = await this.storage.getPairings(query.bidPackageId);

    // Filter for multi-day pairings (2+ days)
    const multiDayPairings = allPairings.filter(p => p.pairingDays >= 2);

    // Group by duration
    const groupedByDuration = multiDayPairings.reduce((acc, p) => {
      const key = `${p.pairingDays}day`;
      if (!acc[key]) acc[key] = [];
      acc[key].push(p);
      return acc;
    }, {} as any);

    // Get top pairings from each duration group
    const topFromEachDuration = Object.entries(groupedByDuration)
      .map(([duration, pairings]: [string, any]) => ({
        duration,
        count: pairings.length,
        topPairings: pairings
          .sort((a: any, b: any) => parseFloat(b.creditHours.toString()) - parseFloat(a.creditHours.toString()))
          .slice(0, 5)
      }));

    return {
      type: 'multi_day_analysis',
      durationBreakdown: topFromEachDuration,
      totalMultiDay: multiDayPairings.length,
      totalSearched: allPairings.length,
      truncated: false
    };
  }

  private async handleShortTripQuery(query: HybridAnalysisQuery, message: string): Promise<any> {
    const allPairings = await this.storage.getPairings(query.bidPackageId);

    // Filter for short trips (1-2 days)
    const shortTripPairings = allPairings.filter(p => p.pairingDays <= 2);

    const sortedPairings = shortTripPairings
      .sort((a, b) => parseFloat(b.creditHours.toString()) - parseFloat(a.creditHours.toString()))
      .slice(0, this.MAX_PAIRINGS_TO_SEND);

    return {
      type: 'short_trip_analysis',
      matchingPairings: sortedPairings.map(p => ({
        pairingNumber: p.pairingNumber,
        creditHours: this.formatHours(parseFloat(p.creditHours.toString())),
        blockHours: this.formatHours(parseFloat(p.blockHours.toString())),
        efficiency: (parseFloat(p.creditHours.toString()) / parseFloat(p.blockHours.toString())).toFixed(2),
        holdProbability: p.holdProbability,
        pairingDays: p.pairingDays,
        route: p.route,
        tafb: p.tafb
      })),
      filterCriteria: { maxPairingDays: 2 },
      totalMatching: shortTripPairings.length,
      totalSearched: allPairings.length,
      truncated: sortedPairings.length < shortTripPairings.length
    };
  }

  private async handleLayoverQuery(query: HybridAnalysisQuery, message: string): Promise<any> {
    const allPairings = await this.storage.getPairings(query.bidPackageId);

    // Extract city from query (DFW, ATL, etc.)
    const cityMatch = message.match(/\b([A-Z]{3})\b/);
    const targetCity = cityMatch ? cityMatch[1] : null;

    // Extract number of layovers requested (default to 10)
    const numberMatch = message.match(/(\d+)\s+(?:longest|top)/);
    const requestedCount = numberMatch ? parseInt(numberMatch[1]) : 10;

    // Extract minimum duration if specified
    const durationMatch = message.match(/(?:over|longer than|above)\s+(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)/);
    const minDuration = durationMatch ? parseFloat(durationMatch[1]) : 0;

    // Collect layovers from all pairings, filtering by city FIRST if specified
    const allLayovers: any[] = [];

    allPairings.forEach(pairing => {
      if (pairing.layovers && Array.isArray(pairing.layovers)) {
        pairing.layovers.forEach((layover: any) => {
          // STRICT city filtering - only include layovers in the specified city
          if (targetCity && layover.city !== targetCity) return;

          // Parse duration (handle both "18.43" and "18:43" formats)
          const durationStr = layover.duration?.toString() || '0';
          let durationHours = 0;

          if (durationStr.includes(':')) {
            // Handle "18:43" format
            const [hours, minutes] = durationStr.split(':').map(Number);
            durationHours = hours + (minutes / 60);
          } else if (durationStr.includes('.')) {
            // Handle "18.43" format (PBS format where .43 = 43 minutes)
            const [hours, minutes] = durationStr.split('.').map(Number);
            durationHours = hours + (minutes / 60);
          } else {
            // Handle whole hours
            durationHours = parseFloat(durationStr);
          }

          // Filter by minimum duration if specified
          if (durationHours >= minDuration) {
            allLayovers.push({
              city: layover.city,
              hotel: layover.hotel,
              duration: durationStr,
              durationHours: durationHours,
              pairingNumber: pairing.pairingNumber,
              creditHours: pairing.creditHours,
              holdProbability: pairing.holdProbability,
              route: pairing.route
            });
          }
        });
      }
    });

    // Sort by duration descending and take requested count
    const sortedLayovers = allLayovers
      .sort((a, b) => b.durationHours - a.durationHours)
      .slice(0, requestedCount);

    // Group by city for summary stats
    const cityStats = allLayovers.reduce((acc, layover) => {
      if (!acc[layover.city]) {
        acc[layover.city] = { count: 0, totalDuration: 0, avgDuration: 0 };
      }
      acc[layover.city].count++;
      acc[layover.city].totalDuration += layover.durationHours;
      return acc;
    }, {} as any);

    // Calculate averages
    Object.keys(cityStats).forEach(city => {
      cityStats[city].avgDuration = cityStats[city].totalDuration / cityStats[city].count;
    });

    return {
      type: 'layover_analysis',
      targetCity: targetCity,
      requestedCount: requestedCount,
      minDuration: minDuration,
      longestLayovers: sortedLayovers.map(layover => ({
        city: layover.city,
        hotel: layover.hotel,
        duration: layover.duration,
        durationHours: layover.durationHours.toFixed(2),
        pairingNumber: layover.pairingNumber,
        creditHours: this.formatHours(parseFloat(layover.creditHours.toString())),
        holdProbability: layover.holdProbability,
        route: layover.route
      })),
      cityStats: Object.entries(cityStats)
        .map(([city, stats]: [string, any]) => ({
          city,
          count: stats.count,
          avgDuration: stats.avgDuration.toFixed(2)
        }))
        .sort((a, b) => b.count - a.count),
      totalLayovers: allLayovers.length,
      totalPairings: allPairings.length,
      truncated: false
    };
  }

  private extractEfficiencyThreshold(message: string): number {
    const efficiencyMatch = message.match(/efficiency.*?(\d+\.?\d*)/);
    if (efficiencyMatch) return parseFloat(efficiencyMatch[1]);

    if (message.includes('credit-to-block') && message.includes('above')) {
      const aboveMatch = message.match(/above\s+(\d+\.?\d*)/);
      if (aboveMatch) return parseFloat(aboveMatch[1]);
    }

    return 1.2; // Default threshold
  }

  private extractHoldProbabilityThreshold(message: string): number {
    // Look for explicit hold probability percentages with proper context
    const holdMatch = message.match(/(?:at least|>=|>|with)\s*(\d+)%?\s*hold\s*prob/i);
    if (holdMatch) return parseInt(holdMatch[1]);

    // Fallback to seniority-based defaults
    if (message.includes('senior')) return 70;
    if (message.includes('junior')) return 30;

    return 75; // Default threshold
  }

  private async handleLargeDatasetRequest(query: HybridAnalysisQuery): Promise<HybridAnalysisResponse> {
    const allPairings = await this.storage.getPairings(query.bidPackageId);
    return {
      response: `Here are all ${allPairings.length} pairings directly from the DB.`,
      data: allPairings,
      truncated: false
    };
  }

  private async handleWithSummaryOnly(query: HybridAnalysisQuery): Promise<HybridAnalysisResponse> {
    const stats = await this.storage.getPairingStatsSummary(query.bidPackageId);
    return {
      response: `This dataset is large (${stats.totalPairings} pairings). Here's a summary:\n- Avg Credit: ${this.formatHours(+stats.avgCredit)}\n- Avg Block: ${this.formatHours(+stats.avgBlock)}\n- Avg Hold Probability: ${stats.avgHoldProbability.toFixed(1)}%`,
      data: stats,
      truncated: true
    };
  }

  private async handleFunctionCall(functionCall: any, bidPackageId: number): Promise<HybridAnalysisResponse> {
    const functionName: string = functionCall.name;
    const args = JSON.parse(functionCall.arguments || '{}');

    switch (functionName) {
      case 'getTopEfficientPairings':
        const efficientResult = await this.storage.getTopEfficientPairings(bidPackageId, args.limit || 20);

        // Generate detailed response with actual pairing data
        const topPairings = efficientResult.pairings.slice(0, 5);
        let response = `**Top 5 Most Efficient Pairings (Credit-to-Block Ratio):**\n\n`;

        topPairings.forEach((p: any, i: number) => {
          const efficiency = (parseFloat(p.creditHours.toString()) / parseFloat(p.blockHours.toString())).toFixed(2);
          response += `${i + 1}. **Pairing ${p.pairingNumber}** - ${efficiency} ratio\n`;
          response += `   • Credit: ${this.formatHoursDeltaPBS(parseFloat(p.creditHours.toString()))} | Block: ${this.formatHoursDeltaPBS(parseFloat(p.blockHours.toString()))}\n`;
          response += `   • ${p.pairingDays} days | Hold: ${p.holdProbability}% | Route: ${p.route?.substring(0, 50)}...\n\n`;
        });

        response += `**Summary Stats:**\n`;
        response += `• Average efficiency: ${efficientResult.stats.avgEfficiency.toFixed(2)}\n`;
        response += `• Top efficiency: ${efficientResult.stats.topEfficiency.toFixed(2)}\n`;
        response += `• Average credit: ${this.formatHoursDeltaPBS(parseFloat(efficientResult.stats.avgCredit.toString()))}\n`;
        response += `• Showing ${topPairings.length} of ${efficientResult.stats.totalPairings} pairings`;

        return {
          response: response,
          data: efficientResult,
          truncated: efficientResult.pairings.length < efficientResult.stats.totalPairings
        };

      case 'getPairingsByDuration':
        const allPairings = await this.storage.getPairings(bidPackageId);
        let durationPairings = allPairings.filter(p => p.pairingDays === args.days);

        // Apply additional filters if provided
        if (args.minEfficiency) {
          durationPairings = durationPairings.filter(p => {
            const creditHours = parseFloat(p.creditHours.toString());
            const blockHours = parseFloat(p.blockHours.toString());
            const efficiency = blockHours > 0 ? creditHours / blockHours : 0;
            return efficiency >= args.minEfficiency;
          });
        }

        if (args.minHoldProb) {
          durationPairings = durationPairings.filter(p => {
            const holdProb = parseInt(p.holdProbability?.toString() || '0');
            return holdProb >= args.minHoldProb;
          });
        }

        // Sort by credit hours descending
        const sortedPairings = durationPairings
          .sort((a, b) => parseFloat(b.creditHours.toString()) - parseFloat(a.creditHours.toString()))
          .slice(0, args.limit || 20);

        return {
          response: `Found ${durationPairings.length} ${args.days}-day pairings${args.minEfficiency ? ` with efficiency >= ${args.minEfficiency}` : ''}${args.minHoldProb ? ` and hold probability >= ${args.minHoldProb}%` : ''}.`,
          data: {
            pairings: sortedPairings,
            stats: {
              totalFound: durationPairings.length,
              totalSearched: allPairings.length,
              avgCredit: durationPairings.length > 0 ? durationPairings.reduce((sum, p) => sum + parseFloat(p.creditHours.toString()), 0) / durationPairings.length : 0
            }
          },
          truncated: sortedPairings.length < durationPairings.length
        };

      case 'getMultiDayAnalysis':
        return await this.getMultiDayAnalysis(args.limit || 10);

      case 'getPairingsByAirport':
        return await this.getPairingsByAirport(args);

      case 'analyzeAirportPairings':
        return await this.analyzeAirportPairings(args.airport, args.analysisType);

      default:
        throw new Error(`Unknown function: ${functionName}`);
    }
  }

  private shouldSkipOpenAI(message: string): boolean {
    return ['all pairings', 'full dataset', 'complete list'].some(pattern => message.toLowerCase().includes(pattern));
  }

  private estimateTokens(data: any): number {
    const jsonString = JSON.stringify(data);
    return Math.ceil(jsonString.length / 4); // Rough estimate: 1 token ≈ 4 chars
  }

  private formatHours(hours: number): string {
    // Handle HH.MM format (e.g., 28.19 = 28 hours 19 minutes)
    const hoursStr = hours.toString();
    if (hoursStr.includes('.')) {
      const [h, m] = hoursStr.split('.');
      return `${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
    }

    // Handle decimal hours format (e.g., 28.33 = 28 hours 20 minutes)
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
  }

  private formatHoursDeltaPBS(hours: number): string {
    // Return original Delta PBS format (28.19, 16.58)
    return hours.toString();
  }

  private getSystemPrompt(bidPackageInfo?: any): string {
    const bidPackageDisplay = bidPackageInfo ? 
      `${bidPackageInfo.base} ${bidPackageInfo.aircraft} ${bidPackageInfo.month} ${bidPackageInfo.year} Bid Package` :
      'the current bid package';

    return `You are a Delta PBS Bid Optimization Assistant. Analyze pilot pairing data and provide specific, actionable insights.

When providing analysis, refer to the bid package as "${bidPackageDisplay}" instead of using generic terms like "bid package #27".

When provided with pairing data:
- Always show the actual pairing numbers found
- Include key metrics like credit hours, block hours, efficiency ratios, and hold probabilities
- For layover analysis, show the city, hotel, duration, and associated pairing information
- If no pairings match the criteria, clearly state this
- For 4-day pairing requests, focus on the 4-day pairings specifically
- Provide practical bidding advice based on the data

CRITICAL FOR LAYOVER QUERIES:
- When a specific city is mentioned (e.g., "layovers in DFW"), ONLY show layovers in that exact city
- If the data is filtered for a specific city, confirm this in your response (e.g., "The longest layovers in DFW are:")
- Do not mix layovers from different cities when a specific city is requested
- If no layovers exist in the requested city, clearly state this

IMPORTANT: When displaying hours, use the exact Delta PBS format as provided in the data:
- Show credit hours like: "28.19 credit hours" (not "28 hours and 19 minutes")
- Show block hours like: "16.58 block hours" (not "16 hours and 58 minutes")
- For layover durations, show ONLY the original format from the bid package (e.g., "28.53 hours")
- Do NOT add decimal conversions or explanations in parentheses
- Match the exact format from the bid package data

Use the backend-processed summaries to provide accurate analysis within token limits.`;
  }

  private getAvailableFunctions(): any[] {
    return [
      {
        type: "function",
        function: {
          name: "getTopEfficientPairings",
          description: "Get top efficient pairings (credit-to-block ratio)",
          parameters: {
            type: "object",
            properties: {
              limit: { type: "number", description: "Max pairings to return" }
            }
          }
        }
      },
      {
        type: "function",
        function: {
          name: "getPairingsByDuration",
          description: "Get pairings by specific duration (1-day, 2-day, 3-day, 4-day, 5-day, etc.)",
          parameters: {
            type: "object",
            properties: {
              days: { type: "number", description: "Number of days (1, 2, 3, 4, 5, etc.)" },
              limit: { type: "number", description: "Max pairings to return" },
              minEfficiency: { type: "number", description: "Minimum credit-to-block ratio" },
              minHoldProb: { type: "number", description: "Minimum hold probability" }
            }
          }
        }
      },
      {
        type: "function",
        function: {
          name: "getMultiDayAnalysis",
          description: "Get analysis of all multi-day pairings (2+ days) grouped by duration",
          parameters: {
            type: "object",
            properties: {
              limit: { type: "number", description: "Max pairings per duration group" }
            }
          }
        }
      },
      {
        type: "function",
        function: {
          name: "getLayoverAnalysis",
          description: "Analyze layovers by city, duration, or find longest layovers",
          parameters: {
            type: "object",
            properties: {
              city: { type: "string", description: "3-letter airport code (e.g., DFW, ATL)" },
              count: { type: "number", description: "Number of layovers to return (default 10)" },
              minDuration: { type: "number", description: "Minimum layover duration in hours" }
            }
          }
        }
      },
            {
        type: "function",
        function: {
          name: "getPairingsByAirport",
          description: "Get pairings that start, end, or include a specific airport",
          parameters: {
            type: "object",
            properties: {
              startAirport: { type: "string", description: "3-letter airport code to search for pairings starting from" },
              endAirport: { type: "string", description: "3-letter airport code to search for pairings ending at" },
              includesAirport: { type: "string", description: "3-letter airport code to search for pairings including it" },
              minCreditHours: { type: "number", description: "Minimum credit hours for the pairings" },
              maxCreditHours: { type: "number", description: "Maximum credit hours for the pairings" },
              minHoldProb: { type: "number", description: "Minimum hold probability for the pairings" },
              limit: { type: "number", description: "Maximum number of pairings to return" }
            },
            required: []
          }
        }
      },
      {
        type: "function",
        function: {
          "name": "analyzeAirportPairings",
          "description": "Analyze pairings based on specific airport and the type of analysis (starts, ends, includes)",
          "parameters": {
            "type": "object",
            "properties": {
              "airport": {
                "type": "string",
                "description": "The 3-letter airport code for analysis"
              },
              "analysisType": {
                "type": "string",
                "enum": ["starts", "ends", "includes", "starts_and_ends"],
                "description": "The type of analysis to perform: 'starts', 'ends', 'includes', or 'starts_and_ends'"
              }
            },
            "required": ["airport", "analysisType"]
          }
        }
      }
    ];
  }

  private async getMultiDayAnalysis(limit: number = 10) {
    const allPairings = await this.storage.getPairings(this.bidPackageId);
    const multiDayPairings = allPairings.filter(p => p.pairingDays >= 2);

    // Group by duration
    const groupedByDuration = multiDayPairings.reduce((acc, p) => {
      const key = p.pairingDays;
      if (!acc[key]) acc[key] = [];
      acc[key].push(p);
      return acc;
    }, {} as any);

    // Get top pairings from each duration group
    const multiDayAnalysis = Object.entries(groupedByDuration)
      .map(([duration, pairings]: [string, any]) => ({
        duration: parseInt(duration),
        count: pairings.length,
        avgCredit: pairings.reduce((sum: number, p: any) => sum + parseFloat(p.creditHours), 0) / pairings.length,
        topPairings: pairings
          .sort((a: any, b: any) => parseFloat(b.creditHours) - parseFloat(a.creditHours))
          .slice(0, limit)
      }))
      .sort((a, b) => b.count - a.count);

    const totalPairings = allPairings.length;

    return {
      multiDayAnalysis,
      summary: `Analysis of ${totalPairings} multi-day pairings (2+ days) across ${Object.keys(multiDayAnalysis).length} duration categories`
    };
  }

  private async getPairingsByAirport(params: {
    startAirport?: string;
    endAirport?: string;
    includesAirport?: string;
    minCreditHours?: number;
    maxCreditHours?: number;
    minHoldProb?: number;
    limit?: number;
  }) {
    const allPairings = await this.storage.getPairings(this.bidPackageId);

    let filteredPairings = allPairings.filter(pairing => {
      let matches = true;

      if (params.startAirport) {
        matches = matches && pairing.route?.startsWith(params.startAirport.toUpperCase());
      }

      if (params.endAirport) {
        matches = matches && pairing.route?.endsWith(params.endAirport.toUpperCase());
      }

      if (params.includesAirport) {
        matches = matches && pairing.route?.includes(params.includesAirport.toUpperCase());
      }

      if (params.minCreditHours) {
        matches = matches && parseFloat(pairing.creditHours) >= params.minCreditHours;
      }

      if (params.maxCreditHours) {
        matches = matches && parseFloat(pairing.creditHours) <= params.maxCreditHours;
      }

      if (params.minHoldProb) {
        matches = matches && (pairing.holdProbability || 0) >= params.minHoldProb;
      }

      return matches;
    });

    const limit = params.limit || 20;
    const pairings = filteredPairings.slice(0, limit);

    return {
      pairings,
      totalFound: filteredPairings.length,
      totalShown: pairings.length,
      searchCriteria: {
        startAirport: params.startAirport,
        endAirport: params.endAirport,
        includesAirport: params.includesAirport,
        minCreditHours: params.minCreditHours,
        maxCreditHours: params.maxCreditHours,
        minHoldProb: params.minHoldProb
      }
    };
  }

  private async analyzeAirportPairings(airport: string, analysisType: string) {
    const allPairings = await this.storage.getPairings(this.bidPackageId);
    const airportCode = airport.toUpperCase();

    let matchingPairings = [];
    let description = "";

    switch (analysisType) {
      case 'starts':
        matchingPairings = allPairings.filter(p => p.route?.startsWith(airportCode));
        description = `pairings that start at ${airportCode}`;
        break;
      case 'ends':
        matchingPairings = allPairings.filter(p => p.route?.endsWith(airportCode));
        description = `pairings that end at ${airportCode}`;
        break;
      case 'includes':
        matchingPairings = allPairings.filter(p => p.route?.includes(airportCode));
        description = `pairings that include ${airportCode} anywhere in the route`;
        break;
      case 'starts_and_ends':
        matchingPairings = allPairings.filter(p => 
          p.route?.startsWith(airportCode) && p.route?.endsWith(airportCode)
        );
        description = `pairings that both start and end at ${airportCode}`;
        break;
      default:
        throw new Error(`Unknown analysis type: ${analysisType}`);
    }

    // Calculate statistics
    const totalMatching = matchingPairings.length;
    const totalPairings = allPairings.length;
    const percentage = ((totalMatching / totalPairings) * 100).toFixed(1);

    // Group by duration
    const durationGroups: { [key: number]: any[] } = {};
    matchingPairings.forEach(pairing => {
      const days = pairing.pairingDays || 0;
      if (!durationGroups[days]) durationGroups[days] = [];
      durationGroups[days].push(pairing);
    });

    // Calculate averages
    const avgCredit = matchingPairings.length > 0 
      ? (matchingPairings.reduce((sum, p) => sum + parseFloat(p.creditHours), 0) / matchingPairings.length).toFixed(1)
      : 0;

    const avgHoldProb = matchingPairings.length > 0
      ? (matchingPairings.reduce((sum, p) => sum + (p.holdProbability || 0), 0) / matchingPairings.length).toFixed(1)
      : 0;

    // Get best pairings (high credit and good hold probability)
    const goodPairings = matchingPairings
      .filter(p => parseFloat(p.creditHours) >= 15 && (p.holdProbability || 0) >= 0.6)
      .sort((a, b) => parseFloat(b.creditHours) - parseFloat(a.creditHours))
      .slice(0, 10);

    return {
      airport: airportCode,
      analysisType,
      description,
      totalMatching,
      totalPairings,
      percentage: `${percentage}%`,
      durationBreakdown: Object.keys(durationGroups).map(days => ({
        days: parseInt(days),
        count: durationGroups[parseInt(days)].length,
        percentage: ((durationGroups[parseInt(days)].length / totalMatching) * 100).toFixed(1) + '%'
      })).sort((a, b) => a.days - b.days),
      statistics: {
        avgCreditHours: avgCredit,
        avgHoldProbability: avgHoldProb + '%'
      },
      goodPairings: goodPairings.slice(0, 5), // Show top 5 good pairings
      summary: `Found ${totalMatching} ${description} out of ${totalPairings} total pairings (${percentage}%)`
    };
  }
}