/**
 * S5 — the Executive Briefing and the Snapshot, produced and drawn.
 *
 *   npx tsx scripts/reports/s5CondenseReports.mts
 *
 * The last two of the five client reports. They come out of
 * `condense-investment-report`, which makes ONE model call and then runs a
 * long deterministic composition over the answer — and until
 * `condenseCompose.pure.ts` existed that composition could not run outside a
 * deployed Deno runtime, so neither document had ever been drawn as a
 * document and read.
 *
 * This runs the real composition for both subjects, builds the row the
 * function would persist (`report_tier`, `report_variant`, both linkage
 * columns, the parent's record copied across — exactly the insert at
 * `condense-investment-report/index.ts:463`), and draws each through the
 * supported template path: `compileTemplateHtmlForPdf` then WeasyPrint on the
 * six options the production route sends.
 *
 * ## The one stand-in, named
 *
 * The model call is stood in for by `_condenseStandIn.mts`, which excerpts the
 * parent's own blocks whole. Read that file's header for why that is a fair
 * substitute and what it refuses to do — the short version is that it copies
 * and never composes, so it cannot invent a figure, which is the one failure
 * that would make a finding here ambiguous.
 *
 * Everything downstream of the model call is the production implementation,
 * unmodified: the recorded-facts block, the composed financial chapters, the
 * score breakdown, the SWOT, the verdict, the registry trim, the
 * declared-order assembly and all five hygiene passes.
 *
 * `runQAValidation` is run here exactly as the handler runs it, against the
 * same recorded score set, because a document nobody validated is not the
 * document production ships.
 *
 * `reports/fixtures/*-row.json` is read from production and `reports/` is
 * git-ignored, so a fresh checkout has to fetch them first.
 */
import {
  composeCondensedDocument, type CondensedTier,
} from '../../supabase/functions/_shared/reports/investment/condenseCompose.pure';
import { runQAValidation } from '../../supabase/functions/_shared/compassQAValidator';
import { STAND_IN_NOTE, condenseStandIn } from './_condenseStandIn.mts';
import { drawReportRow, headingsOf, readFixture } from './_s5Render.mts';

const read = readFixture;

console.log(`STAND-IN: ${STAND_IN_NOTE}\n`);

interface Drawn { key: string; tier: string; sections: number; chars: number; pages: string; }
const drawn: Drawn[] = [];

for (const subject of ['annabelle', 'pallas']) {
  const parent = read(`reports/fixtures/${subject}-row.json`);
  console.log(`${parent.property_address}`);
  console.log(`  parent: ${String(parent.report_content ?? '').length} chars, `
    + `${headingsOf(parent.report_content ?? '').length} H2 sections`);

  for (const tier of ['briefing', 'snapshot'] as CondensedTier[]) {
    const standIn = condenseStandIn(String(parent.report_content ?? ''), tier);
    const composed = composeCondensedDocument({
      tier,
      modelMarkdown: standIn.markdown,
      investmentScore: parent.investment_score,
      financialCalculations: parent.financial_calculations,
      parentContent: typeof parent.report_content === 'string' ? parent.report_content : undefined,
    });
    // The tier being produced. This said `'compass-40'` because the handler
    // did, which is how the harness came to reproduce the fault it was meant
    // to observe: sixteen Compass findings on a correct Briefing.
    const qa = runQAValidation(composed.markdown, tier, { recordedScores: composed.recordedScores });

    // The row the function would persist: the parent's record, the tier's
    // content, both linkage columns.
    const row = {
      ...parent,
      report_content: composed.markdown,
      report_tier: tier,
      report_variant: tier,
      parent_report_id: parent.id,
      derived_from_report_id: parent.id,
    };
    const name = `s5-${subject}-${tier}`;
    const { pages, warnings } = await drawReportRow(row, name);
    const sections = headingsOf(composed.markdown);

    console.log(`  ${tier}`);
    console.log(`    stand-in   ${String(standIn.markdown.length).padStart(6)} chars, `
      + `${standIn.trace.length} of ${standIn.trace.length + standIn.omitted.length} declared headings filled`
      + (standIn.omitted.length ? `; omitted (nothing in the parent to copy): ${standIn.omitted.join(', ')}` : ''));
    for (const t of standIn.trace) console.log(`      ${t.heading.padEnd(22)} ← ${t.from.join(' + ')}`);
    console.log(`    composed   ${String(composed.markdown.length).padStart(6)} chars, ${sections.length} sections`);
    console.log(`      ${sections.join(' · ')}`);
    console.log(`    hygiene    ${JSON.stringify(composed.hygiene)}`);
    if (composed.postProcessReport) {
      console.log(`    postproc   ${JSON.stringify(composed.postProcessReport)}`);
    }
    console.log(`    QA         ${JSON.stringify(qa)}`);
    console.log(`    drawn      ${String(pages).padStart(3)} pages`
      + (warnings > 2 ? `  · ${warnings} engine warnings` : ''));
    drawn.push({ key: name, tier, sections: sections.length, chars: composed.markdown.length, pages });
  }
  console.log('');
}

console.log(`${drawn.length} documents drawn · reports/pdf/s5-*.pdf`);
