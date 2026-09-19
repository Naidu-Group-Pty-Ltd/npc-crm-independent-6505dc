/**
 * Solicitor Portal Phase 7 — matter intelligence client helpers.
 *
 * Typed wrapper over the `solicitor-portal-intelligence` edge function so the
 * pipeline board, KPI panels and contract analyser never hand-roll transport.
 */
import { invokeSolicitorFunction } from '@/lib/solicitorPortal';
import type { LegalMatter, LegalMatterStatus } from '@/lib/legalMatters';

export type ContractAnalysisStatus = 'draft' | 'confirmed' | 'dismissed';

export interface ContractParty { role?: string; name?: string; detail?: string }
export interface ContractKeyDate { label?: string; date?: string; basis?: string }
export interface ContractSpecialCondition {
  reference?: string;
  title?: string;
  summary?: string;
  obligation_on?: string;
  deadline?: string;
}
export interface ContractRiskFlag {
  severity?: string;
  title?: string;
  detail?: string;
  recommended_action?: string;
}

export interface ContractAnalysis {
  id: string;
  legal_matter_id: string;
  firm_id: string | null;
  document_id: string | null;
  source_label: string | null;
  status: ContractAnalysisStatus;
  model: string | null;
  summary: string | null;
  parties: ContractParty[];
  key_dates: ContractKeyDate[];
  special_conditions: ContractSpecialCondition[];
  risk_flags: ContractRiskFlag[];
  financials: Record<string, string | undefined>;
  confidence: number | null;
  created_by_type: string;
  created_by_solicitor_user_id: string | null;
  confirmed_at: string | null;
  confirmed_by_type: string | null;
  review_notes: string | null;
  created_at: string;
  updated_at: string;
  governance?: { id:string; status:string; review_status:string; provider:string; model:string; request_correlation_id:string; input_hash:string; output_hash:string|null; input_tokens:number|null; output_tokens:number|null; cost_usd:number|null; ai_prompt_versions?:{version:number;jurisdiction:string}; ai_analysis_sources?:Array<{document_version_id:string;source_sha256:string}> } | null;
}

export type MatterRiskLevel = 'critical' | 'high' | 'medium' | 'ok';

export interface MatterRiskSignal {
  code: string;
  severity: 'critical' | 'high' | 'medium';
  label: string;
  detail: string;
}

export interface MatterRiskAssessment {
  matter_id: string;
  score: number;
  level: MatterRiskLevel;
  signals: MatterRiskSignal[];
  days_in_stage: number | null;
}

export interface AtRiskRecord extends MatterRiskAssessment {
  matter: LegalMatter | null;
}

export interface PortfolioKpis {
  total: number;
  active: number;
  closed: number;
  by_status: Record<string, number>;
  settling_7d: number;
  settling_30d: number;
  settled_90d: number;
  overdue_settlements: number;
  at_risk: number;
  critical: number;
  stalled: number;
  avg_days_to_settle: number | null;
  avg_days_in_stage: number | null;
  total_pipeline_value: number;
  settlements_by_month: Array<{ month: string; count: number; value: number }>;
}

export interface PipelineLane {
  stage: LegalMatterStatus;
  matter_ids: string[];
  count: number;
  value: number;
}

export const PIPELINE_STAGES: LegalMatterStatus[] = [
  'instructed', 'contract_review', 'exchanged', 'cooling_off', 'conditions',
  'unconditional', 'pre_settlement', 'settled', 'post_settlement', 'on_hold', 'terminated',
];

export const RISK_LEVEL_CLASSES: Record<MatterRiskLevel, string> = {
  critical: 'border-destructive/40 bg-destructive/10 text-destructive',
  high: 'border-warning/40 bg-warning/10 text-warning',
  medium: 'border-border bg-muted/40 text-muted-foreground',
  ok: 'border-success/30 bg-success/10 text-success',
};

export const RISK_LEVEL_LABELS: Record<MatterRiskLevel, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Watch',
  ok: 'On track',
};

export const ANALYSIS_STATUS_LABELS: Record<ContractAnalysisStatus, string> = {
  draft: 'Awaiting review',
  confirmed: 'Confirmed',
  dismissed: 'Dismissed',
};

async function call<T>(body: Record<string, unknown>) {
  return invokeSolicitorFunction<T>('solicitor-portal-intelligence', body);
}

export function fetchPipelineBoard(mineOnly = false) {
  return call<{
    lanes: PipelineLane[];
    matters: LegalMatter[];
    risk: MatterRiskAssessment[];
  }>({ operation: 'pipeline_board', mine_only: mineOnly });
}

export function moveMatter(matterId: string, status: LegalMatterStatus, position: number) {
  return call<{ record: LegalMatter }>({
    operation: 'move_matter', matter_id: matterId, status, position,
  });
}

export function fetchPortfolioKpis(mineOnly = false) {
  return call<{ kpis: PortfolioKpis; risk: MatterRiskAssessment[] }>({
    operation: 'portfolio_kpis', mine_only: mineOnly,
  });
}

export function fetchAtRiskMatters(limit = 12, mineOnly = false) {
  return call<{ records: AtRiskRecord[] }>({
    operation: 'at_risk_matters', limit, mine_only: mineOnly,
  });
}

export function listContractAnalyses(matterId: string) {
  return call<{ records: ContractAnalysis[] }>({ operation: 'list_analyses', matter_id: matterId });
}

export function getAiPolicyStatus() {
  return call<{policy:{configured:boolean;enabled:boolean;available:boolean;consent_version?:string;provider?:string;allowed_models?:string[];max_cost_usd?:number;redaction_profile?:string}}>({ operation:'get_ai_policy_status' });
}

export function analyseContract(input: {
  matterId: string;
  contractText?: string;
  documentId?: string | null;
  sourceLabel?: string | null;
}) {
  return call<{ record: ContractAnalysis }>({
    operation: 'analyse_contract',
    matter_id: input.matterId,
    contract_text: input.contractText ?? null,
    document_id: input.documentId ?? null,
    source_label: input.sourceLabel ?? null,
  });
}

export function setAnalysisStatus(analysisId: string, status: ContractAnalysisStatus, reviewNotes?: string) {
  return call<{ record: ContractAnalysis }>({
    operation: 'set_analysis_status', analysis_id: analysisId, status, review_notes: reviewNotes ?? null,
  });
}

export function deleteAnalysis(analysisId: string) {
  return call<{ success: boolean }>({ operation: 'delete_analysis', analysis_id: analysisId });
}

/** Severity → semantic badge classes for AI-extracted risk flags. */
export function riskFlagClasses(severity?: string): string {
  const key = String(severity || '').toLowerCase();
  if (key === 'high' || key === 'critical') return 'border-destructive/40 bg-destructive/10 text-destructive';
  if (key === 'medium') return 'border-warning/40 bg-warning/10 text-warning';
  return 'border-border bg-muted/40 text-muted-foreground';
}

export function formatCompactCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-AU', {
    style: 'currency', currency: 'AUD', notation: 'compact', maximumFractionDigits: 1,
  }).format(value);
}
