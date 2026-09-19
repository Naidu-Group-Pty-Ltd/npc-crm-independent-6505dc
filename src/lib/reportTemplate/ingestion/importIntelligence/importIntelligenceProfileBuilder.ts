/**
 * importIntelligenceProfileBuilder — Phase 10B.
 *
 * Assembles a complete ImportIntelligenceProfile from available input by running
 * signal extraction then classification. Deterministic and non-throwing: missing
 * input yields a profile carrying blockers rather than an exception.
 */
import {
  IMPORT_INTELLIGENCE_PROFILE_VERSION,
  type BuildImportIntelligenceProfileOptions,
  type ImportIntelligenceProfile,
  type ImportIntelligenceProfileCategory,
  type ImportIntelligenceRiskLevel,
} from './importIntelligenceTypes';
import { extractImportIntelligenceSignals } from './importIntelligenceSignals';
import { classifyImportIntelligenceProfile } from './importIntelligenceClassifier';

const VALID_CATEGORIES: ImportIntelligenceProfileCategory[] = [
  'simple_document',
  'design_heavy',
  'multi_page_report',
  'table_heavy',
  'image_heavy',
  'scanned_ocr',
  'mixed_complex',
  'high_risk',
  'unknown',
];

const VALID_RISK_LEVELS: ImportIntelligenceRiskLevel[] = [
  'low',
  'medium',
  'high',
  'critical',
  'unknown',
];

function coerceString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function readPath(source: unknown, path: string[]): unknown {
  let cur: any = source;
  for (const key of path) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
    cur = cur[key];
  }
  return cur;
}

/** Merge warning string sets, dropping empties and duplicates, preserving order. */
export function mergeImportIntelligenceWarnings(
  ...warningSets: Array<string[] | null | undefined>
): string[] {
  const out: string[] = [];
  for (const set of warningSets) {
    if (!set) continue;
    for (const w of set) if (w && !out.includes(w)) out.push(w);
  }
  return out;
}

/** Merge blocker string sets, dropping empties and duplicates, preserving order. */
export function mergeImportIntelligenceBlockers(
  ...blockerSets: Array<string[] | null | undefined>
): string[] {
  const out: string[] = [];
  for (const set of blockerSets) {
    if (!set) continue;
    for (const b of set) if (b && !out.includes(b)) out.push(b);
  }
  return out;
}

/** Build a complete, deterministic ImportIntelligenceProfile from available input. */
export function buildImportIntelligenceProfile(
  options: BuildImportIntelligenceProfileOptions,
): ImportIntelligenceProfile {
  const now = options.now ?? (() => new Date());
  const generatedAt = now().toISOString();
  const snap = options.snapshot;
  const record = options.record;

  const importId = coerceString(options.importId)
    ?? coerceString(readPath(snap, ['importId']))
    ?? coerceString(readPath(record, ['id']))
    ?? coerceString(readPath(record, ['import_id']));

  const templateId = coerceString(options.templateId)
    ?? coerceString(readPath(snap, ['templateId']))
    ?? coerceString(readPath(record, ['created_template_id']))
    ?? coerceString(readPath(record, ['template_id']));

  const sourceFilename = coerceString(options.sourceFilename)
    ?? coerceString(readPath(snap, ['sourceFilename']))
    ?? coerceString(readPath(record, ['source_filename']));

  const extracted = extractImportIntelligenceSignals({
    importId,
    templateId,
    sourceFilename,
    record,
    snapshot: snap,
    templateSchema: options.templateSchema,
    artifacts: options.artifacts,
    visualQuality: options.visualQuality,
    repairSummary: options.repairSummary,
    exportParitySummary: options.exportParitySummary,
    goldenRegressionSummary: options.goldenRegressionSummary,
    goldenHistory: options.goldenHistory,
  });

  const classification = classifyImportIntelligenceProfile({
    signals: extracted.signals,
    evidence: extracted.evidence,
  });

  const confidence = classification.scores.confidence ?? 0;

  const profile: ImportIntelligenceProfile = {
    version: IMPORT_INTELLIGENCE_PROFILE_VERSION,
    importId,
    templateId,
    sourceFilename,
    profileCategory: classification.profileCategory,
    riskLevel: classification.riskLevel,
    confidence,
    scores: classification.scores,
    signals: extracted.signals,
    recommendations: classification.recommendations,
    evidence: extracted.evidence,
    warnings: mergeImportIntelligenceWarnings(extracted.warnings, classification.warnings),
    blockers: mergeImportIntelligenceBlockers(extracted.blockers, classification.blockers),
    generatedAt,
  };

  return profile;
}

/** Structural validation of a built profile. Non-throwing. */
export function validateImportIntelligenceProfile(
  profile: ImportIntelligenceProfile,
): { ok: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!profile || typeof profile !== 'object') {
    return { ok: false, errors: ['profile_missing'], warnings: [] };
  }
  if (profile.version !== IMPORT_INTELLIGENCE_PROFILE_VERSION) errors.push('invalid_version');
  if (!VALID_CATEGORIES.includes(profile.profileCategory)) errors.push('invalid_category');
  if (!VALID_RISK_LEVELS.includes(profile.riskLevel)) errors.push('invalid_risk_level');

  if (typeof profile.confidence !== 'number' || profile.confidence < 0 || profile.confidence > 1) {
    errors.push('invalid_confidence');
  }

  if (!profile.scores || typeof profile.scores !== 'object') {
    errors.push('missing_scores');
  } else {
    for (const [key, value] of Object.entries(profile.scores)) {
      if (value === null) continue;
      if (typeof value !== 'number' || value < 0 || value > 1) {
        errors.push(`invalid_score_${key}`);
      }
    }
  }

  if (!profile.signals || typeof profile.signals !== 'object') errors.push('missing_signals');
  if (!profile.recommendations || typeof profile.recommendations !== 'object') {
    errors.push('missing_recommendations');
  }
  if (!Array.isArray(profile.evidence)) warnings.push('missing_evidence');
  if (!Array.isArray(profile.warnings)) errors.push('invalid_warnings');
  if (!Array.isArray(profile.blockers)) errors.push('invalid_blockers');

  return { ok: errors.length === 0, errors, warnings };
}
