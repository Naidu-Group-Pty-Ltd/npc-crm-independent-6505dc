/**
 * importIntelligenceDisplay — Phase 10B.
 *
 * UI-safe labels, Badge tones, and formatting for the Import Intelligence
 * Profile. Pure; no network.
 */
import type {
  ImportIntelligenceProfile,
  ImportIntelligenceProfileCategory,
  ImportIntelligenceRiskLevel,
} from './importIntelligenceTypes';

export type ImportIntelligenceDisplayTone =
  | 'default'
  | 'secondary'
  | 'destructive'
  | 'outline';

const CATEGORY_LABELS: Record<string, string> = {
  simple_document: 'Simple document',
  design_heavy: 'Design-heavy',
  multi_page_report: 'Multi-page report',
  table_heavy: 'Table-heavy',
  image_heavy: 'Image-heavy',
  scanned_ocr: 'Scanned/OCR',
  mixed_complex: 'Mixed complex',
  high_risk: 'High risk',
  unknown: 'Unknown',
};

const RISK_LABELS: Record<string, string> = {
  low: 'Low risk',
  medium: 'Medium risk',
  high: 'High risk',
  critical: 'Critical risk',
  unknown: 'Unknown risk',
};

export function getImportIntelligenceCategoryLabel(
  category: ImportIntelligenceProfileCategory | string | null | undefined,
): string {
  if (!category) return 'Unknown';
  return CATEGORY_LABELS[category] ?? 'Unknown';
}

export function getImportIntelligenceRiskLabel(
  risk: ImportIntelligenceRiskLevel | string | null | undefined,
): string {
  if (!risk) return 'Unknown risk';
  return RISK_LABELS[risk] ?? 'Unknown risk';
}

export function getImportIntelligenceRiskTone(
  risk: ImportIntelligenceRiskLevel | string | null | undefined,
): ImportIntelligenceDisplayTone {
  switch (risk) {
    case 'low':
      return 'default';
    case 'medium':
      return 'secondary';
    case 'high':
    case 'critical':
      return 'destructive';
    case 'unknown':
    default:
      return 'outline';
  }
}

export function getImportIntelligenceCategoryTone(
  category: ImportIntelligenceProfileCategory | string | null | undefined,
): ImportIntelligenceDisplayTone {
  switch (category) {
    case 'simple_document':
      return 'default';
    case 'multi_page_report':
    case 'table_heavy':
    case 'image_heavy':
    case 'design_heavy':
      return 'secondary';
    case 'scanned_ocr':
    case 'mixed_complex':
    case 'high_risk':
      return 'destructive';
    case 'unknown':
    default:
      return 'outline';
  }
}

/** Format a 0..1 score as a percentage string, or an em dash when null. */
export function formatImportIntelligenceScore(
  score: number | null | undefined,
): string {
  if (score === null || score === undefined || Number.isNaN(score)) return '—';
  return `${Math.round(score * 100)}%`;
}

/** Human headline like "Simple document · Low risk". */
export function getImportIntelligenceHeadline(
  profile: ImportIntelligenceProfile | null | undefined,
): string {
  if (!profile) return 'No import intelligence profile';
  return `${getImportIntelligenceCategoryLabel(profile.profileCategory)} · ${getImportIntelligenceRiskLabel(profile.riskLevel)}`;
}

/** Compact display bundle for a profile chip/summary. */
export function summarizeImportIntelligenceProfile(
  profile: ImportIntelligenceProfile | null | undefined,
): {
  label: string;
  riskLabel: string;
  tone: ImportIntelligenceDisplayTone;
  confidenceLabel: string;
  recommendationLabel: string;
} {
  if (!profile) {
    return {
      label: 'No import intelligence profile',
      riskLabel: 'Unknown risk',
      tone: 'outline',
      confidenceLabel: '—',
      recommendationLabel: '—',
    };
  }
  return {
    label: getImportIntelligenceCategoryLabel(profile.profileCategory),
    riskLabel: getImportIntelligenceRiskLabel(profile.riskLevel),
    tone: getImportIntelligenceRiskTone(profile.riskLevel),
    confidenceLabel: formatImportIntelligenceScore(profile.confidence),
    recommendationLabel: `Operator: ${profile.recommendations.operatorStrategy}`,
  };
}
