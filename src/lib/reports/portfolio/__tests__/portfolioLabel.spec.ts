/**
 * Audit item 11 — one report, three names.
 *
 *   Client portal → Request a report     "Portfolio Performance Review"
 *   Clients → a client → Reports         "Portfolio Analysis"
 *   Clients → a client → Sent Reports    "Portfolio Review"
 *
 * `PortalReports.tsx` managed two of the three by itself, in adjacent maps —
 * which is what a literal repeated at fourteen call sites does. The name is
 * imported now, and this fails any UI file that spells a variant.
 *
 * The scan is deliberately over the RENDERED source: comments may still say
 * "Portfolio Performance Review" — several must, to record what changed and
 * why — and the document's own title legitimately keeps it.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PORTFOLIO_REPORT_LABEL } from '../label';

const root = join(__dirname, '..', '..', '..', '..', '..');

/** Every UI surface that names this report. */
const SURFACES = [
  'src/components/clients/ClientReportRequestsTab.tsx',
  'src/components/clients/ClientSentReportsTab.tsx',
  'src/components/clients/ClientReportsTab.tsx',
  'src/components/clients/PortfolioAnalysisReportsList.tsx',
  'src/components/clients/PortfolioReportDownloadButton.tsx',
  'src/components/clients/FollowUpFlag.tsx',
  'src/components/clients/ClientReminders.tsx',
  'src/components/clients/review-wizard/index.tsx',
  'src/components/portal/PortalRequestReportForm.tsx',
  'src/pages/ReportRequests.tsx',
  'src/pages/portal/PortalReports.tsx',
];

/** Source with prose removed — the assertions are about what is drawn. */
function code(relative: string): string {
  return readFileSync(join(root, relative), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');
}

describe('the report has one name', () => {
  it('is "Portfolio Analysis"', () => {
    expect(PORTFOLIO_REPORT_LABEL).toBe('Portfolio Analysis');
  });

  it.each(SURFACES)('%s spells no variant', (relative) => {
    const source = code(relative);
    expect(source).not.toMatch(/Portfolio Performance Review/);
    expect(source).not.toMatch(/Portfolio Review/);
  });

  it.each(SURFACES)('%s imports the name rather than repeating it', (relative) => {
    expect(code(relative)).toMatch(/PORTFOLIO_REPORT_LABEL/);
  });
});

/**
 * The list above is eleven files somebody remembered. That is the weakness
 * this describe block exists to close: a guard that enumerates its subjects
 * can only ever catch the surfaces named in it, and the name came back through
 * the ones that were not — a tooltip on the client header, the toast at the
 * end of the wizard, the aria-label on its close button, the download control
 * on the Reports tab, the sentence in the CLIENT's own onboarding tour and the
 * empty state on their reports page. Six surfaces, two of them read by the
 * customer, none of them on the list.
 *
 * So this scans every UI file instead, and the exceptions are named with the
 * reason each one is allowed. A new surface is covered the moment it exists.
 */
const ALLOWED: ReadonlyArray<readonly [string, string]> = [
  [
    'src/lib/reportTemplate/adapters/portfolioAdapter.ts',
    "the DOCUMENT's own title — its formal name on the fifty Investment Compass "
      + 'masters and in render-portfolio-review-pdf. Changing it is a template-library '
      + 'regeneration, not a label change.',
  ],
  [
    'src/lib/command-center/templateLibrary.ts',
    'seeded catalogue content — the name of a template somebody can pick, not '
      + "this product's name for the report.",
  ],
  [
    'src/lib/reportTemplate/sampleDataPresets.ts',
    'sample data for a preview render, never drawn as a label.',
  ],
  [
    'src/lib/templateLibrary/sampleReportData.ts',
    'sample data for a preview render, never drawn as a label.',
  ],
];

/** A SPACE-separated phrase only: `portfolio_review` and `portfolioReview` are
 *  the stored value and an identifier, and both must survive untouched. */
const VARIANT = /portfolio\s+(?:performance\s+)?review/i;

function everyUiFile(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
        walk(rel);
      } else if (/\.tsx?$/.test(entry.name) && !/\.(spec|test)\.tsx?$/.test(entry.name)) {
        out.push(rel);
      }
    }
  };
  walk('src');
  return out;
}

describe('no surface spells a variant, including the ones nobody listed', () => {
  const allowed = new Set(ALLOWED.map(([file]) => file));

  it('scans the whole UI, not a list of files', () => {
    // If this ever collapses to a handful, the scan has stopped scanning.
    expect(everyUiFile().length).toBeGreaterThan(500);
  });

  it('every exception names why it is one', () => {
    for (const [file, reason] of ALLOWED) {
      expect(reason.length, `${file} has no reason`).toBeGreaterThan(30);
      expect(existsSync(join(root, file)), `${file} no longer exists`).toBe(true);
    }
  });

  it('no other file names this report anything but its one name', () => {
    const offenders: string[] = [];
    for (const relative of everyUiFile()) {
      if (allowed.has(relative)) continue;
      const source = code(relative);
      const match = VARIANT.exec(source);
      if (match) {
        const line = source.slice(0, match.index).split('\n').length;
        offenders.push(`${relative}:${line} — "${match[0]}"`);
      }
    }
    expect(offenders, `use PORTFOLIO_REPORT_LABEL instead:\n${offenders.join('\n')}`).toEqual([]);
  });
});

describe('what deliberately did not change', () => {
  it('leaves the stored values alone', () => {
    // `portfolio_review`, `portfolio` and `review` are what the database
    // holds and what every query matches on. Renaming a label must never
    // reach them.
    expect(code('src/pages/portal/PortalReports.tsx')).toMatch(/portfolio_review:/);
    expect(code('src/components/clients/ClientSentReportsTab.tsx')).toMatch(/value="portfolio"/);
    expect(code('src/components/clients/FollowUpFlag.tsx')).toMatch(/value: 'review'/);
  });

  it("leaves the document's own title, which is a different artefact", () => {
    // "Portfolio Performance Review" is the report's formal name on the fifty
    // Investment Compass masters, in the seeded catalogue and in
    // `render-portfolio-review-pdf`. Changing it is a template-library
    // regeneration, not a label change — so it stays, and stays deliberate.
    const adapter = readFileSync(
      join(root, 'src', 'lib', 'reportTemplate', 'adapters', 'portfolioAdapter.ts'),
      'utf8',
    );
    expect(adapter).toMatch(/title: 'Portfolio Performance Review'/);
  });
});
