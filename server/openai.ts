
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
        }
      ];

      const completion = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          {
            role: "system",
            content: `You are an expert airline pilot bid analysis assistant. You help pilots analyze pairing data to make informed bidding decisions. 

            Key context:
            - Pairings are airline trips with multiple flight segments
            - Credit hours = pay time, Block hours = actual flight time  
            - TAFB = Time Away From Base (trip duration)
            - Layovers are rest periods between flights with city and duration
            - Hold probability = likelihood of getting awarded the pairing
            - Higher seniority pilots have better chances of getting desired pairings

            When analyzing pairings, consider:
            - Credit-to-block ratio (efficiency)
            - Layover quality (duration and location)
            - Total trip duration vs. pay
            - Hold probability for the pilot's seniority level
            
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
    const pairings = await storage.searchPairings({ 
      bidPackageId: params.bidPackageId,
      pairingDays: params.days
    });
    
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
      }))
    };
  }
}
