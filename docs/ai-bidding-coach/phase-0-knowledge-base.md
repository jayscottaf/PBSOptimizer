# AI Bidding Coach — Knowledge Base

The live knowledge base is code: `server/ai/biddingCoachKnowledge.ts`. It is
injected into the coach's system prompt by `server/ai/simpleAI.ts`. There is
no separate JSON copy — earlier snapshots drifted from the code and were
removed.

Rule content in the TS module is verified against the page-cited
extractions from the two official guides:

- `docs/ai-bidding-coach/navblue-rules.md` — NAVBLUE N-PBS Bidder's Guide,
  Release 21-3 (bid grammar, award engine mechanics: substitution, vertical
  swapping, shuffling, Denial Mode, SLG, coverage; Reasons Report
  vocabulary).
- `docs/ai-bidding-coach/delta-rules.md` — Delta MEC PBS Reference
  Handbook v4, Feb 2025 (ALV/LCW/BHL numbers, credit windows, Slide
  Vacation/PVPP, redeye definition, PWA/FAR constraints, the handbook's own
  strategy guidance).

To change coach behavior: update the rules docs from the PDFs first, then
edit `biddingCoachKnowledge.ts` to match, citing pages in `sourceRefs`.

## Boundaries (still true)

- The coach drafts **review-ready** bid text, not verified NAVBLUE syntax —
  exact-syntax export is the job of the future exporter.
- The coach must not promise awards; response sanitization in
  `simpleAI.ts` backstops guarantee-adjacent phrasing.
- Award prediction beyond hold probability requires the future simulator.
