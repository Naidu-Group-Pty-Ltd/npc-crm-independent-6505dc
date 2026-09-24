# The five-format ownership matrix

**Generated — do not hand-edit.** `npx tsx scripts/verify/section-ownership-matrix.mjs`
rewrites this from `sectionRegistry.pure.ts`, and a spec fails when the two
disagree. A matrix written by hand is wrong the first time a producer changes
and nothing says so.

One row per topic. **Full detail** is the single format that carries it whole;
**summarised in** are the formats permitted to state a shortened version, and
nowhere else may. **Producer** is what actually makes the content — a projection
path, a model call, or a composition. `—` in a column means the format does not
carry the topic at all, which is a decision rather than an omission.

Sections: 41. Formats: Compass, Financial Analysis, Strategic / Due Diligence, Executive Briefing, Snapshot.

| Topic | Provenance | Full detail | Summarised in | Producer(s) | Compass | Financial Analysis | Strategic / Due Diligence | Executive Briefing | Snapshot |
|---|---|---|---|---|---|---|---|---|---|
| Cover & report identity | recorded | every format (spine) | — | projection · report.* | spine | spine | spine | spine | spine |
| Key figures | computed | every format (spine) | — | projection · financials.* | spine | spine | spine | spine | spine |
| Executive Verdict | authored | every format (spine) | — | authored · generator.compass; routed · split.financial#1; routed · split.dueDiligence#1; authored · condense.briefing; composed · scoreSections.pure.ts#composeVerdictSection | spine | spine | spine | spine | spine |
| The Opportunity in Strategic Terms | computed | Strategic / Due Diligence | — | composed · strategyPositions.pure.ts#composeStrategicRead | — | — | required | — | — |
| Property & Locality Snapshot | recorded | every format (spine) | — | authored · generator.compass; routed · split.financial#2; routed · split.dueDiligence#2; projection · property.*; authored · condense.snapshot | spine | spine | spine | spine | spine |
| Appendix, Source Notes & Disclaimer | recorded | every format (spine) | — | authored · generator.compass; composed · supabase/functions/fork-investment-report/index.ts#renderVariantMarkdown; authored · condense.briefing; authored · condense.snapshot | spine | spine | spine | spine | spine |
| Base Assumptions | recorded | Financial Analysis | Compass; Executive Briefing | routed · split.financial#17 | summary (in provenance) | required | — | summary (in provenance) | — |
| Why This Location Matters | measured | Strategic / Due Diligence | Compass; Executive Briefing | authored · generator.compass; routed · split.dueDiligence#4; authored · condense.briefing | required | — | required | required | — |
| Infrastructure and Growth Context | measured | Compass | Strategic / Due Diligence; Executive Briefing | authored · generator.compass | required | — | summary (in locationCase) | summary (in locationCase) | — |
| Suburb Character, Lifestyle & Occupier Appeal | measured | not carried in full by any format | Compass; Strategic / Due Diligence; Executive Briefing | nothing yet | summary (in propertyFit) | — | summary (in propertyFit) | summary (in propertyFit) | — |
| Market Positioning | measured | Strategic / Due Diligence | Compass; Financial Analysis; Executive Briefing | authored · generator.compass; routed · split.financial#3; routed · split.dueDiligence#16; authored · condense.briefing | required | required | required | required | — |
| Competitive Landscape and Supply Pipeline | measured | Compass | Strategic / Due Diligence; Executive Briefing | authored · generator.compass | required | — | summary (in marketPosition) | summary (in marketPosition) | — |
| Demand Drivers | measured | Strategic / Due Diligence | Compass; Executive Briefing | authored · generator.compass; routed · split.dueDiligence#9 | required | — | required | summary (in locationCase) | — |
| Socioeconomic Profile & SEIFA Interpretation | measured | not carried in full by any format | Compass; Strategic / Due Diligence; Executive Briefing | nothing yet | summary (in population) | — | summary (in population) | summary (in locationCase) | — |
| Employment, Income & Affordability Profile | measured | not carried in full by any format | Compass; Strategic / Due Diligence; Executive Briefing | nothing yet | summary (in population) | — | summary (in population) | summary (in locationCase) | — |
| Tenant Demand and Occupier Personas | measured | Financial Analysis | Compass; Strategic / Due Diligence; Executive Briefing | routed · split.financial#7 | summary (in population) | required | summary (in population) | summary (in locationCase) | — |
| Amenity & Access | measured | Strategic / Due Diligence | Compass; Executive Briefing | authored · generator.compass; routed · split.dueDiligence#6; authored · condense.briefing | required | — | required | required | — |
| Schools & Education | measured | not carried in full by any format | Compass; Strategic / Due Diligence; Executive Briefing | nothing yet | summary (in amenityAccess) | — | summary (in amenityAccess) | summary (in amenityAccess) | — |
| Transport, Commute & Daily Movement | measured | Strategic / Due Diligence | Compass; Executive Briefing | authored · generator.compass; routed · split.dueDiligence#7 | required | — | required | summary (in amenityAccess) | — |
| Property Fit Within the Suburb | authored | Strategic / Due Diligence | Compass; Executive Briefing | authored · generator.compass; routed · split.dueDiligence#3; authored · condense.briefing | required | — | required | required | — |
| Dwelling Layout & Functional Fit | recorded | not carried in full by any format | Compass; Strategic / Due Diligence; Executive Briefing | nothing yet | summary (in propertyFit) | — | summary (in propertyFit) | summary (in propertyFit) | — |
| Planning, Zoning and Title Due Diligence | measured | Strategic / Due Diligence | Compass; Executive Briefing | authored · generator.compass | required | — | required | summary (in riskDashboard) | — |
| Risk Dashboard | measured | Strategic / Due Diligence | Compass; Financial Analysis; Executive Briefing | authored · generator.compass; routed · split.financial#11; routed · split.dueDiligence#18; authored · condense.briefing | required | required | required | required | — |
| Climate, Environmental, Insurance, Crime and Safety Risk | measured | Strategic / Due Diligence | Compass; Executive Briefing | authored · generator.compass; routed · split.dueDiligence#15 | required | — | required | summary (in riskDashboard) | — |
| Due Diligence Checklist | recorded | Strategic / Due Diligence | Compass | authored · generator.compass; routed · split.dueDiligence#19 | required | — | required | — | — |
| Purchase Costs & Annual Holding Cost Breakdown | computed | Financial Analysis | — | composed · financialChapters.pure.ts#4 | — | required | — | — | — |
| Rental Assessment, Gross Yield & Net Yield | computed | Financial Analysis | — | composed · financialChapters.pure.ts#5 | — | required | — | — | — |
| Loan Structure, Repayments & Cashflow Impact | computed | Financial Analysis | — | composed · financialChapters.pure.ts#6 | — | required | — | — | — |
| Sensitivity & Scenario Testing | computed | Financial Analysis | — | composed · financialChapters.pure.ts#8 | — | required | — | — | — |
| 10-Year Cashflow, Equity & Growth Projection | computed | Financial Analysis | — | composed · financialChapters.pure.ts#9 | — | required | — | — | — |
| Resale Liquidity & Exit Outlook | computed | Strategic / Due Diligence | Compass; Financial Analysis | composed · strategyPositions.pure.ts#composeExitOutlook | required | required | required | — | — |
| Investment Score Breakdown | computed | Financial Analysis | Executive Briefing; Snapshot | projection · recommendation.gradedDetailLine; composed · financialChapters.pure.ts#12; composed · scoreSections.pure.ts#composeScoreBreakdownSection; composed · scoreSections.pure.ts#composeScoreDimensionsSection | optional | required | — | required | required |
| SWOT Analysis | computed | Financial Analysis | Compass; Executive Briefing | composed · strategyPositions.pure.ts#composeSwot; composed · financialChapters.pure.ts#14; composed · scoreSections.pure.ts#composeSwotSection | required | required | — | required | — |
| Investor Suitability Profile | computed | Financial Analysis | — | composed · strategyPositions.pure.ts#composeSuitability | — | required | — | — | — |
| Holding Strategy | computed | Financial Analysis | — | composed · strategyPositions.pure.ts#composeHoldingStrategy | — | required | — | — | — |
| Monitoring & Review Plan | computed | Strategic / Due Diligence | Compass | composed · strategyPositions.pure.ts#composeMonitoringPlan | required | — | required | — | — |
| Top 3 Opportunities | authored | Executive Briefing | Snapshot | authored · condense.briefing; authored · condense.snapshot | — | — | — | required | required |
| Top 3 Risks | authored | Executive Briefing | Snapshot | authored · condense.briefing; authored · condense.snapshot | — | — | — | required | required |
| Final Recommendation | authored | Strategic / Due Diligence | Compass; Financial Analysis; Executive Briefing; Snapshot | authored · generator.compass; routed · split.financial#16; routed · split.dueDiligence#21; authored · condense.briefing; authored · condense.snapshot | required | required | required | required | required |
| Key Market Stats | measured | Snapshot | — | authored · condense.snapshot | — | — | — | — | required |
| Financial Snapshot | computed | Snapshot | — | composed · financialChapters.pure.ts#composeFinancialSnapshotSection | — | — | — | — | required |

## Topics with no producer at all

A declared topic nothing produces. Each is an honest gap rather than a bug,
and `PRODUCER_GAPS` in the registry records why; a NEW one fails CI.

- **Suburb Character, Lifestyle & Occupier Appeal** (`suburbCharacter`)
- **Socioeconomic Profile & SEIFA Interpretation** (`socioeconomic`)
- **Employment, Income & Affordability Profile** (`employment`)
- **Schools & Education** (`education`)
- **Dwelling Layout & Functional Fit** (`dwelling`)
