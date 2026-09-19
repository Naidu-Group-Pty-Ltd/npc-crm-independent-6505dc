/**
 * The legacy comparison path is not deprecated — and this time it was also
 * repaired, which is a harder pair of claims to hold at once.
 *
 * Every format before this one asserted only the first half. Here the user asked
 * for the five field-name defects to be fixed, so the file the migration was
 * meant not to touch has been touched. Both halves are asserted structurally on
 * source, because that is the property that matters: a behavioural test of one
 * button says nothing about whether a second generator two thousand lines away
 * still exists.
 *
 *   1. `exportComparisonPDF` and `exportAiAnalysisPDF` are still there, still
 *      drawing with jsPDF, still bound to their buttons, and the producer they
 *      read is still the only one.
 *   2. Each of the five wrong field names is gone and each of the five right
 *      ones is there.
 *   3. The new path is genuinely additional — it imports neither generator,
 *      neither PDF library, and is not metered.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO = resolve(__dirname, '../../../../..');
const read = (path: string) => readFileSync(resolve(REPO, path), 'utf8');

/** Source with its comments removed, for assertions about what the code does. */
const code = (path: string) =>
  read(path).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const MODAL = 'src/components/reports/CashFlowAnalysisModal.tsx';
const PRODUCER = 'supabase/functions/compare-cash-flow-reports/index.ts';
const ROUTE = 'supabase/functions/render-cash-flow-comparison-pdf/index.ts';

describe('the legacy path still exists', () => {
  const source = read(MODAL);

  it('both in-browser generators are still declared', () => {
    expect(source).toContain('const exportComparisonPDF = useCallback');
    expect(source).toContain('const exportAiAnalysisPDF = useCallback');
  });

  it('still draws with jsPDF', () => {
    expect(source).toContain("from 'jspdf'");
    expect(source).toContain("new jsPDF('p', 'mm', 'a4')");
  });

  /**
   * The comparison PDF's only charts are rasterised DOM. A refactor that dropped
   * a ref would silently remove a page from a client's document and nothing else
   * would fail.
   */
  it('still rasterises the on-screen charts into the comparison PDF', () => {
    expect(source).toContain('html2canvas');
    for (const ref of ['cashFlowChartRef', 'yieldChartRef', 'comparisonChartRef']) {
      expect(source, `${ref} is no longer captured`).toContain(ref);
    }
  });

  /** The JSX tag, not the identifier: a leftover import satisfies a substring
   * search over a 6,000-line file and asserts nothing about what is rendered. */
  it('both Export PDF buttons are still mounted', () => {
    expect(source).toContain('onClick={() => exportComparisonPDF()}');
    expect(source).toContain('onClick={() => exportAiAnalysisPDF()}');
  });

  it('the producer is still invoked, and is still the only one', () => {
    expect(source).toContain("invokeSecureFunction('compare-cash-flow-reports'");
    expect(read(PRODUCER)).toContain('cash_flow_comparison');
  });

  /**
   * The save path writes to a table that holds zero rows and structurally
   * cannot hold any. That is a real defect and it is recorded in the contract
   * document — but this migration is not the thing that removes the button.
   */
  it('the save path is untouched', () => {
    expect(source).toContain("from('cash_flow_analyses')");
    expect(source).toContain('const saveAiAnalysis = useCallback');
  });

  /** The already-shipped single-property server render shares this component. */
  it('the 10 Year format\'s server render still works from here', () => {
    expect(source).toContain('exportServerCashFlowPDF');
    expect(source).toContain('requestCashFlowPdf');
  });
});

describe('the five field names the producer actually emits', () => {
  const source = code(MODAL);

  /**
   * Measured against the JSON schema at `compare-cash-flow-reports/index.ts`.
   * Each of these printed something wrong on a client's page: "#1 - undefined",
   * "Score: undefined/100", a Balanced recommendation that never rendered, "N/A"
   * for all four investor profiles, and an object handed to `splitTextToSize`.
   */
  it.each([
    ['ranking.propertyAddress ?? ', 'ranking.address ??'],
    ['ranking.overallScore ??', 'ranking.score ??'],
  ])('reads the schema key first (%s → %s)', (_wrong, right) => {
    expect(source).toContain(right);
  });

  it('no longer reads propertyAddress or overallScore first', () => {
    expect(source).not.toMatch(/\$\{ranking\.propertyAddress\s*\}/);
    expect(source).not.toMatch(/ranking\.propertyAddress\s*\|\|\s*ranking\.address/);
    expect(source).not.toMatch(/ranking\.overallScore\s*\|\|\s*ranking\.score/);
  });

  /** The schema states no scale, so printing one asserts something the record
   * does not support. Fixing the key while keeping `/100` would turn "undefined"
   * into a confidently wrong number. */
  it('prints no denominator beside a score', () => {
    expect(source).not.toContain('/100');
  });

  it('asks for the balanced profile by the name the schema uses', () => {
    expect(source).toContain("['balanced', 'balancedApproach']");
    expect(source).not.toMatch(/key:\s*'balancedApproach'/);
  });

  /**
   * `recommendation` is not in the schema — the block is
   * `{propertyNumber, reason}` — so every profile printed "N/A". The property
   * number is *not* substituted in its place: it indexes an ordering that
   * existed only inside one edge-function call.
   */
  it('prints the reason and not a phantom recommendation field', () => {
    expect(source).not.toContain('recData.recommendation');
    expect(source).toContain('recData.reason');
  });

  it('reads the recommendation object rather than passing it to the typesetter', () => {
    expect(source).toContain('aiAnalysis.overallRecommendation?.bestProperty?.reason');
    expect(source).not.toMatch(/addWrappedText\(\s*aiAnalysis\.overallRecommendation\s*,/);
  });
});

describe('the new path is additional, not a replacement', () => {
  /**
   * Comments stripped: each of these files explains in prose why it does not
   * reach for the legacy, and a whole-file search would be satisfied by the
   * explanation rather than by the absence.
   */
  const NEW_MODULES = [
    'src/lib/reports/cashFlowComparison/toWireComparison.ts',
    'src/lib/reports/cashFlowComparison/requestCashFlowComparisonPdf.ts',
    'src/lib/reports/cashFlowComparison/deliverCashFlowComparisonPdf.ts',
    'src/components/cash-flow/modal/CashFlowComparisonDownloadButton.tsx',
  ];

  it.each(NEW_MODULES)('%s draws no PDFs of its own', (path) => {
    const source = code(path);
    expect(source).not.toContain('jspdf');
    expect(source).not.toContain('html2canvas');
    expect(source).not.toContain('exportComparisonPDF');
    expect(source).not.toContain('exportAiAnalysisPDF');
  });

  /**
   * A fallback that quietly called the producer would reintroduce the cost and
   * the non-determinism the typeset path exists to remove.
   */
  it('never invokes the producer', () => {
    expect(code('src/lib/reports/cashFlowComparison/requestCashFlowComparisonPdf.ts'))
      .not.toContain('compare-cash-flow-reports');
    expect(code(ROUTE)).not.toContain('compare-cash-flow-reports');
  });

  it('fails with a message naming the buttons that work, rather than falling back', () => {
    const request = read('src/lib/reports/cashFlowComparison/requestCashFlowComparisonPdf.ts');
    expect(request).toContain('looksUndeployed');
    expect(request).toContain('Export PDF buttons on this screen still work');
    expect(request).not.toMatch(/legacyFallback/);
  });

  /** Typesetting figures the browser already computed asks nothing of any model. */
  it('is not metered', () => {
    expect(code(ROUTE)).not.toContain('withReportMetering');
  });

  /** The route reads reports and writes only its own ledger. */
  it('never writes to cash_flow_analyses or to investment_reports', () => {
    const source = code(ROUTE);
    expect(source).not.toContain('cash_flow_analyses');
    expect(source).not.toMatch(/from\('investment_reports'\)[\s\S]{0,160}\.(update|insert|upsert|delete)\(/);
  });
});

describe('the control sits beside the two that already exist', () => {
  const source = read(MODAL);

  it('is mounted at both comparison surfaces', () => {
    expect(source.match(/<CashFlowComparisonDownloadButton/g) ?? []).toHaveLength(2);
  });

  /**
   * Not gated on the analysis. `exportAiAnalysisPDF` returns without drawing
   * anything when there is none, which is why an adviser who has not pressed
   * "Generate AI Analysis" currently cannot hand over the comparison at all.
   */
  it('is available without a written analysis', () => {
    // Comments stripped: the control explains in prose *why* it is not gated on
    // the analysis, and a whole-file search would be satisfied by that sentence.
    expect(code('src/components/cash-flow/modal/CashFlowComparisonDownloadButton.tsx'))
      .not.toMatch(/aiAnalysis/);
    expect(source).toContain('comparisonUnavailableReason');
    expect(source).toContain('comparisonReports.length === 0');
  });

  /** Disabled with a reason rather than hidden: a missing control reads as a
   * feature that does not exist. */
  it('says why it is unavailable rather than disappearing', () => {
    const control = read('src/components/cash-flow/modal/CashFlowComparisonDownloadButton.tsx');
    expect(control).toContain('unavailableReason');
    expect(control).toContain('TooltipContent');
  });
});

describe('one implementation reads a report\'s position', () => {
  /**
   * The extraction that makes a comparison comparable. Before it, the modal read
   * the primary's financials one way and the peers' another — `compBaseData` has
   * no `lmiAmount` key at all, and that figure is inside the denominator of
   * return on capital, cash-on-cash and the equity multiple.
   */
  it('the modal calls the shared reader rather than inlining the cascade', () => {
    const source = read(MODAL);
    expect(source).toContain('readBaseFinancials(report, new Date().getFullYear())');
    // And the version it replaced is gone, not merely unused.
    expect(source).not.toContain('const baseFinancialData = useMemo(() => {');
  });

  /**
   * The peer *projection* engine reads through the shared reader too.
   *
   * This assertion used to compare the peer engine's INLINE `purchasePrice`
   * and `marketValueNow` expressions against `readBaseFinancials`, character
   * for character, and its own note said extracting that cascade was "well
   * beyond a report migration". The cash-flow audit did the extraction: the
   * peer engine now calls `readBaseFinancials(compReport, ...)` and builds its
   * years with the same `buildProjection` the subject uses, so there are no
   * two expressions left to drift apart.
   *
   * So the guard is the stronger one the old one was approximating — one
   * reader and one engine, with nothing resolved beside them.
   */
  it('the peer projection engine reads and projects through the shared modules', () => {
    const modal = read(MODAL);

    const peerBlock = modal.slice(
      modal.indexOf('const allComparisonProjections = useMemo'),
      modal.indexOf('}, [comparisonReports]);'),
    );
    expect(peerBlock).toBeTruthy();

    // One reader, and one engine, for the peers as well as the subject.
    expect(peerBlock).toContain('readBaseFinancials(compReport, new Date().getFullYear())');
    expect(peerBlock).toContain('buildProjection(');
    expect(peerBlock).toContain('fixedExpenseBase(compBase)');

    // A peer's loan amortises. It used to be held flat for ten years under a
    // comment reading "no amortization engine", so every peer was ranked on
    // debt that never reduced while the subject's did.
    expect(peerBlock).toContain('buildLoanSchedule(compBase');
    // Comments are stripped: this rule is about what the file DOES, and the
    // block above it names the removed behaviour in order to explain it.
    const code = modal.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    expect(code).not.toContain('no amortization engine');

    // And the inline cascade this test used to police is gone, not unused.
    for (const inlined of ['mo.purchasePrice ??', 'mo.weeklyRent ??', 'mo.capitalGrowth ??']) {
      expect(peerBlock, `the peer engine still inlines ${inlined}`).not.toContain(inlined);
    }
  });

  it('the comparison wire uses it for every property', () => {
    expect(code('src/lib/reports/cashFlowComparison/toWireComparison.ts'))
      .toContain('readBaseFinancials(entry.report, currentYear)');
  });

  /** Deriving on the server is the point; sending metrics would undo it. */
  it('sends no metrics', () => {
    const source = code('src/lib/reports/cashFlowComparison/toWireComparison.ts');
    for (const metric of ['roi', 'equityMultiple', 'cashOnCash', 'breakEvenYear', 'totalReturn']) {
      expect(source, `the wire carries ${metric}`).not.toContain(metric);
    }
  });
});
