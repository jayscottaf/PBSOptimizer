# OpenAI Token Optimization Plan — PBS Assistant

**Created:** 2026-08-08
**Scope:** `server/ai/simpleAI.ts` (primary), `server/routes.ts` (read-only reference)
**Goal:** Cut OpenAI input-token cost and reduce `context_length_exceeded` risk **without changing what the assistant knows or how it answers.**

---

## 0. Background — why this file exists

An audit of the OpenAI dashboard (billing period Jul 24 – Aug 8, 2026) found:

| API Key (app) | Spend | Requests | Input tokens |
|---|---|---|---|
| **PBS Help (this app)** | **$8.03** | 537 | **22.38M** |
| High Peaks Ledger | $0.16 | 61 | 76K |
| DailyPulse | $0.14 | 79 | 84K |
| 7 other keys | $0.00 | 0 | 0 |

PBS Help is **96% of all OpenAI spend** across every repo, and averages
**~41,700 input tokens per API call** (22.38M / 537). Everything else is noise.

Absolute dollars are currently low — the effective rate works out to roughly
$0.36/1M tokens, well under gpt-4.1 list input price, which means OpenAI's
automatic prompt-prefix caching is already absorbing a large share. **So this
is not an emergency.** It matters because:

1. The per-call baseline scales linearly with usage — 10x the pilots is 10x this.
2. `context_length_exceeded` is already a handled error path
   (`server/routes.ts:2975`), meaning large bid packages have hit the ceiling.
3. Latency tracks payload size, and this is a chat UI.

---

## 1. IMPORTANT — a correction to carry into this work

An earlier pass at this suggested *"stop re-sending the pairings dump on each
tool-loop round."* **That recommendation was wrong. Do not implement it.**

Reasons:

- The Chat Completions API is **stateless**. Every round of a tool-calling loop
  *must* resend the full message array. You cannot omit the earlier user message.
- Rounds 1–4 of the loop already share a **byte-identical prefix** with round 0,
  so they already get near-full cache hits today. Rewriting or trimming that
  prefix mid-loop would **invalidate the cache and make cost worse.**

The actual gap is **across turns**, not within a turn. See below.

---

## 2. Root cause

In `server/ai/simpleAI.ts`, the message array is assembled as
(`simpleAI.ts:86-102`):

```ts
const messages: any[] = [
  { role: 'system', content: systemPrompt },   // stable per (bidPackage, user)
];

if (query.conversationHistory && query.conversationHistory.length > 0) {
  messages.push(...query.conversationHistory); // grows, capped at 8
}

messages.push({
  role: 'user',
  content: `${pairingsContext}\n\nUser Question: ${query.message}`,  // ← the whole bid package
});
```

`pairingsContext` is the **entire bid package rendered as text**
(`buildPairingsContext`, `simpleAI.ts:334-350`) — every pairing, every turn.

**The problem is its position.** OpenAI's prompt caching keys on the longest
common *prefix*. Because the pairings live in the **newest** message:

- Turn 1 array: `[system, ...history, USER(pairings + Q1)]`
- Turn 2 array: `[system, ...history + Q1/A1, USER(pairings + Q2)]`

The common prefix between turns ends at the system prompt + older history. The
pairings block sits **after** the divergence point, so it is **billed as fresh,
uncached input on every single turn of every session.** That is the ~30–35K
tokens/call that dominates the bill.

Meanwhile the ~24KB (~6K token) `biddingCoachKnowledge` block is already inside
the system prompt, so it *is* cached correctly. Leave it alone.

The 8-message history cap (`routes.ts:2930`) is also already correct. Leave it.

---

## 3. The changes

Two changes. Both are **information-preserving** — the model sees exactly the
same data, just positioned and encoded better.

### Step 1 — Instrument first (do this before touching anything else)

You cannot verify a token optimization you never measured. In the tool loop
(`simpleAI.ts:148-155`), log usage on every round:

```ts
for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
  const completion = await openai.chat.completions.create({
    model: 'gpt-4.1',
    temperature: 0.7,
    max_completion_tokens: 2000,
    messages,
    tools: COACH_TOOL_DEFINITIONS,
  });

  const u = completion.usage;
  const cached = (u as any)?.prompt_tokens_details?.cached_tokens ?? 0;
  console.log(
    `[SimpleAI] round=${round} prompt=${u?.prompt_tokens} cached=${cached} ` +
    `uncached=${(u?.prompt_tokens ?? 0) - cached} completion=${u?.completion_tokens}`
  );
  // ... existing logic unchanged
```

Run a **3–4 turn conversation** against a real bid package and record the
numbers. The signature you expect to see confirming the diagnosis: on turns 2+,
`cached` stays roughly flat (just system + history) while `uncached` stays high
(~30K), because the pairings are re-billed every turn.

**Keep this logging in.** It is cheap and it is how you verify Steps 2 and 3.

---

### Step 2 — Move the pairings block into the cacheable prefix (the big win)

Replace the message assembly at `simpleAI.ts:86-102` with:

```ts
const messages: any[] = [
  { role: 'system', content: systemPrompt },
  // Stable per (bidPackage, user). Kept immediately after the system message
  // so it lands inside the cacheable prompt prefix and is reused across every
  // turn in a session, instead of being re-billed at full price each turn.
  { role: 'user', content: pairingsContext },
  {
    role: 'assistant',
    content:
      'Pairing data for this bid package is loaded. Ask me about it.',
  },
];

// Add conversation history if provided
if (query.conversationHistory && query.conversationHistory.length > 0) {
  messages.push(...query.conversationHistory);
}

// Current question only — the pairing data is already in context above.
messages.push({
  role: 'user',
  content: `User Question: ${query.message}`,
});
```

The short `assistant` acknowledgement keeps the turn structure natural now that
history follows a data blob. It costs ~15 tokens and is itself cached. If it
causes any oddness in testing, drop it — it is not load-bearing.

**Also add a one-line pointer to the system prompt** so the model knows where
the data went. In `buildSystemPrompt` (`simpleAI.ts:371+`), inside the
`IMPORTANT RULES` block, add:

```
8. The full pairing list for this bid package is provided as a data block
   earlier in this conversation — analyze it directly.
```

Put the pointer in the **system prompt**, not the user message: the system
prompt is cached, so it is effectively free after the first call.

**Effect:** turn 1 of a session still pays full price for the pairings. Turns
2..N drop them to the cached rate. Multi-turn sessions — which is the normal
usage pattern — get the large cut.

**Caveat to watch in testing:** the pairings now sit *before* up to 8 messages
of history rather than immediately adjacent to the question. GPT-4.1 handles
long context well and the system prompt explicitly instructs it to analyze the
data, so risk is low — but this is exactly what the smoke test in Step 4 is for.

---

### Step 3 — Compact the encoding (helps turn 1 and context limits)

`buildPairingsContext` (`simpleAI.ts:334-350`) currently repeats a full set of
labels on **every** row:

```
Pairing 12345: 4d | 24.5cr | 20.1blk | 98:30 TAFB | 75% hold | Route: ATL-JFK-BOS-ATL | Layovers: JFK (14:20), BOS (11:05)
```

That is roughly 15–20 tokens per row of pure boilerplate (`Pairing `, `d | `,
`cr | `, `blk | `, ` TAFB | `, `% hold | Route: `, ` | Layovers: `). Across a
package of several hundred to a thousand+ pairings that is **10–25K tokens of
repeated labels**.

Replace with a header + delimited rows:

```ts
private buildPairingsContext(pairings: any[]): string {
  const lines = [
    'AVAILABLE PAIRINGS',
    'Pipe-delimited. Columns: id|days|credit|block|tafb|hold_pct|route|layovers',
    'layovers: CITY:DURATION separated by ";" (empty when none)',
  ];

  pairings.forEach(p => {
    const layovers = Array.isArray(p.layovers) ? p.layovers : [];
    const layoverInfo = layovers
      .map((l: any) => `${l.city}:${l.duration || '?'}`)
      .join(';');

    lines.push(
      `${p.pairingNumber}|${p.pairingDays}|${p.creditHours}|${p.blockHours}|` +
      `${p.tafb}|${p.holdProbability}|${p.route}|${layoverInfo}`
    );
  });

  return lines.join('\n');
}
```

Pipe delimiter (not comma) is deliberate — routes are hyphen-joined but verify
no field contains a `|` before committing. Expect roughly **30–45%** off the
pairings block; confirm with the Step 1 logging rather than trusting the estimate.

This helps the uncached turn-1 cost *and* pushes back the
`context_length_exceeded` ceiling for large packages.

---

## 4. Verification

Run in order. Do not skip the manual conversation check — the automated checks
do not evaluate answer *quality*.

```bash
npm run check
```

```bash
npm run lint
```

```bash
npm run check:bid-tools
```

Then start the dev server and run the smoke test:

```bash
npm run dev
```

```bash
npm run smoke
```

**Manual quality check (the important one).** With a real bid package loaded,
run the same 3–4 turn conversation you baselined in Step 1 and confirm:

- [ ] It still cites **specific pairing numbers** (rule #6 in the system prompt).
- [ ] It still answers layover/rest-duration questions from the data — it must
      **not** regress into "I can't filter by that" (rule #1 exists precisely
      to prevent this).
- [ ] Multi-turn follow-ups still resolve against the pairing data, not just
      the last answer. Ask a turn-3 question that requires re-reading the data.
- [ ] The tool loop still fires — ask it to build/optimize a bid and confirm
      `[SimpleAI] Tool call: ...` appears and a NAVBLUE draft comes back.
- [ ] `pairingNumbers` still comes back populated in the API response
      (`extractPairingNumbers`, used by the client to highlight rows).

**Token check:** compare the Step 1 log output before vs. after. Success looks
like `uncached` dropping sharply on turns 2+, and total `prompt` dropping on
every turn from the Step 3 re-encoding.

**Billing check:** the per-request average is the honest scoreboard. Watch
[platform.openai.com/usage](https://platform.openai.com/usage) filtered to the
**PBS Help** key over the following week and compare tokens ÷ requests against
the current ~41.7K baseline. Dashboard numbers lag, so give it a few days.

---

## 5. Explicitly NOT in scope

- **Do not** trim or rewrite the message array between tool rounds — see §1.
  It breaks caching and cannot work with a stateless API.
- **Do not** switch models. `gpt-4.1` is a deliberate choice here.
- **Do not** filter the pairings list down to "relevant" ones as part of this
  change. It is tempting and it would save the most tokens, but it directly
  conflicts with system-prompt rule #1 ("ANALYZE the actual pairing data
  provided — don't say 'I can't filter by that'") and risks real answer-quality
  regressions. If you want it, do it **after** Steps 2–3 are verified, as a
  separate change, implemented as an on-demand `search_pairings` tool
  (`storage.searchPairings` already supports credit/block/TAFB/days/hold
  filters — see `server/storage.ts:96`) with its own quality evaluation.
- **Do not** touch `MAX_HISTORY_MESSAGES` (`routes.ts:2930`) or the
  `biddingCoachKnowledge` block — both are already correctly positioned.

---

## 6. Rollback

All changes are confined to `server/ai/simpleAI.ts`. Work on a branch:

```bash
git checkout -b perf/openai-token-optimization
```

If anything regresses:

```bash
git checkout main -- server/ai/simpleAI.ts
```

Steps 2 and 3 are independent — Step 3 (encoding) can ship alone if Step 2
(repositioning) shows any answer-quality regression, and vice versa.

---

## 7. Suggested commit sequence

1. `perf(ai): log OpenAI token usage per tool round` — Step 1, ships alone, no
   behavior change, establishes the baseline.
2. `perf(ai): move pairing context into cacheable prompt prefix` — Step 2.
3. `perf(ai): compact pairing context encoding` — Step 3.

Keeping them separate means the token logs attribute the win to the right
change, and a regression can be bisected to one commit.
