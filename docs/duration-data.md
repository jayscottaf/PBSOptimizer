**Duration contract**

Printed PBS values (`18:30` or `18.30`) are hours and minutes. `shared/durations.ts` parses them into integer minutes and formats display values. Persisted credit/block numeric fields and numeric filter inputs remain explicitly decimal hours for schema compatibility: `18.50` means 18 hours 30 minutes. The table converts these values before showing them under HH.MM headings. TAFB remains a printed hours/minutes string, interpreted identically by SQL and client filters and sorting.

Existing award credit cannot safely be reverse-converted without its source: a stored 18.30 could represent either a legacy 18h30m import or valid decimal 18h18m. Re-upload the original Reasons HTML to repair it. Matching existing awards update credit, total credit, and credit-derived fingerprint fields atomically; their identities, links, and unrelated fingerprint fields remain intact. The upload summary reports corrections separately from inserts and skipped duplicates.

No original Reasons HTML files were found in the local upload/asset folders during this fix, and no speculative historical backfill was applied. Source re-import is also required to restore award dates discarded by the earlier deduplication bug.
