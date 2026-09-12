**Review fixes — September 12, 2026**

Fixes are implemented, verified, and committed individually in numbered finding order from the application review. Application data is not used for destructive testing.

1. **Complete — personalized hold probabilities.** Centralized current-profile/history calculation for search, detail, favorites, simulation/optimization, and coach reads. Probability filtering, ordering, and statistics follow calculation. Profile/history changes invalidate client data and isolate offline caches. Verified: two new regression tests, 245 bid-tool assertions, TypeScript, lint, client build, local browser startup, and API smoke. Live package 61 returns 90% at the 10th percentile versus 10% at the 90th percentile, with correctly ordered results.

The repository-wide formatting check had 71 pre-existing failing files in the audit. New modules/tests are formatted; existing files are kept focused rather than reformatted wholesale in each bug fix.

2. **Complete — distinct-pilot strategy ranks.** Deduplicated each period roster before computing percentiles. SQL uses the same cumulative roster convention as empirical hold evidence (including single-pilot periods). Verified with a read-only PostgreSQL fixture containing unequal preference counts, a populated live strategy query, 245 bid checks, TypeScript, lint, browser startup, and smoke.

3. **Complete — database recovery.** Publish a tested replacement through a live client binding, serialize reconnect attempts, close failed candidates, attach error handlers to every pool, and coordinate cleanup. Verified five regression tests including a real storage method under injected connection failure, concurrent recovery, and failed candidate cleanup; 245 bid checks; TypeScript; lint; local browser startup; and smoke.

4. **Complete — atomic, truthful Reasons imports.** Stage parsed records, then commit awards and preference replacement together. Propagate preparation/insertion failures and count committed rows only. Verified rollback after a second award batch fails, rollback of preference deletion, success counts, and HTTP 500 instead of success for an injected transaction failure. Tests use session-local tables and private sequences, not application records. TypeScript, lint, 245 bid checks, local browser startup, and smoke passed.
