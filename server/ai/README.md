# PBS AI Chat System

**ChatGPT-like experience for PBS pairing analysis**

## 🎯 Overview

This is a 3-stage AI pipeline that provides natural language query understanding for Delta Airlines pilot bid packages. It replaces the old dual-system architecture with a unified, cost-efficient, and reliable solution.

## 💰 Cost Savings

- **Before:** $333/month (deprecated GPT-4)
- **After:** $9/month (o4-mini + GPT-5 + caching)
- **Savings:** 97% reduction ($324/month)

## 🏗️ Architecture

### Stage 1: Intent Extraction (`intentExtractor.ts`)
- **Model:** o4-mini ($1.10 input / $4.40 output per 1M tokens)
- **Temperature:** 0.1 (low for consistency)
- **Task:** Extract structured JSON from natural language
- **Cost:** ~$0.001 per query

**Example:**
```
Input:  "show me efficient four-day trips for senior pilots"
Output: {
  filters: { pairingDays: 4, holdProbabilityMin: 70 },
  ranking: "efficiency",
  needsClarification: false
}
```

### Stage 2: Data Retrieval & Ranking (`rankingEngine.ts`)
- **Model:** None (pure PostgreSQL + backend logic)
- **Task:** Fetch real pairing data + deterministic ranking
- **Cost:** $0

**Features:**
- Deterministic "best" calculations (AI explains, doesn't decide)
- Weighted scoring based on seniority
- Zero hallucination risk (no AI involved)

### Stage 3: Response Generation (`responseGenerator.ts`)
- **Model:** GPT-5 ($1.25 input / $10.00 output per 1M tokens)
- **Temperature:** 0.6 (natural tone)
- **Task:** Generate conversational explanation using only Stage 2 data
- **Cost:** ~$0.0075 per query (cached: ~$0.0015)

**Example:**
```
Input:  Stage 2 data (47 pairings found)
Output: "I found 47 4-day pairings. Here are the top 5 by efficiency:
         1. Pairing 7892 - 1.43 ratio, 22.5 credit hours, 85% hold..."
```

## 📁 File Structure

```
server/ai/
├── config.ts              # Model configuration & costs
├── prompts.ts             # PBS-specific prompt templates
├── intentExtractor.ts     # Stage 1: Natural language → JSON
├── rankingEngine.ts       # Stage 2: Deterministic ranking
├── responseGenerator.ts   # Stage 3: Conversational responses
├── unifiedAI.ts          # Orchestrates all 3 stages
└── README.md             # This file
```

## 🚀 Usage

### Basic Query
```typescript
import { UnifiedAI } from './ai/unifiedAI';

const ai = new UnifiedAI(storage);

const result = await ai.analyzeQuery({
  message: "show me 4-day pairings",
  bidPackageId: 27,
  seniorityPercentile: 47.6
});

console.log(result.response); // Natural language explanation
console.log(result.data);     // Array of pairings
```

### Route Integration
```typescript
// server/routes.ts
app.post('/api/pbs-assistant/ask', async (req, res) => {
  const { question, bidPackageId, seniorityPercentile } = req.body;

  const ai = new UnifiedAI(storage);
  const result = await ai.analyzeQuery({
    message: question,
    bidPackageId,
    seniorityPercentile
  });

  res.json({
    reply: result.response,
    data: result.data
  });
});
```

## 🧪 Testing

Run the test suite to validate intent extraction:

```bash
npm test server/__tests__/aiEvaluation.test.ts
```

**Test Coverage:**
- 15 duration variations ("4-day" / "four day" / "quad trips")
- 7 credit/pay variations
- 5 efficiency variations
- 10 seniority/hold variations
- 4 city/layover variations
- 5 complex multi-criteria queries
- 4 ambiguous queries (clarification needed)

**Success Metrics:**
- ✅ 95%+ intent extraction accuracy
- ✅ 100% grounded responses (no hallucinated pairing numbers)
- ✅ < 3 second response time
- ✅ Natural language understanding for all phrasings

## 🔑 Key Features

### 1. Natural Language Understanding
**No regex patterns** - GPT-5/o4-mini understands all variations:
- "4-day" ✅
- "four day" ✅
- "4 day trips" ✅
- "quad pairings" ✅

### 2. Zero Hallucination
**Stage 2 provides ONLY real data** - AI cannot make up pairing numbers:
```typescript
// Stage 2: Database query returns actual pairings
const pairings = await storage.searchPairings({ pairingDays: 4 });

// Stage 3: AI ONLY sees this data, cannot access database
const response = await generateResponse(query, pairings);
```

### 3. Deterministic Rankings
**Backend calculates "best"** - AI explains but doesn't decide:
```typescript
// Ranking engine computes scores
const ranked = PairingRankingEngine.rankPairings(pairings, 'overall', seniorityPercentile);

// AI explains the ranking logic
const explanation = PairingRankingEngine.generateRankingExplanation(ranked);
```

### 4. Prompt Caching
**90% cost reduction on repeated queries:**
```typescript
// System prompts are cached automatically
messages: [
  {
    role: 'system',
    content: systemPrompt,
    cache_control: { type: 'ephemeral' } // 90% cheaper on cache hit
  }
]
```

## 📊 Cost Breakdown

### Per Query Costs

| Stage | Model | Input Tokens | Output Tokens | Cost (First) | Cost (Cached) |
|-------|-------|--------------|---------------|--------------|---------------|
| Intent | o4-mini | 500 | 100 | $0.001 | $0.0003 |
| Data | PostgreSQL | - | - | $0 | $0 |
| Response | GPT-5 | 2000 | 500 | $0.0075 | $0.0015 |
| **Total** | | | | **$0.0085** | **$0.0018** |

### Monthly Costs (100 queries/day)
- First query: $0.0085
- Cached (80%): $0.0018
- **Average:** $0.003/query
- **Monthly:** $9 (97% savings from $333)

## 🛠️ Configuration

Adjust models and parameters in `config.ts`:

```typescript
export const AI_CONFIG = {
  MODELS: {
    INTENT: 'o4-mini',      // Fast reasoning for JSON
    RESPONSE: 'gpt-5',       // Best quality for responses
  },
  TEMPERATURES: {
    INTENT: 0.1,             // Low = consistent
    RESPONSE: 0.6,           // Higher = natural
  },
  ENABLE_CACHING: true,      // 90% cost reduction
  MAX_PAIRINGS_IN_CONTEXT: 100,
};
```

## 🔄 Migration from Old System

### Before (Dual System)
```typescript
// Complex routing logic
if (isBestQuery) {
  const hybrid = new HybridOpenAIService(storage);
  // ...
} else {
  const natural = new PairingAnalysisService();
  // ...fallbacks...
}
```

### After (Unified)
```typescript
// Simple, single entry point
const ai = new UnifiedAI(storage);
const result = await ai.analyzeQuery({ message, bidPackageId, seniorityPercentile });
```

## 📝 Adding New Query Patterns

Add few-shot examples to `prompts.ts`:

```typescript
// In getIntentExtractionPrompt()
Query: "best layovers"
Response: {"filters": {}, "ranking": "overall", "needsClarification": false}
```

The AI will automatically understand new patterns!

## ⚠️ Deprecated Files

The following files are deprecated and will be removed:
- ❌ `server/openai.ts` (PairingAnalysisService)
- ❌ `server/openaiHybrid.ts` (HybridOpenAIService)

Use `server/ai/unifiedAI.ts` instead.

## 🎯 Future Enhancements

1. **Conversation Memory**
   - Store chat history per session
   - Reference previous queries

2. **Vector Search (RAG)**
   - Embed pairings in vector database
   - Semantic similarity search

3. **Streaming Responses**
   - Real-time token-by-token output
   - Better UX for long responses

4. **Multi-Turn Dialogues**
   - Follow-up questions without context loss
   - "Tell me more about pairing 7892"

## 📚 Resources

- [OpenAI Models Comparison](https://platform.openai.com/docs/models/compare)
- [Prompt Caching Guide](https://platform.openai.com/docs/guides/prompt-caching)
- [PBS Terminology](../CLAUDE.md#data-model-key-concepts)
