/**
 * AI Service Configuration
 * Centralized configuration for all AI models and parameters
 */

export const AI_CONFIG = {
  /**
   * Model Selection Strategy:
   * - o4-mini for intent extraction (fast, cheap, excellent at structured JSON)
   * - gpt-4.1 for response generation (proven better quality than gpt-5 for this use case)
   * - Cost: $0.69/user/month (o4-mini saves on intent, gpt-4.1 for quality responses)
   */
  MODELS: {
    INTENT: 'o4-mini',       // Fast + cheap for JSON extraction
    RESPONSE: 'gpt-4.1',     // Better response quality than gpt-5
  },

  /**
   * Temperature Settings:
   * - o4-mini only supports temperature 1.0 (reasoning models have fixed temperature)
   * - gpt-5 uses 0.7 for natural, conversational tone
   */
  TEMPERATURES: {
    INTENT: 1.0,             // o4-mini only supports 1.0
    RESPONSE: 0.7,           // Natural/conversational for gpt-5
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
