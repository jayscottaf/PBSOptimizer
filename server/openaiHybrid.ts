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
  async analyzeQuery(
    query: HybridAnalysisQuery
  ): Promise<HybridAnalysisResponse> {
    try {
      console.log(
        'Starting hybrid analysis for query:',
        query.message.substring(0, 100)
      );

      // Get bid package information for proper formatting
      let bidPackageInfo = null;
      if (query.bidPackageId) {
        try {
          const bidPackages = await this.storage.getBidPackages();
          bidPackageInfo = bidPackages.find(
            pkg => pkg.id === query.bidPackageId
          );
        } catch (error: unknown) {
          console.log(
            'Could not fetch bid package info:',
            error instanceof Error ? error.message : String(error)
          );
        }
      }

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
        console.log(
          `Data too large (${estimatedTokens} tokens), using summary approach`
        );
        return await this.handleWithSummaryOnly(query);
      }

      // If the user explicitly asks for "best" pairings, handle deterministically
      const lowerMsg = query.message.toLowerCase();
      if (lowerMsg.includes('best')) {
        // Extract optional limit (e.g., "2 best" or "top 3")
        const limitMatch = lowerMsg.match(/(?:^|\s)(?:top|best)\s*(\d{1,2})|(?:\b(\d{1,2})\b\s*best)/);
        const limit = limitMatch ? parseInt(limitMatch[1] || limitMatch[2] || '5', 10) : 5;

        // Extract pairing days (e.g., "5 day", "5-day")
        const daysMatch = lowerMsg.match(/(\d+)[-\s]?day/);
        const pairingDays = daysMatch ? parseInt(daysMatch[1], 10) : undefined;

        // Infer criteria if explicitly mentioned
        let criteria: 'credit' | 'efficiency' | 'hold_probability' | 'overall' = 'overall';
        if (lowerMsg.includes('credit')) criteria = 'credit';
        else if (lowerMsg.includes('efficiency') || lowerMsg.includes('efficient')) criteria = 'efficiency';
        else if (lowerMsg.includes('hold')) criteria = 'hold_probability';

        const directResult = await this.handleFunctionCall({
          name: 'findBestPairings',
          arguments: JSON.stringify({ pairingDays, limit, criteria })
        } as any, query.bidPackageId);

        return directResult;
      }

      // Call OpenAI with tool_calls (replaces deprecated function_call)
      const completion = await openai.chat.completions.create({
        model: 'gpt-4',
        messages: [
          { role: 'system', content: this.getSystemPrompt(bidPackageInfo) },
          {
            role: 'user',
            content: `${query.message}\n\nAvailable Data Summary:\n${dataString}`,
          },
        ],
        tools: this.getAvailableFunctions(),
        max_tokens: 1000,
        temperature: 0.7,
      });

      const response = completion.choices[0]?.message?.content;
      const toolCall =
        completion.choices[0]?.message?.tool_calls?.[0]?.function;

      if (toolCall) {
        console.log('Tool call requested:', toolCall.name);
        const functionResult = await this.handleFunctionCall(
          toolCall,
          query.bidPackageId
        );
        return functionResult;
      }

      if (!response) {
        throw new Error('No response from OpenAI');
      }

      return {
        response,
        data: processedData,
        truncated: processedData.truncated,
      };
    } catch (error: unknown) {
      console.error('Hybrid analysis error:', error);

      if (
        error instanceof Error &&
        error.message.includes('rate_limit_exceeded')
      ) {
        throw new Error(
          'OpenAI rate limit exceeded. Please try again shortly.'
        );
      }

      if (
        error instanceof Error &&
        error.message.includes('context_length_exceeded')
      ) {
        console.log(
          'Context length exceeded, falling back to summary approach'
        );
        return await this.handleWithSummaryOnly(query);
      }

      throw new Error(`Failed to analyze query: ${(error as Error).message}`);
    }
  }

  private async preprocessDataForQuery(
    query: HybridAnalysisQuery
  ): Promise<any> {
    const message = query.message.toLowerCase();

    // Handle check-in time queries FIRST before other patterns
    const checkInMatch =
      message.match(/check.?in\s+(?:after|>=|>\s*)?(\d{1,2})[:.;](\d{2})/i) ||
      message.match(/after\s+(\d{1,2})[:.;](\d{2})/i);

    if (
      checkInMatch &&
      (message.includes('pairing') || message.includes('how many'))
    ) {
      const hours = checkInMatch[1];
      const minutes = checkInMatch[2];
      const timeDecimal = parseFloat(`${hours}.${minutes}`);

      return await this.handleCheckInTimeQuery(query, timeDecimal, message);
    }

    // Extract pairing duration from the message FIRST (1-day, 2-day, etc.)
    const durationMatch = message.match(/(\d+)[-\s]?day/);
    const requestedDays = durationMatch ? parseInt(durationMatch[1]) : null;

    // Handle specific duration requests (1-day, 2-day, 3-day, 4-day, 5-day, etc.)
    if (requestedDays) {
      return await this.handleDurationSpecificQuery(
        query,
        requestedDays,
        message
      );
    }

    // Check for specific pairing number requests (only very explicit pairing requests)
    const pairingMatch =
      message.match(/(?:pairing|show\s+me\s+pairing)\s+#?(\d{4,5})/i) ||
      message.match(/#(\d{4,5})/i) ||
      (message.match(/\b(\d{4,5})\b/) &&
        (message.includes('pairing') ||
          message.match(/^(?:show\s+me\s+)?(\d{4,5})$/)));

    if (pairingMatch && Array.isArray(pairingMatch)) {
      const pairingNumber = pairingMatch[1];
      const pairing = await this.storage.getPairingByNumber(
        pairingNumber,
        query.bidPackageId
      );

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
            fullTextBlock: pairing.fullTextBlock,
            checkInTime: pairing.checkInTime, // Added checkInTime
          },
          truncated: false,
        };
      } else {
        return {
          type: 'pairing_not_found',
          pairingNumber,
          truncated: false,
        };
      }
    }

    // Handle turn queries (1-day pairings)
    if (message.includes('turn') || message.includes('turns')) {
      return await this.handleDurationSpecificQuery(query, 1, message);
    }

    // Handle layover queries
    if (message.includes('layover') || message.includes('layovers')) {
      return await this.handleLayoverQuery(query, message);
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
      const result = await this.storage.getTopEfficientPairings(
        query.bidPackageId,
        this.MAX_PAIRINGS_TO_SEND
      );
      return {
        type: 'efficiency_analysis',
        topPairings: result.pairings.map(p => ({
          pairingNumber: p.pairingNumber,
          creditHours: this.formatHours(parseFloat(p.creditHours.toString())),
          blockHours: this.formatHours(parseFloat(p.blockHours.toString())),
          efficiency: (
            parseFloat(p.creditHours.toString()) /
            parseFloat(p.blockHours.toString())
          ).toFixed(2),
          holdProbability: p.holdProbability || 0,
          pairingDays: p.pairingDays || 1,
        })),
        summaryStats: {
          totalPairings: result.stats.totalPairings,
          avgEfficiency: result.stats.avgEfficiency.toFixed(2),
          topEfficiency: result.stats.topEfficiency.toFixed(2),
          avgCredit: this.formatHours(
            parseFloat(result.stats.avgCredit.toString())
          ),
          avgBlock: this.formatHours(
            parseFloat(result.stats.avgBlock.toString())
          ),
        },
        truncated: result.pairings.length < result.stats.totalPairings,
      };
    }

    const result = await this.storage.getPairingStatsSummary(
      query.bidPackageId
    );
    return {
      type: 'general_stats',
      summary: result,
      truncated: false,
    };
  }

  private async handleCheckInTimeQuery(
    query: HybridAnalysisQuery,
    afterTime: number,
    message: string
  ): Promise<any> {
    try {
      const allPairings = await this.storage.getPairings(query.bidPackageId);

      // Filter pairings with check-in times after the specified time
      const filteredPairings = allPairings.filter(p => {
        if (!p.checkInTime) {
          return false;
        }
        const checkInDecimal = parseFloat(p.checkInTime.toString());
        return checkInDecimal >= afterTime;
      });

      const stats = {
        totalPairings: allPairings.length,
        totalWithCheckInData: allPairings.filter(p => p.checkInTime).length,
        matchingCheckInCriteria: filteredPairings.length,
        afterTime: afterTime,
        avgCreditHours:
          filteredPairings.length > 0
            ? (
                filteredPairings.reduce(
                  (sum, p) => sum + parseFloat(p.creditHours.toString()),
                  0
                ) / filteredPairings.length
              ).toFixed(2)
            : null,
        avgBlockHours:
          filteredPairings.length > 0
            ? (
                filteredPairings.reduce(
                  (sum, p) => sum + parseFloat(p.blockHours.toString()),
                  0
                ) / filteredPairings.length
              ).toFixed(2)
            : null,
        avgHoldProbability:
          filteredPairings.length > 0
            ? (
                filteredPairings.reduce(
                  (sum, p) => sum + (p.holdProbability || 0),
                  0
                ) / filteredPairings.length
              ).toFixed(1)
            : null,
      };

      return {
        type: 'checkin_time_analysis',
        afterTime: afterTime,
        stats: stats,
        matchingPairings: filteredPairings.slice(0, 20).map(p => ({
          pairingNumber: p.pairingNumber,
          checkInTime: p.checkInTime,
          creditHours: p.creditHours.toString(),
          blockHours: p.blockHours.toString(),
          pairingDays: p.pairingDays || 1,
          holdProbability: p.holdProbability || 0,
          route: p.route,
        })),
        totalMatching: filteredPairings.length,
        totalSearched: allPairings.length,
        truncated: false,
      };
    } catch (error: unknown) {
      console.error(
        'Error in handleCheckInTimeQuery:',
        error instanceof Error ? error.message : String(error)
      );
      return {
        type: 'error',
        message: `Error processing check-in time query: ${error instanceof Error ? error.message : String(error)}`,
        truncated: false,
      };
    }
  }

  private async handleDurationSpecificQuery(
    query: HybridAnalysisQuery,
    days: number,
    message: string
  ): Promise<any> {
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
    if (
      message.includes('hold prob') ||
      message.includes('senior') ||
      message.includes('junior')
    ) {
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
          const effA =
            parseFloat(a.creditHours.toString()) /
            parseFloat(a.blockHours.toString());
          const effB =
            parseFloat(b.creditHours.toString()) /
            parseFloat(b.blockHours.toString());
          return effB - effA;
        }
        return (
          parseFloat(b.creditHours.toString()) -
          parseFloat(a.creditHours.toString())
        );
      })
      .slice(0, this.MAX_PAIRINGS_TO_SEND);

    return {
      type: `duration_${days}day_analysis`,
      matchingPairings: sortedPairings.map(p => ({
        pairingNumber: p.pairingNumber,
        creditHours: this.formatHours(parseFloat(p.creditHours.toString())),
        blockHours: this.formatHours(parseFloat(p.blockHours.toString())),
        efficiency: (
          parseFloat(p.creditHours.toString()) /
          parseFloat(p.blockHours.toString())
        ).toFixed(2),
        holdProbability: p.holdProbability || 0,
        pairingDays: p.pairingDays || 1,
        route: p.route,
        tafb: p.tafb,
        layovers: p.layovers,
        checkInTime: p.checkInTime, // Added checkInTime
      })),
      filterCriteria,
      totalMatching: filteredPairings.length,
      totalSearched: allPairings.length,
      truncated: sortedPairings.length < filteredPairings.length,
    };
  }

  private async handleMultiDayQuery(
    query: HybridAnalysisQuery,
    message: string
  ): Promise<any> {
    const allPairings = await this.storage.getPairings(query.bidPackageId);

    // Filter for multi-day pairings (2+ days)
    const multiDayPairings = allPairings.filter(p => (p.pairingDays || 1) >= 2);

    // Group by duration
    const groupedByDuration = multiDayPairings.reduce((acc, p) => {
      const key = `${p.pairingDays}day`;
      if (!acc[key]) {
        acc[key] = [];
      }
      acc[key].push(p);
      return acc;
    }, {} as any);

    // Get top pairings from each duration group
    const topFromEachDuration = Object.entries(groupedByDuration).map(
      ([duration, pairings]: [string, any]) => ({
        duration,
        count: pairings.length,
        topPairings: pairings
          .sort(
            (a: any, b: any) =>
              parseFloat(b.creditHours.toString()) -
              parseFloat(a.creditHours.toString())
          )
          .slice(0, 5),
      })
    );

    return {
      type: 'multi_day_analysis',
      durationBreakdown: topFromEachDuration,
      totalMultiDay: multiDayPairings.length,
      totalSearched: allPairings.length,
      truncated: false,
    };
  }

  private async handleShortTripQuery(
    query: HybridAnalysisQuery,
    message: string
  ): Promise<any> {
    const allPairings = await this.storage.getPairings(query.bidPackageId);

    // Filter for short trips (1-2 days)
    const shortTripPairings = allPairings.filter(
      p => (p.pairingDays || 1) <= 2
    );

    const sortedPairings = shortTripPairings
      .sort(
        (a, b) =>
          parseFloat(b.creditHours.toString()) -
          parseFloat(a.creditHours.toString())
      )
      .slice(0, this.MAX_PAIRINGS_TO_SEND);

    return {
      type: 'short_trip_analysis',
      matchingPairings: sortedPairings.map(p => ({
        pairingNumber: p.pairingNumber,
        creditHours: this.formatHours(parseFloat(p.creditHours.toString())),
        blockHours: this.formatHours(parseFloat(p.blockHours.toString())),
        efficiency: (
          parseFloat(p.creditHours.toString()) /
          parseFloat(p.blockHours.toString())
        ).toFixed(2),
        holdProbability: p.holdProbability || 0,
        pairingDays: p.pairingDays || 1,
        route: p.route,
        tafb: p.tafb,
      })),
      filterCriteria: { maxPairingDays: 2 },
      totalMatching: shortTripPairings.length,
      totalSearched: allPairings.length,
      truncated: sortedPairings.length < shortTripPairings.length,
    };
  }

  private async handleLayoverQuery(
    query: HybridAnalysisQuery,
    message: string
  ): Promise<any> {
    const allPairings = await this.storage.getPairings(query.bidPackageId);

    // Extract city from query (DFW, ATL, etc.)
    const cityMatch = message.match(/\b([A-Z]{3})\b/);
    const targetCity = cityMatch ? cityMatch[1] : null;

    // Extract number of layovers requested (default to 10)
    const numberMatch = message.match(/(\d+)\s+(?:longest|top)/);
    const requestedCount = numberMatch ? parseInt(numberMatch[1]) : 10;

    // Extract minimum duration if specified
    const durationMatch = message.match(
      /(?:over|longer than|above)\s+(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)/
    );
    const minDuration = durationMatch ? parseFloat(durationMatch[1]) : 0;

    // Collect layovers from all pairings, filtering by city FIRST if specified
    const allLayovers: any[] = [];
    const debugInfo: any[] = [];

    allPairings.forEach(pairing => {
      // Debug: Check for specific pairing 8053
      if (pairing.pairingNumber === '8053') {
        debugInfo.push({
          pairingNumber: pairing.pairingNumber,
          hasLayovers: !!pairing.layovers,
          layoversArray: pairing.layovers,
          isArray: Array.isArray(pairing.layovers),
          layoverCount:
            pairing.layovers && Array.isArray(pairing.layovers)
              ? pairing.layovers.length
              : 0,
        });
      }

      if (pairing.layovers && Array.isArray(pairing.layovers)) {
        pairing.layovers.forEach((layover: any) => {
          // STRICT city filtering - only include layovers in the specified city
          if (targetCity && layover.city !== targetCity) {
            return;
          }

          // Parse duration (handle both "18.43" and "18:43" formats)
          const durationStr = layover.duration?.toString() || '0';
          let durationHours = 0;

          if (durationStr.includes(':')) {
            // Handle "18:43" format
            const [hours, minutes] = durationStr.split(':').map(Number);
            durationHours = hours + minutes / 60;
          } else if (durationStr.includes('.')) {
            // Handle "18.43" format (PBS format where .43 = 43 minutes)
            const [hours, minutes] = durationStr.split('.').map(Number);
            durationHours = hours + minutes / 60;
          } else {
            // Handle whole hours
            durationHours = parseFloat(durationStr);
          }

          // Filter by minimum duration if specified
          if (durationHours >= minDuration) {
            allLayovers.push({
              city: layover.city,
              hotel: layover.hotel,
              duration: durationStr,
              durationHours: durationHours,
              pairingNumber: pairing.pairingNumber,
              creditHours: pairing.creditHours,
              holdProbability: pairing.holdProbability,
              route: pairing.route,
            });
          }
        });
      }
    });

    // Sort by duration descending and take requested count
    const sortedLayovers = allLayovers
      .sort((a, b) => b.durationHours - a.durationHours)
      .slice(0, requestedCount);

    // Group by city for summary stats
    const cityStats = allLayovers.reduce((acc, layover) => {
      if (!acc[layover.city]) {
        acc[layover.city] = { count: 0, totalDuration: 0, avgDuration: 0 };
      }
      acc[layover.city].count++;
      acc[layover.city].totalDuration += layover.durationHours;
      return acc;
    }, {} as any);

    // Calculate averages
    Object.keys(cityStats).forEach(city => {
      cityStats[city].avgDuration =
        cityStats[city].totalDuration / cityStats[city].count;
    });

    // Format the response with actual layover details
    let responseText = `Found ${allLayovers.length} layovers${targetCity ? ` in ${targetCity}` : ''}${minDuration > 0 ? ` longer than ${minDuration} hours` : ''}.`;

    if (sortedLayovers.length > 0) {
      responseText += `\n\nLayover Details:\n`;
      sortedLayovers.forEach((layover, index) => {
        responseText += `${index + 1}. Pairing ${layover.pairingNumber}: ${layover.city} layover (${layover.duration} hours)${layover.hotel ? ` at ${layover.hotel}` : ''}\n`;
      });
    } else {
      responseText += ` No layovers found matching your criteria.`;
    }

    // Add debug info if pairing 8053 was found
    if (debugInfo.length > 0) {
      console.log('Debug info for pairing 8053:', debugInfo);
    }

    return {
      response: responseText,
      data: {
        targetCity,
        longestLayovers: sortedLayovers.map(layover => ({
          city: layover.city,
          hotel: layover.hotel,
          duration: layover.duration,
          durationHours: layover.durationHours.toFixed(2),
          pairingNumber: layover.pairingNumber,
          creditHours: this.formatHours(
            parseFloat(layover.creditHours.toString())
          ),
          holdProbability: layover.holdProbability,
          route: layover.route,
        })),
        totalLayovers: allLayovers.length,
        debugInfo: debugInfo, // Include debug info for troubleshooting
      },
      truncated: sortedLayovers.length < allLayovers.length,
    };
  }

  private extractEfficiencyThreshold(message: string): number {
    // Look for efficiency thresholds in the message
    const thresholdMatch = message.match(/(\d+(?:\.\d+)?)\s*%?\s*efficiency/i);
    if (thresholdMatch) {
      return parseFloat(thresholdMatch[1]) / 100;
    }
    return 1.0; // Default minimum efficiency of 100%
  }

  private analyzeCheckInTimes(pairings: any[], message: string) {
    console.log('Analyzing check-in times for', pairings.length, 'pairings');

    // Filter pairings with check-in times
    const pairingsWithCheckIn = pairings.filter(
      p => p.checkInTime && p.checkInTime.trim() !== ''
    );
    console.log(
      `Found ${pairingsWithCheckIn.length} pairings with check-in times`
    );

    if (pairingsWithCheckIn.length === 0) {
      return {
        type: 'check_in_analysis',
        response: 'No check-in time data available in the current bid package.',
        count: 0,
        totalWithCheckIn: 0,
        totalSearched: pairings.length,
      };
    }

    // Parse time threshold from message (e.g., "after 10:59 am")
    const timeMatch = message.match(
      /(?:after|before)\s+(\d{1,2})[:.:](\d{2})/i
    );
    let targetHour = null;
    let targetMinute = null;
    let isAfter = true;

    if (timeMatch) {
      targetHour = parseInt(timeMatch[1]);
      targetMinute = parseInt(timeMatch[2]);
      isAfter = message.toLowerCase().includes('after');
      console.log(
        `Looking for pairings ${isAfter ? 'after' : 'before'} ${targetHour}:${targetMinute.toString().padStart(2, '0')}`
      );
    }

    let filteredPairings = pairingsWithCheckIn;

    if (targetHour !== null && targetMinute !== null) {
      filteredPairings = pairingsWithCheckIn.filter(p => {
        const checkIn = p.checkInTime.toString();
        // Handle both "10.35" and "10:35" formats
        const parts = checkIn
          .split(/[.:]/)
          .map((s: string) => parseInt(s.trim()));
        if (parts.length < 2) {
          return false;
        }

        const hours = parts[0];
        const minutes = parts[1];
        const checkInMinutes = hours * 60 + minutes;
        const targetMinutes = targetHour * 60 + (targetMinute || 0);

        console.log(
          `Pairing ${p.pairingNumber}: ${checkIn} (${checkInMinutes} min) vs target (${targetMinutes} min)`
        );
        return isAfter
          ? checkInMinutes > targetMinutes
          : checkInMinutes < targetMinutes;
      });

      console.log(
        `Filtered to ${filteredPairings.length} pairings matching time criteria`
      );
    }

    const responseText =
      targetHour !== null && targetMinute !== null
        ? `Found ${filteredPairings.length} pairings that check in ${isAfter ? 'after' : 'before'} ${targetHour}:${(targetMinute || 0).toString().padStart(2, '0')} out of ${pairingsWithCheckIn.length} pairings with check-in times.`
        : `Found ${pairingsWithCheckIn.length} pairings with check-in time data.`;

    return {
      type: 'check_in_analysis',
      response: responseText,
      count: filteredPairings.length,
      totalWithCheckIn: pairingsWithCheckIn.length,
      totalSearched: pairings.length,
      criteria: timeMatch
        ? `${isAfter ? 'after' : 'before'} ${targetHour}:${(targetMinute || 0).toString().padStart(2, '0')}`
        : 'all',
      pairings: filteredPairings.slice(0, 20).map(p => ({
        pairingNumber: p.pairingNumber,
        checkInTime: p.checkInTime,
        route: p.route?.substring(0, 80) || '',
        creditHours: this.formatHours(parseFloat(p.creditHours.toString())),
        blockHours: this.formatHours(parseFloat(p.blockHours.toString())),
        pairingDays: p.pairingDays || 1,
        holdProbability: p.holdProbability,
      })),
    };
  }

  private extractHoldProbabilityThreshold(message: string): number {
    // Look for explicit hold probability percentages with proper context
    const holdMatch = message.match(
      /(?:at least|>=|>|with)\s*(\d+)%?\s*hold\s*prob/i
    );
    if (holdMatch) {
      return parseInt(holdMatch[1]);
    }

    // Fallback to seniority-based defaults
    if (message.includes('senior')) {
      return 70;
    }
    if (message.includes('junior')) {
      return 30;
    }

    return 75; // Default threshold
  }

  private async handleGeneralQuestion(
    query: HybridAnalysisQuery,
    message: string
  ): Promise<any> {
    console.log('Handling general question:', message);

    const allPairings = await this.storage.getPairings(query.bidPackageId);
    console.log(`Retrieved ${allPairings.length} pairings for analysis`);

    // Process different types of general questions
    if (message.includes('check-in') || message.includes('checkin')) {
      return this.analyzeCheckInTimes(allPairings, message);
    }

    // Default response if no specific handler matches
    const result = await this.storage.getPairingStatsSummary(
      query.bidPackageId
    );
    return {
      type: 'general_stats',
      summary: result,
      truncated: false,
    };
  }

  private async handleLargeDatasetRequest(
    query: HybridAnalysisQuery
  ): Promise<HybridAnalysisResponse> {
    const allPairings = await this.storage.getPairings(query.bidPackageId);
    return {
      response: `Here are all ${allPairings.length} pairings directly from the DB.`,
      data: allPairings,
      truncated: false,
    };
  }

  private async handleWithSummaryOnly(
    query: HybridAnalysisQuery
  ): Promise<HybridAnalysisResponse> {
    const stats = await this.storage.getPairingStatsSummary(query.bidPackageId);
    return {
      response: `This dataset is large (${stats.totalPairings} pairings). Here's a summary:\n- Avg Credit: ${this.formatHours(+stats.avgCredit)}\n- Avg Block: ${this.formatHours(+stats.avgBlock)}\n- Avg Hold Probability: ${stats.avgHoldProbability.toFixed(1)}%`,
      data: stats,
      truncated: true,
    };
  }

  private async handleFunctionCall(
    functionCall: any,
    bidPackageId: number
  ): Promise<HybridAnalysisResponse> {
    const functionName: string = functionCall.name;
    const args = JSON.parse(functionCall.arguments || '{}');

    switch (functionName) {
      case 'getTopEfficientPairings':
        const efficientResult = await this.storage.getTopEfficientPairings(
          bidPackageId,
          args.limit || 20
        );

        // Generate detailed response with actual pairing data
        const topPairings = efficientResult.pairings.slice(0, 5);
        let response = `**Top 5 Most Efficient Pairings (Credit-to-Block Ratio):**\n\n`;

        topPairings.forEach((p: any, i: number) => {
          const efficiency = (
            parseFloat(p.creditHours.toString()) /
            parseFloat(p.blockHours.toString())
          ).toFixed(2);
          response += `${i + 1}. **Pairing ${p.pairingNumber}** - ${efficiency} ratio\n`;
          response += `   • Credit: ${this.formatHoursDeltaPBS(parseFloat(p.creditHours.toString()))} | Block: ${this.formatHoursDeltaPBS(parseFloat(p.blockHours.toString()))}\n`;
          response += `   • ${p.pairingDays} days | Hold: ${p.holdProbability}% | Route: ${p.route?.substring(0, 50)}...\n\n`;
        });

        response += `**Summary Stats:**\n`;
        response += `• Average efficiency: ${efficientResult.stats.avgEfficiency.toFixed(2)}\n`;
        response += `• Top efficiency: ${efficientResult.stats.topEfficiency.toFixed(2)}\n`;
        response += `• Average credit: ${this.formatHoursDeltaPBS(parseFloat(efficientResult.stats.avgCredit.toString()))}\n`;
        response += `• Showing ${topPairings.length} of ${efficientResult.stats.totalPairings} pairings`;

        return {
          response: response,
          data: efficientResult,
          truncated:
            efficientResult.pairings.length <
            efficientResult.stats.totalPairings,
        };

      case 'getPairingsByDuration':
        const allPairings = await this.storage.getPairings(bidPackageId);
        let durationPairings = allPairings.filter(
          p => p.pairingDays === args.days
        );

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
          .sort(
            (a, b) =>
              parseFloat(b.creditHours.toString()) -
              parseFloat(a.creditHours.toString())
          )
          .slice(0, args.limit || 20);

        return {
          response: `Found ${durationPairings.length} ${args.days}-day pairings${args.minEfficiency ? ` with efficiency >= ${args.minEfficiency}` : ''}${args.minHoldProb ? ` and hold probability >= ${args.minHoldProb}%` : ''}.`,
          data: {
            pairings: sortedPairings,
            stats: {
              totalFound: durationPairings.length,
              totalSearched: allPairings.length,
              avgCredit:
                durationPairings.length > 0
                  ? durationPairings.reduce(
                      (sum, p) => sum + parseFloat(p.creditHours.toString()),
                      0
                    ) / durationPairings.length
                  : 0,
            },
          },
          truncated: sortedPairings.length < durationPairings.length,
        };

      case 'getMultiDayAnalysis':
        const allPairingsForMulti =
          await this.storage.getPairings(bidPackageId);
        const multiDayPairings = allPairingsForMulti.filter(
          p => (p.pairingDays || 1) >= 2
        );

        // Group by duration
        const groupedByDuration = multiDayPairings.reduce((acc, p) => {
          const key = p.pairingDays || 1;
          if (!acc[key]) {
            acc[key] = [];
          }
          acc[key].push(p);
          return acc;
        }, {} as any);

        // Get top pairings from each duration group
        const analysisResults = Object.entries(groupedByDuration)
          .map(([duration, pairings]: [string, any]) => ({
            duration: parseInt(duration),
            count: pairings.length,
            avgCredit:
              pairings.reduce(
                (sum: number, p: any) =>
                  sum + parseFloat(p.creditHours.toString()),
                0
              ) / pairings.length,
            topPairings: pairings
              .sort(
                (a: any, b: any) =>
                  parseFloat(b.creditHours.toString()) -
                  parseFloat(a.creditHours.toString())
              )
              .slice(0, args.limit || 5),
          }))
          .sort((a, b) => b.count - a.count);

        return {
          response: `Multi-day analysis complete. Found ${multiDayPairings.length} pairings across ${Object.keys(groupedByDuration).length} duration categories.`,
          data: {
            durationBreakdown: analysisResults,
            totalMultiDay: multiDayPairings.length,
            totalSearched: allPairingsForMulti.length,
          },
          truncated: false,
        };

      case 'findBestPairings':
        const allPairingsForBest = await this.storage.getPairings(bidPackageId);
        let bestPairings = allPairingsForBest;

        // Filter by pairing days if specified
        if (args.pairingDays) {
          bestPairings = bestPairings.filter(p => p.pairingDays === args.pairingDays);
        }

        if (bestPairings.length === 0) {
          return {
            response: `No pairings found matching the criteria.`,
            data: { pairings: [], totalFound: 0 },
            truncated: false
          };
        }

        // Parse hours and calculate efficiency
        const parseHours = (timeStr: string) => {
          if (!timeStr) return 0;
          const [hours, minutes] = timeStr.split(':').map(Number);
          return hours + (minutes || 0) / 60;
        };

        const analyzedPairings = bestPairings.map((p: any) => ({
          pairingNumber: p.pairingNumber,
          creditHours: parseHours(p.creditHours.toString()),
          blockHours: parseHours(p.blockHours.toString()),
          pairingDays: p.pairingDays || 1,
          efficiency: parseHours(p.creditHours.toString()) / (parseHours(p.blockHours.toString()) || 1),
          dailyPay: parseHours(p.creditHours.toString()) / (p.pairingDays || 1),
          holdProbability: p.holdProbability || 0,
          layovers: p.layovers || [],
          route: p.route || 'N/A',
          tafb: p.tafb || 'N/A'
        })).filter(p => p.creditHours > 0);

        // Sort by different criteria
        let sortedBestPairings = [...analyzedPairings];
        const limit = args.limit || 5;
        const criteria = args.criteria || 'overall';

        switch (criteria) {
          case 'credit':
            sortedBestPairings.sort((a, b) => b.creditHours - a.creditHours);
            break;
          case 'efficiency':
            sortedBestPairings.sort((a, b) => b.efficiency - a.efficiency);
            break;
          case 'hold_probability':
            sortedBestPairings.sort((a, b) => b.holdProbability - a.holdProbability);
            break;
          case 'overall':
          default:
            // Overall score: 40% credit, 30% efficiency, 20% hold probability, 10% daily pay
            sortedBestPairings.sort((a, b) => {
              const scoreA = (a.creditHours * 0.4) + (a.efficiency * 0.3) + (a.holdProbability * 0.2) + (a.dailyPay * 0.1);
              const scoreB = (b.creditHours * 0.4) + (b.efficiency * 0.3) + (b.holdProbability * 0.2) + (b.dailyPay * 0.1);
              return scoreB - scoreA;
            });
            break;
        }

        const topBestPairings = sortedBestPairings.slice(0, limit);
        
        // Generate detailed response
        let responseText = `**Top ${Math.min(limit, topBestPairings.length)} Best ${args.pairingDays ? args.pairingDays + '-Day ' : ''}Pairings (${criteria} ranking):**\n\n`;
        
        topBestPairings.forEach((p, i) => {
          responseText += `${i + 1}. **Pairing ${p.pairingNumber}**\n`;
          responseText += `   • Credit: ${this.formatHoursDeltaPBS(p.creditHours)} | Block: ${this.formatHoursDeltaPBS(p.blockHours)}\n`;
          responseText += `   • Efficiency: ${p.efficiency.toFixed(2)} | Hold: ${p.holdProbability}%\n`;
          responseText += `   • Route: ${p.route.substring(0, 50)}...\n\n`;
        });

        responseText += `**Analysis Summary:**\n`;
        responseText += `• Total ${args.pairingDays ? args.pairingDays + '-day ' : ''}pairings analyzed: ${analyzedPairings.length}\n`;
        responseText += `• Ranking criteria: ${criteria}\n`;
        responseText += `• Average credit: ${this.formatHoursDeltaPBS(analyzedPairings.reduce((sum, p) => sum + p.creditHours, 0) / analyzedPairings.length)}\n`;
        responseText += `• Average efficiency: ${(analyzedPairings.reduce((sum, p) => sum + p.efficiency, 0) / analyzedPairings.length).toFixed(2)}\n`;

        return {
          response: responseText,
          data: {
            bestPairings: topBestPairings,
            totalFound: analyzedPairings.length,
            criteria: criteria,
            pairingDays: args.pairingDays,
            analysisType: 'Best Pairings Analysis'
          },
          truncated: topBestPairings.length < analyzedPairings.length
        };

      case 'getLayoverAnalysis':
        const allPairingsForLayover =
          await this.storage.getPairings(bidPackageId);
        const targetCity = args.city;
        const requestedCount = args.count || 10;
        const minDuration = args.minDuration || 0;

        // Collect all layovers
        const allLayovers: any[] = [];

        allPairingsForLayover.forEach(pairing => {
          if (pairing.layovers && Array.isArray(pairing.layovers)) {
            pairing.layovers.forEach((layover: any) => {
              // Filter by city if specified
              if (targetCity && layover.city !== targetCity) {
                return;
              }

              // Parse duration
              const durationStr = layover.duration?.toString() || '0';
              let durationHours = 0;

              if (durationStr.includes(':')) {
                const [hours, minutes] = durationStr.split(':').map(Number);
                durationHours = hours + minutes / 60;
              } else if (durationStr.includes('.')) {
                const [hours, minutes] = durationStr.split('.').map(Number);
                durationHours = hours + minutes / 60;
              } else {
                durationHours = parseFloat(durationStr);
              }

              if (durationHours >= minDuration) {
                allLayovers.push({
                  city: layover.city,
                  hotel: layover.hotel,
                  duration: durationStr,
                  durationHours: durationHours,
                  pairingNumber: pairing.pairingNumber,
                  creditHours: pairing.creditHours,
                  holdProbability: pairing.holdProbability,
                  route: pairing.route,
                });
              }
            });
          }
        });

        const sortedLayovers = allLayovers
          .sort((a, b) => b.durationHours - a.durationHours)
          .slice(0, requestedCount);

        // Group by city for summary stats
        const cityStats = allLayovers.reduce((acc, layover) => {
          if (!acc[layover.city]) {
            acc[layover.city] = { count: 0, totalDuration: 0, avgDuration: 0 };
          }
          acc[layover.city].count++;
          acc[layover.city].totalDuration += layover.durationHours;
          return acc;
        }, {} as any);

        // Calculate averages
        Object.keys(cityStats).forEach(city => {
          cityStats[city].avgDuration =
            cityStats[city].totalDuration / cityStats[city].count;
        });

        // Format the response with actual layover details
        let layoverResponseText = `Found ${allLayovers.length} layovers${targetCity ? ` in ${targetCity}` : ''}${minDuration > 0 ? ` longer than ${minDuration} hours` : ''}.`;

        if (sortedLayovers.length > 0) {
          layoverResponseText += `\n\nLayover Details:\n`;
          sortedLayovers.forEach((layover, index) => {
            layoverResponseText += `${index + 1}. Pairing ${layover.pairingNumber}: ${layover.city} layover (${layover.duration} hours)${layover.hotel ? ` at ${layover.hotel}` : ''}\n`;
          });
        } else {
          layoverResponseText += ` No layovers found matching your criteria.`;
        }

        return {
          response: layoverResponseText,
          data: {
            targetCity,
            longestLayovers: sortedLayovers.map(layover => ({
              city: layover.city,
              hotel: layover.hotel,
              duration: layover.duration,
              durationHours: layover.durationHours.toFixed(2),
              pairingNumber: layover.pairingNumber,
              creditHours: this.formatHours(
                parseFloat(layover.creditHours.toString())
              ),
              holdProbability: layover.holdProbability,
              route: layover.route,
            })),
            totalLayovers: allLayovers.length,
          },
          truncated: sortedLayovers.length < allLayovers.length,
        };

      default:
        throw new Error(`Unknown function: ${functionName}`);
    }
  }

  private shouldSkipOpenAI(message: string): boolean {
    return ['all pairings', 'full dataset', 'complete list'].some(pattern =>
      message.toLowerCase().includes(pattern)
    );
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

  private getSystemPrompt(bidPackageInfo?: any): string {
    const bidPackageDisplay = bidPackageInfo
      ? `${bidPackageInfo.base} ${bidPackageInfo.aircraft} ${bidPackageInfo.month} ${bidPackageInfo.year} Bid Package`
      : 'the current bid package';

    return `You are a Delta PBS Bid Optimization Assistant. Analyze pilot pairing data and provide specific, actionable insights.

When providing analysis, refer to the bid package as "${bidPackageDisplay}" instead of using generic terms like "bid package #27".

When provided with pairing data:
- Always show the actual pairing numbers found
- Include key metrics like credit hours, block hours, efficiency ratios, and hold probabilities
- For layover analysis, show the city, hotel, duration, and associated pairing information
- For check-in time queries, show the exact count and list matching pairings with their check-in times
- If no pairings match the criteria, clearly state this
- For 4-day pairing requests, focus on the 4-day pairings specifically
- Provide practical bidding advice based on the data

IMPORTANT FOR "BEST" PAIRING REQUESTS:
- When asked for "best" pairings, use the findBestPairings function
- Always analyze and rank by multiple criteria (credit, efficiency, hold probability, overall score)
- Provide specific reasoning for why each pairing is recommended
- If asked for a specific number (e.g., "2 best"), limit your response to that number
- Explain the ranking criteria used
- Be specific about what makes each pairing desirable

CRITICAL FOR LAYOVER QUERIES:
- When a specific city is mentioned (e.g., "layovers in DFW"), ONLY show layovers in that exact city
- If the data is filtered for a specific city, confirm this in your response (e.g., "The longest layovers in DFW are:")
- Do not mix layovers from different cities when a specific city is requested
- If no layovers exist in the requested city, clearly state this

IMPORTANT: When displaying hours, use the exact Delta PBS format as provided in the data:
- Show credit hours like: "28.19 credit hours" (not "28 hours and 19 minutes")
- Show block hours like: "16.58 block hours" (not "16 hours and 58 minutes")
- For layover durations, show ONLY the original format from the bid package (e.g., "28.53 hours")
- Do NOT add decimal conversions or explanations in parentheses
- Match the exact format from the bid package data

Use the backend-processed summaries to provide accurate analysis within token limits.`;
  }

  private getAvailableFunctions(): any[] {
    return [
      {
        type: 'function',
        function: {
          name: 'getTopEfficientPairings',
          description: 'Get top efficient pairings (credit-to-block ratio)',
          parameters: {
            type: 'object',
            properties: {
              limit: { type: 'number', description: 'Max pairings to return' },
            },
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'getPairingsByDuration',
          description:
            'Get pairings by specific duration (1-day, 2-day, 3-day, 4-day, 5-day, etc.)',
          parameters: {
            type: 'object',
            properties: {
              days: {
                type: 'number',
                description: 'Number of days (1, 2, 3, 4, 5, etc.)',
              },
              limit: { type: 'number', description: 'Max pairings to return' },
              minEfficiency: {
                type: 'number',
                description: 'Minimum credit-to-block ratio',
              },
              minHoldProb: {
                type: 'number',
                description: 'Minimum hold probability',
              },
            },
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'getMultiDayAnalysis',
          description:
            'Get analysis of all multi-day pairings (2+ days) grouped by duration',
          parameters: {
            type: 'object',
            properties: {
              limit: {
                type: 'number',
                description: 'Max pairings per duration group',
              },
            },
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'getLayoverAnalysis',
          description:
            'Analyze layovers by city, duration, or find longest layovers',
          parameters: {
            type: 'object',
            properties: {
              city: { type: "string", description: "3-letter airport code (e.g., DFW, ATL)" },
              count: { type: "number", description: "Number of layovers to return (default 10)" },
              minDuration: { type: "number", description: "Minimum layover duration in hours" }
            }
          }
        }
      },
      {
        type: "function",
        function: {
          name: "findBestPairings",
          description: "Find the best pairings based on multiple criteria like credit hours, efficiency, hold probability, and layover quality",
          parameters: {
            type: "object",
            properties: {
              pairingDays: { type: "number", description: "Filter by number of pairing days (1, 2, 3, 4, 5, etc.)" },
              limit: { type: "number", description: "Number of top pairings to return (default: 5)" },
              criteria: { type: "string", description: "Primary criteria for ranking: 'credit', 'efficiency', 'hold_probability', or 'overall'" }
            }
          }
        }
      }
    ];
  }
}
