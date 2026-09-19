/**
 * S5 — the Investment Compass, for both subjects, beside the other four.
 *
 *   npx tsx scripts/reports/s5CompassReports.mts
 *
 * The Compass is the only one of the five that needs no composition: it IS
 * the stored parent row. S1 drew Kellyville's through this path and read six
 * representative pages; this draws both subjects' whole, through the same
 * `_s5Render.mts` step the fork and condense runs use, so the suite is ten
 * documents that can be compared with each other rather than nine plus one
 * drawn a different way.
 */
import { drawReportRow, headingsOf, readFixture, TEMPLATE } from './_s5Render.mts';

console.log(`master: ${TEMPLATE.name} (${TEMPLATE.slug})\n`);

for (const subject of ['annabelle', 'pallas']) {
  const row = readFixture(`reports/fixtures/${subject}-row.json`);
  const content = String(row.report_content ?? '');
  const drawn = await drawReportRow(row, `s5-${subject}-compass`);
  console.log(`${row.property_address}`);
  console.log(`  ${String(content.length).padStart(6)} chars, ${headingsOf(content).length} sections`);
  console.log(`  ${headingsOf(content).join(' · ')}`);
  console.log(`  drawn ${String(drawn.pages).padStart(3)} pages`
    + (drawn.warnings > 2 ? `  · ${drawn.warnings} engine warnings` : ''));
  console.log('');
}
