
import OpenAI from 'openai';
import { DatabaseStorage } from './storage';
import { HybridOpenAIService } from './openaiHybrid';

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
        },
        {
          name: "getPayAnalysis",
          description: "Analyze pay rates and compensation across pairings",
          parameters: {
            type: "object",
            properties: {
              bidPackageId: { type: "number", description: "ID of the bid package" },
              payType: { type: "string", description: "Type of pay analysis (credit, block, efficiency)" }
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
          When users mention specific numbers (e.g., "pairing 7813", "show me 7813") → use findPairingByNumber
          When users ask about "pairing details" with a number → use findPairingByNumber

          SEARCH STRATEGY:
          1. Parse natural language for multiple criteria
          2. Translate to appropriate function parameters  
          3. Use most specific function available
          4. Provide context about why results match the query
          5. Highlight key insights (efficiency, hold probability, etc.)

          IMPORTANT: You have full access to the pairing database through the provided functions. Never ask the user to provide pairing data or pay information - you can access all of this through the database functions. When users ask about pay, compensation, or any pairing analysis, use the available functions to get the actual data from the database.

          DATA LIMITATIONS: Due to response size limits, function results may show only the first few results (typically 3-5 pairings). When this happens, acknowledge the limitation and note that more results are available in the database. Focus on the key insights from the sample data provided.

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

          case "getPayAnalysis":
            functionResult = await this.getPayAnalysis(storage, functionArgs);
            break;

          default:
            functionResult = { error: "Unknown function" };
        }

        // Create a heavily summarized version of the function result to avoid token limits
        let summarizedResult = this.truncateForOpenAI(functionResult);

        // Send the summarized function result back to ChatGPT for final response
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
              content: JSON.stringify(summarizedResult)
            }
          ]
        });

        return {
          response: finalCompletion.choices[0].message.content || "I couldn't analyze that data.",
          data: functionResult // Return the full data to the client, even though we sent summarized to OpenAI
        };
      } else {
        // Direct response without function call
        return {
          response: message.content || "I couldn't process that request."
        };
      }
    } catch (error) {
      console.error('OpenAI API error:', error);
      
      // Check if it's a rate limit error
      if (error.message && error.message.includes('rate_limit_exceeded')) {
        return {
          response: "I'm experiencing high demand right now. Please try your question again in a moment."
        };
      }
      
      // Check if it's a context length error
      if (error.message && error.message.includes('context_length_exceeded')) {
        return {
          response: "Your query returned too much data to process at once. Please try asking for more specific information, such as filtering by specific criteria (e.g., 'show me 4-day pairings with high credit hours') or break it down into smaller questions."
        };
      }

      // Check if it's a token limit error (request too large)
      if (error.message && error.message.includes('Request too large')) {
        return {
          response: "The amount of data for your query is too large to process. Please try asking for more specific information (e.g., 'show me the top 5 highest credit pairings' or 'analyze 3-day pairings only') to get a more focused analysis."
        };
      }
      
      // Generic error with more helpful message
      return {
        response: "I encountered an error while analyzing your request. This might be due to a temporary issue with the AI service. Please try again, or try asking a more specific question about your pairings."
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
    console.log(`Searching for pairing number: ${params.pairingNumber} in bid package ${params.bidPackageId}`);
    
    // First try exact pairing number match
    const allPairings = await storage.searchPairings({ 
      bidPackageId: params.bidPackageId
    });
    
    console.log(`Total pairings in bid package: ${allPairings.length}`);
    
    // Try multiple search patterns
    const searchPatterns = [
      params.pairingNumber,
      params.pairingNumber.toString(),
      params.pairingNumber.padStart(4, '0'), // Try with leading zeros
      params.pairingNumber.padStart(5, '0')  // Try with more leading zeros
    ];
    
    let exactMatches = [];
    
    for (const pattern of searchPatterns) {
      exactMatches = allPairings.filter((p: any) => 
        p.pairingNumber === pattern || 
        p.pairingNumber?.toString() === pattern ||
        p.pairingNumber?.includes(pattern)
      );
      
      if (exactMatches.length > 0) {
        console.log(`Found ${exactMatches.length} matches with pattern: ${pattern}`);
        break;
      }
    }
    
    // If no exact matches, try partial matches
    if (exactMatches.length === 0) {
      const partialMatches = allPairings.filter((p: any) => 
        p.pairingNumber?.includes(params.pairingNumber) ||
        p.pairingNumber?.toString().includes(params.pairingNumber.toString())
      );
      
      console.log(`Found ${partialMatches.length} partial matches`);
      
      return {
        found: false,
        message: `Pairing ${params.pairingNumber} not found in bid package ${params.bidPackageId}`,
        searchedFor: params.pairingNumber,
        totalPairings: allPairings.length,
        similarPairings: partialMatches.slice(0, 5).map((p: any) => ({
          pairingNumber: p.pairingNumber,
          route: p.route
        })),
        // Add sample pairing numbers for debugging
        samplePairings: allPairings.slice(0, 10).map((p: any) => p.pairingNumber)
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
        payHours: pairing.payHours,
        fullText: pairing.fullText // Include full text for complete details
      }
    };
  }

  private truncateForOpenAI(functionResult: any): any {
    if (!functionResult) return functionResult;

    // Handle arrays of pairings - limit to 3 items max
    if (functionResult.pairings && Array.isArray(functionResult.pairings)) {
      const truncatedPairings = functionResult.pairings.slice(0, 3).map((pairing: any) => ({
        pairingNumber: pairing.pairingNumber,
        route: pairing.route?.substring(0, 100) || 'N/A',
        creditHours: pairing.creditHours,
        blockHours: pairing.blockHours,
        tafb: pairing.tafb,
        pairingDays: pairing.pairingDays,
        holdProbability: pairing.holdProbability,
        // Remove large text fields
        layovers: pairing.layovers ? pairing.layovers.slice(0, 2) : []
      }));

      return {
        ...functionResult,
        pairings: truncatedPairings,
        totalShown: Math.min(3, functionResult.pairings.length),
        totalFound: functionResult.pairings.length,
        note: functionResult.pairings.length > 3 ? `Showing first 3 of ${functionResult.pairings.length} results` : undefined
      };
    }

    // Handle single pairing result
    if (functionResult.pairing) {
      return {
        ...functionResult,
        pairing: {
          pairingNumber: functionResult.pairing.pairingNumber,
          route: functionResult.pairing.route?.substring(0, 100) || 'N/A',
          creditHours: functionResult.pairing.creditHours,
          blockHours: functionResult.pairing.blockHours,
          tafb: functionResult.pairing.tafb,
          pairingDays: functionResult.pairing.pairingDays,
          holdProbability: functionResult.pairing.holdProbability,
          layovers: functionResult.pairing.layovers ? functionResult.pairing.layovers.slice(0, 2) : [],
          effectiveDates: functionResult.pairing.effectiveDates?.substring(0, 50) || 'N/A',
          // Remove or truncate large text fields
          fullText: functionResult.pairing.fullText ? 
            functionResult.pairing.fullText.substring(0, 200) + "..." : 'N/A'
        }
      };
    }

    // Handle other result types (stats, analysis, etc.)
    if (functionResult.topPairings && Array.isArray(functionResult.topPairings)) {
      return {
        ...functionResult,
        topPairings: functionResult.topPairings.slice(0, 3).map((pairing: any) => ({
          pairingNumber: pairing.pairingNumber,
          creditHours: pairing.creditHours,
          dailyPay: pairing.dailyPay,
          efficiency: pairing.efficiency,
          holdProbability: pairing.holdProbability
        })),
        totalShown: Math.min(3, functionResult.topPairings.length),
        totalFound: functionResult.topPairings.length
      };
    }

    // For other result types, return as-is but remove any large text fields
    const cleanResult = { ...functionResult };
    if (cleanResult.fullText) {
      cleanResult.fullText = cleanResult.fullText.substring(0, 200) + "...";
    }
    if (cleanResult.details) {
      cleanResult.details = cleanResult.details.substring(0, 200) + "...";
    }

    return cleanResult;
  }

  private async getPayAnalysis(storage: any, params: any) {
    const pairings = await storage.searchPairings({ bidPackageId: params.bidPackageId });

    if (pairings.length === 0) {
      return { error: "No pairings found in this bid package" };
    }

    // Parse pay/credit hours (convert from HH:MM format to decimal)
    const parseHours = (timeStr: string) => {
      if (!timeStr) return 0;
      const [hours, minutes] = timeStr.split(':').map(Number);
      return hours + (minutes || 0) / 60;
    };

    const payData = pairings.map((p: any) => ({
      pairingNumber: p.pairingNumber,
      creditHours: parseHours(p.creditHours),
      blockHours: parseHours(p.blockHours),
      payHours: parseHours(p.payHours || p.creditHours), // Use payHours if available, fallback to creditHours
      pairingDays: p.pairingDays || 1,
      efficiency: parseHours(p.creditHours) / (parseHours(p.blockHours) || 1),
      dailyPay: parseHours(p.creditHours) / (p.pairingDays || 1),
      holdProbability: p.holdProbability || 0
    })).filter(p => p.creditHours > 0);

    // Sort by different criteria based on payType
    let sortedPairings = [...payData];
    if (params.payType === 'credit') {
      sortedPairings.sort((a, b) => b.creditHours - a.creditHours);
    } else if (params.payType === 'efficiency') {
      sortedPairings.sort((a, b) => b.efficiency - a.efficiency);
    } else {
      sortedPairings.sort((a, b) => b.dailyPay - a.dailyPay);
    }

    const stats = {
      totalPairings: payData.length,
      averageCredit: (payData.reduce((sum, p) => sum + p.creditHours, 0) / payData.length).toFixed(2),
      averageDailyPay: (payData.reduce((sum, p) => sum + p.dailyPay, 0) / payData.length).toFixed(2),
      averageEfficiency: (payData.reduce((sum, p) => sum + p.efficiency, 0) / payData.length).toFixed(2),
      highestCredit: Math.max(...payData.map(p => p.creditHours)).toFixed(2),
      highestDailyPay: Math.max(...payData.map(p => p.dailyPay)).toFixed(2),
      mostEfficient: Math.max(...payData.map(p => p.efficiency)).toFixed(2)
    };

    return {
      stats,
      topPairings: sortedPairings.slice(0, 10),
      payType: params.payType || 'general',
      analysisType: 'Pay and Compensation Analysis'
    };
  }
}

// Create and export hybrid service
const storage = new DatabaseStorage();
export const hybridService = new HybridOpenAIService(storage);
