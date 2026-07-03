# NAVBLUE N-PBS Rules Reference (extracted)

Source: `docs/navblue-pbs-bidder-guide (1).pdf` — NAVBLUE N-PBS Bidder's
Guide, Release 21-3, 231 pages. Page numbers are the guide's printed page
numbers. This file is the verified source of truth for the AI bidding
coach's NAVBLUE knowledge (`server/ai/biddingCoachKnowledge.ts`); update it
only against the PDF.

## 1. Bid preference grammar

### Structural model (p64–66, 180, 195)
- A bid is composed of ordered **Bid Groups**, each independent. Preferences
  are only relevant within their own bid group; the scheduler clears
  everything and moves on when a group is abandoned.
- Bid groups are of type **Pairings** or **Reserve**.
- Three bid types: **Current** (submittable while period open, resubmit
  unlimited), **Default** (carries over month-to-month if no Current is
  submitted — use generic preferences like days-of-week, since specific
  dates only apply in their applicable month, p65–66), **Training**.

### Positive vs negative bids (p171)
- **Negative bids** = `Prefer Off`, `Avoid Pairings`. They *remove* pairings
  from the available pool. Only **one instance/leg** within a pairing must
  match for the whole pairing to be excluded.
- **Positive bids** = `Award Pairings`. They *take* pairings from the pool
  onto the block. Only one attribute must match to remain eligible.

### Preference types
- **Prefer Off** (p173): dates, days of week, date ranges, times of day to
  be free of duty. Negative bid.
- **Award Pairings** (p173–175): layover types, duty duration, pairing
  credit, dates, routes, etc.
  - **Limit modifier** (Award only, p174–175): caps awards from a single
    Award preference (e.g. `Award Pairings If Pairing Length = 4 Days
    Limit 2`). Limit applies **only** to the preference it is attached to.
- **Avoid Pairings** (p175): excludes unwanted criteria; supports most of
  the same options as Award. **Affects all Award preferences that follow
  it** — e.g. `Avoid Pairings If Average Daily Credit < 006:00` removes
  those pairings even if a later Award would match them.
- **Waive** (p179; not all configs): adjust/disregard specific rules while
  building. Some rules fully disregarded, others only adjustable. Only
  rules visible in the interface can be waived.
- **Instruction** (p179): `Forget Line`, `Redo From Line` (always used with
  Forget Line; Forget Line can stand alone) — these add pairings back into
  the pool, giving more options **before Denial Mode**.
- **Clear Schedule and Start Next Bid Group (CSSN)** (p180): only inside a
  Pairings bid group; forced to the **bottom** of its group. Triggering it
  **removes any previously awarded pairings** and starts the next group.
  Substitution/shuffling is attempted *before* executing CSSN. If used in
  the last bid group, system-generated bid groups (`Award Pairings` then
  `Start Reserve`) complete the block.
- **Set Condition** (p181–182): global block condition (min/max credit,
  patterns of days on/off, Min Days Off/On, Pattern, Min Base Layover).
  Either auto-forced to the top of the group, or placeable above/below
  Avoid/Prefer Off but **always forced above Award preferences**. Cannot
  be forgotten.
- **Bids forced to top** (p181): `Vacation GDO`, `Reserve GDO`,
  `Slide Vacation` — denied **only after** all Avoid Pairings and Prefer
  Off preferences are denied.
- **Else Start Next Bid Group (ESN)** (p92): attachable to Prefer Off,
  Avoid, and certain Set Condition bids (Pairing and Reserve groups). If a
  legal schedule can't be built honoring the preference, move to the next
  group. Auto-added when `Max Above` is used on reserve line bids.

### Modifiers / matching semantics
- **Any / Every** (p174–178): `Any` = one leg must have the property;
  `Every` = every leg must. `Avoid if Every Leg is Redeye` will **not**
  remove mixed pairings. Any/Every usually **not available for Avoid** in
  most configs (p176).
- **Always-present properties** (p177): Aircraft Type, Duty Legs, Duty On,
  Duty Duration, Employee Number. **Not-always-present**: Layover, Line
  Check Airmen, Split Duty, Charters, Sit Length, Redeyes, Enroute
  Check-In/Out. Matching (p177–178): `If Every`/`If Not Every`/`If Any`
  require ≥1 instance of the property; `If Not Any` matches pairings with
  zero of the property.
- **Deadhead legs** (p178): `Flight Number`/`Landings In` count deadhead
  legs (Landings In only with the "Counting Deadhead Legs" option);
  Redeye/Charter/Aircraft Type/Employee Number match only non-deadhead legs.
- **Comma-separated lists have equal priority** (p173): items within one
  Award bid (dates, pairing numbers) are equal. To rank, split into
  separate bids in priority order.
- **Property vocabulary observed** (p49, 61, 210): Pairing Length (= /
  Between X and Y Days), Layovers In [city], Departing On [date] Between
  [time] and [time], Check-In Time, Check-Out Time, Average Daily Credit
  (< / >), Layover Of Duration (>), Charter, Redeye, Aircraft
  Type/Equipment, Landings In, Duty On (days of week), Flight/Pairing
  Number, Followed By.

## 2. The award process (engine mechanics)

- **Seniority order**: bidders processed in seniority order; junior bidders
  lose pairings to senior bidders (p134).
- **Pairing group processing (p183–185)**: from the top of the group, the
  scheduler reads and remembers all restrictions. It must honor all Set
  Condition, Prefer Off, and Avoid Pairings **100%** unless a Forget
  instruction fires or Denial Mode is entered. At the first `Award
  Pairings` it searches the (already-restricted) pool and awards matches,
  running a **legality check on each placement**. It stops the moment the
  block is complete (later preferences unused). If it reaches the last
  preference incomplete, it uses the **system-generated `Award Pairings`**
  and fills with any pool-legal pairings honoring negatives.
- **Substitution (p190)**: replaces a pairing awarded by a *higher*
  preference with a different pairing matching that **same** higher
  preference, to make room for a lower-preference pairing.
- **Vertical Swapping (p190–191)**: pulls pairings already awarded to
  **more senior** block-holders onto the block being built, replacing them
  on the senior block with **equally desirable** pairings matching the same
  originating bid (and honoring that bidder's negatives). Credit-window
  guardrails: swapped-from blocks above Threshold stay above Threshold;
  blocks between Min and Threshold stay above Min.
- **Shuffling (p184, 191–194)**: last step before Denial Mode. Considers
  only Award pairings awarded **after the last deniable (negative)
  preference** in the bid. Tries different combinations to complete the
  block without denying any preference — may award pairings matching
  *lower* Award preferences instead of higher ones (the only time this
  happens), favoring higher credit value. **Preference order controls
  shuffling scope.** Once a preference is denied, shuffling can reach Award
  preferences above the denied one but not above remaining negatives.
  **Pairings from `Followed By` are never shuffled** (p192, 194).
- **Denial Mode (p184, 194–195)**: entered if shuffling fails. Rebuilds
  top-down: honors preference 1 + Awards; then 1+2 together (if 1 was
  denied, tries 2 alone), etc., producing the best line. **Set Condition
  and Avoid Pairings are removed entirely** (even multi-option lists).
  **Prefer Off options are removed one at a time, from the end of the list
  leftward** (p184, 195). Each denial starts a new **completion attempt**
  that clears all previously-awarded pairings and reprocesses (p201). The
  group is abandoned on an unhonorable ESN/CSSN preference.
- **SLG — Secondary Line Generation (p185, 196)**: if Denial Mode removes
  all deniables without a complete block, it builds using only Award
  preferences; failing that, a final attempt using only the system `Award
  Pairings` — SLG ignores all preferences and does an exhaustive search.
  No deniables → Denial Mode goes straight to SLG.
- **Reserve block selection (p186)**: **no optimization** (no substitution,
  swapping, shuffling) and **no Denial Mode** — but Coverage Awards may
  still apply. Reads `Start Reserve`, checks a legal reserve line, then
  honors reserve preferences top-to-bottom cumulatively (keeps
  already-honored preferences; denies one that conflicts, then tries the
  next with the earlier honored ones).
- **Coverage Awards (p196–200)**: **take precedence over ALL bid
  preferences.** Triggered by *stacks* — mutually exclusive pairings left
  unassigned in a critical period exceeding max stack height. Junior crew
  below a computed point get a stack pairing assigned first as an
  **unmovable event**, then their block is built from their bid; the
  scheduler picks the stack pairing conflicting with the fewest
  Avoid/Prefer Off (by priority) that best matches Awards. Multiple stacks
  assigned earliest-period-first unless a **priority stack date** takes
  precedence. May *appear* to violate seniority (p198). If a coverage
  pairing violates a Prefer Off/Avoid carrying an ESN, the ESN is attempted
  first (unless language-credit coverage). **Language Coverage Awards**
  (p199–201) force language-qualified pairings on junior crew.
- **If no block can be built (p202)**: crew appears in the final roster
  with only pre-awards; no special flag.

## 3. Constraints & legality

- **Credit windows (p187–189, 195)**: three biddable windows —
  Minimum / Normal / Maximum — each with Maximum, **Threshold**, and
  Minimum values (admin-set). `Set Condition Maximum Credit` → Max window;
  no credit preference → **Normal** (default); `Set Condition Minimum
  Credit` → Min window.
- **Completion rule (p188)**: award until credit > **Threshold**, then stop
  (block complete). Below Threshold but above **Minimum** → block is
  complete; **no Shuffle/Denial just to push above Threshold**. Below
  Minimum → Shuffle then Denial Mode used to complete.
- **Min/Max credit bids force denial (p189, 195)**: `Set Condition Min/Max
  Credit` **will** trigger Denial Mode if the block isn't above Minimum,
  even inside the Normal window. If Denial deletes that Set Condition, the
  next attempt **reverts to the Normal window**, and previously-denied
  Avoid/Prefer Off preferences **stay denied**.
- **Per-placement legality (p183, 198)**: every pairing placement is
  rules-checked (FARs, rest, max duty).
- Other enforced constraints: Minimum Base Layover line condition (p137,
  182), max credit for period, min GDO (no more than two single GDOs,
  p138), green-on-green (p138), RLL/reduced-block caps (p136–137), max
  Min/Max-credit-block counts (p136–137), language legality (p200).

## 4. Pitfalls the guide warns about

- **Negatives silently kill positives** (p172): `Prefer Off Mon/Tue` +
  `Avoid Departing 01:00–06:00` + `Award Layovers MIA/BOS` → you will not
  get MIA/BOS pairings that touch Mon/Tue or early departures; negatives
  remove them first regardless of later Awards.
- **Avoid affects everything after it** (p175).
- **Order controls shuffling scope** (p192–193): an Avoid placed last vs
  first drastically changes which awarded pairings can be shuffled.
- **Denial order** (p181, 184, 195): Prefer Off items denied end-first
  (rightmost). Vacation/Reserve GDO denied only after all Avoid/Prefer Off.
- **Comma lists lose priority ranking** (p173).
- **Any/Every misread** (p174–178): zero-property pairings behave
  counterintuitively (`If Not Any` includes them).
- **CSSN wipes prior awards** (p180); **Followed-By pairings can't be
  shuffled** (p192).
- **Buddy bidding** (p171): the junior buddy's bid builds both blocks; the
  senior should still enter a bid as a precaution. If the buddy can't take
  a pairing, neither can you (p135).

## 5. Reasons Report (p132–139)

Two panes on the Results Screen: **Awards** (awarded pairings
chronologically, plus training/vacation/other considered activities) and
**Reasons**. Each bid preference is numbered and followed by the pairings
it awarded plus an explanation. Carry-out pairings marked with `*` (p134).

Reason vocabulary (p134–138): *Awarded by previous bids: X*; *Awarded for
coverage under a different bid*; *Awarded to senior bidder / senior shadow
bidder*; *Best Line Before* variants (No Pairing Awards Possible /
Available Pairing Credit Insufficient / Block Time Limit Insufficient /
SLG Could Not Find Line Including Priority Stack Date); *Beyond bid limit:
X* (Limit modifier hit); *Bid denied*; *Block is complete* (+ count of
matched-but-unawarded); *Buddy cannot take pairing*; *Could Not Build
Complete Line with Pairing*; *Filtered by higher bid: X* (removed by a
higher Avoid/Prefer Off); *Followed By sequence not found*; *Forgotten*;
*Honored*; *Item overlaps with another: X*; *Matching: X*; *Needed for
Legality*; *Not considered* vs *Not honored* (both denied — "Not honored"
means contradicting pairings exist on the block, "Not considered" means
none do); *No pairings available*; *Partially honored*; *Restricted
location*; *[Rule violation]* (named FAR/legal rule); *Over maximum
credits for period*; *Prevents assignment of minimum GDO*; *Too many
above* (reserve, seniority); *Violates green on green*; RLL/language
messages.

Top-of-report banners (p139): *Affected By Denial Mode*, *Affected by
SLG*, *Affected By Coverage*.
