# Delta MEC PBS Rules Reference (extracted)

Source: `docs/PBS Reference Handbook.pdf` — Delta MEC PBS Reference
Handbook, Version 4, February 2025. Built on the NAVBLUE WebApp Bidder's
Guide; the PWA and FARs supersede it where differences exist (p10). Page
numbers are the handbook's printed page numbers. This file is the verified
source of truth for the AI bidding coach's Delta-specific knowledge
(`server/ai/biddingCoachKnowledge.ts`); update it only against the PDF.

## 1. Delta-specific PBS rules

- **Average Line Value (ALV)** (p46): set per position by the Company,
  published on the PBS Info screen. Must be **72:00–84:00 inclusive** for
  narrowbody & B767-300/757 (7ER); **71:00–85:00 inclusive** for widebody
  (non-7ER) per PWA §12.A.2.
- **Line Construction Window (LCW)** (p46): **10 hrs above to 10 hrs below
  ALV**, not to exceed **91.5 hrs narrowbody / 92.5 hrs widebody**. A line
  is "complete" when inside the LCW. Reduced Regular Line (RRL) LCW =
  7.5 hrs above/below 80% of ALV.
- **VTS (Vacation/Training/Sick & other absences)** (p46): counts toward
  the value of the line. Example: ALV 75:00 → LCW 65:00–85:00; with 21:00
  VTS, PBS adds 44:00–64:00 of pairing credit. Vacation & CQ count full
  value toward the LCW during construction but are **pay-no-credit on the
  time card** (do NOT count toward the white-slip pickup limit). Unpaid
  absences (e.g. military leave) get artificial credit of 1/30th–1/31st of
  ALV for construction only.
- **Block Hour Limit (BHL)** (p50–51, §12.B / §23.D.9.C): personal
  yearly-pace cap; you may not be awarded a regular line exceeding your
  BHL. If BHL < top of the category LCW, PBS lowers the **bottom of your
  personal LCW** = lesser of (BHL − LCW width [normally 20 hrs] +
  non-block credit) or the category-LCW bottom. Top of the personal LCW
  always equals the category top. (Example: LCW 70–90, BHL 71 → personal
  bottom 51:00.)
- **Threshold** (p52): Company-set trigger inside the LCW that stops
  preference processing once enough credit is awarded. PBS will NOT deny
  preferences solely to reach the threshold; if it reaches the end of the
  bid group (incl. system-generated Award Pairings) and the line is within
  the LCW, it awards even below threshold.
- **Min/Max/Mid Credit windows** (p93–94): Set Condition **global** bids
  (top of the Pairing Bid Group, above award lines, cannot be forgotten).
  Four windows: (1) normal LCW; (2) **Min Credit = bottom of LCW to ALV**;
  (3) **Max Credit = ALV to top of LCW**; (4) **Mid Credit = 5 hrs below
  to 5 hrs above ALV**. Each has its own threshold. Admin can **limit the
  number of Min or Max Credit bidders** in seniority order (down to zero);
  **Mid Credit bidders cannot be restricted**. If restricted at your
  seniority: with ESN/CSSN → jump to the next bid group; without → PBS
  ignores the Min/Max bid and processes the full LCW.
- **Slide Vacation** (p99–101, §7.E.7.B): global Set Condition bid (top of
  Pairing Bid Group, cannot be forgotten). Moves pre-awarded vacation as
  part of the bid; positive value = later, negative = earlier. Limits:
  only days fully within the current bid period slide; cannot split a
  block (PVAC and SVAC touching = two separate blocks); can slide past
  pre-awarded CQ/MLOA/other VAC; **PBS will not slide vacation onto
  Coverage awards** (coverage is a separate pre-process) — exception: may
  slide PVAC up to 3 calendar days regardless of coverage if the category
  is entitled to an extra X-day, but NOT into **Blackout Dates** (2 days
  before + 1 after New Year's, July 4, Thanksgiving, Christmas). Only one
  direction per bid group. Slide Vacation is only considered in regular
  processing, NOT coverage — **back it up with Prefer Off** (they are not
  mutually exclusive).
- **PVPP** (p100, 124): **48 hrs (2 days) free of duty (no pay/credit)
  immediately preceding Primary Vacation (PVAC)**, if requested at the
  primary-vacation bid; appears as pre-posted "PVPP". PVPP+PVAC **slide as
  one block**; neither slides outside the bid period; a Slide-Vacation
  start date = first day of PVPP. PVPP will NOT move via a Vacation Any
  bid. On reserve, **each PVPP day counts as one X-day** (p130). PVPP
  removal only via the Crew Resources smartsheet before 1800E on the last
  day of the bid period, 2 bid periods prior.
- **PVAC-into-coverage slide conditions** (p68): slide ≤3 days only if the
  post-slide PVPP/PVAC touches new coverage days; must not touch a
  Blackout Date unless already touched pre-slide.
- **Premium Rotations** (p125): filter on the Pairings tab (If / If Not);
  can Award or Avoid; Avoid may carry Else Start Next.
- **Redeye definition** (p125): any **eastbound unaugmented** flight
  segment that intrudes on the pilot's WOCL or touches **0200–0359**
  (measured in the time zone flown over). Pilot WOCL = 0200–0559
  acclimated.

## 2. PWA/FAR constraints the engine enforces

- **FAR buffer**: PBS buffers all FAR limits by **60 minutes** at initial
  construction (e.g. the 30-hr/168-hr rest becomes 31 hrs) (p46).
- **FAR 117.23 cumulative** (p46–47): flight time 100 hrs/672 hrs,
  1,000 hrs/365 days; FDP 60 hrs/168 hrs, 190 hrs/672 hrs.
- **FAR 117.25 rest** (p47): 30 hrs/preceding 168 hrs; 10 hrs immediately
  before FDP/short-call (≥8 hrs sleep opportunity); after >60° longitude
  with TAFB >168 hrs → 56 consecutive hrs at base (3 physiological nights,
  0100–0700 base time); post-deadhead exceeding Table B → rest = deadhead
  length, min 10 hrs.
- **PWA breaks between rotations** (§23.D.12, p47): **48 hrs** between
  different-direction ocean-crossing rotations (waivable to **24 hrs** via
  a Waive bid preference); **13 hrs** before a trans-oceanic duty period;
  **18 hrs** after; **12 hrs** between all rotations.
- **PWA limits have NO buffer** (unlike FARs); some are waivable via the
  Waive bid preference (p47).
- **WOCL** (p47–48): 0200–0559 acclimated. FAR 117.27 / §12.P.4: no more
  than **3 consecutive WOCLs** flown; after 3, next **2 WOCLs off**
  (waivable to 1). **WOCL intrusion** (§12.P.2): consecutive intrusions
  require **21 hrs rest** (or rest spanning 0000–0759) between duty
  periods — **no waiver**. "Infringe" = on duty within 0200–0559;
  "Intrude" = start before 0200 and end 0200–0359 or later.
- **Green-on-green** enforced (reason "Violates green on green", p145).

## 3. The handbook's own strategy guidance

- **Step-by-step, not priority** (p147–149): PBS executes preferences
  sequentially top-down; it is NOT a weighted-priority system. Put
  restrictive Avoid/Prefer Off **before** Award Pairings, or a generic
  Award grabs undesirable pairings first. The most common serious mistake:
  layering Award Pairings expecting AND-priority behavior.
- **Bid from specific to general** for Award Pairings (p151).
- **ESN/CSSN required**: PBS won't submit multiple Pairing (or Reserve)
  bid groups unless all but the last contain Else Start Next or Clear
  Schedule & Start Next (p148). CSSN moves on without processing
  system-generated Award Pairings or denying restrictions.
- **Never put Start Next in your last bid group** (p152).
- A reserve bid does **not** hurt regular-line chances unless a Start Next
  precedes it (p148). Rule of thumb: **bid both a pairing group and a
  reserve group**.
- **Multiple conditions in one preference = logical AND; lists within a
  condition = OR** (p148). Separate your Avoids — don't combine conditions
  in one Avoid (p151).
- **Only Prefer Off and Ordered "Pairing Number Departing On Date" honor
  left-to-right priority** (p148); everything else has no internal order.
- **Seniority-based**: senior confident bidders may use a single Pairing
  Bid Group (p136). Mid-seniority: regular group + just-in-case reserve
  group. To fly with Line Check Airmen: `Award Pairings If NOT Junior If
  Line Check Airmen` then `Award Pairings If Line Check Airmen` (p119).
- To prefer any regular line over reserve, place a Start Next before the
  Reserve Bid Group (p148).

## 4. Glossary

- **Rotation / Pairing**: multi-day trip; PBS awards line-by-line,
  top-down by seniority.
- **ALV / LCW / BHL / Threshold**: see §1.
- **TAFB**: Time Away From Base.
- **Credit vs Block**: block = flight time; credit = pay value (may exceed
  block).
- **VTS**: Vacation, Training, Sick & other absences.
- **X-days**: reserve days off; **Golden X-day**: protected days PBS
  cannot assign over.
- **PVAC / SVAC / PVPP**: primary/secondary vacation; PVPP = 48-hr
  pre-PVAC free block.
- **CQ**: Continuing Qualification training — pay-no-credit for the
  white-slip limit but **does count toward the green-slip trigger**
  (§23.U.1, p168).
- **Coverage / SLG / RLL (Reduced Lower Limit) / RRL / MBL / ULC**:
  award/line types.
- **Infringe vs Intrude**: see §2 (WOCL).
- **CSSN / ESN / Denial Mode / Threshold**: control-flow terms.

## 5. Reasons (Composite) Report interpretation (p143–146)

- Top banners: **"Affected by Denial Mode"** (some/all bids denied to build
  a complete line); **"Affected by SLG"** (no preferences worked; line
  built by secondary line generation); **"Affected by Coverage"**
  (pairing/on-call forced on for open-time or reserve-coverage/unstacking).
- Per-preference reasons: **Honored**; **Not honored / Not used** (denied,
  contradicting activity on the line); **Not considered** (denied, nothing
  contradicts) or **"Below Reduced Lower Limit Cutoff"**; **Partially
  honored** (part of a Prefer Off date group honored); **Forgotten**;
  **Filtered by higher bid**; **Item overlaps**; **Beyond bid limit**;
  **Awarded to senior bidder**; **Awarded by previous bids**;
  **Matching: X**; **Could Not Build Complete Line with Pairing**;
  **Followed By sequence not found**; **No pairings available**; **Too
  many above** (reserve); **Violates green on green**; **Maximum
  Max/Min-Credit / MBL / RRL / ULC bidders Reached**; FAR/legal reason
  named inline.
- **Unblockable** (p145–146): can't get a regular line in the LCW, at/above
  the RLL limit but didn't request RLL, awarded reserve (§23.D.11).
  **Unbuildable**: PBS can't build a legal reserve line given
  pre-awards/available days; options: keep the sub-LCW regular line and
  use PCS/iCrew Swap Board, or (if senior enough) request manual
  conversion to a reserve line via the PBS Bid Inquiry Form. Final awards
  published in iCrew by 1800E on the 17th; pilots must self-review to
  exercise contractual rights.
- **Reserve specifics**: rules format **Min Days On – Max Days On – Max
  X-day Blocks** (e.g. 3-99-5), set by category/base monthly, published on
  the Info screen (p129). Min Days On normally 3 (narrowbody) / 4
  (widebody); carries across month boundaries; doesn't apply to on-call
  days at month end (p129). **Max Reserves** (p136): admin caps the number
  of reserve lines by seniority — always assume reserve is limited and bid
  accordingly. Reserve coverage may force adjacent reserve days to satisfy
  Min Days On (p135).
