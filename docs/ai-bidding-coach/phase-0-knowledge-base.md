# AI Bidding Coach - Phase 0 Knowledge Base

This file is the first compact knowledge layer for the AI Bidding Coach. It summarizes the NAVBLUE and Delta PBS reference material into assistant-ready concepts without replacing the source PDFs.

## Source Documents

- `docs/navblue-pbs-bidder-guide (1).pdf` - NAVBLUE N-PBS Bidder Guide 21-3.
- `docs/PBS Reference Handbook.pdf` - Delta Pilots' PBS Reference Handbook, Version 4, February 2025.

## Core Model

PBS is a seniority-ordered, top-down line builder. More senior pilots are processed first, so the available pairing pool shrinks before junior pilots are considered.

A bid is organized into bid groups. Pairing bid groups and reserve bid groups are independent attempts. PBS stays in a bid group until it builds an award, an instruction moves processing to the next group, or the pilot cannot hold that type of line.

Bid groups can be unconditional or conditional. An unconditional pairing group ultimately accepts any legal regular line PBS can build inside that group. A conditional group uses instructions such as `Else Start Next Bid Group` or `Clear Schedule and Start Next Bid Group` to control when PBS should abandon that group and try the next one.

Regular lines are built inside the Line Construction Window around the Average Line Value, with vacation/training/sick credit, FAR limits, PWA limits, and coverage constraints affecting what is possible.

## Preference Grammar

| Preference                                | Role                         | Coach Use                                                                                                                                                 |
| ----------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Award Pairings`                          | Positive pairing selector    | Use for desired trip lengths, dates, routes, layovers, credit ranges, or named pairings. Put narrow/high-value requests before broader fallback requests. |
| `Avoid Pairings`                          | Negative pairing selector    | Use for trips the pilot wants to exclude. Warn that avoid preferences may be denied if they prevent PBS from building a complete line.                    |
| `Prefer Off`                              | Negative calendar selector   | Use for must-have days off, weekends, and holidays. Date order matters when multiple dates compete.                                                       |
| `Set Condition`                           | Line-construction constraint | Use for line-level goals such as minimum, maximum, or mid credit. These are not pairing filters.                                                          |
| `Else Start Next Bid Group`               | Conditional exit             | Use when a specific preference is a boundary: if PBS cannot honor it, move to the next group.                                                             |
| `Clear Schedule and Start Next Bid Group` | Clean fallback exit          | Use after a focused strategy when the pilot wants a fresh fallback group rather than system-generated completion or denied negatives.                     |
| `Waive`                                   | Protection tradeoff          | Only include after explicit pilot confirmation. Explain the tradeoff plainly.                                                                             |
| Reserve bid group                         | Fallback or reserve strategy | Keep reserve goals separate from pairing awards. Ask whether the pilot prefers a lower-quality regular line or reserve with protected dates.              |

## Strategy Archetypes

### Quality Of Life First

Use when the pilot prioritizes days off, fatigue control, or avoiding undesirable work. Start with `Prefer Off` and high-priority `Avoid Pairings`, then add acceptable `Award Pairings`. Use a conditional exit if the pilot would rather fall back than have must-have preferences denied.

### Maximize Credit

Use when pay is the priority. Consider `Set Condition Maximum Credit`, then award high-credit and efficient pairings. Keep fatigue or route avoidances explicit and limited so the line remains buildable.

### Specific Pairing Wishlist

Use when the app identifies exact target pairings. Draft ordered `Pairing Number Departing On` style award lines first, then add similar-trip fallback lines based on attributes such as layover, trip length, or credit.

### Holiday Protection

Use when the pilot wants specific holiday dates off. Prioritize dates truthfully, add award lines around the protected windows, and warn that coverage risk is higher around holidays, especially for junior bidders.

## Coach Interview Checklist

Before drafting, ask for missing goal inputs:

- Pay priority: maximize credit, mid-credit, or lighter month.
- Quality-of-life priority: exact dates off, weekends, report/release constraints, commute needs.
- Trip preference: turns, 2-day, 3-day, 4-day, 5-day, high efficiency, specific pairings.
- Layover/route preferences: preferred cities, avoided cities, deadheads, redeyes.
- Risk tolerance: whether to chase harder-to-hold trips or build a conservative fallback.
- Reserve tolerance: whether reserve is acceptable if regular-line goals fail.
- Waiver tolerance: only if the pilot explicitly wants to discuss waivers.

## Current Boundaries

Phase 0 does not simulate PBS awards. The coach can explain and draft strategy, but it should not guarantee an award, a day off, or a pairing result. Predictions must remain tied to the app's hold probability and, later, the planned simulator.

Phase 0 draft bid text should be labeled as a review-ready starting draft. Do not call it copy-and-paste-ready until the exporter exists and can render verified NAVBLUE syntax.

Phase 1 should use this knowledge inside the existing chat panel to interview the pilot and draft pasteable NAVBLUE bid text.
