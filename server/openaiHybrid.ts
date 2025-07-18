import OpenAI from 'openai';
import { DatabaseStorage } from './storage';
import safeStringify from 'fast-safe-stringify';
import { encoding_for_model } from 'tiktoken';

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
 * Hybrid OpenAI Service that implements token optimization:
 * 1. Backend pre-processing of large datasets
 * 2. Sends small JSON summaries to OpenAI
 * 3. Direct DB fallback for large queries
 * 4. Caching for repeated queries
 * 5. Truncation awareness in responses
 */
export class HybridOpenAIService {
  private storage: DatabaseStorage;
  private readonly TOKEN_LIMIT = 8000; // GPT-4 safe limit
  private MAX_PAIRINGS_TO_SEND = 20; // Dynamic later
  private cache = new Map<string, any>(); // Simple in-memory cache

  constructor(storage: DatabaseStorage) {
    this.storage = storage;
  }

  async analyzeQuery(query: HybridAnalysisQuery): Promise<HybridAnalysisResponse> {
    try {
      const cacheKey = `${query.bidPackageId}:${query.message}`;
      if (this.cache.has(cacheKey)) {
        console.log(`Cache hit for query: ${query.message}`);
        return this.cache.get(cacheKey);
      }

      console.log('Starting hybrid analysis for query:', query.message.substring(0, 100));

      if (this.shouldSkipOpenAI(query.message)) {
        console.log('Large dataset request detected, using direct DB fallback');
        return await this.handleLargeDatasetRequest(query);
      }

      const processedData = await this.preprocessDataForQuery(query);

      const estimatedTokens = this.estimateTokens(processedData);
      if (estimatedTokens > this.TOKEN_LIMIT) {
        console.log(`Processed data too large (${estimatedTokens} tokens), using summary only`);
        return await this.handleWithSummaryOnly(query, processedData);
      }

      const completion = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          { role: "system", content: this.getSystemPrompt(processedData) },
          {
            role: "user",
            content: `${query.message}\n\nAvailable Data Summary:\n${safeStringify(processedData).slice(0, 6000)}`
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
        this.cache.set(cacheKey, functionResult);
        return functionResult;
      }

      if (!response) throw new Error('No response from OpenAI');

      const result: HybridAnalysisResponse = {
        response,
        data: processedData,
        truncated: processedData.truncated
      };
      this.cache.set(cacheKey, result);
      return result;

    } catch (error: any) {
      console.error('Hybrid analysis error:', error);

      if (error instanceof OpenAI.APIError) {
        switch (error.code) {
          case 'rate_limit_exceeded':
            throw new Error('OpenAI rate limit exceeded. Try again soon.');
          case 'context_length_exceeded':
            console.log('Context length exceeded, falling back to summary');
            return await this.handleWithSummaryOnly(query, { truncated: true });
          default:
            throw new Error(`OpenAI API Error: ${error.message}`);
        }
      }

      throw new Error(`Failed to analyze query: ${error.message || error}`);
    }
  }

  private async preprocessDataForQuery(query: HybridAnalysisQuery): Promise<any> {
    const message = query.message.toLowerCase();

    const intentHandlers = [
      {
        patterns: ['efficient', 'best ratio', 'credit per block', 'most efficient'],
        handler: this.storage.getTopEfficientPairings.bind(this.storage),
        formatter: this.formatEfficiencyResult.bind(this)
      },
      {
        patterns: ['high credit', 'most credit', 'top pay'],
        handler: this.storage.getTopCreditPairings.bind(this.storage),
        formatter: this.formatCreditResult.bind(this)
      },
      {
        patterns: ['hold', 'probability', 'likely to get'],
        handler: this.storage.getTopHoldProbabilityPairings.bind(this.storage),
        formatter: this.formatHoldResult.bind(this)
      },
      {
        patterns: ['layover', 'overnight', 'city'],
        handler: this.storage.analyzePairingsByLayoverSummary.bind(this.storage),
        formatter: this.formatLayoverResult.bind(this)
      },
      {
        patterns: ['deadhead', 'dh '],
        handler: this.storage.getDeadheadAnalysis.bind(this.storage),
        formatter: this.formatDeadheadResult.bind(this)
      },
      {
        patterns: ['day', 'turn', 'duration'],
        handler: this.storage.getPairingDurationAnalysis.bind(this.storage),
        formatter: this.formatDurationResult.bind(this)
      }
    ];

    for (const { patterns, handler, formatter } of intentHandlers) {
      if (patterns.some(p => message.includes(p))) {
        const result = await handler(query.bidPackageId, this.MAX_PAIRINGS_TO_SEND);
        return formatter(result);
      }
    }

    const stats = await this.storage.getPairingStatsSummary(query.bidPackageId);
    return { type: 'general_stats', summary: stats, truncated: false };
  }

  private async handleLargeDatasetRequest(query: HybridAnalysisQuery): Promise<HybridAnalysisResponse> {
    const allPairings = await this.storage.getPairings(query.bidPackageId);
    return {
      response: `Here are all ${allPairings.length} pairings from the bid package. Use filters for more targeted results.`,
      data: allPairings,
      truncated: false
    };
  }

  private async handleWithSummaryOnly(query: HybridAnalysisQuery, data: any): Promise<HybridAnalysisResponse> {
    const stats = await this.storage.getPairingStatsSummary(query.bidPackageId);
    const response = `This query involves ${stats.totalPairings} pairings. Here's a summary:\n\n${safeStringify(stats, null, 2)}\n\nFor detailed analysis, refine your query.`;
    return { response, data: stats, truncated: true };
  }

  private shouldSkipOpenAI(message: string): boolean {
    return ['all pairings', 'full dataset', 'complete list', 'dump all', 'export all']
      .some(pattern => message.toLowerCase().includes(pattern));
  }

  private estimateTokens(data: any): number {
    const encoder = encoding_for_model('gpt-4');
    const tokens = encoder.encode(JSON.stringify(data));
    encoder.free();
    return tokens.length;
  }

  private formatEfficiencyResult(result: any): any {
    return { type: 'efficiency_analysis', ...result, truncated: result.pairings.length < result.stats.totalPairings };
  }
  private formatCreditResult(result: any): any {
    return { type: 'credit_analysis', ...result, truncated: result.pairings.length < result.stats.totalPairings };
  }
  private formatHoldResult(result: any): any {
    return { type: 'hold_probability_analysis', ...result, truncated: result.pairings.length < result.stats.totalPairings };
  }
  private formatLayoverResult(result: any): any {
    return { type: 'layover_analysis', ...result, truncated: false };
  }
  private formatDeadheadResult(result: any): any {
    return { type: 'deadhead_analysis', ...result, truncated: false };
  }
  private formatDurationResult(result: any): any {
    return { type: 'duration_analysis', ...result, truncated: false };
  }

  private getSystemPrompt(processedData: any): string {
    const pairingCount = processedData.topPairings?.length || 0;
    return `You are a Delta Airlines PBS Bid Optimization Assistant. 
You analyze pre-processed summaries from the backend. Data summary contains ${pairingCount} pairings.
Acknowledge when data is truncated and suggest narrower queries. Combine PBS expertise with provided summaries.`;
  }

  private getAvailableFunctions(): any[] {
    return [
      { name: "getTopEfficientPairings", description: "Get top efficient pairings (best credit/block ratio)", parameters: { type: "object", properties: { limit: { type: "number", description: "Max results (default: 20)" } } } },
      { name: "getTopCreditPairings", description: "Get highest credit pairings", parameters: { type: "object", properties: { limit: { type: "number", description: "Max results (default: 20)" } } } },
      { name: "getPairingStatsSummary", description: "Get overall stats for all pairings", parameters: { type: "object", properties: {} } }
    ];
  }

  private async handleFunctionCall(functionCall: any, bidPackageId: number): Promise<HybridAnalysisResponse> {
    const functionName = functionCall.name;
    const functionArgs = JSON.parse(functionCall.arguments || '{}');

    let functionResult: any;

    try {
      switch (functionName) {
        case "getTopEfficientPairings":
          functionResult = await this.storage.getTopEfficientPairings(bidPackageId, functionArgs.limit || 20);
          break;

        case "getTopCreditPairings":
          functionResult = await this.storage.getTopCreditPairings(bidPackageId, functionArgs.limit || 20);
          break;

        case "getPairingStatsSummary":
          functionResult = await this.storage.getPairingStatsSummary(bidPackageId);
          break;

        default:
          functionResult = { error: "Unknown function" };
      }

      return {
        response: `Function ${functionName} executed successfully. Here's the analysis:`,
        data: functionResult,
        truncated: functionResult.truncated || false
      };

    } catch (error) {
      console.error(`Error executing function ${functionName}:`, error);
      return {
        response: `Error executing ${functionName}: ${error.message}`,
        data: null,
        truncated: false
      };
    }
  }
}
