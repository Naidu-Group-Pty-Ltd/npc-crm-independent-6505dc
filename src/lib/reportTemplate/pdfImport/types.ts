import type { CdirDocument } from '@/lib/reportTemplate/ingestion/cdir';
import type { CdirFidelityReport } from '@/lib/reportTemplate/ingestion/fidelity';
import type { ImportAsset, RawImportManifest } from '@/lib/reportTemplate/ingestion/reconciliation';

export type FidelityMode = 'semantic' | 'pixel' | 'hybrid' | 'ocr';

export interface ImportProgress {
  phase: 'reading' | 'extracting' | 'rasterizing' | 'ocr' | 'uploading' | 'finalizing' | 'done';
  page?: number;
  totalPages?: number;
  message?: string;
  /** Raw dispatcher stage (`hashing`, `parsing`, `persisting`, `rastering`, `finalizing`, `parsed`, `cache_hit`, …). */
  stage?: string | null;
  /** Pages rasterised so far (hybrid / pixel-perfect only). */
  pagesCompleted?: number | null;
  /** Total pages reported by the parser. */
  pagesTotal?: number | null;
  /** Last transient warning (e.g. Cloud Run cold-start retry). */
  warning?: string | null;
}

export interface ImportOptions {
  mode: FidelityMode;
  rasterDpi?: number;
  templateName?: string;
  onProgress?: (p: ImportProgress) => void;
  userId?: string | null;
  targetTemplateId?: string;
  ocrLang?: string;
  redactPii?: boolean;
  /**
   * Run the inline visual quality gate (source-vs-template diff + deterministic
   * repair) before finalizing. Defaults to on; fail-open, so a QA failure never
   * blocks the import. Skipped automatically for very large documents.
   */
  runQualityGate?: boolean;
  /** Page-count ceiling above which the inline gate is skipped. */
  qualityGateMaxPages?: number;
}

/** Compact, JSON-serialisable verdict from the inline quality gate. */
export interface ImportVisualQualitySummary {
  ran: boolean;
  skippedReason?: string;
  overallScore: number | null;
  finalScore: number | null;
  recommendedFinalMode: FidelityMode | 'pixel-perfect';
  repairPassesApplied: number;
  manualReviewRequired: boolean;
  pagesNeedingReview: number;
  pageCount: number;
}

export interface ImportResult {
  template: { id: string; name: string };
  importId: string;
  pageCount: number;
  cdir?: CdirDocument;
  cdirFidelity?: CdirFidelityReport;
  importAsset?: ImportAsset;
  importManifests?: RawImportManifest[];
  engine?: 'docling';
  fidelityReport: {
    semanticPages: number;
    rasterizedPages: number;
    textBlocks: number;
    images: number;
    vectors: number;
    fontsEmbedded: number;
    fontsSubstituted: string[];
  };
  /** Phase 6D — fidelity mode best suited to the parsed document (from its OCR /
   * confidence signals). Surfaced as a "try this mode" nudge when it differs from
   * the mode the user imported with. */
  recommendedMode?: FidelityMode;
  recommendedModeReason?: string;
  /** Phase 7 — inline visual quality gate verdict (present when the gate ran). */
  visualQuality?: ImportVisualQualitySummary;
}

export type PdfImportEngine = 'docling';
