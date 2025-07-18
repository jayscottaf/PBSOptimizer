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
      
      // Check if the processed data is still too large
      const estimatedTokens = this.estimateTokens(processedData);
      if (estimatedTokens > this.TOKEN_LIMIT) {
        console.log(`Processed data still too large (${estimatedTokens} tokens), using summary approach`);
        return await this.handleWithSummaryOnly(query, processedData);
      }

      // Send to OpenAI with function calling capabilities
      const completion = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          {
            role: "system",
            content: this.getSystemPrompt()
          },
          {
            role: "user",
            content: `${query.message}

Available Data Summary:
${JSON.stringify(processedData, null, 2)}`
          }
        ],
        functions: this.getAvailableFunctions(),
        max_tokens: 1000,
        temperature: 0.7
      });

      const response = completion.choices[0]?.message?.content;
      const functionCall = completion.choices[0]?.message?.function_call;

      if (functionCall) {
        console.log('Function call requested:', functionCall.name);
        const functionResult = await this.handleFunctionCall(functionCall, query.bidPackageId);
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

    } catch (error) {
      console.error('Hybrid analysis error:', error);
      
      // Handle specific error types
      if (error.message?.includes('rate_limit_exceeded')) {
        throw new Error('OpenAI rate limit exceeded. Please try again in a moment.');
      }
      
      if (error.message?.includes('context_length_exceeded')) {
        console.log('Context length exceeded, falling back to summary approach');
        return await this.handleWithSummaryOnly(query, { truncated: true });
      }

      throw new Error(`Failed to analyze query: ${error.message}`);
    }
  }

  /**
   * Pre-process data based on query intent to create compact summaries
   */
  private async preprocessDataForQuery(query: HybridAnalysisQuery): Promise<any> {
    const message = query.message.toLowerCase();
    
    // Identify query intent and get appropriate summary data
    if (message.includes('efficient') || message.includes('best ratio') || message.includes('credit per block') || message.includes('most efficient')) {
      const result = await this.storage.getTopEfficientPairings(query.bidPackageId, this.MAX_PAIRINGS_TO_SEND);
      return {
        type: 'efficiency_analysis',
        topPairings: result.pairings.map(p => ({
          pairingNumber: p.pairingNumber,
          creditHours: this.formatHours(p.creditHours),
          blockHours: this.formatHours(p.blockHours),
          efficiency: (p.creditHours / p.blockHours).toFixed(2),
          holdProbability: p.holdProbability,
          pairingDays: p.pairingDays
        })),
        summaryStats: {
          totalPairings: result.stats.totalPairings,
          avgEfficiency: result.stats.avgEfficiency.toFixed(2),
          topEfficiency: result.stats.topEfficiency.toFixed(2),
          avgCredit: this.formatHours(result.stats.avgCredit),
          avgBlock: this.formatHours(result.stats.avgBlock)
        },
        truncated: result.pairings.length < result.stats.totalPairings
      };
    }

    if (message.includes('high credit') || message.includes('most credit') || message.includes('top pay')) {
      const result = await this.storage.getTopCreditPairings(query.bidPackageId, this.MAX_PAIRINGS_TO_SEND);
      return {
        type: 'credit_analysis',
        topPairings: result.pairings.map(p => ({
          pairingNumber: p.pairingNumber,
          creditHours: this.formatHours(p.creditHours),
          blockHours: this.formatHours(p.blockHours),
          holdProbability: p.holdProbability,
          pairingDays: p.pairingDays
        })),
        summaryStats: {
          totalPairings: result.stats.totalPairings,
          maxCredit: this.formatHours(result.stats.maxCredit),
          avgCredit: this.formatHours(result.stats.avgCredit),
          minCredit: this.formatHours(result.stats.minCredit)
        },
        truncated: result.pairings.length < result.stats.totalPairings
      };
    }

    if (message.includes('hold') || message.includes('probability') || message.includes('likely to get')) {
      const result = await this.storage.getTopHoldProbabilityPairings(query.bidPackageId, this.MAX_PAIRINGS_TO_SEND);
      return {
        type: 'hold_probability_analysis',
        topPairings: result.pairings.map(p => ({
          pairingNumber: p.pairingNumber,
          creditHours: this.formatHours(p.creditHours),
          holdProbability: p.holdProbability,
          pairingDays: p.pairingDays
        })),
        summaryStats: {
          totalPairings: result.stats.totalPairings,
          maxHold: result.stats.maxHold,
          avgHold: result.stats.avgHold.toFixed(1),
          highHoldCount: result.stats.highHoldCount
        },
        truncated: result.pairings.length < result.stats.totalPairings
      };
    }

    if (message.includes('layover') || message.includes('overnight') || message.includes('city')) {
      const city = this.extractCityFromQuery(message);
      const result = await this.storage.analyzePairingsByLayoverSummary(query.bidPackageId, city);
      return {
        type: 'layover_analysis',
        summary: result,
        truncated: result.topCities.length < result.uniqueCities
      };
    }

    if (message.includes('deadhead') || message.includes('dh ')) {
      const result = await this.storage.getDeadheadAnalysis(query.bidPackageId);
      return {
        type: 'deadhead_analysis',
        summary: result,
        truncated: result.topDeadheadPairings.length < result.deadheadCount
      };
    }

    if (message.includes('day') || message.includes('turn') || message.includes('duration')) {
      const result = await this.storage.getPairingDurationAnalysis(query.bidPackageId);
      return {
        type: 'duration_analysis',
        summary: result,
        truncated: false
      };
    }

    // Default: general stats summary
    const result = await this.storage.getPairingStatsSummary(query.bidPackageId);
    return {
      type: 'general_stats',
      summary: result,
      truncated: false
    };
  }

  /**
   * Handle large dataset requests that should skip OpenAI entirely
   */
  private async handleLargeDatasetRequest(query: HybridAnalysisQuery): Promise<HybridAnalysisResponse> {
    const message = query.message.toLowerCase();
    
    if (message.includes('all pairings') || message.includes('full dataset') || message.includes('complete list')) {
      const allPairings = await this.storage.getPairings(query.bidPackageId);
      
      return {
        response: `Here are all ${allPairings.length} pairings from the bid package. This is a large dataset that has been returned directly from the database. You can use the search and filter functions in the interface to narrow down the results.`,
        data: allPairings,
        truncated: false
      };
    }

    // Fall back to regular analysis
    return await this.analyzeQuery(query);
  }

  /**
   * Handle cases where even processed data is too large
   */
  private async handleWithSummaryOnly(query: HybridAnalysisQuery, data: any): Promise<HybridAnalysisResponse> {
    const stats = await this.storage.getPairingStatsSummary(query.bidPackageId);
    
    const response = `This query involves a large dataset with ${stats.totalPairings} pairings. Here's a summary:

**Overall Statistics:**
- Total Pairings: ${stats.totalPairings}
- Average Credit Hours: ${this.formatHours(stats.avgCreditHours)}
- Average Block Hours: ${this.formatHours(stats.avgBlockHours)}
- Average Hold Probability: ${stats.avgHoldProbability.toFixed(1)}%

**Duration Breakdown:**
- 1-day (Turns): ${stats.dayDistribution['1day']}
- 2-day: ${stats.dayDistribution['2day']}
- 3-day: ${stats.dayDistribution['3day']}
- 4-day: ${stats.dayDistribution['4day']}
- 5+ day: ${stats.dayDistribution['5day+']}

**Recommendations:**
For more specific analysis, please refine your query with filters like:
- "Show me high credit 3-day pairings"
- "Find efficient turns with high hold probability"
- "Analyze layovers in DFW"

This approach will help me provide more detailed insights without hitting data limits.`;

    return {
      response,
      data: stats,
      truncated: true
    };
  }

  /**
   * Handle function calls from OpenAI
   */
  private async handleFunctionCall(functionCall: any, bidPackageId: number): Promise<HybridAnalysisResponse> {
    const functionName = functionCall.name;
    const args = JSON.parse(functionCall.arguments || '{}');
    
    console.log(`Executing function: ${functionName} with args:`, args);
    
    switch (functionName) {
      case 'getTopEfficientPairings':
        const efficientResult = await this.storage.getTopEfficientPairings(bidPackageId, args.limit || 20);
        return {
          response: `Found ${efficientResult.pairings.length} top efficient pairings (showing top ${args.limit || 20} of ${efficientResult.stats.totalPairings} total).`,
          data: efficientResult,
          truncated: efficientResult.pairings.length < efficientResult.stats.totalPairings
        };
        
      case 'getTopCreditPairings':
        const creditResult = await this.storage.getTopCreditPairings(bidPackageId, args.limit || 20);
        return {
          response: `Found ${creditResult.pairings.length} top credit pairings (showing top ${args.limit || 20} of ${creditResult.stats.totalPairings} total).`,
          data: creditResult,
          truncated: creditResult.pairings.length < creditResult.stats.totalPairings
        };
        
      case 'getPairingStatsSummary':
        const statsResult = await this.storage.getPairingStatsSummary(bidPackageId);
        return {
          response: `Here's a complete statistical summary of all ${statsResult.totalPairings} pairings in the bid package.`,
          data: statsResult,
          truncated: false
        };
        
      default:
        throw new Error(`Unknown function: ${functionName}`);
    }
  }

  /**
   * Check if query should skip OpenAI due to large dataset requirements
   */
  private shouldSkipOpenAI(message: string): boolean {
    const largeDatasetPatterns = [
      'all pairings',
      'full dataset',
      'complete list',
      'dump all',
      'export all'
    ];
    
    return largeDatasetPatterns.some(pattern => message.toLowerCase().includes(pattern));
  }

  /**
   * Estimate token count for processed data
   */
  private estimateTokens(data: any): number {
    const jsonString = JSON.stringify(data);
    // Rough estimate: 1 token per 4 characters
    return Math.ceil(jsonString.length / 4);
  }

  /**
   * Extract city code from query
   */
  private extractCityFromQuery(message: string): string | undefined {
    const cities = ['ATL', 'DFW', 'LAX', 'JFK', 'LGA', 'SEA', 'MSP', 'DTW', 'BOS', 'DCA', 'IAD', 'PDX', 'SLC'];
    const found = cities.find(city => message.toUpperCase().includes(city));
    return found;
  }

  /**
   * Format hours from decimal to HH:MM format
   */
  private formatHours(hours: number): string {
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
  }

  /**
   * Get system prompt with truncation awareness
   */
  private getSystemPrompt(): string {
    return `You are a Delta Airlines PBS (Preferential Bidding System) Bid Optimization Assistant. You analyze pilot queries using pre-processed data summaries from the backend to avoid token limits.

**Core Responsibilities:**
- Analyze pairing data summaries and provide actionable insights
- Help pilots make informed bidding decisions
- Acknowledge when data is truncated and suggest refinements
- Combine backend summaries with PBS expertise

**Key Terminology:**
- Credit Hours: Pay time (what pilots get paid for)
- Block Hours: Actual flight time
- TAFB: Time Away From Base (total trip duration)
- Hold Probability: Likelihood of being awarded the pairing (0-100%)
- Efficiency: Credit hours ÷ Block hours ratio
- Turns: 1-day trips (out and back same day)
- Multi-day: 2+ day trips with overnight layovers

**Data Handling:**
- When data is truncated (truncated: true), acknowledge this clearly
- Always mention "showing top X results" when applicable
- Advise pilots to refine queries for more specific analysis
- Focus on actionable insights rather than raw data regurgitation

**Response Style:**
- Be conversational and pilot-friendly
- Provide specific recommendations with reasoning
- Reference actual pairing numbers and metrics
- Explain bidding strategies and trade-offs

**Truncation Awareness:**
When data is limited, say: "Showing top 20 results out of 534 total pairings. For more specific analysis, try queries like 'high credit 3-day pairings' or 'efficient turns with good hold probability'."

Combine your PBS expertise with the provided data summaries to give pilots the best possible advice for their bidding strategy.`;
  }

  /**
   * Get available functions for OpenAI function calling
   */
  private getAvailableFunctions(): any[] {
    return [
      {
        name: "getTopEfficientPairings",
        description: "Get top efficient pairings (best credit-to-block ratio)",
        parameters: {
          type: "object",
          properties: {
            limit: { type: "number", description: "Maximum number of pairings to return (default: 20)" }
          }
        }
      },
      {
        name: "getTopCreditPairings",
        description: "Get highest credit hour pairings",
        parameters: {
          type: "object",
          properties: {
            limit: { type: "number", description: "Maximum number of pairings to return (default: 20)" }
          }
        }
      },
      {
        name: "getPairingStatsSummary",
        description: "Get overall statistics summary for all pairings",
        parameters: {
          type: "object",
          properties: {}
        }
      }
    ];
  }
}