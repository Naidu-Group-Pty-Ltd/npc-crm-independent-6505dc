/**
 * S5 — the Financial and Due Diligence reports, produced and drawn.
 *
 *   npx tsx scripts/reports/s5ForkReports.mts
 *
 * Two of the five client reports come out of `fork-investment-report`, and
 * until `forkSplit.pure.ts` existed neither could be produced outside a
 * deployed Deno runtime — so neither had ever been drawn as a document and
 * read. They need no model call: the composite's own sections are routed
 * through the split registry and the financial chapters are typed from the
 * recorded calculation.
 *
 * This runs the real composition for both subjects, builds the row each fork
 * would persist (the parent's record with the variant's content and tier, as
 * `upsertFork` writes it), and draws each through `_s5Render.mts` — the one
 * render step all ten S5 documents share, so a defect found in one document
 * cannot be an artefact of how that document alone reached the paper.
 *
 * The registry is the code default, which IS production's: `report_engine_config`
 * holds no overlay for `split_routes`, `split_metadata`,
 * `split_section_order_fin` or `split_section_order_pldd` (measured 17 Sep 2026).
 *
 * `reports/fixtures/*-row.json` is read from production and `reports/` is
 * git-ignored, so a fresh checkout has to fetch them first.
 */
import { composeForkDocuments } from '../../supabase/functions/_shared/reports/investment/forkSplit.pure';
import { loadSplitRegistry } from '../../supabase/functions/_shared/reportSplitRegistry';
import { drawReportRow, readFixture } from './_s5Render.mts';

const read = readFixture;

/** A client that answers nothing, so the registry resolves to its code defaults. */
const NO_OVERLAY = { from: () => ({ select: () => ({ in: async () => ({ data: null }) }) }) } as never;
/** Fixed, so a document produced twice is the same document. */
const GENERATED_ON = '2026-09-17';

const registry = await loadSplitRegistry(NO_OVERLAY);
console.log(`split registry: ${JSON.stringify(registry.source)}\n`);

interface Row { key: string; tier: string; sections: number; chars: number; pages: string; }
const produced: Row[] = [];

for (const subject of ['annabelle', 'pallas']) {
  const parent = read(`reports/fixtures/${subject}-row.json`);
  const docs = composeForkDocuments({
    registry,
    parentContent: parent.report_content || '',
    propertyAddress: parent.property_address,
    financialCalculations: parent.financial_calculations,
    // The fork scores each variant separately; the parent's own score is what
    // the composed chapters read, and re-scoring here would be a different
    // question from "does the document draw".
    financialScore: parent.investment_score,
    composeFinancial: true,
    generatedOn: GENERATED_ON,
  });

  console.log(`${parent.property_address}`);
  console.log(`  composite: ${docs.compositeSections} sections`);
  console.log(`  composed chapters: ${docs.composedChapters.length}`);
  if (docs.replacedByComposedChapters.length) {
    console.log(`  routed prose replaced by the record: ${docs.replacedByComposedChapters.join('; ')}`);
  }

  for (const [key, out, tier] of [
    ['financial', docs.financial, 'financial'],
    ['strategic', docs.dueDiligence, 'strategic'],
  ] as const) {
    // The row the fork would persist: the parent's record, the variant's
    // content and tier. `upsertFork` writes exactly these.
    const row = {
      ...parent,
      report_content: out.markdown,
      report_tier: tier,
      report_variant: tier,
      derived_from_report_id: parent.id,
      parent_report_id: parent.id,
    };
    const name = `s5-${subject}-${key}`;
    const { pages, warnings } = await drawReportRow(row, name);
    console.log(
      `  ${key.padEnd(10)} ${String(out.sections).padStart(2)} sections  `
      + `${String(out.markdown.length).padStart(6)} chars  ${String(pages).padStart(3)} pages  `
      + `hygiene: ${out.editorialBlocksRemoved} editorial, ${out.placeholderRowsRemoved} placeholder rows, `
      + `${out.emptyStatCardsRemoved} empty cards, ${out.duplicateDirectivesRemoved} duplicate figures`
      + (warnings > 2 ? `  · ${warnings} engine warnings` : ''),
    );
    produced.push({ key: name, tier, sections: out.sections, chars: out.markdown.length, pages });
  }
  console.log('');
}

console.log(`${produced.length} documents drawn · reports/pdf/s5-*.pdf`);
