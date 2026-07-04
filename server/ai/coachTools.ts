/**
 * Tool definitions and executor for the AI bidding coach.
 *
 * The coach (OpenAI chat completion) can call these tools to ground its
 * advice: simulate_bid runs a structured draft against the loaded bid
 * package, export_bid renders review-ready NAVBLUE text. The executor is
 * kept free of OpenAI/storage imports so it can be unit-tested with plain
 * data (see scripts/bid-tools-check.ts).
 */

import type { DraftBid } from '../../shared/bidTypes';
import { simulateBid } from '../lib/bidSimulator';
import { exportBid } from '../lib/bidExporter';

/** Compact JSON schema for a DraftBid, shared by both tool definitions. */
const DRAFT_BID_SCHEMA = {
  type: 'object',
  description:
    'Structured draft bid. Groups are processed in order; preferences within a pairing group are processed top-down (PBS is step-by-step, not priority-weighted).',
  properties: {
    groups: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['pairings', 'reserve'] },
          preferences: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                type: {
                  type: 'string',
                  enum: [
                    'award',
                    'avoid',
                    'preferOff',
                    'setConditionCredit',
                    'clearScheduleStartNext',
                  ],
                },
                filter: {
                  type: 'object',
                  description:
                    'For award/avoid. All present fields must match (AND); array values are OR within the condition.',
                  properties: {
                    pairingNumbers: {
                      type: 'array',
                      items: { type: 'string' },
                    },
                    pairingDaysMin: { type: 'number' },
                    pairingDaysMax: { type: 'number' },
                    layoverCities: {
                      type: 'array',
                      items: { type: 'string' },
                      description: '3-letter station codes, e.g. ["BOS","MIA"]',
                    },
                    creditMin: { type: 'number' },
                    creditMax: { type: 'number' },
                    checkInHourMin: { type: 'number' },
                    checkInHourMax: { type: 'number' },
                    deadheadsMax: { type: 'number' },
                    averageDailyCreditMin: { type: 'number' },
                    averageDailyCreditMax: { type: 'number' },
                  },
                },
                preferOffDates: {
                  type: 'array',
                  items: { type: 'string' },
                  description:
                    'ISO dates YYYY-MM-DD, MOST IMPORTANT FIRST (Denial Mode drops from the end of the list).',
                },
                creditWindow: {
                  type: 'string',
                  enum: ['normal', 'min', 'max', 'mid'],
                },
                limit: {
                  type: 'number',
                  description: 'Award only: max pairings from this preference.',
                },
                elseStartNext: {
                  type: 'boolean',
                  description:
                    'Attachable to avoid/preferOff/setConditionCredit.',
                },
              },
              required: ['type'],
            },
          },
        },
        required: ['type', 'preferences'],
      },
    },
  },
  required: ['groups'],
} as const;

/** OpenAI tool definitions passed to chat.completions.create. */
export const COACH_TOOL_DEFINITIONS = [
  {
    type: 'function' as const,
    function: {
      name: 'simulate_bid',
      description:
        'Evaluate a draft bid against the loaded bid package using NAVBLUE first-pass pool semantics. Returns predicted awards with hold probabilities, total and probability-weighted credit, the credit window, preferences that matched nothing, and explicit caveats about what is NOT modeled (shuffling, Denial Mode, coverage, other pilots). Use before presenting any draft to the pilot.',
      parameters: {
        type: 'object',
        properties: {
          bid: DRAFT_BID_SCHEMA,
          alv: {
            type: 'number',
            description:
              'Average Line Value override in credit hours. Omit to use the bid package ALV (or 78 default).',
          },
        },
        required: ['bid'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'export_bid',
      description:
        'Render a draft bid to review-ready NAVBLUE preference text plus structure warnings verified against the PBS guides (missing group exits, Start Next in last group, Set Condition placement, etc.). Use to produce the final text the pilot will enter into NAVBLUE.',
      parameters: {
        type: 'object',
        properties: { bid: DRAFT_BID_SCHEMA },
        required: ['bid'],
      },
    },
  },
];

export interface CoachToolContext {
  /** Raw pairing rows for the loaded bid package. */
  pairings: any[];
  /** ALV from the bid package, when known. */
  alv?: number;
  /** Real credit window/threshold from the latest imported Reasons Report. */
  windowMin?: number;
  windowMax?: number;
  threshold?: number;
  windowSource?: string;
}

/**
 * Execute a coach tool call and return a JSON-serializable result compact
 * enough to feed back into the model. Never throws: errors come back as
 * { error } so the model can self-correct its arguments.
 */
export function executeCoachTool(
  name: string,
  rawArgs: string,
  context: CoachToolContext
): object {
  let args: any;
  try {
    args = JSON.parse(rawArgs || '{}');
  } catch {
    return { error: 'Tool arguments were not valid JSON.' };
  }

  const bid = args?.bid as DraftBid | undefined;
  if (!bid || !Array.isArray(bid.groups)) {
    return {
      error:
        'Missing or malformed "bid": expected { groups: [{ type, preferences }] }.',
    };
  }

  try {
    if (name === 'simulate_bid') {
      const result = simulateBid(bid, context.pairings, {
        alv: typeof args.alv === 'number' ? args.alv : context.alv,
        threshold: context.threshold,
        windowMin: context.windowMin,
        windowMax: context.windowMax,
        windowSource: context.windowSource,
      });
      // Trim the award list so large lines don't blow up the context.
      return {
        totalCredit: result.totalCredit,
        expectedCredit: result.expectedCredit,
        lineComplete: result.lineComplete,
        window: result.window,
        awards: result.awards.slice(0, 30).map(a => ({
          pairing: a.pairingNumber,
          days: a.pairingDays,
          credit: a.creditHours,
          holdPct: a.holdProbability,
          byPreference: a.awardedByPreference,
        })),
        awardsTruncated: result.awards.length > 30,
        inertPreferences: result.groupResults.flatMap(g =>
          g.inertPreferences.map(p => ({
            group: g.groupIndex + 1,
            preference: p.preferenceIndex + 1,
            reason: p.reason,
          }))
        ),
        caveats: result.caveats,
      };
    }
    if (name === 'export_bid') {
      const result = exportBid(bid);
      return { text: result.text, warnings: result.warnings };
    }
    return { error: `Unknown tool: ${name}` };
  } catch (error) {
    return {
      error: `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
