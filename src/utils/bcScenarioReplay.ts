import type { BorrowingCapacityInput, BorrowingCapacityResult } from './borrowingCapacityCalculations';
import type {
  AcquisitionCapacity,
  CapitalLedger,
  ScenarioDelta,
  ScenarioValidationIssue,
} from './borrowingCapacityTypes';
import type { ScenarioIncomeComponent } from './lenderShadingProfiles';

export const BC_SCENARIO_SCHEMA_VERSION = 2 as const;
export const BC_SCENARIO_ENGINE_VERSION = 'scenario-delta-engine:v2' as const;

export interface ReplayPropertySnapshot {
  id: string;
  address?: string;
  property_type?: string;
  propertyType?: string;
  current_value?: number;
  currentValue?: number;
  loan_remaining?: number;
  loanRemaining?: number;
  monthly_interest_repayment?: number;
  monthlyRepayment?: number;
  loan_repayment_amount?: number;
  loanRepaymentAmount?: number;
  net_monthly_cashflow?: number;
  netMonthlyCashflow?: number;
  interest_rate?: number;
  interestRate?: number;
}

export interface ReplayLiabilitySnapshot {
  id: string;
  type?: string;
  label?: string;
  balance?: number;
  limit?: number;
  monthlyServicing?: number;
}

export interface AcquisitionReplaySnapshot {
  enabled?: boolean;
  state?: string;
  intent?: string;
  category?: string;
  isFirstHomeBuyer?: boolean;
  isForeignBuyer?: boolean;
  lmiMode?: string;
  cashOnHand?: number;
  targetPurchasePrice?: number;
}

export interface SnapshotHashes {
  baseInputs: string;
  properties: string;
  liabilities: string;
  incomeComponents: string;
  combined: string;
}

export interface ScenarioDriftStatus {
  isStale: boolean;
  changed: Array<keyof SnapshotHashes>;
}

export interface PersistedBcScenarioV2 {
  schemaVersion: typeof BC_SCENARIO_SCHEMA_VERSION;
  engineVersion: typeof BC_SCENARIO_ENGINE_VERSION;
  baseAssessmentId: string | null;
  baseCalculatedAt: string | null;
  createdFrom: {
    snapshotHashes: SnapshotHashes;
    baseInputs: BorrowingCapacityInput;
    properties: ReplayPropertySnapshot[];
    liabilities: ReplayLiabilitySnapshot[];
    incomeComponents: ScenarioIncomeComponent[];
  };
  scenario: {
    name: string;
    deltas: ScenarioDelta[];
    adjustedInputs: BorrowingCapacityInput;
    acquisition?: AcquisitionReplaySnapshot;
    capitalAllocations?: unknown[];
  };
  resultSnapshot: BorrowingCapacityResult;
  acquisitionCapacitySnapshot?: AcquisitionCapacity | null;
  validationIssues: ScenarioValidationIssue[];
  capitalLedger?: CapitalLedger | null;
  audit: {
    createdAt: string;
    evidenceCompleteness: 'complete' | 'partial' | 'minimal';
    warningCount: number;
    errorCount: number;
  };
}

interface SnapshotHashInput {
  baseInputs: BorrowingCapacityInput;
  properties?: ReplayPropertySnapshot[];
  liabilities?: ReplayLiabilitySnapshot[];
  incomeComponents?: ScenarioIncomeComponent[];
}

interface BuildReplayAuditInput extends SnapshotHashInput {
  scenarioName: string;
  baseResult: BorrowingCapacityResult & { assessmentId?: string; calculatedAt?: string };
  scenarioDeltas: ScenarioDelta[];
  adjustedInputs: BorrowingCapacityInput;
  resultSnapshot: BorrowingCapacityResult;
  acquisition?: AcquisitionReplaySnapshot;
  acquisitionCapacity?: AcquisitionCapacity | null;
  validationIssues?: ScenarioValidationIssue[];
  capitalLedger?: CapitalLedger | null;
  capitalAllocations?: unknown[];
  createdAt?: string;
}

function normalizeNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function normalizeBaseInputs(input: BorrowingCapacityInput): BorrowingCapacityInput {
  return {
    ...input,
    grossAnnualIncome: normalizeNumber(input.grossAnnualIncome),
    shadedAnnualIncome: normalizeNumber(input.shadedAnnualIncome),
    monthlyLivingExpenses: normalizeNumber(input.monthlyLivingExpenses),
    monthlyCommitments: normalizeNumber(input.monthlyCommitments),
    interestRate: normalizeNumber(input.interestRate),
    bufferRate: normalizeNumber(input.bufferRate),
    loanTermYears: normalizeNumber(input.loanTermYears),
    totalDebtBalances: normalizeNumber(input.totalDebtBalances),
    dtiCapLimit: input.dtiCapLimit === undefined ? undefined : normalizeNumber(input.dtiCapLimit),
  };
}

function normalizeProperties(properties: ReplayPropertySnapshot[] = []): ReplayPropertySnapshot[] {
  return properties
    .map((p) => ({
      id: String(p.id),
      address: p.address || '',
      propertyType: p.propertyType || p.property_type || '',
      currentValue: normalizeNumber(p.currentValue ?? p.current_value),
      loanRemaining: normalizeNumber(p.loanRemaining ?? p.loan_remaining),
      monthlyRepayment: normalizeNumber(p.monthlyRepayment ?? p.monthly_interest_repayment),
      loanRepaymentAmount: normalizeNumber(p.loanRepaymentAmount ?? p.loan_repayment_amount),
      netMonthlyCashflow: normalizeNumber(p.netMonthlyCashflow ?? p.net_monthly_cashflow),
      interestRate: normalizeNumber(p.interestRate ?? p.interest_rate),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function normalizeLiabilities(liabilities: ReplayLiabilitySnapshot[] = []): ReplayLiabilitySnapshot[] {
  return liabilities
    .map((l) => ({
      id: String(l.id),
      type: l.type || '',
      label: l.label || '',
      balance: normalizeNumber(l.balance),
      limit: l.limit === undefined ? undefined : normalizeNumber(l.limit),
      monthlyServicing: normalizeNumber(l.monthlyServicing),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function normalizeIncomeComponents(incomeComponents: ScenarioIncomeComponent[] = []): ScenarioIncomeComponent[] {
  return incomeComponents
    .map((c) => ({
      ...c,
      id: String(c.id),
      label: c.label || '',
      grossAnnual: normalizeNumber(c.grossAnnual),
      currentShadingRate: normalizeNumber(c.currentShadingRate),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`;
}

export function stableHash(value: unknown): string {
  const text = stableStringify(value);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function buildSnapshotHashes(input: SnapshotHashInput): SnapshotHashes {
  const normalized = {
    baseInputs: normalizeBaseInputs(input.baseInputs),
    properties: normalizeProperties(input.properties),
    liabilities: normalizeLiabilities(input.liabilities),
    incomeComponents: normalizeIncomeComponents(input.incomeComponents),
  };
  const hashes = {
    baseInputs: stableHash(normalized.baseInputs),
    properties: stableHash(normalized.properties),
    liabilities: stableHash(normalized.liabilities),
    incomeComponents: stableHash(normalized.incomeComponents),
  };
  return {
    ...hashes,
    combined: stableHash(hashes),
  };
}

export function computeScenarioDrift(
  replayAudit: PersistedBcScenarioV2 | undefined,
  current: SnapshotHashInput,
): ScenarioDriftStatus {
  if (!replayAudit || replayAudit.schemaVersion !== BC_SCENARIO_SCHEMA_VERSION) {
    return { isStale: false, changed: [] };
  }
  const currentHashes = buildSnapshotHashes(current);
  const savedHashes = replayAudit.createdFrom.snapshotHashes;
  const changed = (['baseInputs', 'properties', 'liabilities', 'incomeComponents', 'combined'] as Array<keyof SnapshotHashes>)
    .filter((key) => savedHashes[key] !== currentHashes[key]);
  return { isStale: changed.length > 0, changed };
}

export function buildPersistedBcScenarioV2(input: BuildReplayAuditInput): PersistedBcScenarioV2 {
  const validationIssues = Array.isArray(input.validationIssues) ? input.validationIssues : [];
  const scenarioDeltas = Array.isArray(input.scenarioDeltas) ? input.scenarioDeltas : [];
  const warningCount = validationIssues.filter((issue) => issue.severity === 'warning').length;
  const errorCount = validationIssues.filter((issue) => issue.severity === 'error').length;
  const hasDeltas = scenarioDeltas.length > 0;
  const hasAcquisition = !!input.acquisition?.enabled;
  const evidenceCompleteness = errorCount > 0
    ? 'minimal'
    : warningCount > 0 || (!hasDeltas && !hasAcquisition)
      ? 'partial'
      : 'complete';

  return {
    schemaVersion: BC_SCENARIO_SCHEMA_VERSION,
    engineVersion: BC_SCENARIO_ENGINE_VERSION,
    baseAssessmentId: input.baseResult.assessmentId || null,
    baseCalculatedAt: input.baseResult.calculatedAt || null,
    createdFrom: {
      snapshotHashes: buildSnapshotHashes(input),
      baseInputs: normalizeBaseInputs(input.baseInputs),
      properties: normalizeProperties(input.properties),
      liabilities: normalizeLiabilities(input.liabilities),
      incomeComponents: normalizeIncomeComponents(input.incomeComponents),
    },
    scenario: {
      name: input.scenarioName,
      deltas: scenarioDeltas,
      adjustedInputs: normalizeBaseInputs(input.adjustedInputs),
      acquisition: input.acquisition,
      capitalAllocations: input.capitalAllocations,
    },
    resultSnapshot: input.resultSnapshot,
    acquisitionCapacitySnapshot: input.acquisitionCapacity ?? null,
    validationIssues,
    capitalLedger: input.capitalLedger ?? null,
    audit: {
      createdAt: input.createdAt || new Date().toISOString(),
      evidenceCompleteness,
      warningCount,
      errorCount,
    },
  };
}
