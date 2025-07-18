
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID || "asst_07IFIcu3kejuJQHiYq5ueiTC";

export class OpenAIAssistantService {
  /**
   * Ask the PBS Assistant a question and get a response
   */
  async askPBSAssistant(question: string): Promise<string> {
    try {
      // Create a new thread
      const thread = await openai.beta.threads.create();

      // Add the user's message to the thread
      await openai.beta.threads.messages.create(thread.id, {
        role: "user",
        content: question,
      });

      // Run the assistant
      const run = await openai.beta.threads.runs.create(thread.id, {
        assistant_id: ASSISTANT_ID,
      });

      // Poll for completion
      let runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);
      
      while (runStatus.status === 'queued' || runStatus.status === 'in_progress') {
        // Wait 1 second before checking again
        await new Promise(resolve => setTimeout(resolve, 1000));
        runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);
      }

      if (runStatus.status === 'completed') {
        // Get the assistant's response
        const messages = await openai.beta.threads.messages.list(thread.id);
        const assistantMessage = messages.data
          .filter(message => message.role === 'assistant')
          .sort((a, b) => b.created_at - a.created_at)[0];

        if (assistantMessage && assistantMessage.content[0]?.type === 'text') {
          return assistantMessage.content[0].text.value;
        } else {
          throw new Error('No response from assistant');
        }
      } else if (runStatus.status === 'requires_action') {
        // Handle function calls if the assistant needs to call backend functions
        return await this.handleRequiredActions(thread.id, run.id, runStatus);
      } else {
        throw new Error(`Assistant run failed with status: ${runStatus.status}`);
      }
    } catch (error) {
      console.error('OpenAI Assistant API error:', error);
      throw new Error('Failed to get response from PBS Assistant');
    }
  }

  /**
   * Handle function calls required by the assistant
   */
  private async handleRequiredActions(threadId: string, runId: string, runStatus: any): Promise<string> {
    const toolCalls = runStatus.required_action?.submit_tool_outputs?.tool_calls || [];
    const toolOutputs = [];

    for (const toolCall of toolCalls) {
      const functionName = toolCall.function.name;
      const functionArgs = JSON.parse(toolCall.function.arguments);

      console.log(`Assistant calling function: ${functionName} with args:`, functionArgs);

      let output;
      try {
        output = await this.executeFunction(functionName, functionArgs);
      } catch (error) {
        console.error(`Error executing function ${functionName}:`, error);
        output = { error: `Failed to execute ${functionName}: ${error.message}` };
      }

      toolOutputs.push({
        tool_call_id: toolCall.id,
        output: JSON.stringify(output),
      });
    }

    // Submit the tool outputs
    await openai.beta.threads.runs.submitToolOutputs(threadId, runId, {
      tool_outputs: toolOutputs,
    });

    // Continue polling for completion
    let updatedRun = await openai.beta.threads.runs.retrieve(threadId, runId);
    while (updatedRun.status === 'queued' || updatedRun.status === 'in_progress') {
      await new Promise(resolve => setTimeout(resolve, 1000));
      updatedRun = await openai.beta.threads.runs.retrieve(threadId, runId);
    }

    if (updatedRun.status === 'completed') {
      const messages = await openai.beta.threads.messages.list(threadId);
      const assistantMessage = messages.data
        .filter(message => message.role === 'assistant')
        .sort((a, b) => b.created_at - a.created_at)[0];

      if (assistantMessage && assistantMessage.content[0]?.type === 'text') {
        return assistantMessage.content[0].text.value;
      }
    }

    throw new Error('Failed to complete assistant run after function calls');
  }

  /**
   * Execute backend functions called by the assistant
   * These are placeholders that will connect to your PostgreSQL DB via Drizzle ORM
   */
  private async executeFunction(functionName: string, args: any): Promise<any> {
    // Import storage here to avoid circular dependencies
    const { storage } = await import('./storage');

    switch (functionName) {
      case 'searchPairings':
        return await storage.searchPairings(args);

      case 'analyzePairingsByLayover':
        return await this.analyzePairingsByLayover(storage, args);

      case 'getPairingStats':
        return await this.getPairingStats(storage, args);

      case 'findPairingsByDuration':
        return await this.findPairingsByDuration(storage, args);

      case 'findPairingByNumber':
        return await this.findPairingByNumber(storage, args);

      default:
        throw new Error(`Unknown function: ${functionName}`);
    }
  }

  // Helper functions (copied from your existing openai.ts for consistency)
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
        const aMaxLayover = Math.max(...a.layovers.map((l: any) => parseFloat(l.duration) || 0));
        const bMaxLayover = Math.max(...b.layovers.map((l: any) => parseFloat(l.duration) || 0));
        return bMaxLayover - aMaxLayover;
      });

    return layoverAnalysis.slice(0, 10);
  }

  private async getPairingStats(storage: any, params: any) {
    const pairings = await storage.searchPairings({ bidPackageId: params.bidPackageId });

    if (pairings.length === 0) {
      return { error: "No pairings found" };
    }

    const creditHours = pairings.map((p: any) => parseFloat(p.creditHours?.replace(':', '.')) || 0);
    const blockHours = pairings.map((p: any) => parseFloat(p.blockHours?.replace(':', '.')) || 0);
    const holdProbabilities = pairings.map((p: any) => p.holdProbability || 0);

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

  private async findPairingByNumber(storage: any, params: any) {
    const pairings = await storage.searchPairings({ 
      bidPackageId: params.bidPackageId,
      search: params.pairingNumber
    });

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

export const openaiAssistant = new OpenAIAssistantService();
