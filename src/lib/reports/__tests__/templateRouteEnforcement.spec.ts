/**
 * One contract, enforced for every format at once.
 *
 * Each round of this programme fixed a hole that existed because a format was
 * wired *nearly* all the way: an adapter with no lister, a `variant` nothing
 * passed, a route that rendered a refusal, a picker whose choice the generator
 * ignored. Every one of them was invisible per-format and obvious across
 * formats, which is what this file is for — a tenth format cannot be added half
 * wired, and a ninth cannot quietly lose a half it already had.
 *
 * The rules, in the order they bite:
 *
 *  1. A production format has an adapter that can list, route and bind.
 *  2. Its delivery path asks for a templated document before rendering its own
 *     way, so activating a template actually changes the document.
 *  3. That request carries the **person's chosen template**, because the picker
 *     offers a choice for every format and says it is kept.
 *  4. A format whose choice cannot change anything says so, rather than
 *     offering a choice that does nothing.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { listAdapters, getAdapter } from '@/lib/reportTemplate/adapters';
import { listReportFormats } from '@/lib/reportTemplate/reportFormats';

const ROOT = join(__dirname, '../../../..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const stripComments = (source: string) => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

/**
 * Where each production format's documents are produced.
 *
 * The `deliver*` module, or the one surface that plays that part for a format
 * that has none. This list is the map from "format" to "the code a person's
 * download actually runs", and it is written out rather than derived because
 * being wrong about it is the failure this file exists to catch.
 */
const DELIVERY_PATHS: Record<string, string[]> = {
  // Phase 3 delivery unification: the chain that lived in PremiumPdfButton
  // (template-first, legacy route fallback) moved into investment's own
  // deliver module, and every surface — the primary download, Send to
  // Client, the premium button, the flatten copy — asks it.
  investment: ['src/lib/reports/investment/deliverInvestmentPdf.ts'],
  borrowing_capacity: ['src/lib/reports/borrowingCapacity/deliverSnapshot.ts'],
  portfolio: ['src/lib/reports/portfolio/deliverPortfolioReview.ts'],
  comparison: ['src/lib/reports/propertyComparison/deliverComparisonPdf.ts'],
  client_details: ['src/lib/reports/clientDetails/deliverClientDetailsPdf.ts'],
  qa: ['src/lib/reports/reportQa/deliverReportQaPdf.ts'],
  commercial_capacity: ['src/hooks/useCapacityReport.ts'],
  market_intelligence: ['src/lib/reports/marketIntelligence/deliverMarketIntelligencePdf.ts'],
  // The 10 Year Cash Flow produces its document from the modal, because the
  // projection is an argument rather than a lookup and only that surface holds
  // it. See `cashFlowTemplateRouteGuarded.spec.ts`.
  cashflow: ['src/components/reports/CashFlowAnalysisModal.tsx'],
};

const productionFormats = () => listAdapters().filter((a) => a.supportsProduction);

describe('every production format is wired the whole way', () => {
  it('has the nine adapters this programme migrated, and no half-built tenth', () => {
    const types = productionFormats().map((a) => a.reportType).sort();
    expect(types).toEqual([
      'borrowing_capacity', 'cashflow', 'client_details', 'commercial_capacity',
      'comparison', 'investment', 'market_intelligence', 'portfolio', 'qa',
    ]);
  });

  it.each(productionFormats().map((a) => a.reportType))(
    '%s: the adapter can list, route and bind',
    (reportType) => {
      const adapter = getAdapter(reportType)!;
      // A format with no lister is one the preview picker cannot offer a real
      // report for — the state eight of the nine were in.
      expect(typeof adapter.listRecentReports, 'no listRecentReports').toBe('function');
      expect(typeof adapter.resolveRoutingContext).toBe('function');
      expect(typeof adapter.buildBindingContext).toBe('function');
      // The legacy generator is named, because it stays the default until a
      // template is activated and a person is entitled to know what produced
      // their document.
      expect(adapter.legacyFallback?.reason, 'no legacyFallback reason').toBeTruthy();
      expect(adapter.label).toBeTruthy();
    },
  );

  it.each(Object.entries(DELIVERY_PATHS))(
    '%s: its delivery path asks for a templated document',
    (reportType, paths) => {
      expect(getAdapter(reportType)?.supportsProduction, `${reportType} is not production`).toBe(true);
      for (const path of paths) {
        expect(existsSync(join(ROOT, path)), `${path} does not exist`).toBe(true);
        const code = stripComments(read(path));
        // Either the shared question, or the Compass pilot's own entry — the
        // two doors, and nothing generates a templated document without one.
        expect(
          /tryTemplateDocument\(|tryRouteThroughTemplateBuilder\(/.test(code),
          `${path} never asks for a templated document, so activating a template `
          + `for ${reportType} changes nothing a person can see`,
        ).toBe(true);
      }
    },
  );

  it('covers every production format — the map cannot fall behind the registry', () => {
    // Adding an adapter without adding it here would leave the rule above
    // enforcing nothing for the new format.
    expect(Object.keys(DELIVERY_PATHS).sort())
      .toEqual(productionFormats().map((a) => a.reportType).sort());
  });
});

describe("the person's chosen template reaches the document", () => {
  /**
   * The picker lists every format and says "a choice is kept for every report
   * of that format until it is changed here". It was true of one format.
   * `PremiumPdfButton` passed the chosen id; the shared path did not accept
   * one, so on the other eight a selection was stored, shown as selected, and
   * ignored by the generator it was a choice about.
   */
  it('the shared path forwards a chosen template to the router', () => {
    const code = stripComments(read('src/lib/reportTemplate/compassRoute.ts'));
    // The generic entry takes it and passes it on.
    expect(code).toMatch(/tryRouteThroughTemplateBuilderFor[\s\S]*?templateId/);
    expect(code).toMatch(/templateId:\s*opts\?\.templateId/);
  });

  it('the shared question resolves the selection itself, for every surface', () => {
    const code = stripComments(read('src/lib/reportTemplate/templateDocument.ts'));
    // Looked up rather than threaded through eight signatures: the email,
    // attachment and portal paths do not use the picker's hook and would
    // otherwise keep ignoring the choice.
    expect(code).toMatch(/fetchTemplateSelections/);
    // Resolved once, forwarded by name: the id is also compared against the
    // route's answer so a fallback to the ranking can be said out loud. A
    // caller that has already read the choice (the Investment finalisation
    // keys its memo on it) hands it down instead, and the shared question
    // still resolves it for everybody else — one read either way.
    expect(code).toMatch(/const selectedId = [\s\S]{0,160}?await selectedTemplateFor\(reportType\)/);
    expect(code).toMatch(/templateId:\s*selectedId/);
  });

  it('the Compass pilot goes through the shared delivery, which resolves the choice', () => {
    // The pilot used to forward the selection itself because the shared path
    // could not accept one. The shared question resolves it for every surface
    // now (asserted above), so the pilot's job is to USE the shared delivery
    // rather than keep a private copy of the chain — a second copy is how the
    // two drift.
    const code = stripComments(read('src/components/reports/PremiumPdfButton.tsx'));
    expect(code).toMatch(/produceInvestmentDocument\(/);
    expect(code).not.toMatch(/tryRouteThroughTemplateBuilder\(/);
    expect(code).not.toMatch(/render-investment-report-pdf/);
  });
});

/**
 * Where a person can *make* the choice, as opposed to where it is honoured.
 *
 * Choosing a template was possible in two places: the Template Library list and
 * one export panel. Every other format's download control offered no way to see
 * or change it, so the answer to "which template is this going to use?" lived a
 * page away from the button that used it — and a person had to know that page
 * existed at all. The generator honouring the choice (above) and the person
 * being able to make it where they are (here) are two different failures, and
 * the second one is why the first went unnoticed.
 */
const CHOICE_SURFACES: Record<string, string> = {
  investment: 'src/components/reports/report-view/InvestmentReportExportPanel.tsx',
  borrowing_capacity: 'src/components/borrowing-capacity/SnapshotDownloadButton.tsx',
  portfolio: 'src/components/clients/PortfolioReportDownloadButton.tsx',
  comparison: 'src/components/reports/ComparisonDownloadButton.tsx',
  client_details: 'src/components/clients/ClientDetailsDownloadButton.tsx',
  qa: 'src/components/report-qa/ReportQaDownloadButton.tsx',
  commercial_capacity: 'src/components/clients/ClientCommercialIndustrialTab.tsx',
  market_intelligence: 'src/components/marketing/MarketIntelligenceDownloadButton.tsx',
  cashflow: 'src/components/cash-flow/modal/CashFlowExportMenu.tsx',
};

describe('the choice can be made where the document is produced', () => {
  it.each(Object.entries(CHOICE_SURFACES))(
    '%s: its download control offers the template',
    (_reportType, path) => {
      expect(existsSync(join(ROOT, path)), `${path} does not exist`).toBe(true);
      const code = stripComments(read(path));
      // Either presentation counts: the menu section for a dropdown, or the
      // row for a panel that is not a menu.
      expect(
        /useReportTemplateMenu\(|<ReportTemplateSelector/.test(code),
        `${path} offers no way to see or change the template, so the only place `
        + 'to choose one is the Template Library page',
      ).toBe(true);
    },
  );

  it('covers every production format', () => {
    expect(Object.keys(CHOICE_SURFACES).sort())
      .toEqual(productionFormats().map((a) => a.reportType).sort());
  });

  it('renders the picker outside the menu that opens it', () => {
    // Radix unmounts `DropdownMenuContent` on close; a dialog rendered inside
    // it opens and vanishes in the same frame. Every menu-based surface has to
    // place `template.dialog` outside the menu, so the section and the dialog
    // are never both inside it.
    for (const path of Object.values(CHOICE_SURFACES)) {
      const code = stripComments(read(path));
      if (!code.includes('useReportTemplateMenu(')) continue;

      expect(code.includes('{template.dialog}'), `${path} never renders the picker`).toBe(true);

      // Every region between a `<DropdownMenuContent` and its close is inside
      // the menu. A component can have two appearances and therefore two of
      // them, so each is checked rather than the first against the last.
      for (const region of code.matchAll(/<DropdownMenuContent[\s\S]*?<\/DropdownMenuContent>/g)) {
        expect(
          region[0].includes('{template.dialog}'),
          `${path} renders the picker inside the menu that opens it`,
        ).toBe(false);
      }
    }
  });
});

describe('the picker never offers a choice that does nothing', () => {
  it('lists exactly the registry, production formats first', () => {
    const formats = listReportFormats();
    expect(formats.map((f) => f.reportType).sort())
      .toEqual(listAdapters().map((a) => a.reportType).sort());

    const firstPreviewOnly = formats.findIndex((f) => !f.supportsProduction);
    const lastProduction = formats.map((f) => f.supportsProduction).lastIndexOf(true);
    expect(lastProduction, 'a preview-only format sorts above a production one')
      .toBeLessThan(firstPreviewOnly);
  });

  it('says why, for every format a choice cannot change', () => {
    for (const format of listReportFormats().filter((f) => !f.supportsProduction)) {
      // Offering a choice that changes nothing, without saying so, is the same
      // defect as the ignored selection in the other direction.
      expect(format.previewOnlyReason, `${format.reportType} offers a silent no-op`)
        .toBeTruthy();
    }
  });
});

/**
 * A control that carries a dialog must never live inside another menu.
 *
 * Radix unmounts `DropdownMenuContent` when the menu closes. A wired download
 * control embedded in one is doubly broken: its own trigger is a menu that
 * cannot open from inside an open menu, and the template picker's dialog is
 * unmounted with the content the moment the outer menu closes — the picker
 * opens and vanishes in the same frame. `ConversationExport` shipped exactly
 * this for the Q&A format, and the per-file checks above could not see it
 * because they only read each wired component's own file. This scans every
 * component in the app.
 */
describe('no wired control is embedded inside another menu', () => {
  const WIRED_MENU_CONTROLS = [
    'SnapshotDownloadButton',
    'PortfolioReportDownloadButton',
    'ComparisonDownloadButton',
    'ClientDetailsDownloadButton',
    'ReportQaDownloadButton',
    'MarketIntelligenceDownloadButton',
    'CashFlowExportMenu',
    'ConversationExport',
  ];

  const walk = (dir: string): string[] => {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
        out.push(...walk(full));
      } else if (entry.name.endsWith('.tsx')) {
        out.push(full);
      }
    }
    return out;
  };

  it('nowhere in src does a menu contain one', () => {
    const offenders: string[] = [];
    for (const file of walk(join(ROOT, 'src'))) {
      const code = stripComments(readFileSync(file, 'utf8'));
      let from = 0;
      for (;;) {
        const open = code.indexOf('<DropdownMenuContent', from);
        if (open === -1) break;
        const close = code.indexOf('</DropdownMenuContent>', open);
        const region = code.slice(open, close === -1 ? undefined : close);
        for (const name of WIRED_MENU_CONTROLS) {
          if (region.includes(`<${name}`)) {
            offenders.push(`${file.slice(ROOT.length + 1)} embeds <${name}> inside a DropdownMenuContent`);
          }
        }
        from = open + 1;
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });
});
