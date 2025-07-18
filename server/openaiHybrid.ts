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
          { role: "system", content: this.getSystemPrompt() },
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

    // Check for specific pairing number requests first
    const pairingMatch = message.match(/pairing\s+#?(\d+)/i) || 
                         message.match(/show\s+me\s+#?(\d+)/i) || 
                         message.match(/#(\d+)/i) || 
                         message.match(/\b(\d{4})\b/i); // Match 4-digit numbers like 7758
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

    // Extract pairing duration from the message (1-day, 2-day, etc.)
    const durationMatch = message.match(/(\d+)[-\s]?day/);
    const requestedDays = durationMatch ? parseInt(durationMatch[1]) : null;

    // Handle specific duration requests (1-day, 2-day, 3-day, 4-day, 5-day, etc.)
    if (requestedDays) {
      return await this.handleDurationSpecificQuery(query, requestedDays, message);
    }

    // Handle turn queries (1-day pairings)
    if (message.includes('turn') || message.includes('turns')) {
      return await this.handleDurationSpecificQuery(query, 1, message);
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
    const holdMatch = message.match(/hold.*?(\d+)/);
    if (holdMatch) return parseInt(holdMatch[1]);
    
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
        return {
          response: `Top ${args.limit || 20} efficient pairings retrieved.`,
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
        const allPairingsForMulti = await this.storage.getPairings(bidPackageId);
        const multiDayPairings = allPairingsForMulti.filter(p => p.pairingDays >= 2);
        
        // Group by duration
        const groupedByDuration = multiDayPairings.reduce((acc, p) => {
          const key = p.pairingDays;
          if (!acc[key]) acc[key] = [];
          acc[key].push(p);
          return acc;
        }, {} as any);

        // Get top pairings from each duration group
        const analysisResults = Object.entries(groupedByDuration)
          .map(([duration, pairings]: [string, any]) => ({
            duration: parseInt(duration),
            count: pairings.length,
            avgCredit: pairings.reduce((sum: number, p: any) => sum + parseFloat(p.creditHours.toString()), 0) / pairings.length,
            topPairings: pairings
              .sort((a: any, b: any) => parseFloat(b.creditHours.toString()) - parseFloat(a.creditHours.toString()))
              .slice(0, args.limit || 5)
          }))
          .sort((a, b) => b.count - a.count);

        return {
          response: `Multi-day analysis complete. Found ${multiDayPairings.length} pairings across ${Object.keys(groupedByDuration).length} duration categories.`,
          data: {
            durationBreakdown: analysisResults,
            totalMultiDay: multiDayPairings.length,
            totalSearched: allPairingsForMulti.length
          },
          truncated: false
        };
      
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

  private getSystemPrompt(): string {
    return `You are a Delta PBS Bid Optimization Assistant. Analyze pilot pairing data and provide specific, actionable insights.

When provided with pairing data:
- Always show the actual pairing numbers found
- Include key metrics like credit hours, block hours, efficiency ratios, and hold probabilities
- If no pairings match the criteria, clearly state this
- For 4-day pairing requests, focus on the 4-day pairings specifically
- Provide practical bidding advice based on the data

IMPORTANT: When displaying hours, use the exact Delta PBS format as provided in the data:
- Show credit hours like: "28.19 credit hours" (not "28 hours and 19 minutes")
- Show block hours like: "16.58 block hours" (not "16 hours and 58 minutes")
- Match the exact decimal format from the bid package data

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
      }
    ];
  }
}
