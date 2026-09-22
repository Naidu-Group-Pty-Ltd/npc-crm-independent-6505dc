/**
 * Builds the seeded Template Library catalogue and emits it as a SQL migration.
 *
 * Templates are authored here as data, validated against the *real*
 * `ReportTemplateSchema` and the *real* production renderer allow-list, and
 * written to the database. They are deliberately not bundled into the app: the
 * Builder list already documents that PDF-imported schemas can reach hundreds
 * of megabytes, and a catalogue that ships in the JS bundle would cost every
 * user — including the ones who never open the library — on first paint.
 *
 * Run:  npx tsx scripts/template-library/buildSeedCatalogue.ts
 * (or)  npm run templates:library:seed
 *
 * The generated migration is idempotent: it upserts on (slug, version), so
 * re-running it updates the seeded entries and never duplicates them. It only
 * ever touches rows whose slug is in the seed set, so an operator's own
 * promoted entries are never disturbed.
 *
 * ## Two authoring systems, one catalogue
 *
 * `SEED_TEMPLATES` are the forty *voice* templates — built from the five studio
 * voices keyed to the catalogue's `style` axis. `INVESTMENT_COMPASS_TEMPLATES`
 * are the *family* templates, built from the approved Claude Design Investment
 * Compass catalogue's manifest model. Both compile to the same
 * `ReportTemplate` schema and pass the same gates; only their authoring
 * vocabulary differs, and each gets the design-consistency check that suits it.
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ReportTemplateSchema } from '../../src/lib/reportTemplate/templateSchema';
import {
  PRODUCTION_SAFE_BLOCK_TYPES,
} from '../../supabase/functions/_shared/productionBlockTypes';
import {
  deriveEntryFacts,
  validateForPublish,
} from '../../supabase/functions/_shared/templateLibraryCore.pure';
import { takeOverflows } from './blocks';
import { runningHeadFor, VOICES, type VoiceId } from './designSystem';

/**
 * Mirrors `template_library_entries_category_check`. See the check in
 * `validateTemplate` for what this cost the first time it was missing.
 */
const LIBRARY_CATEGORIES: ReadonlySet<string> = new Set([
  'investment', 'suburb', 'postcode', 'statewide', 'comparison',
  'cash_flow', 'client_form', 'compliance', 'finance', 'portfolio',
]);
import { SEED_TEMPLATES, type SeedTemplate } from './templates';
import { takeCompassOverflows } from './investmentCompass/blocks';
import { INVESTMENT_COMPASS_TEMPLATES } from './investmentCompass/templates';
import { BORROWING_CAPACITY_TEMPLATES } from './investmentCompass/borrowingCapacity';
import { PORTFOLIO_TEMPLATES } from './investmentCompass/portfolio';
import { COMPARISON_TEMPLATES } from './investmentCompass/comparison';
import { CASH_FLOW_COMPASS_TEMPLATES } from './investmentCompass/cashFlow';
import { CLIENT_DETAILS_TEMPLATES } from './investmentCompass/clientDetails';
import { CASH_FLOW_COMPARISON_TEMPLATES } from './investmentCompass/cashFlowComparison';
import { REPORT_QA_TEMPLATES } from './investmentCompass/reportQa';
import { COMMERCIAL_CAPACITY_TEMPLATES } from './investmentCompass/commercialCapacity';
import { MARKET_INTELLIGENCE_TEMPLATES } from './investmentCompass/marketIntelligence';
import type { CompassSeedTemplate } from './investmentCompass/master';

/**
 * Every family master, across every report format.
 *
 * The ten designs are format-agnostic, so each format contributes its own page
 * sequence and shares the shell (`master.ts`). Adding a format here is what
 * makes its masters validated, deduplicated and seeded with the rest.
 */
const FAMILY_TEMPLATES: CompassSeedTemplate[] = [
  ...INVESTMENT_COMPASS_TEMPLATES,
  ...BORROWING_CAPACITY_TEMPLATES,
  ...PORTFOLIO_TEMPLATES,
  ...COMPARISON_TEMPLATES,
  ...CASH_FLOW_COMPASS_TEMPLATES,
  ...CLIENT_DETAILS_TEMPLATES,
  ...CASH_FLOW_COMPARISON_TEMPLATES,
  ...REPORT_QA_TEMPLATES,
  ...COMMERCIAL_CAPACITY_TEMPLATES,
  ...MARKET_INTELLIGENCE_TEMPLATES,
];
import { typographyFor } from './investmentCompass/family';
import {
  colourwaysForFamily,
} from '../../supabase/functions/_shared/templateColourways.pure';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '../..');

/**
 * Where the generated catalogue lands.
 *
 * **Bump this filename whenever the catalogue changes after the current one has
 * been applied to production.** Supabase records a migration as applied by its
 * version prefix and never runs it again, so editing an already-applied file
 * changes the repository and nothing else — the new rows would never reach the
 * database, and the only symptom would be templates missing from the UI.
 *
 * Because the generated SQL upserts the *whole* catalogue on `(slug, version)`,
 * a new file is a complete replacement, not a delta: applying it brings a fresh
 * database and a long-running one to exactly the same state. Superseded files
 * stay on disk, so an environment that has never been seeded still replays the
 * full history in order.
 *
 * | Applied to production | File |
 * | --- | --- |
 * | yes — 12 templates | `20260801093000_seed_template_library.sql` |
 * | maybe — 40 templates, pre-design-system | `20260802093000_seed_template_library_v2.sql` |
 * | maybe — 40 templates in the NPC voices | `20260803090000_seed_template_library_v3.sql` |
 * | yes — 93: the voices plus 50 Investment Compass masters | `20260811120000_seed_template_library_v4_investment_compass.sql` |
 * | yes — 543: every format's masters | `20260812090000_seed_template_library_v5_borrowing_capacity_portfolio.sql` |
 * | yes — 543, with the date and conditional fixes | `20260815150000_seed_template_library_v6_binding_fixes.sql` |
 * | not yet — 543, with the voice templates' disclaimer bound too | the one below |
 *
 * v4 was a new file rather than an edit of v3 because it added rows and wrote a
 * column (`design_meta`) that v3 did not know about.
 *
 * **v5 exists because v4 had already been applied.** The Borrowing Capacity
 * masters were generated back into v4 after it ran in production, and Supabase
 * records a migration as applied by its version prefix — so those fifty rows
 * would have sat in the repository and never reached the database, with the
 * only symptom being fifty templates missing from the library. Confirmed
 * against the live project: `supabase_migrations.schema_migrations` carries
 * `20260811120000`, and `template_library_entries` held 93 rows. This file
 * carries all three of the formats added since.
 *
 * Its **name** says two of them because that is what it carried when it was
 * written, and the name is not what Supabase keys on — the `20260812090000`
 * prefix is. Renaming it would be cosmetic while it is unapplied and actively
 * harmful once it is not: a file whose prefix is already recorded never runs
 * again, whatever it is called. If v5 has been applied by the time the
 * Comparison masters land, they need a v6 rather than an edit here.
 *
 * **That moment arrived, and v6 is it.** On 15 Aug 2026 the check finally came
 * back the other way: `20260812090000` IS in
 * `supabase_migrations.schema_migrations` and `template_library_entries` holds
 * 543 rows, so v5 has run. The binding fixes for the Client Details Form and
 * the 10 Year Cash Flow — the `| date` filter on every `report.generatedDate`,
 * the conditionals that stop a master printing a label for data the
 * adviser-reviewed path withholds, and the residence variants — were
 * regenerated back into v5 first, which would have left every one of them in
 * the repository and none of them in the database. The only symptom would have
 * been that the exported PDFs did not change, which is the hardest kind of
 * failure to see: nothing is red and the product does not move.
 *
 * The generated SQL upserts the whole catalogue on `(slug, version)`, so v6 is
 * a complete replacement rather than a delta — a fresh database replays v1..v6
 * and a production one applies only v6, and both land on the same 543 rows.
 *
 * **And v7, one hour later, for the same reason.** `apply-migration.yml` ran v6
 * against production at 15:52 and recorded `20260815150000`, so the one-query
 * check now answers "applied" for v6 too and editing it would be inert.
 *
 * v7 exists because the disclaimer fix was incomplete. `disclaimerPage()` binds
 * `{{org.disclaimer}}` in `investmentCompass/blocks.ts`, which is 500 of the
 * 543 — the 43 **voice** templates come from `template-library/blocks.ts` and
 * kept the baked boilerplate. Measured after v6 applied:
 *
 *     disclaimer_bound      500
 *     still_baked_literal   534     <- 500 fallbacks + 34 voice templates
 *
 * Two documents out of one product disagreeing about what the firm's
 * disclaimer says is worse than both being wrong, which is why this is a
 * migration rather than a note.
 *
 * Run the same one-query check before editing this file: if
 * `20260815170000` is already recorded, the next change needs a v8.
 *
 * ## v8 — the report's own structure
 *
 * It was recorded, so this is v8. The Investment Compass masters now carry the
 * document the model wrote — `report_content`, chunked into conditional pages
 * by `packMarkdownPages` — because nothing did. `{{sections.*}}` was bound by 0
 * of the 13 active `report_templates` rows and the projection published nothing
 * from that column, so a Compass render was the calculator's scorecard on a
 * fixed page sequence with the report itself absent. Measured on one address at
 * all five tiers, the model writes 9 (snapshot) to 107 (compass) headings every
 * time. See `docs/reports/INVESTMENT.md` and PR #2162.
 *
 * ## v12 — the verdict sentence is composed, never interpolated
 *
 * The two verdict bodies bound `recommendation.grade`/`.score` inside a
 * hand-written "Graded … out of 100" literal. On a row with no score the
 * sentence printed with the holes left in — "Graded  at  out of 100", shipped
 * on every Due Diligence fork ever produced — and the hardcoded weighting
 * clause ("growth, location, yield, demand and risk" / "five weighted
 * dimensions") misstated every variant score. Both bodies now bind
 * `recommendation.gradedLine` / `.gradedDetailLine`, composed by the
 * projection from the score's own dimensions and absent when the record
 * cannot say them (scoreSections.pure.ts).
 *
 * ## v13 — the cash flow table foots
 *
 * `20261112000000` is recorded and `template_library_entries` holds 543 rows,
 * so v12 has run and editing it would be inert. v13 carries the Financial
 * position page's new lines: the engine subtracts eight annual cost components
 * and the table drew four, so on 262 Pallas Street, Maryborough the rows came
 * to $10,780 against a net position built on $12,880 — and the row that left
 * water rates out was labelled "Council and water rates". The projection now
 * folds water into that row and letting fees into management, and publishes
 * land tax and strata (`financials.annualOtherCosts`) and the occupancy gap
 * (`financials.annualVacancyAllowance`) as conditional rows that draw only
 * where there is a figure to draw.
 *
 * ## v14 — the Compass stops drawing the Financial Analysis
 *
 * `20261202000000` is recorded, so v13 has run and editing it would be inert.
 *
 * One Investment master serves five document kinds, so the acquisition table,
 * the cash flow and the ten-year equity chart were drawn on all five — and
 * `compassSectionRegistry.ts` has said since v2.0 that "ALL detailed financial
 * modelling ... lives in the separate Financial Analysis Report and MUST NOT
 * appear here". The generator obeyed it and the master did not, so the
 * Investment Compass opened on purchase price, gross yield, LVR and a
 * ten-year projection while the Financial Analysis carried the location case.
 *
 * v14 makes those three pages conditional on `report.drawsFinancialModelling`,
 * published by `reportBindingProjection` from `tierContent.pure.ts` — the one
 * module that decides what a tier's document contains. The projection also
 * WITHHOLDS the modelling bindings on those tiers, which is what makes the
 * drop clean: a page kept with nothing to bind prints labelled empty rows.
 *
 * ## v15 — the running head names the chapter, and a column fits what it carries
 *
 * `20261203000000` **is recorded** — checked 19 Sep 2026 against the project's
 * applied migration list (980 of them), which is the one-query check this
 * header has always asked for. So v14 has run, editing it would be inert, and
 * this is v15.
 *
 * Two master changes:
 *
 * The running head read `Part 03 · Report` on every page of every document,
 * and a page carried a heading reading `The report`. The head now names the
 * chapter a page is in, derived from the same packing that decides the page
 * breaks — estimated by the projection and overwritten by the renderer's
 * pre-pass, so the two cannot disagree — and the `The report` heading is
 * deleted.
 *
 * And the Commercial Capacity constraints table printed over the explanation
 * beneath it on 4 of 50 masters: the four value columns took a fixed 330 pt,
 * leaving the test name 87-117 pt on the families with the deepest margins,
 * while three of the ten `CONSTRAINT_LABELS` run 24 to 31 characters. Measured
 * in Chromium at A4 across all fifty, for the longest string each column can
 * carry and for the column heads: Test 147.8, Permits 66.6, Policy 42.0,
 * This deal 53.8, Status 73.9. The value columns are 75/48/60/82 now and the
 * name takes the rest, at least 152 pt everywhere. Re-measured: 0 of 50
 * overlap, 0 of 400 rows wrap.
 *
 * The version is `20261204020000`, not `...000000`: two other migrations
 * already hold `20261204000000` and `20261204010000`, and
 * `check-migration-version-collisions.mjs` is right that one version records
 * one ledger row, so a second file at that version can never be told apart
 * from applied. And a seed alone is not the change — `20261204030000`
 * re-copies the ACTIVE masters from it, because an adopted master is a COPY
 * and nothing else updates a copy after adoption.
 *
 * ## v16 — the verdict fits its box, and the running head names the chapter
 *
 * `20261204020000` **is recorded** — checked 19 Sep 2026 against the project's
 * applied migration list (986 of them), which is the one-query check this
 * header has always asked for. So v15 has run, editing it would be inert, and
 * this is v16.
 *
 * Two master changes, both geometry, both measured against all fifty.
 *
 * **The verdict heading printed over the KPI band.** `verdict()` reserved
 * `scale.verdict * 2.2` at a leading of 1.1 — exactly two lines — and the
 * reservation was never measured against the sentence that fills it. At this
 * catalogue's own 0.52 display advance, `RECOMMENDATION_BY_GRADE` set past two
 * lines on **27 of 50** masters unqualified, and on **50 of 50** once
 * `qualifyRecommendation` began appending its coverage sentence. The masters
 * position every block at an absolute `y`, so the surplus did not overflow the
 * page — it printed on top of what came next, and every arithmetic check in
 * the build passed. On 42 Patya Circuit `$1,975,000` and `$850` were struck
 * through by the heading's last two lines.
 *
 * The dashboard page has 15pt of slack above the footer on 49 of the 50, so
 * the block could not grow. It keeps its footprint exactly and the heading is
 * fitted to it: `fitToLines` picks the largest quarter-point size at which the
 * longest publishable headline still sets in two lines. 23 masters were
 * already inside it and are byte-identical; the rest move from 23-34.25pt to
 * 16.5-19.5pt. The coverage sentence also leaves the heading for a `scopeNote`
 * of its own (`splitVerdictScope`), which is a projection change rather than a
 * master one.
 *
 * **The running head said `Part 05 · Report` on 29 of 36 pages.** v15 made the
 * head name the chapter and reached eleven masters: `furniture()` draws the
 * part AND the section on a railed family, and on a running-head family draws
 * the part and DISCARDS the section. The Compass's report pages now pass an
 * explicit `headMarker` — the part number plus the chapter — which only the
 * running-head branch reads, so the railed eleven and the other nine formats'
 * 450 masters are untouched.
 *
 * The version is `20261207000000`: `20261206000000` is taken and already
 * applied. `20261207010000` re-copies the ACTIVE masters from it, because an
 * adopted master is a COPY and nothing else updates a copy after adoption.
 *
 * ## v17 — the running head stops repeating the part
 *
 * One master change, on the 39 running-head masters, and nothing else in the
 * catalogue moves.
 *
 * v16 fixed the half of the running head that was DISCARDED and left the half
 * that was REPEATED. It passed `Part NN · {{narrative.chapters.i}}`, so the
 * Investment Compass issued for 97 Poole Road, Kellyville on 20 Sep 2026
 * carried `Part 07 · <chapter>` on **twenty-six consecutive pages** — true,
 * because the body is one part, and saying nothing twenty-six times over.
 *
 * A running head exists to say where the reader is. Across a single part the
 * part number does not; the chapter does. The part structure is on the
 * contents page, which is where it varies. The marker is the chapter alone.
 *
 * The ten characters that frees are not a line — the marker sits in 34% of the
 * measure, about 43 characters, against `CHAPTER_MAX_CHARS` of 64 — so the
 * worst case still takes both lines the rule reserves. Measured on the twelve
 * chapters that report actually produced: three wrapped to a second ragged
 * right-aligned line with the prefix, one wraps without it.
 *
 * A binding change inside one text block, on 39 masters. The railed eleven
 * draw the part as an eyebrow ABOVE the chapter rather than a prefix beside
 * it, so the repetition is subordinate by construction and they are untouched;
 * the other nine formats' 450 masters pass no `headMarker` and are
 * byte-identical.
 *
 * The version is `20261208000000`. `20261208010000` re-copies the ACTIVE
 * masters from it, for the reason above.
 *
 * ## v18 — the assessment page said five and showed three
 *
 * Checked before editing, as the line below asked: `20261208000000` and
 * `20261208010000` are both in the applied migration list (990 of them), so
 * this change is a v18.
 *
 * ONE page, on the 50 Investment Compass masters, and nothing else in the
 * catalogue moves. `The assessment` carried the heading **"Five dimensions,
 * weighted"** over a table that drew THREE rows on the 9 Hollow Street
 * Compass of 20 Sep 2026 and FOUR on 1 Crestview Avenue and 97 Poole Road.
 * The projection publishes nothing bindable for a dimension the engine did
 * not score — an absence is omitted, never worded — so the row count is the
 * count of what was measured, and a heading promising five contradicts the
 * table under it on every report that could not score one.
 *
 * Its third column was headed `Weight`, and the figure in it is the ADJUSTED
 * weight: 97 Poole Road printed `Demand 27 · 5%` where the published method
 * weights demand at 15%, with nothing on the page to tell the two apart. The
 * header names it and the standfirst says what it is.
 *
 * And one BINDING, on two of the 43 voice masters: their Recommendation page
 * bound `{{recommendation.rationale}}`, which the projection does not publish,
 * so the decision body resolved to the empty string on every render. The
 * Investment Compass master corrected exactly that in its own block and these
 * two kept it. They bind `gradedDetailLine` now — found by a spec asserting
 * that no master binds a `recommendation.*` path the projection does not
 * publish, which is the general form of the `scopeNote` defect in the other
 * direction.
 *
 * Three text changes inside two blocks on one page, plus two bindings. No page
 * gains or loses one, no block moves, and the other eight formats' 400 masters
 * are byte-identical. The standfirst is one sentence longer than the
 * one it replaces and no more: at two extra sentences the geometry gate
 * refused three masters, at one it refused `le-03` by 7pt, and the wording
 * shipped is the longest that clears all 50.
 *
 * The version is `20261209000000`. `20261209010000` re-copies the ACTIVE
 * masters from it, for the reason above.
 *
 * ## v19 — two placeholder words in slots that name things
 *
 * Checked before editing, as the line below asked: `20261209000000` and
 * `20261209010000` are both in the applied migration list (1,012 of them, the
 * latest being `20261211000000`), so this change is a **v19**.
 *
 * Two literals on the 50 Investment Compass masters, and nothing else in the
 * catalogue moves.
 *
 * **The risk register's rating read `Noted`.** The record holds a bare risk
 * STRING from `investment_score.risks` and no severity at all, and the
 * platform's exposure vocabulary is `Low | Moderate | High | Not assessed`
 * (`riskRegister.pure.ts`). `Noted` was a fifth word in a four-word
 * vocabulary, in the column that states the EXPOSURE, and it is absent from
 * `RATING_PALETTE` too — which is why the chip display already drew it
 * neutral. `severityFromRating` answers null for both, so neither draws a
 * bar; what changes is that a reader is given the platform's own word for
 * "nobody assessed this" instead of one it uses nowhere else.
 * `confidence: 'Indicative'` is deliberately KEPT: it is in
 * `CONFIDENCE_PALETTE`, and it is an honest qualifier for an unverified
 * one-liner rather than a claim the record cannot support.
 *
 * **The Opportunities list's term read `Noted`.** Every sibling definition
 * list on that page carries a real term naming what the row is about —
 * `Location`, `Yield`, `Risk` — and the record gives an opportunity as one
 * unlabelled string, so any term in that slot is invented. The heading
 * already said "Opportunities", so the 160pt term column carried a word that
 * repeated nothing and meant nothing. It is a `callout` now, which is the
 * container the same page already uses for one unqualified statement ("No
 * risk recorded"), and it is height-neutral: the definition list declared
 * 30 + one ~45pt row against the callout's 72.
 *
 * A sweep of every literal `term:`, `rating:`, `confidence:`, `value:` and
 * `status:` across all eleven format files found no other placeholder — the
 * rest are real labels (`Location`, `Yield`, `Risk`, `Suburb`, `Value and
 * equity`, `Cash contributed`). These two were the class.
 *
 * ## What the diff actually is, measured rather than claimed
 *
 * Parsed out of both files and compared schema by schema — 2,172 in each:
 *
 *   * **34 schemas changed**, and every one is an Investment Compass master.
 *     The other ten formats' 493 masters are byte-identical, and the changed
 *     lines are exactly 50 distinct family names plus the two header lines
 *     (the `@effect` probe and the baseline's release id).
 *   * `"rating":"Noted"` **50 → 0**, `"rating":"Not assessed"` **0 → 50**.
 *   * `"type":"definition-list"` **−32**, `"type":"callout"` **+34**.
 *
 * That `+34` against `−32` is the part worth writing down, because the first
 * draft of this comment claimed "no page gains or loses one" and that is
 * **false**. Two masters — **Analyst Folio** and **Monograph** — gain a block
 * (333→334 and 320→321) while keeping all seven of their definition lists.
 *
 * They never carried the Opportunities list. It is an OPTIONAL item, and
 * `ifItFits` keeps one only while `y + height + SLACK <= contentBottom`. The
 * definition list declared `30 + one ~45pt row` ≈ 75pt; the callout declares
 * 72. On those two variants those three points are the difference, so a block
 * they had been dropping silently now fits. That is `ifItFits` doing exactly
 * its job — and it is a small improvement, not a regression: two more masters
 * now show an opportunity the record holds instead of discarding it.
 *
 * `SLACK` is untouched at 36, so the comfort margin that stops an optional
 * block printing over the one above it is unchanged.
 *
 * The version is `20261212000000`. `20261212010000` re-copies the ACTIVE
 * masters from it, for the reason above.
 *
 * ## v19, regenerated — and why it is still a v19
 *
 * The one-query check the line below demands was run on 22 September 2026 and
 * answers the OPPOSITE of what a fourth seed release would need:
 * `20261212000000` is **not** recorded. 1,012 migrations are applied and the
 * latest is `20261211000000`, so v19's own pair has never landed — it is
 * unmerged, on one branch, in one pull request. The condition this header
 * states for a v20 is that the previous version is RECORDED, and it is not,
 * so the right move is to regenerate v19 in place rather than stack a second
 * seed migration on top of an unapplied one.
 *
 * What made that necessary is a gap in this repository rather than a change
 * of mind. The seed is GENERATED, and until now **nothing compared it to the
 * definitions that generate it** — so the generator could be run or not run
 * and the tree looked identical either way. Four commits landed after v19 was
 * written and two of them changed what the definitions produce:
 *
 *   * `bcd1bf5` — a bound KPI note was budgeted one line and sets two, which
 *     grows the DASHBOARD grid on page 2 of **142** masters by 8 to 21pt, and
 *     pushes the blocks below it down by the same amount (76 callouts, 59 text
 *     blocks, 40 data tables, 31 decision boxes, 18 strengths-watch panels).
 *   * `b842936` — the cover facts had their own density behaviour and it
 *     disagreed with the family's on 22 of 50, so `valueSize` on page 0 comes
 *     off a literal and onto the scale: **140** masters 11pt → 9pt (compact)
 *     and **80** masters 14pt → 13pt (spacious).
 *
 * Neither had reached the migration, and the migration is what a deployment
 * applies. A fix that reaches only the definitions reaches no document at
 * all — which is exactly how seed v18 came to merge without landing, the
 * failure `20261212010000`'s `@effect` line was added to catch one layer
 * further down. `npm run templates:library:seed:check` closes the layer above
 * it: it re-derives the SQL and compares the BYTES, naming the templates that
 * drifted, and `ci.yml`'s `template-geometry` job runs it beside the render
 * gate. Measured both ways before it was trusted — exit 1 on the stale file
 * (301 of 543 named), exit 0 on the fresh one.
 *
 * ## What the regenerated release is, measured rather than claimed
 *
 * Parsed out of both files and compared template by template — 543 in each:
 *
 *   * **301 of 543 templates differ**, all of them design-family masters. The
 *     43 voice templates are byte-identical. By format: 47 Investment Compass,
 *     37 Portfolio Review, 36 Cash Flow Comparison, 35 Borrowing Capacity,
 *     35 Property Comparison, 23 Ten Year Cash Flow, 22 each of Client Details,
 *     Report Q&A, Commercial Capacity and Market Intelligence.
 *   * **No template's page count changes, and no template's block count
 *     changes** — checked rather than asserted, because the first draft of the
 *     v19 comment above claimed exactly that about the placeholder words and
 *     was false. Every difference is a size, a height or a `y`.
 *   * The two changes do not touch the same grid: of the grids that moved,
 *     none changed both its `valueSize` and its `height`. The cover facts are
 *     page 0; the note that grew is page 2.
 *
 * The placeholder-word measurement above still stands as the record of THAT
 * change; these are the two that joined it.
 *
 * Run the same one-query check before editing this file: if
 * `20261212000000` is already recorded, the next change needs a v20.
 */
/**
 * The identifier this release records against a baseline and against a
 * refreshed master. It is the seed migration's own basename, so a row that
 * says it carries this release names the artefact that put it there.
 */
const RELEASE_ID = '20261212000000_seed_template_library_v19_placeholder_words';

const MIGRATION = resolve(
  REPO,
  'supabase/migrations/20261212000000_seed_template_library_v19_placeholder_words.sql',
);

/** Postgres string literal, dollar-quoted so JSON never has to be escaped. */
function sqlJson(value: unknown): string {
  const json = JSON.stringify(value ?? null);
  // Pick a tag that cannot appear in the payload.
  let tag = 'tlj';
  while (json.includes(`$${tag}$`)) tag += 'x';
  return `$${tag}$${json}$${tag}$::jsonb`;
}

function sqlText(value: string | null): string {
  if (value === null) return 'NULL';
  let tag = 'tlt';
  while (value.includes(`$${tag}$`)) tag += 'x';
  return `$${tag}$${value}$${tag}$`;
}

function sqlTextArray(values: string[]): string {
  if (values.length === 0) return `ARRAY[]::text[]`;
  return `ARRAY[${values.map((v) => sqlText(v)).join(', ')}]::text[]`;
}

interface Problem { template: string; message: string }

/** Anything the migration can emit a row for. */
type CatalogueTemplate = SeedTemplate | CompassSeedTemplate;

function isCompass(t: CatalogueTemplate): t is CompassSeedTemplate {
  return 'designMeta' in t;
}

/** Checks every catalogue entry must pass, whichever system authored it. */
function validateCommon(template: CatalogueTemplate): Problem[] {
  const problems: Problem[] = [];
  const label = template.slug;

  // 1. The schema must parse against the live Zod contract, not a lookalike.
  const parsed = ReportTemplateSchema.safeParse(template.schema);
  if (!parsed.success) {
    for (const issue of parsed.error.issues.slice(0, 8)) {
      problems.push({ template: label, message: `schema: ${issue.path.join('.')} — ${issue.message}` });
    }
    return problems;
  }

  // 2. Every block must be renderable by the production pipeline. A catalogue
  //    entry that cannot render is worse than no entry: it wastes the user's
  //    time before failing.
  for (const page of parsed.data.pages) {
    for (const block of page.blocks) {
      if (!PRODUCTION_SAFE_BLOCK_TYPES.has(block.type)) {
        problems.push({ template: label, message: `unsupported block type "${block.type}" on page "${page.name}"` });
      }
    }
  }

  // 3. It must pass the same gate the publish endpoint applies.
  const publishProblem = validateForPublish({
    name: template.name,
    slug: template.slug,
    schema: template.schema,
  });
  if (publishProblem) {
    problems.push({ template: label, message: `publish gate: ${publishProblem.message}` });
  }

  // 4. Pages must be non-empty — a blank page in a premium catalogue is a bug.
  parsed.data.pages.forEach((page, i) => {
    if (page.blocks.length === 0) {
      problems.push({ template: label, message: `page ${i + 1} ("${page.name}") has no blocks` });
    }
  });

  // 5. The category has to be one the column will accept.
  //
  //    This lives in validateCommon, not beside the voice checks, because the
  //    350 family masters do not go through validateVoice — and they were the
  //    ones that broke. The seed validated everything about a template except
  //    whether the database would take it: 50 Client Details masters carried
  //    `category: 'client_details'` (the format's `report_type`, which is a
  //    different vocabulary), the build was clean, the Zod parse was clean, and
  //    Postgres rejected all 50 partway through a live apply — after 290 rows
  //    had already been written.
  //
  //    Keep LIBRARY_CATEGORIES in step with
  //    `template_library_entries_category_check`. Validating against a copy of a
  //    constraint is weaker than validating against the constraint itself, and
  //    enormously stronger than the nothing that was here.
  if (!LIBRARY_CATEGORIES.has(template.category)) {
    problems.push({
      template: label,
      message: `category "${template.category}" is not accepted by `
        + `template_library_entries_category_check (allowed: `
        + `${[...LIBRARY_CATEGORIES].join(', ')})`,
    });
  }

  return problems;
}

/** Checks specific to the voice system. */
function validateVoice(template: SeedTemplate): Problem[] {
  const problems: Problem[] = [];
  const label = template.slug;
  const parsed = ReportTemplateSchema.safeParse(template.schema);
  if (!parsed.success) return problems;

  // 5. The declared `style` must be the voice the template was actually built
  //    in. The two are set in different places — `beginTemplate()` at the top
  //    of the builder, `style` in the returned metadata — and if they drift the
  //    library filters a user to "editorial" and hands back a technical layout.
  //    Comparing the compiled display face catches it at build time.
  const voice = VOICES[template.style as VoiceId];
  if (!voice) {
    problems.push({ template: label, message: `unknown style "${template.style}"` });
  } else if (!template.schema.tokens.fonts.heading.startsWith(`${voice.display},`)) {
    problems.push({
      template: label,
      message: `style "${template.style}" expects the ${voice.display} voice, but the `
        + `template was built in ${template.schema.tokens.fonts.heading}`,
    });
  }

  // 6. Every running head must name this template's own category. The eyebrow
  //    is set from `beginTemplate()`'s third argument, several hundred lines
  //    from the `category` it has to agree with.
  const expectedHead = runningHeadFor(template.category);
  for (const page of parsed.data.pages) {
    for (const block of page.blocks) {
      if (block.type !== 'text-block') continue;
      const eyebrow = (block.props as Record<string, unknown>).eyebrow;
      if (typeof eyebrow === 'string' && eyebrow !== expectedHead) {
        problems.push({
          template: label,
          message: `running head "${eyebrow}" on page "${page.name}" does not match `
            + `category "${template.category}" (expected "${expectedHead}")`,
        });
      }
    }
  }

  return problems;
}

/**
 * Checks specific to the family system.
 *
 * The voice system's running-head rule deliberately does NOT apply here. Under
 * the approved Investment Compass catalogue a section eyebrow names the
 * *section* ("The verdict", "Projections", "Risk register") and the document is
 * named by the running head across the top of the page — `section_header_style:
 * eyebrow_rule_display` is exactly that arrangement. Asserting the voice rule
 * would reject every one of these templates for following its own spec.
 *
 * What replaces it is stricter in the way that matters: the compiled type must
 * be the family's, the declared density must be the manifest's, and every
 * colourway the entry offers must exist in that family's curated set.
 */
function validateCompass(template: CompassSeedTemplate): Problem[] {
  const problems: Problem[] = [];
  const label = template.slug;
  const meta = template.designMeta;

  const type = typographyFor(meta.familyKey);
  const fonts = template.schema.tokens.fonts as Record<string, string> | undefined;
  const expected: Array<[string, string]> = [
    ['display', type.display],
    ['heading', type.heading],
    ['body', type.body],
    ['mono', type.mono],
  ];
  for (const [role, face] of expected) {
    if (!fonts?.[role]?.startsWith(`${face},`)) {
      problems.push({
        template: label,
        message: `family "${meta.familyKey}" sets ${face} for ${role}, `
          + `but the template compiled ${fonts?.[role]}`,
      });
    }
  }

  // Every face the template NAMES must also be loadable, or WeasyPrint renders
  // the engine default and nothing says so.
  const faces = (template.schema.tokens as Record<string, unknown>).fontFaces as
    Array<{ family: string; cssUrl: string }> | undefined;
  const loaded = new Set((faces ?? []).map((f) => f.family));
  for (const [, face] of expected) {
    if (!loaded.has(face)) {
      problems.push({ template: label, message: `names ${face} but does not load it` });
    }
  }

  // The manifest is the design decision; the metadata the library filters on
  // has to agree with it, or a user filtering to "compact" gets a spacious page.
  if (meta.density !== meta.manifest.density) {
    problems.push({
      template: label,
      message: `density "${meta.density}" disagrees with the resolved manifest `
        + `("${meta.manifest.density}")`,
    });
  }

  const known = new Set(colourwaysForFamily(meta.familyKey).map((c) => c.id));
  if (known.size === 0) {
    problems.push({ template: label, message: `no colourways registered for family "${meta.familyKey}"` });
  }
  for (const id of meta.colourways) {
    if (!known.has(id)) {
      problems.push({ template: label, message: `unknown colourway "${id}"` });
    }
  }
  if (!known.has(meta.defaultColourway)) {
    problems.push({
      template: label,
      message: `default colourway "${meta.defaultColourway}" is not in the family's set`,
    });
  }

  return problems;
}

/** The row values shared by both systems. */
function rowFor(t: CatalogueTemplate): string {
  const facts = deriveEntryFacts({ report_type: t.reportType, schema: t.schema });
  const designMeta = isCompass(t) ? t.designMeta : {};
  return `  (
    ${sqlText(t.slug)}, 1, ${sqlText(t.name)}, ${sqlText(t.description)},
    ${sqlText(t.longDescription)}, ${sqlText(t.category)}, ${sqlText(t.reportType)},
    ${sqlText(t.tier ?? null)}, ${sqlTextArray(t.industry)}, ${sqlTextArray(t.tags)},
    ${sqlText(t.style)}, ${sqlText(facts.orientation)}, 'A4', ${facts.page_count},
    ${sqlJson(t.schema)}, ${sqlJson({})}, ${sqlText(t.accessTier)},
    ${sqlTextArray(facts.supported_modules)}, ${sqlTextArray(facts.required_bindings)},
    ${facts.brand_safe}, ${facts.production_ready}, ${facts.compatibility_version},
    ${sqlJson(facts.preview_schema)}, ${sqlJson(designMeta)}
  )`;
}

/**
 * Does the seed migration on disk still say what the template definitions
 * say?
 *
 * ## The defect this exists for
 *
 * The seeded catalogue is GENERATED — the file's own header says so, and
 * `npm run templates:library:seed` is the only thing that may write it. But
 * nothing anywhere compared the two, so the generator could be run or not run
 * and the repository looked identical either way. Measured on this branch,
 * 22 September 2026: seed v19 was written at `5d17954` and FOUR commits
 * changed what the definitions produce after it —
 *
 *   * `bcd1bf5` grew 142 dashboard KPI grids by 8–20pt, because a bound note
 *     was budgeted one line and sets two;
 *   * `b842936` took the cover facts off a density literal, moving 440 grids
 *     (280 from 11pt to 9pt, 160 from 14pt to 13pt);
 *
 * — and the migration still carried the pre-`5d17954` geometry for all of
 * them. The seed is what a deployment applies, so a fix that only reaches the
 * definitions reaches no document at all. That is precisely how v18 came to
 * merge without landing, which `20261212010000`'s own `@effect` line was
 * added to catch one layer further down.
 *
 * ## Why the comparison is the ARTEFACT and not a count
 *
 * A count baseline absorbs a change: one master gains a block while another
 * loses one and the number holds — the lesson `check-edge-functions.mjs` paid
 * for when `TS2304` was frozen by count and a live `ReferenceError` went with
 * it. So this compares the bytes the generator would write against the bytes
 * on disk, and where they differ it names the templates rather than the
 * offset, because a 40 MB diff sends nobody to a remedy.
 *
 * It is `investmentCompassSource.spec.ts`' rule one layer out: that spec
 * re-checks the generated families against the Design file's own evaluation
 * every run, and this checks the generated MIGRATION against the definitions
 * those families feed.
 */
function seedTuples(sql: string): Map<string, string> {
  const starts: { slug: string; at: number }[] = [];
  // The slug is the tuple's FIRST field and `version` is always 1, so this
  // sequence occurs nowhere else: `sqlText` picks a different dollar tag
  // whenever a value would contain its own, so no field's CONTENT can carry
  // `$tlt$` at all.
  const re = /\$tlt\$([a-z0-9][a-z0-9-]*)\$tlt\$, 1, /g;
  for (let m = re.exec(sql); m !== null; m = re.exec(sql)) {
    starts.push({ slug: m[1], at: m.index });
  }
  // The VALUES list ends at `ON CONFLICT`, and the last tuple must stop
  // there — otherwise the upsert clause and the publish statement ride on the
  // last template and a change to either is reported against a row that did
  // not move.
  const tail = sql.indexOf('\nON CONFLICT', starts.length > 0 ? starts[starts.length - 1].at : 0);
  const listEnd = tail === -1 ? sql.length : tail;
  const tuples = new Map<string, string>();
  starts.forEach((s, i) => {
    const end = i + 1 < starts.length ? starts[i + 1].at : listEnd;
    tuples.set(s.slug, sql.slice(s.at, end));
  });
  return tuples;
}

function reportDrift(fresh: string): void {
  const path = MIGRATION.replace(REPO + '/', '');
  if (!existsSync(MIGRATION)) {
    console.error(`✗ ${path} does not exist — the seed has never been written.`);
    console.error('  Run: npm run templates:library:seed');
    process.exit(1);
  }
  const onDisk = readFileSync(MIGRATION, 'utf-8');
  if (onDisk === fresh) {
    console.log(`✓ ${path} is what the template definitions produce (${(fresh.length / 1024).toFixed(0)} KB, byte-identical)`);
    return;
  }

  const a = seedTuples(onDisk);
  const b = seedTuples(fresh);
  const drifted = [...b.keys()].filter((slug) => a.get(slug) !== b.get(slug));
  const added = [...b.keys()].filter((slug) => !a.has(slug));
  const removed = [...a.keys()].filter((slug) => !b.has(slug));

  console.error(`✗ ${path} is not what the template definitions produce.`);
  console.error(
    `  ${drifted.length} of ${b.size} templates differ`
    + `${added.length > 0 ? `, ${added.length} are new` : ''}`
    + `${removed.length > 0 ? `, ${removed.length} are gone` : ''}`
    + `${drifted.length === 0 && added.length === 0 && removed.length === 0 ? ' — the difference is in the file header alone' : ''}.`,
  );
  for (const slug of [...added, ...removed, ...drifted].slice(0, 12)) {
    console.error(`    ${slug}`);
  }
  if (drifted.length + added.length + removed.length > 12) {
    console.error(`    … and ${drifted.length + added.length + removed.length - 12} more`);
  }
  console.error('  The migration is generated and must never be hand-edited.');
  console.error('  Run: npm run templates:library:seed');
  process.exit(1);
}

function main(mode: 'write' | 'check'): void {
  const problems: Problem[] = [];
  const slugs = new Set<string>();

  // Drained before validation so the log holds only what building the
  // catalogues produced. Importing the modules is what runs the builders.
  for (const o of takeOverflows()) {
    problems.push({
      template: `page "${o.page}"`,
      message: `content runs ${o.overBy}pt past the footer (ends at ${Math.round(o.bottom)}pt, `
        + 'limit 774pt) — shorten a block or move it to the next page',
    });
  }
  for (const o of takeCompassOverflows()) {
    problems.push({
      template: `${o.template} page "${o.page}"`,
      message: `content runs ${o.overBy}pt past the footer (ends at ${Math.round(o.bottom)}pt) `
        + '— shorten a block or move it to the next page',
    });
  }

  const all: CatalogueTemplate[] = [...SEED_TEMPLATES, ...FAMILY_TEMPLATES];

  for (const template of all) {
    if (slugs.has(template.slug)) {
      problems.push({ template: template.slug, message: 'duplicate slug' });
    }
    slugs.add(template.slug);
    problems.push(...validateCommon(template));
    problems.push(...(isCompass(template)
      ? validateCompass(template)
      : validateVoice(template)));
  }

  if (problems.length > 0) {
    console.error(`\n✖ ${problems.length} problem(s) — no migration written:\n`);
    for (const p of problems) console.error(`  ${p.template}: ${p.message}`);
    process.exit(1);
  }

  const rows = all.map(rowFor).join(',\n');

  const readyCount = all.filter(
    (t) => deriveEntryFacts({ report_type: t.reportType, schema: t.schema }).production_ready,
  ).length;

  /*
   * The drift guard, EMITTED rather than hand-added.
   *
   * This header was written into the migration by hand, under a comment
   * explaining that it exists because the migration creates no object — so
   * `scripts/ops/migration-drift.mjs` has nothing to count and reports it as
   * unverifiable, "which is exactly how seed v18 merged to main, never landed,
   * and left every report printing the heading it was written to fix".
   *
   * The generator did not emit it. So the FIRST thing the documented workflow
   * does — `CLAUDE.md`: "never hand-edit the generated migration — edit the
   * source and run `npm run templates:library:seed`" — was silently delete the
   * guard that exists because a seed once merged without landing. Measured: a
   * seed run on an unchanged tree produced an 8-line deletion and nothing else.
   *
   * It is derived from `RELEASE_ID` rather than restated, so the assertion and
   * the rows it is asserting about can never name different releases.
   */
  const sql = `-- @effect: select 1 from public.template_library_release_baselines where release = '${RELEASE_ID}'
-- The line above is this file's own statement of what is true once it has
-- run. It exists because this migration creates no object, so
-- \`scripts/ops/migration-drift.mjs\` has nothing to count and would report
-- it as unverifiable — which is exactly how seed v18 merged to main, never
-- landed, and left every report printing the heading it was written to fix.
-- Read-only by construction: the runner refuses anything that is not a
-- lone SELECT.
-- =====================================================================
-- Template Library — seeded catalogue.
--
-- Generated by scripts/template-library/buildSeedCatalogue.ts. Do not hand-edit:
-- edit the template definitions and re-run \`npm run templates:library:seed\`,
-- which re-validates every schema against the live Zod contract and the
-- production renderer allow-list before it writes anything.
--
-- ${all.length} templates, of which ${readyCount} are production-ready (their report type has a
-- Template Builder adapter). The rest are browsable, previewable and copyable
-- but cannot be activated for live report generation — that limitation belongs
-- to the adapter registry, not to the library, and is surfaced on each card.
--
-- ${FAMILY_TEMPLATES.length} of them are design-family masters (${INVESTMENT_COMPASS_TEMPLATES.length} Investment Compass,
-- ${BORROWING_CAPACITY_TEMPLATES.length} Borrowing Capacity, ${PORTFOLIO_TEMPLATES.length} Portfolio Performance Review,
-- ${COMPARISON_TEMPLATES.length} Property Comparison, ${CASH_FLOW_COMPASS_TEMPLATES.length} 10 Year Cash Flow,
-- ${CLIENT_DETAILS_TEMPLATES.length} Client Details Form,
-- ${CASH_FLOW_COMPARISON_TEMPLATES.length} Cash Flow Comparison,
-- ${REPORT_QA_TEMPLATES.length} Report Q&A,
-- ${COMMERCIAL_CAPACITY_TEMPLATES.length} Commercial & Industrial Capacity,
-- ${MARKET_INTELLIGENCE_TEMPLATES.length} Market Intelligence), which additionally carry
-- \`design_meta\` (family, variant axis, density, resolved manifest, colourway
-- set). Requires 20260811110000_template_library_design_meta.sql.
--
-- IDEMPOTENT: upserts on (slug, version). Re-running updates the seeded rows
-- and never duplicates them. Rows an operator promoted themselves are matched
-- by neither slug nor version and are therefore never touched.
-- =====================================================================

-- ── The baseline this release is judged against ───────────────────────────
--
-- Captured BEFORE the upsert below, because the upsert overwrites \`schema\` in
-- place: \`ON CONFLICT (slug, version)\` with \`version\` = 1 for every entry, so
-- there is exactly one row per slug and the previous release's schema is gone
-- the moment this statement runs. Nothing else in the database retains it.
--
-- What it is for: the refresh that follows this seed must not replace a master
-- a tenant has edited. It can only know that by comparing the tenant's copy
-- against what the library held when they took it — which is this digest.
--
-- \`tokens.colors\` is removed before hashing, and ONLY that path, because
-- \`applyColourwayToSchema\` spreads \`...tokens\` and replaces \`colors\` alone.
-- So a supported colourway difference is accounted for exactly, and a tenant's
-- typeface (\`tokens.fonts\`), page, block, section, binding or branding is
-- fully visible to the comparison rather than hidden by a loose exclusion.
--
-- jsonb's text form is canonical — keys sorted, whitespace normalised — so the
-- digest is stable across writes and comparable between rows.
CREATE TABLE IF NOT EXISTS public.template_library_release_baselines (
  entry_id uuid NOT NULL,
  release text NOT NULL,
  schema_digest text NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entry_id, release)
);

COMMENT ON TABLE public.template_library_release_baselines IS
  'Digest of each library entry schema as it stood immediately BEFORE a seed release overwrote it, so a later refresh can prove whether an adopted copy is unedited. Service role only.';

ALTER TABLE public.template_library_release_baselines ENABLE ROW LEVEL SECURITY;

INSERT INTO public.template_library_release_baselines (entry_id, release, schema_digest)
SELECT e.id, '${RELEASE_ID}', md5((e.schema #- '{tokens,colors}')::text)
FROM public.template_library_entries e
WHERE e.schema IS NOT NULL
ON CONFLICT (entry_id, release) DO NOTHING;

INSERT INTO public.template_library_entries (
  slug, version, name, description,
  long_description, category, report_type,
  tier, industry, tags,
  style, orientation, page_size, page_count,
  schema, config, access_tier,
  supported_modules, required_bindings,
  brand_safe, production_ready, compatibility_version,
  preview_schema, design_meta
)
VALUES
${rows}
ON CONFLICT (slug, version) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  long_description = EXCLUDED.long_description,
  category = EXCLUDED.category,
  report_type = EXCLUDED.report_type,
  tier = EXCLUDED.tier,
  industry = EXCLUDED.industry,
  tags = EXCLUDED.tags,
  style = EXCLUDED.style,
  orientation = EXCLUDED.orientation,
  page_count = EXCLUDED.page_count,
  schema = EXCLUDED.schema,
  access_tier = EXCLUDED.access_tier,
  supported_modules = EXCLUDED.supported_modules,
  required_bindings = EXCLUDED.required_bindings,
  brand_safe = EXCLUDED.brand_safe,
  production_ready = EXCLUDED.production_ready,
  compatibility_version = EXCLUDED.compatibility_version,
  preview_schema = EXCLUDED.preview_schema,
  design_meta = EXCLUDED.design_meta,
  updated_at = now();

-- Publish them. Done as a separate statement so a re-run republishes anything
-- an operator archived without resurrecting their own entries.
UPDATE public.template_library_entries
SET status = 'published',
    published_at = COALESCE(published_at, now())
WHERE version = 1
  AND status = 'draft'
  AND slug IN (${all.map((t) => sqlText(t.slug)).join(', ')});
`;

  if (mode === 'check') {
    reportDrift(sql);
    return;
  }

  mkdirSync(dirname(MIGRATION), { recursive: true });
  writeFileSync(MIGRATION, sql);

  console.log(`✓ ${all.length} templates validated against the live schema`);
  console.log(
    `  ${SEED_TEMPLATES.length} voice, ${INVESTMENT_COMPASS_TEMPLATES.length} Investment Compass, `
    + `${BORROWING_CAPACITY_TEMPLATES.length} Borrowing Capacity, `
    + `${PORTFOLIO_TEMPLATES.length} Portfolio Performance Review, `
    + `${COMPARISON_TEMPLATES.length} Property Comparison, `
    + `${CASH_FLOW_COMPASS_TEMPLATES.length} 10 Year Cash Flow, `
    + `${CLIENT_DETAILS_TEMPLATES.length} Client Details Form, `
    + `${CASH_FLOW_COMPARISON_TEMPLATES.length} Cash Flow Comparison, `
    + `${REPORT_QA_TEMPLATES.length} Report Q&A, `
    + `${COMMERCIAL_CAPACITY_TEMPLATES.length} Commercial & Industrial Capacity, `
    + `${MARKET_INTELLIGENCE_TEMPLATES.length} Market Intelligence`,
  );
  console.log(`  ${readyCount} production-ready, ${all.length - readyCount} preview-only`);
  console.log(`  → ${MIGRATION.replace(REPO + '/', '')} (${(sql.length / 1024).toFixed(0)} KB)`);
}

main(process.argv.includes('--check') ? 'check' : 'write');
