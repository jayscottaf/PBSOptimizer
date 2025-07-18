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

    // Handle complex multi-criteria queries
    if (message.includes('4-day') && message.includes('credit-to-block') && message.includes('hold prob')) {
      const allPairings = await this.storage.getPairings(query.bidPackageId);
      
      // Filter for 4-day pairings with credit-to-block ratio > 1.2 and hold probability > 75%
      const filteredPairings = allPairings.filter(p => {
        const creditHours = parseFloat(p.creditHours.toString());
        const blockHours = parseFloat(p.blockHours.toString());
        const efficiency = blockHours > 0 ? creditHours / blockHours : 0;
        const holdProb = parseInt(p.holdProbability?.toString() || '0');
        
        return p.pairingDays === 4 && efficiency > 1.2 && holdProb > 75;
      });

      // Sort by efficiency and limit results
      const sortedPairings = filteredPairings
        .sort((a, b) => {
          const effA = parseFloat(a.creditHours.toString()) / parseFloat(a.blockHours.toString());
          const effB = parseFloat(b.creditHours.toString()) / parseFloat(b.blockHours.toString());
          return effB - effA;
        })
        .slice(0, this.MAX_PAIRINGS_TO_SEND);

      return {
        type: 'filtered_4day_analysis',
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
        filterCriteria: {
          pairingDays: 4,
          minEfficiency: 1.2,
          minHoldProbability: 75
        },
        totalMatching: filteredPairings.length,
        totalSearched: allPairings.length,
        truncated: sortedPairings.length < filteredPairings.length
      };
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
      // ... (Other function handlers)
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
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
  }

  private getSystemPrompt(): string {
    return `You are a Delta PBS Bid Optimization Assistant. Use backend summaries to avoid token limits and provide actionable pairing analysis.`;
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
      }
    ];
  }
}
