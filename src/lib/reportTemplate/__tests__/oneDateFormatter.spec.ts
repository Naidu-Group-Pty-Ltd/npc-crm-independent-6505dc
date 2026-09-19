/**
 * One date formatter, for every document this product produces.
 *
 * ## What was there
 *
 * Twelve copies of the same eight lines, under four names. Eleven render
 * routes each carried a private long-month `MONTHS` table and a private reader
 * of it — `formatReportDate` in eight, `formatAssessedOn` in Borrowing
 * Capacity, `formatPreparedOn` in the two Cash Flow routes — plus `shortDate`
 * in Market Intelligence, the same again with the month clipped. The template
 * renderer's `| date` filter was the twelfth.
 *
 * Each carried the same two-reason comment about why it did not call `Date`,
 * and no two were ever read side by side — which is how they came to disagree
 * without anyone noticing that the flowing routes print `16 August 2026` while
 * the template renderer prints `16 Aug 2026`. One report can be drawn by either
 * engine.
 *
 * Both spellings survive; they are a style, and the masters are typeset around
 * the short one. What does not survive is two implementations free to drift.
 *
 * ## Why this is a source scan
 *
 * Nothing about a duplicated formatter fails. Each copy is correct in
 * isolation, each format's own tests pass against its own copy, and a thirteenth
 * would be added by someone doing exactly what the eleven authors did — writing
 * eight obvious lines rather than hunting for a shared module. The only thing
 * that catches it is looking.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '../../../..');
const REPORTS = join(ROOT, 'supabase/functions/_shared/reports');
const SHARED = 'reportDate.pure.ts';

/** Every module under the report render tree, plus the template renderer. */
function sources(): Array<{ rel: string; code: string }> {
  const out: Array<{ rel: string; code: string }> = [];
  const walk = (dir: string, prefix: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) { walk(path, `${prefix}/${entry.name}`); continue; }
      if (!entry.name.endsWith('.ts') || entry.name === SHARED) continue;
      out.push({ rel: `${prefix}/${entry.name}`, code: readFileSync(path, 'utf8') });
    }
  };
  walk(REPORTS, 'supabase/functions/_shared/reports');
  for (const name of ['bindingResolver.ts', 'blocks/_data.ts']) {
    out.push({
      rel: `src/lib/reportTemplate/${name}`,
      code: readFileSync(join(ROOT, 'src/lib/reportTemplate', name), 'utf8'),
    });
  }
  return out;
}

const stripComments = (code: string) => code
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

describe('one date formatter', () => {
  it('no module carries its own month table', () => {
    // The tell. Every copy needed one, and nothing else in these modules does.
    const offenders = sources()
      .filter(({ code }) => /'January',\s*'February'|'Jan',\s*'Feb'/.test(stripComments(code)))
      .map(({ rel }) => rel);
    expect(
      offenders,
      `${offenders.join(', ')} declares its own month names. Import from `
      + '_shared/reports/reportDate.pure.ts instead.',
    ).toEqual([]);
  });

  it('no module reads a date out of an ISO string by hand', () => {
    // The second tell, and the one that survives a renamed month table: the
    // year/month/day capture every copy opened with.
    const offenders = sources()
      .filter(({ code }) => /\(\\d\{4\}\)-\(\\d\{2\}\)-\(\\d\{2\}\)/.test(stripComments(code)))
      .map(({ rel }) => rel);
    expect(
      offenders,
      `${offenders.join(', ')} parses an ISO date itself. Use formatReportDate `
      + 'or formatIsoDate from _shared/reports/reportDate.pure.ts.',
    ).toEqual([]);
  });

  it('no report module reaches for the platform date formatter', () => {
    /*
     * `toLocaleDateString` depends on the runtime's ICU build and on its
     * timezone, and both were live defects: the same payload dated itself
     * differently in Deno and in Node, and `new Date('2016-02-14')` is midnight
     * UTC, so a client's move-in date printed a day early on every render west
     * of UTC.
     *
     * `bindingResolver` keeps one call, for the inputs that are not ISO strings
     * at all — a `Date` object, or "March 3 2026" — which is the only thing the
     * platform parser is there for.
     */
    const offenders = sources()
      .filter(({ rel }) => !rel.endsWith('bindingResolver.ts') && !rel.endsWith('_data.ts'))
      .filter(({ code }) => stripComments(code).includes('toLocaleDateString'))
      .map(({ rel }) => rel);
    expect(offenders, `${offenders.join(', ')} formats a date through the platform`).toEqual([]);
  });

  it('every route that dates a document still exports the name it always did', () => {
    // The eleven were re-exported rather than removed: each name is part of a
    // module's surface, and two projections and several suites import one.
    const expected: Record<string, string> = {
      clientDetails: 'formatReportDate',
      commercialCapacity: 'formatReportDate',
      converted: 'formatReportDate',
      investment: 'formatReportDate',
      marketIntelligence: 'formatReportDate',
      portfolio: 'formatReportDate',
      propertyComparison: 'formatReportDate',
      reportQa: 'formatReportDate',
      borrowingCapacity: 'formatAssessedOn',
      cashFlow: 'formatPreparedOn',
      cashFlowComparison: 'formatPreparedOn',
    };
    for (const [module, name] of Object.entries(expected)) {
      const code = readFileSync(join(REPORTS, module, 'render.pure.ts'), 'utf8');
      // Imported and then re-exported, rather than `export … from` — several of
      // these modules call the function themselves, and a bare `export … from`
      // creates no local binding, so those routes threw `formatReportDate is
      // not defined` at module load.
      expect(code, `${module} does not import the shared reader`)
        .toMatch(new RegExp(`import \\{[^}]*\\b${name}\\b[^}]*\\} from '\\.\\./${SHARED}'`));
      expect(code, `${module} no longer exports ${name}`)
        .toMatch(new RegExp(`export \\{\\s*${name}(?:,[^}]*)?\\s*\\};`));
    }
  });
});
