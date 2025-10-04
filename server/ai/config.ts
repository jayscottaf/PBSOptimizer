/**
 * AI Service Configuration
 * Centralized configuration for all AI models and parameters
 */

export const AI_CONFIG = {
  /**
   * Model Selection Strategy:
   * - Use GPT-4.1 for everything (smartest non-reasoning model)
   * - ChatGPT-like experience with excellent understanding
   */
  MODELS: {
    INTENT: 'gpt-4.1',       // Smartest non-reasoning model
    RESPONSE: 'gpt-4.1',     // Smartest non-reasoning model
  },

  /**
   * Temperature Settings:
   * - Lower temperature (0.3) for consistent, deterministic outputs (intent extraction)
   * - Higher temperature (0.7) for natural, conversational tone (responses)
   */
  TEMPERATURES: {
    INTENT: 0.3,             // Low = consistent JSON extraction
    RESPONSE: 0.7,           // Higher = natural/conversational
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
   * - gpt-4.1: 1,047,576 tokens (~1M)
   */
  CONTEXT_WINDOWS: {
    'gpt-4.1': 1_047_576,
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
