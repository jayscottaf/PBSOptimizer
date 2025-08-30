import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export class OpenAIAssistantService {
  /**
   * Ask the PBS Assistant a question and get a response using chat completion
   */
  async askPBSAssistant(question: string): Promise<string> {
    try {
      console.log('Starting PBS Assistant chat completion...');

      // Validate API key exists
      if (!process.env.OPENAI_API_KEY) {
        throw new Error('OPENAI_API_KEY environment variable is not set');
      }

      // Use chat completion instead of Assistant API
      const completion = await openai.chat.completions.create({
        model: 'gpt-4',
        messages: [
          {
            role: 'system',
            content: `You are an expert Delta Airlines pilot bid analysis assistant specializing in PBS (Preferential Bidding System). You help pilots understand their bid packages, analyze pairings, and make informed bidding decisions.

TERMINOLOGY:
- Pairings/Trips: Flight sequences with the same crew
- Credit Hours: Pay time (what you get paid for)
- Block Hours: Actual flight time
- TAFB: Time Away From Base (total trip duration)
- Layovers: Rest periods between flights
- Hold Probability: Likelihood of being awarded the pairing (0-100%)
- Turns: 1-day trips (out and back same day)
- Multi-day: 2+ day trips with overnight layovers
- Deadheads: Traveling as passenger to position for duty

ANALYSIS CAPABILITIES:
- Search and filter pairings by credit hours, block time, TAFB
- Analyze layover cities and durations
- Compare hold probabilities across pairings
- Identify high-value vs efficient pairings
- Explain bidding strategies

Provide helpful, conversational responses with clear explanations. When discussing specific pairings, reference their key metrics (credit hours, block time, TAFB, layovers).`,
          },
          {
            role: 'user',
            content: question,
          },
        ],
        max_tokens: 1000,
        temperature: 0.7,
      });

      const response = completion.choices[0]?.message?.content;
      if (!response) {
        throw new Error('No response from OpenAI');
      }

      console.log(
        'Chat completion response received:',
        response.substring(0, 100) + '...'
      );
      return response;
    } catch (error: unknown) {
      console.error('OpenAI Chat Completion error:', error);
      // Return a more helpful error message
      if (error instanceof Error && error.message.includes('API key')) {
        throw new Error(
          'OpenAI API key is missing or invalid. Please check your configuration.'
        );
      } else if (
        error instanceof Error &&
        error.message.includes('rate limit')
      ) {
        throw new Error(
          'OpenAI rate limit exceeded. Please try again in a moment.'
        );
      } else {
        throw new Error(
          `Failed to get response from PBS Assistant: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }
}

export const openaiAssistant = new OpenAIAssistantService();
