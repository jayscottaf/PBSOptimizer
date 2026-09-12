**Review fixes — September 12, 2026**

Fixes are implemented, verified, and committed individually in numbered finding order from the application review. Application data is not used for destructive testing.

1. **Complete — personalized hold probabilities.** Centralized current-profile/history calculation for search, detail, favorites, simulation/optimization, and coach reads. Probability filtering, ordering, and statistics follow calculation. Profile/history changes invalidate client data and isolate offline caches. Verified: two new regression tests, 245 bid-tool assertions, TypeScript, lint, client build, local browser startup, and API smoke. Live package 61 returns 90% at the 10th percentile versus 10% at the 90th percentile, with correctly ordered results.

The repository-wide formatting check had 71 pre-existing failing files in the audit. New modules/tests are formatted; existing files are kept focused rather than reformatted wholesale in each bug fix.
