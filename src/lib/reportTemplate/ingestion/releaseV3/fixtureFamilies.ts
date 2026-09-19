/**
 * PDF Extraction V3 · E12 — generated fixture family catalog.
 *
 * The 20 required deterministic fixture families as `GeneratedFixtureSpecV1` +
 * an INDEPENDENT expected-truth draft. Identity derives from (fixtureId,
 * sourceBuilderVersion, seed) — no time, no random UUID, no network. Every
 * critical Unicode / numeric token asserted downstream is declared here, not
 * read back from extraction.
 */
import {
  GENERATED_FIXTURE_SPEC_VERSION,
  SOURCE_BUILDER_VERSION,
  type GeneratedFixtureSpecV1,
  type GoldenFixtureFamily,
  type PerformanceClass,
  type ReleaseGateTier,
} from './contracts';
import { defaultOutputConstraints, region, type ExpectedTruthDraft } from './expectedTruth';

export interface FixtureDefinition {
  spec: GeneratedFixtureSpecV1;
  truth: ExpectedTruthDraft;
}

function spec(
  fixtureId: string,
  family: GoldenFixtureFamily,
  title: string,
  seed: number,
  pageCount: number,
  performanceClass: PerformanceClass,
  requiredReleaseTiers: ReleaseGateTier[],
  extra: Partial<GeneratedFixtureSpecV1> = {},
): GeneratedFixtureSpecV1 {
  return {
    version: GENERATED_FIXTURE_SPEC_VERSION,
    fixtureId,
    family,
    title,
    sourceBuilderVersion: SOURCE_BUILDER_VERSION,
    seed,
    pageCount,
    expectedTruthRef: `${fixtureId}.truth`,
    requiredContracts: extra.requiredContracts ?? ['pdf-extraction-plan-v3', 'visual-quality-report-v2', 'pdf-region-render-plan-v1'],
    requiredCapabilities: extra.requiredCapabilities ?? ['nativeText'],
    expectedPageClasses: extra.expectedPageClasses ?? [],
    expectedOutputStrategies: extra.expectedOutputStrategies ?? [],
    requiredReleaseTiers,
    performanceClass,
    problems: [],
  };
}

const FAST: ReleaseGateTier[] = ['generated-fast', 'generated-full'];
const FULL: ReleaseGateTier[] = ['generated-full'];

// A helper page of native prose truth.
function prosePage(n: number): ExpectedTruthDraft['pages'][number] {
  return {
    pageNumber: n, widthPt: 595, heightPt: 842, rotation: 0,
    regions: [region(`p${n}-title`, 'text', { x: 40, y: 40, width: 400, height: 30 }, { expectsNativeSafe: true }),
      region(`p${n}-body`, 'text', { x: 40, y: 90, width: 515, height: 600 }, { expectsNativeSafe: true })],
    chartCount: 0, pictureCount: 0, tableCount: 0, tableCells: 0, numericAssociations: 0,
    expectsRasterOnly: false, acceptableFallbackStrategies: ['native'],
  };
}

export const FIXTURE_FAMILIES: FixtureDefinition[] = [
  {
    spec: spec('gen-native-prose', 'native-prose', 'Native prose', 101, 1, 'tiny', FAST,
      { expectedPageClasses: ['native_simple'], expectedOutputStrategies: ['native'] }),
    truth: { documentClass: 'native-prose', planProperties: { documentComplexity: 'low' }, outputConstraints: defaultOutputConstraints(), pages: [prosePage(1)] },
  },
  {
    spec: spec('gen-multi-page-native', 'multi-page-native', 'Multi-page native report', 102, 3, 'small', FULL,
      { expectedPageClasses: ['native_simple', 'native_simple', 'native_simple'], expectedOutputStrategies: ['native'] }),
    truth: { documentClass: 'native-report', planProperties: { documentComplexity: 'low' }, outputConstraints: defaultOutputConstraints(), pages: [prosePage(1), prosePage(2), prosePage(3)] },
  },
  {
    spec: spec('gen-adjacent-tables', 'adjacent-complex-tables', 'Adjacent complex tables', 103, 1, 'small', FAST,
      { requiredCapabilities: ['nativeText', 'tables'], expectedPageClasses: ['native_rich'], expectedOutputStrategies: ['native', 'mixed'] }),
    truth: {
      documentClass: 'financial-tables', planProperties: { documentComplexity: 'high', tableLikelihood: 'high' },
      outputConstraints: defaultOutputConstraints({ minOutputScore: 0.95 }),
      pages: [{
        pageNumber: 1, widthPt: 595, heightPt: 842, rotation: 0,
        regions: [
          region('p1-table-a', 'table', { x: 40, y: 80, width: 250, height: 300 }, { criticalNumericTokens: ['$910,000', '$920,000'], expectsNativeSafe: true }),
          region('p1-table-b', 'table', { x: 305, y: 80, width: 250, height: 300 }, { criticalNumericTokens: ['4.67%', '712'], expectsNativeSafe: true }),
        ],
        chartCount: 0, pictureCount: 0, tableCount: 2, tableCells: 40, numericAssociations: 12,
        expectsRasterOnly: false, acceptableFallbackStrategies: ['native', 'source-crop'],
      }],
    },
  },
  {
    spec: spec('gen-multi-row-header-table', 'multi-row-header-table', 'Multi-row header table', 104, 1, 'small', FULL,
      { requiredCapabilities: ['nativeText', 'tables'] }),
    truth: {
      documentClass: 'financial-tables', planProperties: { documentComplexity: 'high' },
      outputConstraints: defaultOutputConstraints({ minOutputScore: 0.95 }),
      pages: [{
        pageNumber: 1, widthPt: 595, heightPt: 842, rotation: 0,
        regions: [region('p1-table', 'table', { x: 40, y: 80, width: 500, height: 400 }, { criticalNumericTokens: ['$25,000'], expectsNativeSafe: true })],
        chartCount: 0, pictureCount: 0, tableCount: 1, tableCells: 60, numericAssociations: 30,
        expectsRasterOnly: false, acceptableFallbackStrategies: ['native', 'source-crop'],
      }],
    },
  },
  {
    spec: spec('gen-chart-heavy', 'chart-heavy', 'Chart-heavy report', 105, 1, 'medium', FAST,
      { requiredCapabilities: ['nativeText'], requiredContracts: ['chart-preservation-v1', 'visual-quality-report-v2'], expectedOutputStrategies: ['mixed'] }),
    truth: {
      documentClass: 'chart-heavy', planProperties: { documentComplexity: 'high', imageHeavy: true },
      outputConstraints: defaultOutputConstraints({ minOutputScore: 0.95 }),
      pages: [{
        pageNumber: 1, widthPt: 595, heightPt: 842, rotation: 0,
        regions: [
          region('p1-chart-line', 'chart', { x: 40, y: 80, width: 500, height: 250 }, { expectsSourceCrop: true }),
          region('p1-chart-bar', 'chart', { x: 40, y: 360, width: 500, height: 250 }, { expectsSourceCrop: true }),
        ],
        chartCount: 2, pictureCount: 0, tableCount: 0, tableCells: 0, numericAssociations: 0,
        expectsRasterOnly: false, acceptableFallbackStrategies: ['mixed', 'source-crop'],
      }],
    },
  },
  {
    spec: spec('gen-mixed', 'mixed-chart-table-text', 'Mixed chart/table/text', 106, 1, 'medium', FAST),
    truth: {
      documentClass: 'mixed', planProperties: { documentComplexity: 'high' },
      outputConstraints: defaultOutputConstraints({ minOutputScore: 0.95 }),
      pages: [{
        pageNumber: 1, widthPt: 595, heightPt: 842, rotation: 0,
        regions: [
          region('p1-prose', 'text', { x: 40, y: 40, width: 515, height: 60 }, { expectsNativeSafe: true }),
          region('p1-chart', 'chart', { x: 40, y: 120, width: 250, height: 220 }, { expectsSourceCrop: true }),
          region('p1-table', 'table', { x: 305, y: 120, width: 250, height: 220 }, { criticalNumericTokens: ['$100,000'], expectsNativeSafe: true }),
        ],
        chartCount: 1, pictureCount: 0, tableCount: 1, tableCells: 12, numericAssociations: 6,
        expectsRasterOnly: false, acceptableFallbackStrategies: ['mixed', 'source-crop'],
      }],
    },
  },
  {
    spec: spec('gen-branded-brochure', 'branded-brochure', 'Branded brochure', 107, 1, 'medium', FULL,
      { requiredContracts: ['chart-preservation-v1'], expectedOutputStrategies: ['mixed', 'raster-only'] }),
    truth: {
      documentClass: 'design-heavy', planProperties: { documentComplexity: 'high', designHeavy: true },
      outputConstraints: defaultOutputConstraints({ minOutputScore: 0.92 }),
      pages: [{
        pageNumber: 1, widthPt: 595, heightPt: 842, rotation: 0,
        regions: [region('p1-logo', 'logo', { x: 40, y: 40, width: 160, height: 60 }, { expectsSourceCrop: true })],
        chartCount: 0, pictureCount: 1, tableCount: 0, tableCells: 0, numericAssociations: 0,
        expectsRasterOnly: false, acceptableFallbackStrategies: ['mixed', 'source-crop', 'page-fallback'],
      }],
    },
  },
  {
    spec: spec('gen-unavailable-font', 'unavailable-font', 'Unavailable font', 108, 1, 'small', FULL,
      { requiredContracts: ['typography-fidelity-report-v1', 'font-resolution-policy-v2'] }),
    truth: {
      documentClass: 'typography', planProperties: { documentComplexity: 'medium' },
      outputConstraints: defaultOutputConstraints(),
      pages: [{
        pageNumber: 1, widthPt: 595, heightPt: 842, rotation: 0,
        regions: [region('p1-heading', 'text', { x: 40, y: 40, width: 500, height: 40 }, { expectsSourceCrop: true })],
        chartCount: 0, pictureCount: 0, tableCount: 0, tableCells: 0, numericAssociations: 0,
        expectsRasterOnly: false, acceptableFallbackStrategies: ['source-crop', 'native-with-source-reference'],
      }],
    },
  },
  {
    spec: spec('gen-typography-ranges', 'typography-ranges', 'Typography and ranges', 109, 1, 'small', FAST,
      { requiredContracts: ['typography-fidelity-report-v1'] }),
    truth: {
      documentClass: 'typography', planProperties: { documentComplexity: 'medium' },
      outputConstraints: defaultOutputConstraints({ minOutputScore: 0.95 }),
      pages: [{
        pageNumber: 1, widthPt: 595, heightPt: 842, rotation: 0,
        regions: [region('p1-ranges', 'text', { x: 40, y: 40, width: 515, height: 200 }, {
          expectsNativeSafe: true,
          criticalUnicode: ['–', '—', '−', '×', '£', '%', '²', ' ', ' ', '…', '“', '”'],
          criticalNumericTokens: ['10–15 years', '$910,000–$920,000', '−$25,000', '8×8', '4.67%', '712m²'],
        })],
        chartCount: 0, pictureCount: 0, tableCount: 0, tableCells: 0, numericAssociations: 6,
        expectsRasterOnly: false, acceptableFallbackStrategies: ['native', 'source-crop'],
      }],
    },
  },
  {
    spec: spec('gen-image-only-scan', 'image-only-scan', 'Image-only scan', 110, 1, 'small', FULL,
      { requiredCapabilities: ['ocr', 'raster'], expectedPageClasses: ['scanned'], expectedOutputStrategies: ['raster-only', 'mixed'] }),
    truth: {
      documentClass: 'scanned', planProperties: { documentComplexity: 'medium', ocrHint: true },
      outputConstraints: defaultOutputConstraints({ minOutputScore: 0.92 }),
      pages: [{
        pageNumber: 1, widthPt: 595, heightPt: 842, rotation: 0,
        regions: [region('p1-scan', 'picture', { x: 0, y: 0, width: 595, height: 842 }, { expectsSourceCrop: true })],
        chartCount: 0, pictureCount: 1, tableCount: 0, tableCells: 0, numericAssociations: 0,
        expectsRasterOnly: true, acceptableFallbackStrategies: ['raster-only', 'source-crop'],
      }],
    },
  },
  {
    spec: spec('gen-rotated-page', 'rotated-page', 'Rotated page', 111, 1, 'small', FULL),
    truth: {
      documentClass: 'native-report', planProperties: { documentComplexity: 'low' },
      outputConstraints: defaultOutputConstraints(),
      pages: [{
        pageNumber: 1, widthPt: 842, heightPt: 595, rotation: 90,
        regions: [region('p1-body', 'text', { x: 40, y: 40, width: 700, height: 400 }, { expectsNativeSafe: true })],
        chartCount: 0, pictureCount: 0, tableCount: 0, tableCells: 0, numericAssociations: 0,
        expectsRasterOnly: false, acceptableFallbackStrategies: ['native'],
      }],
    },
  },
  {
    spec: spec('gen-rtl-complex-script', 'rtl-complex-script', 'RTL / complex script', 112, 1, 'small', FULL),
    truth: {
      documentClass: 'complex-script', planProperties: { documentComplexity: 'medium' },
      outputConstraints: defaultOutputConstraints({ minOutputScore: 0.92 }),
      pages: [{
        pageNumber: 1, widthPt: 595, heightPt: 842, rotation: 0,
        regions: [region('p1-rtl', 'text', { x: 40, y: 40, width: 515, height: 200 }, { expectsSourceCrop: true })],
        chartCount: 0, pictureCount: 0, tableCount: 0, tableCells: 0, numericAssociations: 0,
        expectsRasterOnly: false, acceptableFallbackStrategies: ['source-crop', 'native'],
      }],
    },
  },
  {
    spec: spec('gen-formula-and-code', 'formula-and-code', 'Formula and code', 113, 1, 'small', FULL),
    truth: {
      documentClass: 'technical', planProperties: { documentComplexity: 'medium' },
      outputConstraints: defaultOutputConstraints(),
      pages: [{
        pageNumber: 1, widthPt: 595, heightPt: 842, rotation: 0,
        regions: [region('p1-formula', 'text', { x: 40, y: 40, width: 515, height: 300 }, { expectsNativeSafe: true, criticalUnicode: ['∑', '√', '≤'] })],
        chartCount: 0, pictureCount: 0, tableCount: 0, tableCells: 0, numericAssociations: 0,
        expectsRasterOnly: false, acceptableFallbackStrategies: ['native', 'source-crop'],
      }],
    },
  },
  {
    spec: spec('gen-blank-near-blank', 'blank-near-blank', 'Blank and near-blank pages', 114, 2, 'small', FULL),
    truth: {
      documentClass: 'sparse', planProperties: { documentComplexity: 'low' },
      outputConstraints: defaultOutputConstraints({ minOutputScore: 0.92 }),
      pages: [
        { pageNumber: 1, widthPt: 595, heightPt: 842, rotation: 0, regions: [], chartCount: 0, pictureCount: 0, tableCount: 0, tableCells: 0, numericAssociations: 0, expectsRasterOnly: false, acceptableFallbackStrategies: ['native', 'raster-only'] },
        { pageNumber: 2, widthPt: 595, heightPt: 842, rotation: 0, regions: [region('p2-faint', 'text', { x: 40, y: 400, width: 200, height: 20 }, { expectsNativeSafe: true })], chartCount: 0, pictureCount: 0, tableCount: 0, tableCells: 0, numericAssociations: 0, expectsRasterOnly: false, acceptableFallbackStrategies: ['native', 'source-crop'] },
      ],
    },
  },
  {
    spec: spec('gen-25-page', 'twenty-five-page', '25-page mixed document', 125, 25, 'large', FULL,
      { expectedOutputStrategies: ['native', 'mixed', 'raster-only'] }),
    truth: {
      documentClass: 'mixed', planProperties: { documentComplexity: 'high', chunked: true },
      outputConstraints: defaultOutputConstraints({ minOutputScore: 0.92 }),
      pages: Array.from({ length: 25 }, (_, i) => prosePage(i + 1)),
    },
  },
  {
    spec: spec('gen-80-page', 'eighty-page', '80-page mixed document', 180, 80, 'large', FULL,
      { expectedOutputStrategies: ['native', 'mixed', 'raster-only'] }),
    truth: {
      documentClass: 'mixed', planProperties: { documentComplexity: 'high', chunked: true },
      outputConstraints: defaultOutputConstraints({ minOutputScore: 0.9 }),
      pages: Array.from({ length: 80 }, (_, i) => prosePage(i + 1)),
    },
  },
  {
    // The pre-upgrade 57/100 failure class: a deceptively-noncatastrophic global
    // score hiding a missing chart, merged tables, generic headers, clipped rows,
    // fused ranges and a missing late financial row.
    spec: spec('gen-pre-upgrade-57', 'pre-upgrade-failure-class', 'Pre-upgrade 57/100 failure class', 157, 1, 'medium', FAST,
      { requiredContracts: ['critical-quality-defects-v1', 'chart-preservation-v1', 'table-integrity-report-v1'], expectedOutputStrategies: ['mixed', 'raster-only'] }),
    truth: {
      documentClass: 'failure-class', planProperties: { documentComplexity: 'high' },
      outputConstraints: defaultOutputConstraints({ minOutputScore: 0.92, maxHardDefects: 0 }),
      pages: [{
        pageNumber: 1, widthPt: 595, heightPt: 842, rotation: 0,
        regions: [
          region('p1-chart', 'chart', { x: 40, y: 60, width: 500, height: 220 }, { expectsSourceCrop: true }),
          region('p1-table-a', 'table', { x: 40, y: 300, width: 250, height: 260 }, { criticalNumericTokens: ['$910,000–$920,000'], expectsNativeSafe: true }),
          region('p1-table-b', 'table', { x: 305, y: 300, width: 250, height: 260 }, { criticalNumericTokens: ['Year 10', '$1,250,000'], expectsNativeSafe: true }),
        ],
        chartCount: 1, pictureCount: 0, tableCount: 2, tableCells: 48, numericAssociations: 20,
        expectsRasterOnly: false,
        // Native acceptance is NEVER acceptable; only exact crop / raster fallback.
        acceptableFallbackStrategies: ['source-crop', 'mixed', 'raster-only'],
      }],
    },
  },
  {
    spec: spec('gen-safe-raster-only', 'safe-raster-only', 'Safe raster-only document', 118, 1, 'small', FULL,
      { expectedPageClasses: ['unreadable'], expectedOutputStrategies: ['raster-only'] }),
    truth: {
      documentClass: 'raster', planProperties: { documentComplexity: 'low' },
      outputConstraints: defaultOutputConstraints({ minOutputScore: 0.92 }),
      pages: [{
        pageNumber: 1, widthPt: 595, heightPt: 842, rotation: 0,
        regions: [], chartCount: 0, pictureCount: 1, tableCount: 0, tableCells: 0, numericAssociations: 0,
        expectsRasterOnly: true, acceptableFallbackStrategies: ['raster-only'],
      }],
    },
  },
  {
    spec: spec('gen-provider-conflict', 'provider-conflict', 'Provider-conflict document', 119, 1, 'small', FULL,
      { requiredContracts: ['provider-arbitration-v1', 'provider-attempt-audit-v1'] }),
    truth: {
      documentClass: 'provider-conflict', planProperties: { documentComplexity: 'medium' },
      outputConstraints: defaultOutputConstraints(),
      pages: [{
        pageNumber: 1, widthPt: 595, heightPt: 842, rotation: 0,
        regions: [region('p1-table', 'table', { x: 40, y: 80, width: 500, height: 300 }, { criticalNumericTokens: ['$42,000'], expectsNativeSafe: true })],
        chartCount: 0, pictureCount: 0, tableCount: 1, tableCells: 20, numericAssociations: 10,
        expectsRasterOnly: false, acceptableFallbackStrategies: ['native', 'source-crop'],
      }],
    },
  },
  {
    spec: spec('gen-cache-replay', 'cache-replay', 'Cache-replay document', 120, 1, 'small', FULL,
      { requiredContracts: ['pdf-cache-fingerprint-v3', 'pdf-cache-entry-v3', 'pdf-artifact-completeness-v1'] }),
    truth: {
      documentClass: 'native-report', planProperties: { documentComplexity: 'low' },
      outputConstraints: defaultOutputConstraints(),
      pages: [prosePage(1)],
    },
  },
];

export function fixtureById(fixtureId: string): FixtureDefinition | null {
  return FIXTURE_FAMILIES.find((f) => f.spec.fixtureId === fixtureId) ?? null;
}
