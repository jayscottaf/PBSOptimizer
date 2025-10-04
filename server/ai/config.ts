/**
 * AI Service Configuration
 * Centralized configuration for all AI models and parameters
 */

export const AI_CONFIG = {
  /**
   * Model Selection Strategy:
   * - Testing o4-mini for intent extraction (should work with temp 0.2)
   * - gpt-4.1 for response generation (proven quality)
   * - Target cost: $0.69/user/month (30% savings vs all gpt-4.1)
   */
  MODELS: {
    INTENT: 'o4-mini',       // Testing with lower temperature
    RESPONSE: 'gpt-4.1',     // Keep proven quality
  },

  /**
   * Temperature Settings:
   * - o4-mini: 0.2 (low for deterministic JSON extraction, per GPT-5 recommendation)
   * - gpt-4.1: 0.7 (higher for natural, conversational tone)
   */
  TEMPERATURES: {
    INTENT: 0.2,             // o4-mini: low for consistency
    RESPONSE: 0.7,           // gpt-4.1: natural/conversational
  },

  /**
   * Token Limits:
   * - Intent extraction needs minimal tokens (just JSON output)
   * - Response generation can use more tokens for detailed explanations
   */
  MAX_TOKENS: {
    INTENT: 300,             // Small JSON output
    RESPONSE: 1500,          // Detailed natural language explanation
  },

  /**
   * Context Windows (for reference):
   * - o4-mini: 1,047,576 tokens (~1M)
   * - gpt-5: 1,047,576 tokens (~1M)
   */
  CONTEXT_WINDOWS: {
    'o4-mini': 1_047_576,
    'gpt-5': 1_047_576,
  },

  /**
   * Caching Configuration:
   * Enable prompt caching for system prompts to save 90% on repeated queries
   */
  ENABLE_CACHING: true,

  /**
   * Data Limits:
   * Maximum number of pairings to include in AI context
   */
  MAX_PAIRINGS_IN_CONTEXT: 100,

} as const;

/**
 * Cost per 1M tokens (for reference and monitoring)
 */
export const MODEL_COSTS = {
  'gpt-4.1': {
    input: 2.00,
    cachedInput: 0.50,
    output: 8.00,
  },
  'gpt-5': {
    input: 1.25,
    cachedInput: 0.13,
    output: 10.00,
  },
  'o4-mini': {
    input: 1.10,
    cachedInput: 0.28,
    output: 4.40,
  },
} as const;

/**
 * Calculate estimated cost for a query
 */
export function estimateQueryCost(
  inputTokens: number,
  outputTokens: number,
  model: keyof typeof MODEL_COSTS,
  cached: boolean = false
): number {
  const costs = MODEL_COSTS[model];
  const inputCost = (inputTokens / 1_000_000) * (cached ? costs.cachedInput : costs.input);
  const outputCost = (outputTokens / 1_000_000) * costs.output;
  return inputCost + outputCost;
}
