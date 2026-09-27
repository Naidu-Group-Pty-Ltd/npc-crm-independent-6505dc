/**
 * The stylesheet the C&I 10-year cash flow report is printed in.
 *
 * The report is printed from a window the card opens and writes: it is a
 * document, not a screen, and the application's stylesheets and tokens do not
 * reach it. So its type and colours are stated here, in the one module that
 * decides them, and nowhere in the card.
 *
 * With no design chosen it is the house sheet, byte for byte — exactly what the
 * report has always printed in. With a design (`drawnDesign.pure.ts`) it is the
 * same rules in the design's inks, rules and heading face. The report's head
 * takes the design's cover: a panel of its field on a field or band design, a
 * rule in its accent on a paper one, because a printed page has no cover of
 * its own. Nothing here changes a word, a figure or which sections print.
 */
import type { DrawnDocumentDesign } from '@/lib/reports/drawnDocumentDesign';

/** The house sheet — the report's stylesheet before designs existed. */
// eslint-disable-next-line no-restricted-syntax -- the printed report's own inks, in a print window the app's tokens do not reach
export const HOUSE_PRINT_STYLE = 'body{font-family:Arial,sans-serif;color:#111827;margin:32px}h1,h2{color:#0f172a}.cover{border-bottom:3px solid #2563eb;padding-bottom:16px;margin-bottom:24px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.card{border:1px solid #d1d5db;border-radius:8px;padding:12px;margin:8px 0}.muted{color:#6b7280}table{width:100%;border-collapse:collapse;margin-top:8px}th,td{border:1px solid #d1d5db;padding:6px;text-align:right}th:first-child,td:first-child{text-align:left}@media print{button{display:none}.page-break{break-before:page}}';

/** The CSS face a drawn face is printed in: a serif design sets its headings in one. */
function headingStack(design: DrawnDocumentDesign): string {
  return design.faces.heading === 'times' ? "Georgia,'Times New Roman',serif" : 'Arial,sans-serif';
}

/** The stylesheet for this design, or the house sheet where none was chosen. */
export function tenYearCashFlowPrintStyle(design: DrawnDocumentDesign | null): string {
  if (!design) return HOUSE_PRINT_STYLE;
  const f = design.family;
  const head = design.cover.ground === 'paper'
    ? `.cover{border-bottom:3px solid ${f.accent};padding-bottom:16px;margin-bottom:24px}`
    : `.cover{background:${f.field};color:${f.onField};padding:20px 24px;margin:0 0 24px;border-bottom:3px solid ${f.accent}}`
      + `.cover h1{color:${f.onField}}.cover .muted{color:${f.accentOnField}}`;
  return `body{font-family:Arial,sans-serif;color:${f.bodyInk};margin:32px}h1,h2,h3{color:${f.deep};font-family:${headingStack(design)}}${head}`
    + `.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.card{border:1px solid ${f.hairline};border-radius:8px;padding:12px;margin:8px 0}`
    + `.muted{color:${f.mutedInk}}table{width:100%;border-collapse:collapse;margin-top:8px}th,td{border:1px solid ${f.hairline};padding:6px;text-align:right}`
    + `th{background:${f.deep};color:${f.onDeep}}tbody tr:nth-child(even) td{background:${f.stripe}}`
    + `th:first-child,td:first-child{text-align:left}@media print{*{-webkit-print-color-adjust:exact;print-color-adjust:exact}button{display:none}.page-break{break-before:page}}`;
}
