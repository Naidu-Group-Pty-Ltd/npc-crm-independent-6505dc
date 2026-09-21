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
import { writeFileSync, mkdirSync } from 'node:fs';
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
 * Run the same one-query check before editing this file: if
 * `20261209000000` is already recorded, the next change needs a v19.
 */
/**
 * The identifier this release records against a baseline and against a
 * refreshed master. It is the seed migration's own basename, so a row that
 * says it carries this release names the artefact that put it there.
 */
const RELEASE_ID = '20261209000000_seed_template_library_v18_assessment_share_of_grade';

const MIGRATION = resolve(
  REPO,
  'supabase/migrations/20261209000000_seed_template_library_v18_assessment_share_of_grade.sql',
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

function main(): void {
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

  const sql = `-- =====================================================================
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

main();
