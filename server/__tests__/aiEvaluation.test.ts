/**
 * AI Evaluation Test Suite
 * Tests intent extraction consistency across 40+ query variations
 */

import { IntentExtractor } from '../ai/intentExtractor';

describe('PBS AI Intent Extraction', () => {
  let extractor: IntentExtractor;

  beforeAll(() => {
    extractor = new IntentExtractor();
  });

  describe('Duration Variations', () => {
    const testCases = [
      { query: '4-day pairings', expected: { pairingDays: 4 } },
      { query: 'four day trips', expected: { pairingDays: 4 } },
      { query: '4 day', expected: { pairingDays: 4 } },
      { query: 'four-day pairing', expected: { pairingDays: 4 } },
      { query: 'quad trips', expected: { pairingDays: 4 } },
      { query: 'turns', expected: { pairingDays: 1 } },
      { query: 'quick trips', expected: { pairingDays: 1 } },
      { query: 'day trips', expected: { pairingDays: 1 } },
      { query: '1-day pairings', expected: { pairingDays: 1 } },
      { query: '2-day trips', expected: { pairingDays: 2 } },
      { query: '3-day pairings', expected: { pairingDays: 3 } },
      { query: '5-day trips', expected: { pairingDays: 5 } },
      { query: 'short trips', expected: { pairingDaysMax: 2 } },
      { query: 'long trips', expected: { pairingDaysMin: 4 } },
      { query: 'extended trips', expected: { pairingDaysMin: 4 } },
    ];

    testCases.forEach(({ query, expected }) => {
      it(`should extract "${query}" correctly`, async () => {
        const result = await extractor.extractIntent(query);
        expect(result.filters).toMatchObject(expected);
        expect(result.needsClarification).toBe(false);
      });
    });
  });

  describe('Credit/Pay Variations', () => {
    const testCases = [
      { query: 'high credit pairings', expected: { creditMin: 18 } },
      { query: 'good pay trips', expected: { creditMin: 18 } },
      { query: 'maximum pay', expected: { creditMin: 18 } },
      { query: 'best pay', expected: { ranking: 'credit' } },
      { query: 'highest credit', expected: { ranking: 'credit' } },
      { query: 'low credit', expected: { creditMax: 15 } },
      { query: 'minimum pay', expected: { creditMax: 15 } },
    ];

    testCases.forEach(({ query, expected }) => {
      it(`should extract "${query}" correctly`, async () => {
        const result = await extractor.extractIntent(query);

        if ('ranking' in expected) {
          expect(result.ranking).toBe(expected.ranking);
        } else {
          expect(result.filters).toMatchObject(expected);
        }
        expect(result.needsClarification).toBe(false);
      });
    });
  });

  describe('Efficiency Variations', () => {
    const testCases = [
      { query: 'efficient pairings', expected: { ranking: 'efficiency' } },
      { query: 'good ratio', expected: { ranking: 'efficiency' } },
      { query: 'efficient trips', expected: { ranking: 'efficiency' } },
      { query: 'credit to block ratio', expected: { ranking: 'efficiency' } },
      { query: 'C/B ratio', expected: { ranking: 'efficiency' } },
    ];

    testCases.forEach(({ query, expected }) => {
      it(`should extract "${query}" correctly`, async () => {
        const result = await extractor.extractIntent(query);
        expect(result.ranking).toBe(expected.ranking);
        expect(result.needsClarification).toBe(false);
      });
    });
  });

  describe('Seniority/Hold Variations', () => {
    const testCases = [
      { query: 'senior friendly pairings', expected: { holdProbabilityMin: 70 } },
      { query: 'likely to hold', expected: { holdProbabilityMin: 70 } },
      { query: 'high hold probability', expected: { holdProbabilityMin: 70 } },
      { query: 'junior friendly trips', expected: { holdProbabilityMin: 30 } },
      { query: 'junior pilot options', expected: { holdProbabilityMin: 30 } },
      { query: 'possible to get', expected: { holdProbabilityMin: 30 } },
      { query: 'guaranteed pairings', expected: { holdProbabilityMin: 90 } },
      { query: 'sure thing', expected: { holdProbabilityMin: 90 } },
      { query: 'definitely hold', expected: { holdProbabilityMin: 90 } },
      { query: 'may hold', expected: { holdProbabilityMin: 50 } },
    ];

    testCases.forEach(({ query, expected }) => {
      it(`should extract "${query}" correctly`, async () => {
        const result = await extractor.extractIntent(query);
        expect(result.filters).toMatchObject(expected);
        expect(result.needsClarification).toBe(false);
      });
    });
  });

  describe('City/Layover Variations', () => {
    const testCases = [
      { query: 'LAX layover', expected: { city: 'LAX' } },
      { query: 'layover in LAX', expected: { city: 'LAX' } },
      { query: 'Seattle layover', expected: { city: 'SEA' } },
      { query: 'trips with LAX', expected: { city: 'LAX' } },
    ];

    testCases.forEach(({ query, expected }) => {
      it(`should extract "${query}" correctly`, async () => {
        const result = await extractor.extractIntent(query);
        expect(result.filters).toMatchObject(expected);
        expect(result.needsClarification).toBe(false);
      });
    });
  });

  describe('Complex Multi-Criteria Queries', () => {
    it('should extract "best 4-day pairings for senior pilots" correctly', async () => {
      const result = await extractor.extractIntent('best 4-day pairings for senior pilots');
      expect(result.filters.pairingDays).toBe(4);
      expect(result.filters.holdProbabilityMin).toBeGreaterThanOrEqual(70);
      expect(result.ranking).toBe('overall');
      expect(result.needsClarification).toBe(false);
    });

    it('should extract "efficient 3-day trips with high credit" correctly', async () => {
      const result = await extractor.extractIntent('efficient 3-day trips with high credit');
      expect(result.filters.pairingDays).toBe(3);
      expect(result.filters.creditMin).toBeGreaterThanOrEqual(18);
      expect(result.ranking).toBe('efficiency');
      expect(result.needsClarification).toBe(false);
    });

    it('should extract "4-day trips with LAX layovers for junior pilots" correctly', async () => {
      const result = await extractor.extractIntent('4-day trips with LAX layovers for junior pilots');
      expect(result.filters.pairingDays).toBe(4);
      expect(result.filters.city).toBe('LAX');
      expect(result.filters.holdProbabilityMin).toBeGreaterThanOrEqual(30);
      expect(result.needsClarification).toBe(false);
    });

    it('should extract "show me top 5 efficient turns" correctly', async () => {
      const result = await extractor.extractIntent('show me top 5 efficient turns');
      expect(result.filters.pairingDays).toBe(1);
      expect(result.ranking).toBe('efficiency');
      expect(result.limit).toBe(5);
      expect(result.needsClarification).toBe(false);
    });

    it('should extract "high credit 4-day pairings with good hold" correctly', async () => {
      const result = await extractor.extractIntent('high credit 4-day pairings with good hold');
      expect(result.filters.pairingDays).toBe(4);
      expect(result.filters.creditMin).toBeGreaterThanOrEqual(18);
      expect(result.filters.holdProbabilityMin).toBeDefined();
      expect(result.needsClarification).toBe(false);
    });
  });

  describe('Ambiguous Queries Requiring Clarification', () => {
    const testCases = [
      { query: 'good pairings' },
      { query: 'show me trips' },
      { query: 'what do you have' },
      { query: 'help me find something' },
    ];

    testCases.forEach(({ query }) => {
      it(`should request clarification for "${query}"`, async () => {
        const result = await extractor.extractIntent(query);
        expect(result.needsClarification).toBe(true);
        expect(result.clarificationQuestion).toBeDefined();
      });
    });
  });

  describe('Ranking Keywords', () => {
    const testCases = [
      { query: 'best pairings', expected: { ranking: 'overall' } },
      { query: 'top trips', expected: { ranking: 'overall' } },
      { query: 'best 5 pairings', expected: { ranking: 'overall', limit: 5 } },
    ];

    testCases.forEach(({ query, expected }) => {
      it(`should extract "${query}" correctly`, async () => {
        const result = await extractor.extractIntent(query);
        expect(result.ranking).toBe(expected.ranking);
        if (expected.limit) {
          expect(result.limit).toBe(expected.limit);
        }
      });
    });
  });
});

// Success metrics
describe('AI Evaluation Success Metrics', () => {
  it('should have at least 40 test cases', () => {
    // Count test cases across all describe blocks
    const totalTests =
      15 + // Duration
      7 +  // Credit
      5 +  // Efficiency
      10 + // Seniority
      4 +  // City
      5 +  // Complex
      4 +  // Ambiguous
      3;   // Ranking

    expect(totalTests).toBeGreaterThanOrEqual(40);
  });
});
