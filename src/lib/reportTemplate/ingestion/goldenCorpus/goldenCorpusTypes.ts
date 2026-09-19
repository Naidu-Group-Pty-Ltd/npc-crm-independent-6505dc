/**
 * goldenCorpusTypes — the Phase 8A Golden Corpus Registry data model.
 *
 * The Golden Corpus Registry defines the fixed set of canonical PDF categories
 * used to repeatedly regression-test the PDF import quality pipeline (Docling
 * parse → Visual QA → repair → AI reconciliation → export parity). Phase 8A only
 * *defines* the corpus; later phases (8B runner, 8C gates, 8D persistence) consume
 * it. Nothing here uploads, commits, or runs any PDF.
 */

export type GoldenCorpusCategory =
  | 'simple_one_page'
  | 'design_heavy_one_page'
  | 'multi_page_report'
  | 'table_heavy'
  | 'image_heavy'
  | 'scanned_ocr';

export type GoldenCorpusPageCountMode =
  | 'exact'
  | 'minimum'
  | 'range'
  | 'unknown';

export interface GoldenCorpusPageCountExpectation {
  mode: GoldenCorpusPageCountMode;
  exact: number | null;
  minimum: number | null;
  maximum: number | null;
}

export interface GoldenCorpusExpectedOutcomes {
  importShouldSucceed: boolean;
  templateShouldBeCreated: boolean;
  visualQaShouldRun: boolean;
  repairShouldRunOrSkipSafely: boolean;
  applyRepairShouldOpenEditor: boolean;
  exportParityShouldBeRecordable: boolean;
  templatePageCountShouldMatch: boolean;
  manualReviewAllowed: boolean;
  fallbackAllowed: boolean;
}

export interface GoldenCorpusScoreThresholds {
  visualQaMinimum: number;
  repairFinalMinimum: number;
  exportParityMinimum: number;
}

export interface GoldenCorpusItem {
  corpusId: string;
  category: GoldenCorpusCategory;
  title: string;
  purpose: string;
  pageCountExpectation: GoldenCorpusPageCountExpectation;
  expectedOutcomes: GoldenCorpusExpectedOutcomes;
  scoreThresholds: GoldenCorpusScoreThresholds;
  acceptableWarnings: string[];
  unacceptableFailures: string[];
  requiredMetadata: string[];
  notes: string[];
}

export interface GoldenCorpusRegistry {
  version: 'pdf-import-golden-corpus-registry-v1';
  registryName: string;
  description: string;
  updatedAt: string;
  corpus: GoldenCorpusItem[];
}

export interface GoldenCorpusValidationIssue {
  corpusId?: string;
  severity: 'warning' | 'error';
  code: string;
  message: string;
}

export interface GoldenCorpusValidationResult {
  ok: boolean;
  issues: GoldenCorpusValidationIssue[];
}

export const GOLDEN_CORPUS_REGISTRY_VERSION = 'pdf-import-golden-corpus-registry-v1';

export const GOLDEN_CORPUS_REQUIRED_IDS = [
  'golden-simple-001',
  'golden-design-001',
  'golden-report-001',
  'golden-table-001',
  'golden-image-001',
  'golden-ocr-001',
] as const;

export type GoldenCorpusRequiredId = typeof GOLDEN_CORPUS_REQUIRED_IDS[number];

export const GOLDEN_CORPUS_CATEGORIES: readonly GoldenCorpusCategory[] = [
  'simple_one_page',
  'design_heavy_one_page',
  'multi_page_report',
  'table_heavy',
  'image_heavy',
  'scanned_ocr',
];

export const GOLDEN_CORPUS_PAGE_COUNT_MODES: readonly GoldenCorpusPageCountMode[] = [
  'exact',
  'minimum',
  'range',
  'unknown',
];

/**
 * Metadata keys that every persisted golden run (Phase 8D) must carry. Each
 * corpus item's `requiredMetadata` must be a superset of the mandatory subset
 * enforced by `validateGoldenCorpusRegistry`.
 */
export const GOLDEN_CORPUS_MANDATORY_METADATA_KEYS = [
  'corpusId',
  'importId',
  'templateId',
  'visualQaScore',
  'repairStatus',
  'exportParityStatus',
] as const;
