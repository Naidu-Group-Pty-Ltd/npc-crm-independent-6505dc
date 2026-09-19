/**
 * pdfImportCostModel — Phase 10F.
 *
 * Rough, deterministic cost model for the major PDF import steps. Costs are
 * advisory estimates used to flag expensive/confirmation-worthy operations. This
 * module never executes or skips any step; it only classifies expected cost.
 */
import type {
  PdfImportCostLevel,
  PdfImportPerformanceDomain,
  PdfImportPerformanceSignals,
  PdfImportStepCost,
} from './pdfImportPerformanceTypes';

const COST_LEVEL_SCORES: Record<PdfImportCostLevel, number> = {
  negligible: 0.05,
  low: 0.2,
  medium: 0.45,
  high: 0.7,
  very_high: 0.95,
  unknown: 0.5,
};

export function getPdfImportCostLevelScore(costLevel: PdfImportCostLevel): number {
  return COST_LEVEL_SCORES[costLevel] ?? COST_LEVEL_SCORES.unknown;
}

export function resolvePdfImportCostLevelFromScore(score: number | null): PdfImportCostLevel {
  if (score === null || !Number.isFinite(score)) return 'unknown';
  if (score < 0.125) return 'negligible';
  if (score < 0.325) return 'low';
  if (score < 0.575) return 'medium';
  if (score < 0.825) return 'high';
  return 'very_high';
}

function isHighRisk(signals: PdfImportPerformanceSignals): boolean {
  return signals.importRiskLevel === 'high' || signals.importRiskLevel === 'critical';
}

function automationBlocked(signals: PdfImportPerformanceSignals): boolean {
  return signals.adaptiveAiBlocked === true
    || signals.repairPatternSeverity === 'critical';
}

export function shouldRequireConfirmationForStep(
  stepId: string,
  signals: PdfImportPerformanceSignals,
): boolean {
  const pages = signals.pageCount ?? 0;
  switch (stepId) {
    case 'run_ai_reconciliation':
      return true;
    case 'run_export_parity':
      return pages > 10 || automationBlocked(signals);
    case 'run_visual_qa':
      return pages > 10 || automationBlocked(signals);
    case 'run_repair':
      return isHighRisk(signals) || automationBlocked(signals);
    case 'run_golden_regression':
      return (signals.goldenHistoryRunCount ?? 0) > 20;
    default:
      return automationBlocked(signals) && (
        stepId === 'run_ai_reconciliation' || stepId === 'run_repair'
      );
  }
}

interface StepDef {
  stepId: string;
  label: string;
  domain: PdfImportPerformanceDomain;
  base: PdfImportCostLevel;
  escalate?: (signals: PdfImportPerformanceSignals) => PdfImportCostLevel | null;
  canReuse?: (signals: PdfImportPerformanceSignals) => boolean;
  reason: (signals: PdfImportPerformanceSignals) => string;
}

const PAGE_HEAVY = 10;

const STEP_DEFS: StepDef[] = [
  {
    stepId: 'load_snapshot',
    label: 'Load import snapshot',
    domain: 'artifact_fetch',
    base: 'low',
    canReuse: () => true,
    reason: () => 'Reads existing import status metadata.',
  },
  {
    stepId: 'get_artifacts',
    label: 'Fetch import artifacts',
    domain: 'artifact_fetch',
    base: 'medium',
    escalate: (s) => ((s.pageCount ?? 0) > 5 ? 'high' : null),
    canReuse: (s) => s.artifactPathCount > 0,
    reason: (s) => ((s.pageCount ?? 0) > 5
      ? 'Multi-page artifact hydration is more expensive.'
      : 'Fetches staged artifact objects.'),
  },
  {
    stepId: 'run_visual_qa',
    label: 'Run Visual QA',
    domain: 'visual_qa',
    base: 'high',
    escalate: (s) => ((s.pageCount ?? 0) > PAGE_HEAVY ? 'very_high' : null),
    canReuse: (s) => s.hasVisualQuality && (s.visualQaScore ?? 0) >= 0.9,
    reason: (s) => ((s.pageCount ?? 0) > PAGE_HEAVY
      ? 'Browser rendering/capture over many pages is very expensive.'
      : 'Browser rendering and pixel capture are expensive.'),
  },
  {
    stepId: 'run_repair',
    label: 'Run deterministic repair',
    domain: 'repair',
    base: 'medium',
    escalate: (s) => (isHighRisk(s) ? 'high' : null),
    canReuse: (s) => s.hasRepairAudit && s.repairStatus === 'completed',
    reason: (s) => (isHighRisk(s)
      ? 'High-risk imports need more repair passes.'
      : 'Deterministic repair over parsed structure.'),
  },
  {
    stepId: 'run_ai_reconciliation',
    label: 'Run AI reconciliation',
    domain: 'ai_reconciliation',
    base: 'very_high',
    canReuse: () => false,
    reason: () => 'AI reconciliation is the most expensive step and always needs confirmation.',
  },
  {
    stepId: 'run_export_parity',
    label: 'Run export parity',
    domain: 'export_parity',
    base: 'high',
    escalate: (s) => ((s.pageCount ?? 0) > PAGE_HEAVY ? 'very_high' : null),
    canReuse: (s) => s.hasExportParity && s.exportParityStatus === 'completed',
    reason: (s) => ((s.pageCount ?? 0) > PAGE_HEAVY
      ? 'Export rasterization over many pages is very expensive.'
      : 'Export rasterization and comparison are expensive.'),
  },
  {
    stepId: 'run_golden_regression',
    label: 'Run golden regression',
    domain: 'golden_regression',
    base: 'medium',
    canReuse: (s) => s.hasGoldenRegression,
    reason: () => 'Evaluates quality gates and summary from existing metadata.',
  },
  {
    stepId: 'save_golden_history',
    label: 'Save golden run history',
    domain: 'golden_regression',
    base: 'low',
    canReuse: () => false,
    reason: () => 'Appends a small history row.',
  },
  {
    stepId: 'build_import_profile',
    label: 'Build import intelligence profile',
    domain: 'metadata',
    base: 'negligible',
    canReuse: (s) => s.hasImportProfile,
    reason: () => 'Pure local metadata calculation.',
  },
  {
    stepId: 'build_repair_pattern_analysis',
    label: 'Build repair pattern analysis',
    domain: 'metadata',
    base: 'negligible',
    canReuse: (s) => s.hasRepairPatternAnalysis,
    reason: () => 'Pure local metadata calculation.',
  },
  {
    stepId: 'build_adaptive_policy',
    label: 'Build adaptive reconciliation policy',
    domain: 'metadata',
    base: 'negligible',
    canReuse: (s) => s.hasAdaptiveReconciliationPolicy,
    reason: () => 'Pure local metadata calculation.',
  },
  {
    stepId: 'build_self_healing_plan',
    label: 'Build self-healing retry plan',
    domain: 'metadata',
    base: 'negligible',
    canReuse: (s) => s.hasSelfHealingAudit,
    reason: () => 'Pure local metadata calculation.',
  },
  {
    stepId: 'dashboard_load',
    label: 'Load diagnostics dashboard',
    domain: 'ui_dashboard',
    base: 'low',
    escalate: (s) => (((s.goldenHistoryRunCount ?? 0) > 20 || (s.pageCount ?? 0) > PAGE_HEAVY) ? 'medium' : null),
    canReuse: () => false,
    reason: (s) => (((s.goldenHistoryRunCount ?? 0) > 20)
      ? 'Large history/row payloads increase dashboard hydration cost.'
      : 'Loads a bounded set of rows.'),
  },
];

export function estimatePdfImportStepCosts(
  signals: PdfImportPerformanceSignals,
): PdfImportStepCost[] {
  return STEP_DEFS.map((def) => {
    const escalated = def.escalate?.(signals) ?? null;
    const costLevel = escalated ?? def.base;
    return {
      stepId: def.stepId,
      label: def.label,
      domain: def.domain,
      costLevel,
      estimatedCostScore: getPdfImportCostLevelScore(costLevel),
      shouldRequireConfirmation: shouldRequireConfirmationForStep(def.stepId, signals),
      canReuseExistingResult: def.canReuse?.(signals) ?? false,
      reason: def.reason(signals),
    };
  });
}

export function estimateOverallCostScore(stepCosts: PdfImportStepCost[]): number {
  if (stepCosts.length === 0) return 0;
  const sum = stepCosts.reduce((acc, s) => acc + s.estimatedCostScore, 0);
  return Number((sum / stepCosts.length).toFixed(4));
}

export function estimateOverallCostLevel(stepCosts: PdfImportStepCost[]): PdfImportCostLevel {
  if (stepCosts.length === 0) return 'unknown';
  return resolvePdfImportCostLevelFromScore(estimateOverallCostScore(stepCosts));
}
