import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export interface PairingAnalysisQuery {
  message: string;
  bidPackageId?: number;
}

export interface PairingAnalysisResponse {
  response: string;
  data?: any[];
}

export class PairingAnalysisService {
  async analyzeQuery(query: PairingAnalysisQuery, storage: any): Promise<PairingAnalysisResponse> {
    try {
      // Define available functions for ChatGPT to call
      const functions = [
        {
          name: "searchPairings",
          description: "Search for pairings based on criteria like credit hours, block time, layovers, destinations, etc.",
          parameters: {
            type: "object",
            properties: {
              bidPackageId: { type: "number", description: "ID of the bid package to search in" },
              search: { type: "string", description: "General search term for pairing numbers, destinations, or routes" },
              creditMin: { type: "number", description: "Minimum credit hours" },
              creditMax: { type: "number", description: "Maximum credit hours" },
              blockMin: { type: "number", description: "Minimum block hours" },
              blockMax: { type: "number", description: "Maximum block hours" },
              tafb: { type: "string", description: "TAFB filter (3d, 4d, 5d+)" },
              holdProbabilityMin: { type: "number", description: "Minimum hold probability percentage" },
              pairingDays: { type: "number", description: "Filter by specific number of pairing days (1, 2, 3, 4, 5, etc.)" },
              pairingDaysMin: { type: "number", description: "Minimum number of pairing days" },
              pairingDaysMax: { type: "number", description: "Maximum number of pairing days" }
            }
          }
        },
        {
          name: "analyzePairingsByLayover",
          description: "Analyze pairings by layover duration and location",
          parameters: {
            type: "object",
            properties: {
              bidPackageId: { type: "number", description: "ID of the bid package" },
              city: { type: "string", description: "Layover city (e.g., DFW, LGA, ATL)" },
              minDuration: { type: "number", description: "Minimum layover duration in hours" }
            }
          }
        },
        {
          name: "getPairingStats",
          description: "Get statistics about pairings like averages, counts, etc.",
          parameters: {
            type: "object",
            properties: {
              bidPackageId: { type: "number", description: "ID of the bid package" }
            }
          }
        },
        {
          name: "findPairingsByDuration",
          description: "Find pairings by specific duration (number of days)",
          parameters: {
            type: "object",
            properties: {
              bidPackageId: { type: "number", description: "ID of the bid package" },
              days: { type: "number", description: "Number of days (1, 2, 3, 4, 5, etc.)" }
            }
          }
        },
        {
          name: "findPairingByNumber",
          description: "Find a specific pairing by its pairing number",
          parameters: {
            type: "object",
            properties: {
              bidPackageId: { type: "number", description: "ID of the bid package" },
              pairingNumber: { type: "string", description: "The pairing number to search for" }
            }
          }
        }
      ];

      const completion = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          {
            role: "system",
            content: `You are an expert airline pilot bid analysis assistant specializing in PBS (Preferential Bidding System) analysis. You help pilots make informed bidding decisions by understanding natural language queries and translating them into precise database searches.

          TERMINOLOGY & CONCEPTS:
          - Pairings/Trips: Sequences of flights with same crew
          - Credit Hours: Pay time (what you get paid for)
          - Block Hours: Flight time (actual flying time) 
          - TAFB: Time Away From Base (total trip duration)
          - Layovers: Rest periods between flights (location + duration)
          - Hold Probability: Likelihood of being awarded the pairing (0-100%)
          - Turns: 1-day trips (out and back same day)
          - Multi-day: 2+ day trips with overnight layovers
          - Dead-heads: Traveling as passenger to position for duty

          NATURAL LANGUAGE UNDERSTANDING:
          When users say "high credit" → search creditMin: 20+
          When users say "good pay" → search creditMin: 15+  
          When users say "efficient" → look for good credit-to-block ratio
          When users say "short trips" → search pairingDays: 1-2
          When users say "long trips" → search pairingDays: 4+
          When users say "turns" → search pairingDays: 1
          When users say "4-day" → search pairingDays: 4
          When users say "high hold" → search holdProbabilityMin: 80
          When users say "senior" → search holdProbabilityMin: 70
          When users say "junior friendly" → search holdProbabilityMin: 30 or less
          When users say "good layovers" → use analyzePairingsByLayover with minDuration: 12+
          When users say "long layovers" → use analyzePairingsByLayover with minDuration: 24+
          When users say city names → use search parameter with city code

          SEARCH STRATEGY:
          1. Parse natural language for multiple criteria
          2. Translate to appropriate function parameters  
          3. Use most specific function available
          4. Provide context about why results match the query
          5. Highlight key insights (efficiency, hold probability, etc.)

          Always use the provided functions to query actual data rather than making assumptions.`
        },
          {
            role: "user",
            content: query.message
          }
        ],
        functions: functions,
        function_call: "auto"
      });

      const message = completion.choices[0].message;

      if (message.function_call) {
        // ChatGPT wants to call a function
        const functionName = message.function_call.name;
        const functionArgs = JSON.parse(message.function_call.arguments);

        let functionResult: any;

        switch (functionName) {
          case "searchPairings":
            // Add bidPackageId if not provided
            if (!functionArgs.bidPackageId && query.bidPackageId) {
              functionArgs.bidPackageId = query.bidPackageId;
            }
            functionResult = await storage.searchPairings(functionArgs);
            break;

          case "analyzePairingsByLayover":
            functionResult = await this.analyzePairingsByLayover(storage, functionArgs);
            break;

          case "getPairingStats":
            functionResult = await this.getPairingStats(storage, functionArgs);
            break;

          case "findPairingsByDuration":
            functionResult = await this.findPairingsByDuration(storage, functionArgs);
            break;

          case "findPairingByNumber":
            functionResult = await this.findPairingByNumber(storage, functionArgs);
            break;

          default:
            functionResult = { error: "Unknown function" };
        }

        // Send the function result back to ChatGPT for final response
        const finalCompletion = await openai.chat.completions.create({
          model: "gpt-4",
          messages: [
            {
              role: "system",
              content: `You are an expert airline pilot bid analysis assistant. Format your response in a helpful, conversational way. When presenting data, use clear formatting and highlight key insights.`
            },
            {
              role: "user",
              content: query.message
            },
            {
              role: "assistant",
              content: message.content,
              function_call: message.function_call
            },
            {
              role: "function",
              name: functionName,
              content: JSON.stringify(functionResult)
            }
          ]
        });

        return {
          response: finalCompletion.choices[0].message.content || "I couldn't analyze that data.",
          data: functionResult
        };
      } else {
        // Direct response without function call
        return {
          response: message.content || "I couldn't process that request."
        };
      }
    } catch (error) {
      console.error('OpenAI API error:', error);
      return {
        response: "I'm sorry, I encountered an error while analyzing your request. Please try again."
      };
    }
  }

  private async analyzePairingsByLayover(storage: any, params: any) {
    const pairings = await storage.searchPairings({ bidPackageId: params.bidPackageId });

    const layoverAnalysis = pairings
      .filter((pairing: any) => {
        if (!pairing.layovers || !Array.isArray(pairing.layovers)) return false;

        return pairing.layovers.some((layover: any) => {
          const matchesCity = !params.city || layover.city === params.city;
          const durationHours = parseFloat(layover.duration) || 0;
          const matchesDuration = !params.minDuration || durationHours >= params.minDuration;
          return matchesCity && matchesDuration;
        });
      })
      .map((pairing: any) => ({
        pairingNumber: pairing.pairingNumber,
        creditHours: pairing.creditHours,
        blockHours: pairing.blockHours,
        layovers: pairing.layovers.filter((layover: any) => {
          const matchesCity = !params.city || layover.city === params.city;
          const durationHours = parseFloat(layover.duration) || 0;
          const matchesDuration = !params.minDuration || durationHours >= params.minDuration;
          return matchesCity && matchesDuration;
        }),
        holdProbability: pairing.holdProbability
      }))
      .sort((a: any, b: any) => {
        // Sort by longest layover duration
        const aMaxLayover = Math.max(...a.layovers.map((l: any) => parseFloat(l.duration) || 0));
        const bMaxLayover = Math.max(...b.layovers.map((l: any) => parseFloat(l.duration) || 0));
        return bMaxLayover - aMaxLayover;
      });

    return layoverAnalysis.slice(0, 10); // Return top 10
  }

  private async getPairingStats(storage: any, params: any) {
    const pairings = await storage.searchPairings({ bidPackageId: params.bidPackageId });

    if (pairings.length === 0) {
      return { error: "No pairings found" };
    }

    const creditHours = pairings.map((p: any) => parseFloat(p.creditHours?.replace(':', '.')) || 0);
    const blockHours = pairings.map((p: any) => parseFloat(p.blockHours?.replace(':', '.')) || 0);
    const holdProbabilities = pairings.map((p: any) => p.holdProbability || 0);

    // Count pairings by duration
    const pairingsByDays = {};
    pairings.forEach((p: any) => {
      const days = p.pairingDays || 1;
      pairingsByDays[days] = (pairingsByDays[days] || 0) + 1;
    });

    return {
      totalPairings: pairings.length,
      averageCredit: (creditHours.reduce((a, b) => a + b, 0) / creditHours.length).toFixed(2),
      averageBlock: (blockHours.reduce((a, b) => a + b, 0) / blockHours.length).toFixed(2),
      averageHoldProbability: (holdProbabilities.reduce((a, b) => a + b, 0) / holdProbabilities.length).toFixed(1),
      highProbabilityPairings: pairings.filter((p: any) => p.holdProbability >= 80).length,
      mediumProbabilityPairings: pairings.filter((p: any) => p.holdProbability >= 50 && p.holdProbability < 80).length,
      lowProbabilityPairings: pairings.filter((p: any) => p.holdProbability < 50).length,
      pairingsByDays
    };
  }

  private async findPairingsByDuration(storage: any, params: any) {
    // First get all pairings to see what pairingDays values exist
    const allPairings = await storage.searchPairings({ 
      bidPackageId: params.bidPackageId
    });

    console.log(`Total pairings in bid package ${params.bidPackageId}: ${allPairings.length}`);
    console.log('Sample pairingDays values:', allPairings.slice(0, 10).map(p => ({ 
      pairingNumber: p.pairingNumber, 
      pairingDays: p.pairingDays 
    })));

    const pairings = await storage.searchPairings({ 
      bidPackageId: params.bidPackageId,
      pairingDays: params.days
    });

    console.log(`Found ${pairings.length} pairings with ${params.days} days`);

    return {
      count: pairings.length,
      days: params.days,
      pairings: pairings.map((p: any) => ({
        pairingNumber: p.pairingNumber,
        route: p.route,
        creditHours: p.creditHours,
        blockHours: p.blockHours,
        tafb: p.tafb,
        pairingDays: p.pairingDays,
        holdProbability: p.holdProbability
      })),
      // Add debug info
      allPairingDaysFound: [...new Set(allPairings.map(p => p.pairingDays))].sort()
    };
  }

  private async findPairingByNumber(storage: any, params: any) {
    const pairings = await storage.searchPairings({ 
      bidPackageId: params.bidPackageId,
      search: params.pairingNumber
    });

    console.log(`Searching for pairing number: ${params.pairingNumber}`);
    console.log(`Found ${pairings.length} pairings matching search`);

    // Filter to exact matches
    const exactMatches = pairings.filter((p: any) => 
      p.pairingNumber === params.pairingNumber
    );

    if (exactMatches.length === 0) {
      return {
        found: false,
        message: `Pairing ${params.pairingNumber} not found in bid package ${params.bidPackageId}`,
        similarPairings: pairings.slice(0, 5).map((p: any) => ({
          pairingNumber: p.pairingNumber,
          route: p.route
        }))
      };
    }

    const pairing = exactMatches[0];
    return {
      found: true,
      pairing: {
        pairingNumber: pairing.pairingNumber,
        route: pairing.route,
        creditHours: pairing.creditHours,
        blockHours: pairing.blockHours,
        tafb: pairing.tafb,
        pairingDays: pairing.pairingDays,
        holdProbability: pairing.holdProbability,
        layovers: pairing.layovers,
        effectiveDates: pairing.effectiveDates,
        payHours: pairing.payHours
      }
    };
  }
}