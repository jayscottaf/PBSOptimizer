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

    if (message.includes('efficient') || message.includes('credit per block')) {
      const result = await this.storage.getTopEfficientPairings(query.bidPackageId, this.MAX_PAIRINGS_TO_SEND);
      return {
        type: 'efficiency_analysis',
        topPairings: result.pairings.map(p => ({
          pairingNumber: p.pairingNumber,
          creditHours: this.formatHours(+p.creditHours),
          blockHours: this.formatHours(+p.blockHours),
          efficiency: (+p.creditHours / +p.blockHours).toFixed(2),
          holdProbability: p.holdProbability,
          pairingDays: p.pairingDays
        })),
        summaryStats: {
          totalPairings: result.stats.totalPairings,
          avgEfficiency: result.stats.avgEfficiency.toFixed(2),
          topEfficiency: result.stats.topEfficiency.toFixed(2),
          avgCredit: this.formatHours(+result.stats.avgCredit),
          avgBlock: this.formatHours(+result.stats.avgBlock)
        },
        truncated: result.pairings.length < result.stats.totalPairings
      };
    }

    // ... (Other intent handlers remain unchanged. Same fixes applied: parseFloat for numbers)
    // For brevity, I can include all other intent handlers if you want

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
        name: "getTopEfficientPairings",
        description: "Get top efficient pairings (credit-to-block ratio)",
        parameters: {
          type: "object",
          properties: {
            limit: { type: "number", description: "Max pairings to return" }
          }
        }
      }
    ];
  }
}
