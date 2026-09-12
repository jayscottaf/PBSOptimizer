**PBS Optimizer application review — September 12, 2026**

The checkout was clean and two commits behind GitHub. It was fast-forwarded from `4bf69af` to `61c6e07` on `main`, matching `origin/main`. The incoming commits improve dashboard filtering and server query batching. This review applies to that updated code. No application fixes, dependency upgrades, database migrations, or deployments were performed during the review.

The most consequential issues affect the accuracy of recommendations and preservation of imported/user data. Performance improvements should follow those corrections: making incorrect or stale answers faster would not address the main problems.

**Verification completed**

| Check                                        | Result                                                                                                                      |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| TypeScript: `npm run check`                  | Passed                                                                                                                      |
| ESLint: `npm run lint`                       | Passed; this command uses `--quiet`, so warnings are suppressed                                                             |
| Client production build: `npm run build`     | Passed; main JS chunk 637.15 kB, 187.27 kB gzip                                                                             |
| Server bundle                                | Passed using the Vercel build's esbuild options, with output directed to `/tmp` to preserve tracked `api/index.js`          |
| Bid tools: `npm run check:bid-tools`         | Passed all 245 printed assertions                                                                                           |
| Formatting: `npm run format:check`           | Failed on 71 existing files                                                                                                 |
| Local development server and `npm run smoke` | Passed against the configured database; health, package metadata, data health, and pairing search worked                    |
| Browser                                      | Welcome and profile setup rendered; existing package data loaded behind the profile dialog                                  |
| Targeted probes                              | Reproduced probability, ranking, import, time conversion, cache-key, chat-context, and reconnection defects described below |
| `npm audit --omit=dev`                       | 23 flagged dependency nodes: 1 critical, 14 high, 6 moderate, 2 low                                                         |

Live database inspection was limited to reads. Failure-path tests substituted in-process database methods and synthetic report data, so they did not insert, delete, or modify application records. Browser inspection stopped at the required profile setup rather than saving a synthetic profile over the app's canonical user. No paid AI calls or live upload/delete tests were made. Actual Vercel deployment behavior and any externally configured access protection were not verified.

**Prioritized findings**

**1. P1 — Hold probabilities do not follow the pilot's seniority. Reproduced against the running API.**

The dashboard sends `seniorityPercentage`, but the search route recalculates only when stored probabilities are null. PDF ingestion defaults to the 50th percentile and writes non-null probabilities; the upload route does not supply the pilot's percentile. Saving the profile does not invoke the separate recalculation endpoint. As a result, changing the profile can leave both displayed odds and probability-based sorting based on the old/default profile.

For package 61, searches at the 10th and 90th percentiles returned identical probabilities for all 236 pairings. This is especially misleading because the UI describes the rankings as personalized. GET and POST pairing routes also implement different recalculation rules.

Fix: centralize calculation around the canonical pilot, package, category, and history revision. Recompute or invalidate when those inputs change. Apply probability filters and ordering to the resulting values. Include the relevant profile revision in client and coach caches. Test that a meaningful seniority change changes the results and that a profile save reaches this path.

Sources: [search recalculation](/Users/jasonmergl/dev/PBSOptimizer/server/routes.ts:2014), [parser default](/Users/jasonmergl/dev/PBSOptimizer/server/pdfParser.ts:1072), [profile save](/Users/jasonmergl/dev/PBSOptimizer/client/src/pages/dashboard.tsx:2671).

**2. P1 — Strategy analytics compute percentiles over preference rows instead of pilots. Reproduced with synthetic and current data.**

`getStrategyStats` places `DISTINCT` in the same SELECT as `percent_rank()`. The window function sees every preference row before DISTINCT removes duplicates. Pilots who submit more preferences therefore change other pilots' apparent seniority percentile. This selects the wrong comparison group for the coach's strategy evidence.

A three-pilot fixture with 100 preferences for the senior pilot and one each for the others ranked the middle pilot at **99.01% instead of 50%**. Across the current NYC/220-B dataset's 3,422 pilot-period combinations, the mean absolute deviation from a distinct-roster rank was **5.50 percentage points**, and the maximum was **18.29 points**. This measures the rank error, not the resulting change in every recommendation.

Fix: first create a distinct `(category, year, month, pilot)` roster in a separate CTE, then rank that roster, then join it to preferences. Standardize the percentile convention with `percentileWithin`, which currently uses a different formula. Add a regression where pilots have very different numbers of preferences.

Source: [strategy percentile query](/Users/jasonmergl/dev/PBSOptimizer/server/storage.ts:1514).

**3. P1 — Reconnection leaves application queries attached to the ended pool. Reproduced with stubbed pools.**

`db` is an exported constant bound to the original pool. `reconnectDatabase` ends that pool and returns a new Drizzle client, but recovery callers discard the returned client. Retried operations still close over the original `db`. Health checks use the new pool directly, so they can report recovery while normal queries remain broken.

The isolated probe confirmed all three conditions: the original pool was ended, exported `db` still referenced it, and the returned replacement used a different pool.

Fix: provide one stable database access abstraction whose active client can be replaced, serialize reconnection, and attach error handling to every replacement pool. Verify a storage operation succeeds after a simulated connection failure, not just `SELECT 1` on the replacement pool.

Source: [database connection and recovery](/Users/jasonmergl/dev/PBSOptimizer/server/db.ts:104).

**4. P1 — Reasons Report imports claim success when inserts fail. Reproduced in the actual route handler with a failing insert stub.**

The batch INSERT loop catches and logs failures, then continues to return `success: true`. Link counters are incremented while preparing rows, before those rows are persisted. Preference outcomes are also deleted and reinserted without a transaction, with errors treated as nonfatal.

Injecting one INSERT failure produced **HTTP 200, `success: true`, one parsed award, zero stored awards**. A pilot can believe history was imported even though it is incomplete, and downstream recommendations silently use partial data.

Fix: stage and validate the import, commit its replacement atomically, and derive counts from committed results. Return an explicit failure or clearly identified partial-import state. Add a failure test for a middle batch and a preference-replacement rollback test.

Sources: [batch insertion](/Users/jasonmergl/dev/PBSOptimizer/server/routes.ts:1288), [preference replacement](/Users/jasonmergl/dev/PBSOptimizer/server/routes.ts:1317).

**5. P1 — Distinct awards of the same pairing are discarded as duplicates. Reproduced with two synthetic dates.**

The deduplication key uses only pairing number and pilot seniority within the report period/category. It excludes the pairing's operating date. A pilot awarded the same recurring pairing on two separate dates loses the second award. That understates monthly credit, trip counts, and the evidence used for historical comparison.

A synthetic report with the same pilot and pairing on August 1 and August 7 parsed two awards but stored one and skipped one as a duplicate.

Fix: define award identity using period/category, stable pilot identity, pairing number, and operating/check-in date. Enforce that identity with a database unique constraint and conflict handling to protect concurrent imports. Re-import source reports after correcting the identity, since discarded awards cannot be reconstructed from the current rows alone.

Source: [award deduplication](/Users/jasonmergl/dev/PBSOptimizer/server/routes.ts:1164).

**6. P1 — Re-uploading a package can erase favorites, calendar entries, and chat history. Confirmed code path; not exercised against user data.**

After parsing a replacement package, upload cleanup automatically deletes older packages with matching metadata. `deleteBidPackage` explicitly deletes related chat history, favorites, and calendar entries. Thus an ordinary re-upload to repair or refresh a PDF can remove work the pilot already saved. Multiple statements are not wrapped in a transaction, so partial deletion is also possible.

Fix: treat re-upload as a versioned replacement. Map old pairing references to the new package using pairing identity and operating information, preserve user records, and report unresolved references. Perform the swap atomically. Keep explicit package deletion separate from replacement semantics.

Sources: [automatic duplicate cleanup](/Users/jasonmergl/dev/PBSOptimizer/server/routes.ts:873), [associated-data deletion](/Users/jasonmergl/dev/PBSOptimizer/server/storage.ts:481).

**7. P1 if accessible outside a trusted boundary — The sync PIN does not protect application access. Confirmed in application code; hosting protection unknown.**

The app intentionally has one canonical user, but its API has no authentication/authorization boundary. A caller can update that user, reset a PIN using a supplied user ID, mutate favorites/calendar data, delete packages, or invoke the paid assistant without proving ownership. The PIN is stored directly and full user rows are returned. The onboarding dialog is not an access-control mechanism.

This does not mean the deployment is known to be publicly exposed: external Vercel protection or network controls were not inspected. It means the application itself does not enforce access.

Fix: for a private single-user app, establish one authenticated session/access gate over the app and API, verify sensitive changes, omit PIN material from responses, and rate-limit linking, uploads, and AI requests. If multiple users are later supported, ownership must also scope every data operation.

Sources: [canonical-user updates](/Users/jasonmergl/dev/PBSOptimizer/server/storage.ts:299), [PIN reset](/Users/jasonmergl/dev/PBSOptimizer/server/routes.ts:2714), [package deletion](/Users/jasonmergl/dev/PBSOptimizer/server/routes.ts:476), [assistant endpoint](/Users/jasonmergl/dev/PBSOptimizer/server/routes.ts:3031).

**8. P1 — The dependency tree includes known vulnerable upload components. Confirmed by registry audit; exploitability varies by package.**

The production dependency audit flags 23 nodes, including a critical transitive `tar` finding and high findings affecting Multer, Express dependencies, Drizzle, and WebSocket dependencies. These are dependency findings, not 23 proven exploitable application vulnerabilities. Some build tooling is installed as a production dependency.

Multer deserves immediate attention because this app directly exposes multipart upload routes. Its maintainers document malformed-request denial of service in affected versions. [Multer security advisory](https://github.com/expressjs/multer/security/advisories/GHSA-5528-5vmv-3xc2).

Fix: update to versions clearing the current advisories, beginning with request-facing dependencies, and run upload/parser regressions. Review the Drizzle upgrade separately because the audit proposes a change outside the current declared range. Inspect transitive runtime reachability before prioritizing the `tar` finding solely on severity. Avoid a blind force-upgrade across the whole tree.

Sources: [locked Multer dependency](/Users/jasonmergl/dev/PBSOptimizer/package-lock.json:9519), [dependency manifest](/Users/jasonmergl/dev/PBSOptimizer/package.json).

**9. P2 — The AI chat drops the user identity needed for personalized optimization. Reproduced by capturing the request body.**

`PairingChat` has a user ID, but `api.analyzePairings` accepts only question, package ID, and session ID. Its `/api/askAssistant` request omits `userId`. The server expects that field to load the saved bid profile and user when the coach calls `optimize_bid`; without it, the optimizer falls back to neutral weights and lacks that user record.

This means the chat can produce a different, less personalized draft than the Bid Builder even though both appear to use the same learned preferences. The request capture confirmed `userId` was absent. No live AI generation was needed to verify the broken data path.

Fix: obtain identity from the authenticated session; until that exists, consistently carry the canonical user through the request. Test that chat optimization and direct optimization use the same saved weights and seniority.

Sources: [chat API request](/Users/jasonmergl/dev/PBSOptimizer/client/src/lib/api.ts:530), [coach profile lookup](/Users/jasonmergl/dev/PBSOptimizer/server/ai/simpleAI.ts:406).

**10. P2 — Time units differ across imports, search, and display calculations. Reproduced for imported credit; TAFB mismatch confirmed in code.**

Reasons Report credit replaces a colon with a decimal point: `18:30` becomes **18.3 hours instead of 18.5**. The fingerprint builder repeats this conversion, while the PDF parser correctly converts credit minutes to fractions of an hour. This distorts award credit totals and matching features.

Separately, the PDF parser retains TAFB as an `HH.MM` string. Server sorting treats the digits after the dot as minutes, while server filtering and dashboard filtering/sorting treat that string as decimal hours. A value such as `10.30` can therefore be sorted as 10h30m but filtered as 10h18m.

Fix: normalize durations to integer minutes at ingestion, use one shared conversion module, and format only at display/export boundaries. Correct existing historical credit from source data and rebuild affected fingerprints. Test colon, dotted-hours/minutes, integer, and explicit decimal-hour inputs separately.

Sources: [Reasons credit](/Users/jasonmergl/dev/PBSOptimizer/server/routes.ts:1199), [fingerprint credit](/Users/jasonmergl/dev/PBSOptimizer/server/reasonsReportParser.ts:392), [PDF time parsing](/Users/jasonmergl/dev/PBSOptimizer/server/pdfParser.ts:841), [TAFB filtering](/Users/jasonmergl/dev/PBSOptimizer/server/storage.ts:900), [client TAFB filtering](/Users/jasonmergl/dev/PBSOptimizer/client/src/pages/dashboard.tsx:1358).

**11. P2 — Different filter combinations can share an offline-cache key. Reproduced using the exported key function.**

The cache key encodes only the first 64 bytes of the serialized filters. Distinct filters sharing that prefix collide. A test with a long `excludeLayoverCities` array and minimum hold values of 20 versus 90 produced the same key. One search can overwrite another's cached result, and offline fallback can return the wrong dataset.

Fix: use the complete canonical serialization or a digest of it; include package/data/profile revisions. Add a regression with long shared prefixes. Invalidate old keys when changing the format.

Source: [cache-key construction](/Users/jasonmergl/dev/PBSOptimizer/client/src/lib/offlineCache.ts:201).

**12. P2 — Valid small packages are repeatedly treated as incomplete, and the client/server fetch contract disagrees. Confirmed with current package counts and API responses.**

The dashboard assumes every complete package contains at least 400 pairings. Current package 61 is completed and has **236**. Each relevant cache effect therefore treats its valid cache as incomplete and can force a full download again, including on filter changes. This is repeated work, not an infinite render loop.

Meanwhile the prefetch client expects pagination metadata, but `/api/pairings/search` returns all matching rows. A request for `limit: 5` returned **236 rows and 458,722 response bytes**. The prefetch code consequently has no reliable server total, even though it already received the whole set. The response includes raw PDF text and full segment data, and the server computes aggregate statistics in a separate sequential query despite fetching all rows.

Fix: choose one explicit contract. For packages of this scale, fetch a compact complete dataset once, store it once, and filter/sort locally; fetch raw text on demand. Alternatively implement real pagination with totals and separate offline export. Validate cache completeness using a server count/revision, never a fixed minimum. Cancel or ignore obsolete asynchronous loads when package/filter selection changes.

Sources: [400-pairing assumption](/Users/jasonmergl/dev/PBSOptimizer/client/src/pages/dashboard.tsx:576), [prefetch implementation](/Users/jasonmergl/dev/PBSOptimizer/client/src/lib/api.ts:194), [full search response](/Users/jasonmergl/dev/PBSOptimizer/server/storage.ts:1175).

**Additional improvements worth scheduling**

- **Cache lifecycle:** helpers repeatedly open IndexedDB connections without closing them. `clearLocalCache` waits for database deletion but has no blocked-deletion handler; open connections can leave it pending. `purgeUserCache` matches `user:...`, while full datasets are stored under `full:user:...`, so those entries escape the purge. Add a managed connection lifecycle, `versionchange`/`blocked` handling, and prefix-aware deletion. [Cache lifecycle](/Users/jasonmergl/dev/PBSOptimizer/client/src/lib/offlineCache.ts:130), [purge](/Users/jasonmergl/dev/PBSOptimizer/client/src/lib/offlineCache.ts:270), [database deletion](/Users/jasonmergl/dev/PBSOptimizer/client/src/lib/api.ts:599).
- **Category identity:** aircraft normalization intentionally removes Captain/FO suffixes, and analytics query by normalized fleet. The required position field stays in browser storage and is omitted from profile saves. Current imported preferences contain only `220-B`, so this review did not observe mixed-seat contamination; importing Captain reports would make pooled rosters and windows a risk. Store position explicitly and use base/fleet/seat for personalized analytics. [Fleet predicate](/Users/jasonmergl/dev/PBSOptimizer/server/storage.ts:1278), [profile payload](/Users/jasonmergl/dev/PBSOptimizer/client/src/pages/dashboard.tsx:2671).
- **Recommendation confidence:** `estimateCompletion` divides summed expected credit by the threshold and caps at 100%. That is a coverage heuristic, not a calibrated probability of constructing a legal awarded line; overlapping trips and correlated outcomes matter. Label it accordingly until validated with chronological holdout testing and feasibility-aware estimates. [Completion estimate](/Users/jasonmergl/dev/PBSOptimizer/server/lib/bidOptimizer.ts:235).
- **Consistent startup:** development, production, and Vercel use different Express setup paths. Development accepts 5 MB JSON, while the other two accept 50 MB. Centralize middleware and error behavior so local checks exercise production behavior. [Development](/Users/jasonmergl/dev/PBSOptimizer/server/index.ts:23), [production](/Users/jasonmergl/dev/PBSOptimizer/app.ts:9), [Vercel](/Users/jasonmergl/dev/PBSOptimizer/server/vercel-entry.ts:8).
- **Performance after correctness:** preserve the existing lazy-loaded tabs and batching improvements. Consolidate duplicated full-package query/cache/filter state before adding more memoization. Measure request counts, transferred bytes, and filter latency. The 637 kB entry bundle is a useful follow-up target, but eliminating repeated package transfers is more directly supported by this review's measurements.
- **Regression gates and maintainability:** add CI for check, lint, build, bid tools, and focused database/API tests. The standalone `server/__tests__` file is not part of a configured runner, and passing the existing 245 checks did not cover the integration defects above. Restore formatting in a separate change. Then extract upload, identity, analytics, and chat services from the 3,319-line routes file and reduce the 2,708-line dashboard around shared typed data contracts. Update README/AGENTS build guidance to match actual scripts. [Existing test](/Users/jasonmergl/dev/PBSOptimizer/server/__tests__/holdProbabilityBulkUpdate.test.ts), [scripts](/Users/jasonmergl/dev/PBSOptimizer/package.json:6).

**Suggested implementation order**

1. Fix probability personalization, distinct-pilot ranking, and chat profile propagation. Add regressions using the reproduced cases.
2. Fix database recovery and make imports/replacements atomic and truthful. Correct award identity and time conversion, then plan a controlled re-import/backfill from original files with a backup.
3. Establish/verify the access boundary and update request-facing vulnerable dependencies. If the deployment is publicly reachable, do this before other feature work.
4. Replace the 400-row cache heuristic, collision-prone keys, and conflicting fetch contracts. Measure cold load, repeated filtering, package switching, and offline recovery.
5. Consolidate entrypoints, add CI and failure-path coverage, then perform focused modularization and UI refinements.
