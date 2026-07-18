# NAVBLUE N-PBS Live UI Audit — Delta (dalpbs.navblue.aero)

Captured read-only from the live app (bid period AUG 2026, category
NYC-220-B) on 2026-07-04. Source of truth for the labels below is the
app's own AngularJS `translations` dictionary (1229 keys; 465 relevant to
bid grammar) plus the Bids-screen DOM/IndexedDB structure. No bid was
created, edited, or submitted — nothing that changes state was clicked.

This complements `navblue-rules.md` (derived from the PDF guide) with the
**exact on-screen label wording** and reveals several properties the PDF
prose didn't spell out. Use this as the spec for the Bid Builder grammar
restructure.

**Update 2026-07-04 (round 2):** the live **Pairings screen** exposes a
"Pairing Preferences" panel that is the *same* property editor the bid
editor uses (`field[pairingPref.fieldName]`, `pairingPref.tempfieldNames`).
Building a filter there does NOT touch a bid, so it gave us the complete
property list AND the value-widget model with zero bid risk. See §8 (the
authoritative property list) and §9 (the widget model) — these supersede
the inferred parts of §2/§7.

## 8. Authoritative pairing-property list (live Pairings "Pairing Preferences" panel)

The exact selectable properties, verbatim, in panel order:

Aircraft Type · Average Daily Block Time · Average Daily Credit · Carry
Out · Deadhead Day · Deadhead Legs · Depart On · Duty Duration · Duty Legs
· Duty On · Enroute Check-In Time · Enroute Check-Out Time · Flight Number
· Landings In · Layover · Redeyes · Sit Length · TAFB · Total Legs In
Pairing · Total Legs In First Duty · Total Legs In Last Duty · Pairing
Check-In Station · Pairing Check-In Time · Pairing Check-Out Time · Pairing
Total Block Time · Pairing In-Period Block Time · Pairing Carry-Out Block
Time · Pairing Total Credit · Pairing In-Period Credit · Pairing Carry-Out
Credit · Pairing International Type · Pairing Length · Pairing Number ·
Pairing Number Departing On · Work Start Station · Work End Station ·
Premium Rotation

**New vs prior audit:** `Pairing International Type`, `Work Start Station`,
`Work End Station`, `Premium Rotation`, `Total Legs In Pairing`.

**Sortable pairing columns** (Sort By dropdown): Pairing Number, Check-In
Time, Check-Out Time, Credit Value, TAFB, L/O Stns, Positions, Aircraft
Type, Length, Dates, Average Daily Credit.

## 9. The value-widget model (confirmed by direct observation)

Every property is built the same way — this is the exact shape the Bid
Builder should adopt:

```
<Property>
  ├─ If | If Not              (positive vs negative match)
  ├─ Any | Every              (matching modifier; ≥1 leg vs all legs)
  └─ one or more sub-fields, each with:
        operator: [ Exactly = | Greater Than > | Less Than < | Range ]
        value:    widget depends on the field's data type
```

Observed widgets by data type:
- **Duration/time** (e.g. Layover → *Of Duration*, Sit Length, Duty
  Duration): operator dropdown + **Hours / Minutes** spinners (HH:MM).
- **Layover** is a *compound* property with sub-fields: **Stations** (city
  list), **Of Duration** (HH:MM range), **On** (dates), **Starting At**
  (time), **Includes All Of** (require every listed city).
- **Depart On** sub-fields: **Dates List**, **Dates Range**, **Days Of
  Week List**, **Time Range** (the day-of-week widget we needed).
- Numeric (credit/block/legs): operator dropdown + numeric value(s);
  `Range` shows two inputs.

Operator set is **{ Exactly =, Greater Than >, Less Than <, Range }** — so
our exporter's `>=`/`<=` for Pairing Length is non-standard; NAVBLUE uses
`=`, `>`, `<`, or a Range with two bounds.

### Bid Builder model change this implies

Replace the flat `PairingFilter` with an ordered list of **conditions**,
each: `{ property, matcher: If|IfNot, quantifier: Any|Every, subField?,
operator: '='|'>'|'<'|'range', value | [lo,hi] }`. That one shape covers
every property NAVBLUE offers and maps 1:1 to both the display text and the
XML the app posts to `/fcgi-bin/ClassBidUI`.

## How the app is built (for the parser/exporter)

- AngularJS 1.x SPA. Bid data per period lives in IndexedDB
  (`Bidderperioddb<MON YEAR>dal` → store `categoryNYC-220-B`), stored as
  **AES-encrypted, ~1MB-chunked** XML (CryptoJS `U2FsdGVk…`). The app
  converts bid lines to/from XML via `json2xml`/`xml2json` and posts to
  `/fcgi-bin/ClassBidUI`. So the canonical bid format is **XML**, rendered
  to the human-readable "Award Pairings If …" text only for display.
- The preference editor is `partials/bidpref.html`, opened via the pencil
  (`editBidLine`) once a user bid line is selected. It renders property
  rows from `tempObjPairingPref.elements` and value widgets per property.
- A bid is **Bid Groups** (type Pairings / Reserve / Blank Line) each
  containing ordered preferences. Group starts: `StartPairings`,
  `StartReserve`, `StartBlankLine`. Three modes: **Current / Default /
  Training** (tabs).

## 1. Preference types (structural verbs)

| App label | Notes |
|---|---|
| **Award Pairings** | positive; takes pairings onto the block |
| **Award Reserve**, **Award Reserve Day On** | reserve-group awards |
| **Award Line**, **Award Monthly Blank Line**, **Award Stat Day** | line-level awards |
| **Avoid Pairings** | negative; removes from pool; affects all following Awards |
| **Prefer Off**, **Prefer Off Weekends** | negative; dates/days/times free of duty |
| **Set Condition …** | global block conditions (see §3) |
| **Waive** (+ `Waive To`, `Waive Completely`, `Waive 48 Hours Off In 7 Days`, `Waive Training Credit`, `Waive Virtual Credit`) | disregard/adjust specific rules |
| **Forget Line**, **Redo From Line** | Instruction bids (add pairings back before Denial Mode) |
| **Clear Schedule and Start Next** / **Else Start Next Bid Group** / **Else Reserve** | group-exit control (CSSN / ESN) |
| Training variants: **Award/Avoid Training**, **Award/Avoid Training Patterns**, **Avoid Voluntary Training** | training mode only |

## 2. Pairing properties (Award/Avoid conditions) — EXACT labels

Grouped; **★ = already in `bidTypes.ts`**, ☆ = present in data but not yet
modeled, ✎ = needs new PDF-parse work before it can be simulated.

**Trip shape / credit**
- Pairing Length ★
- Pairing Credit ★ · Pairing Total Credit · Pairing In-Period Credit ☆ · Total Credit · Total In-Period Credit
- Pairing Total Block Time · Pairing In-Period Block Time · Block Time ☆
- Average Daily Credit ★ · **Average Daily Block Time** ☆ (heavily used in real bids)
- Credit Value · Credit Per Time Away From Base (+ As Percent / Percent) · Block Time Per Time Away From Base As Percent
- Time Away From Base ★ (TAFB)

**Layovers**
- Layovers In [cities] ★ (positive) · "Not Any Layover In" ☆ (exclusion)
- Number Of Layovers ☆ · **Total Layover Time** ☆ · Minimum Base Layover (line condition, see §3)

**Timing / days**
- Departing On / Depart On Dates / Depart On Date Range / **Depart On Day Of Week** ☆ / Depart On Time Range
- Pairing Check-In Station ✎ (avoid-EWR pattern; station not parsed today) · Pairing Check-In Time ★ · Pairing Check-Out Time ☆
- Duty Check-In Time · Duty Check-Out Time · Enroute Check-In Time · Enroute Check-Out Time
- Duty Duration · Duty On (weekday) · Duty Legs · Total Legs In First Duty · Total Legs In Last Duty (Landings In)
- Sit Length ✎ · Pairing Number Check-In Date · Pairing Number Departing On

**Carry-over**
- Carry In · **Carry Out** ✎ (avoided in real JUL 2026 bid) · Pairing Carry-Out Credit · Pairing Carry-Out Block Time

**Deadhead / equipment / flags**
- Deadhead Day ☆ · Deadhead Legs ☆ (require-a-DH, not just a max) · "DH"
- Aircraft Type / Equipment / All Aircraft Type / Any Aircraft Type ✎
- Redeyes ✎ · Duty Is Redeye · Redeye Long Duty Period Pairings (+ Allow) · Charter / Charters (+ Allow Charters) ✎
- Duty Is Split Duty / Split Duty ✎ · Reduced Block · Position / Positions ✎
- Flight Number ✎ (validated against pairing list) · Followed By ✎ (from PDF)

## 3. Set Condition sub-types (block-level)

- Credit window: **Minimum / Mid / Maximum Credit Window** ★ (app has all three; `bidTypes.ts` has normal/min/max/mid) · Minimum/Maximum **Threshold**
- **Pattern** ☆ (whole-line shape): Pattern Start · Pattern Touches · Pattern Start/Touches Day Of Week Time Range · Pattern Start/Touches Range Of Dates · Days On · **Days Off (Minimum)**
- Minimum Base Layover · Minimum/Maximum Days On In A Row · Minimum Days Off In A Row · Maximize Days Off
- No Same Day Pairings · Over Schedule · Long Call Type / Short Call Type
- Vacation family: Slide Vacation · Vacation Any / Extension / Remainder Day(s) · Waive Training/Virtual Credit · Training GDO on

## 4. Operators & modifiers

- **Any / Every / Not** (matching semantics: `If Any`, `If Every`, `If Not Any`)
- **Between … To …** (range; upper bound shown as "To")
- **Limit** (Award only, caps that preference)
- **Else Start Next Bid Group** / **Else Reserve** (attachable exit)
- **All or Nothing** ☆ (reserve Prefer Off groups; used in real bids)
- Credit/time entry format: `HH:MM`, max `23:59` ("Maximum time is 23:59")

## 5. Reason vocabulary (confirms Reasons Report parser)

Award/deny reasons match our `reasonsMiner` categories: *Awarded to senior
bidder / senior shadow bidder*, *Awarded for coverage (under a different
bid)*, *Awarded by previous bids*, *Beyond bid limit*, *Block is
complete*, *Filtered by higher bid*, *Start Next Honored*, plus a large
set of legality reasons (700.28 FDP tables, CAR 700.42 home rest, Max
Block in Calendar Days/Months, Complete Blocks Off, Local Night Rest,
etc.). No parser change needed; these validate existing categories.

## 6. Delta vs the current Bid Builder (`shared/bidTypes.ts`)

**Already modeled & simulatable (★):** award/avoid, prefer off, set
condition credit window, CSSN, pairing length, pairing/avg-daily credit,
layover cities (inclusion), check-in hour, TAFB, deadhead max, limit.

**Tier 1 — data exists, add filter + simulate (☆):** Average Daily Block
Time, Depart On Day Of Week, Deadhead Day / Deadhead Legs ≥ 1 (require),
Not-Any-Layover exclusion, Number Of Layovers, Total Layover Time,
Pairing In-Period Credit, Block Time, All-or-Nothing flag on reserve
groups, Min/Max Threshold and Min/Max Days On/Off row conditions.

**Tier 2 — needs new PDF parsing first (✎):** Check-In **Station**, Carry
Out days, Aircraft/Equipment, Redeye, Charter, Split Duty, Sit Length,
Position, Flight Number, Followed By.

**Tier 3 — engine-model change (whole-line):** Set Condition **Pattern**
(days-on/days-off shape), Waive, Forget/Redo instructions, Vacation/GDO
family, Substitution/Vertical-Swap/Shuffle nuances.

## 7. Recommended structure change

1. Replace the flat `PairingFilter` with a **property + operator + value**
   model mirroring NAVBLUE's editor (each condition = one property from §2
   with an `any|every|not` matcher and a value/range), so the builder can
   express the full grammar and the exporter emits exact "Award Pairings
   If <Property> <op> <value>" text.
2. Tag every property **simulated** vs **text-only** in the UI so nothing
   is silently hidden (the earlier complaint) and nothing silently
   un-simulated. Burn down the text-only list by extending the parser in
   the §6 priority order (Check-In Station first — 3,246 real uses).
3. Store drafts as the same **bid-group→preference** tree NAVBLUE uses;
   the exporter already targets that shape.

## Open follow-ups (need a live edit session or more digging)

- Exact per-property value widgets (dropdown vs range vs date-picker) —
  requires opening the editor on a real bid line (would need to add/select
  one; not done since it changes state). Can be captured next time with a
  throwaway draft the user then discards.
- Confirm which properties are Award-only vs also Avoid-eligible.

## 10. The canonical bid XML schema (captured 2026-07 from a live bid)

Source: the in-memory `bidsetData` model on the Bids screen — parsed by
the app from the server's bid XML via xml2json, so object keys ARE the
XML element names. Captured read-only from an already-submitted bid; no
bid was modified. `bidLineToString` on each node carries the exact
display text (including quirks like the double space in
"Prefer Off  Friday").

Structure per line: `{ BidLineNumber, BidLineType, <BidLineType>: {...} }`

- **Group start**: `StartBidGroup: { BidGroupType: "StartPairings", StartPairings: "" }`
  (BidGroupType ∈ StartPairings | StartReserve | StartBlankLine)
- **Award**: `AwardPairings: { PairingProperties: { PairingProperty: obj | array } }`
- **Avoid**: `AvoidPairings: { ElseStartNext: { boolean: "true" }?, PairingProperties: {...} }`
- **Prefer Off (day-of-week)**: `PreferOff: { PreferOffType: "PreferOffDOWs",
  PreferOffDOWs: { PreferOffType: "DOWs", DOWs: { DOW: ["Friday", ...] } } }`
- **Set Condition (credit window)**: `LineCondition: { LineConditionType:
  "MinimumCredit", MinimumCredit: "" }`
- **Set Condition (pattern)**: `LineCondition: { LineConditionType: "Pattern",
  Pattern: { NumberDays: "5" /* days OFF minimum */,
  NumberDaysRange: { Start: "3", End: "6" } /* days ON range */ } }`

Pairing property entries (each also carries `PairingPropertyType`):
- `AverageDailyBlockTime: { TimeIntervalType: "TimeIntervalCondition",
  TimeIntervalCondition: { Operator: "GT", Time: { Hour: "006", Minute: "30" } } }`
- `PairingLength: { NumberDaysType: "NumberDaysCondition",
  NumberDaysCondition: { Operator: "EQ" | "GT" | ..., Value: "1" } }`
- `CarryOut: { NumberDaysCondition: { Operator: "GT", Value: "0" } }`
- `CheckInBase: { Stations: { Station: "EWR" | [..] } }`  ← check-in station
- `StartOnDOWs: { DOWs: { DOW: ["Monday", ...] } }`        ← departing-on DOW

Operators observed: `GT`, `EQ` (UI also offers `<` and Range → `LT`,
Start/End range objects). Times zero-padded `Hour: "006"`.

**New grammar constructs seen live (not yet in our model):**
- Prefer Off by day-of-week (`PreferOffDOWs`) — our preferOff supports
  dates only.
- Award condition `StartOnDOWs` (Departing On day-of-week) — we deferred
  weekday matching for simulation, but the exporter can now emit it.

This section is the spec for a future NAVBLUE-importable XML writer: the
exporter can serialize DraftBid to this shape 1:1.
