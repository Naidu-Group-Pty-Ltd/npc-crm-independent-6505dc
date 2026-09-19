import type { AiEstimateResult } from './aiEstimateEngine';
import type { AssumptionProvenance } from './assumptionRegistry';
import { summarizeClientPortfolio } from './clientPortfolioEngine';
import type { ClientProfile, ClientScenario, ClientScenarioAuditEvent, ScenarioStatus } from './clientPortfolioTypes';

export type SyncConflictResolution = 'replaceCalculatorValues' | 'keepCalculatorValues' | 'createScenarioOverride';
export type ScenarioAuditAction = 'client_profile_update' | 'scenario_update' | 'property_record_update' | 'ai_estimate_acceptance' | 'scenario_commit' | 'scenario_status_change';

export interface FieldPatch { field: string; previousValue: unknown; newValue: unknown; source: string; }
export interface ScenarioSaveOptions { status?: ScenarioStatus; commitToCurrentPosition?: boolean; confirmed?: boolean; actor?: string; source?: string; }
export interface PropertySaveOptions { selected?: boolean; actor?: string; source?: string; scenarioId?: string; }

const now = () => new Date().toISOString();
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

export function createScenarioAuditEvent(action: ScenarioAuditAction | string, patch: Partial<FieldPatch> & { user?: string; scenarioId?: string }): ClientScenarioAuditEvent {
  return { timestamp: now(), user: patch.user ?? 'Calculator user', action, field: patch.field, previousValue: patch.previousValue, newValue: patch.newValue, source: patch.source ?? 'Commercial / Industrial calculator', scenarioId: patch.scenarioId };
}

export function saveScenarioToClientProfile(client: ClientProfile, scenario: ClientScenario, options: ScenarioSaveOptions = {}): ClientProfile {
  const status = options.status ?? scenario.status;
  const scenarioToSave: ClientScenario = { ...clone(scenario), status, auditLog: [...(scenario.auditLog ?? [])] };
  const existing = client.scenarios.find(s => s.scenarioId === scenario.scenarioId);
  if (existing?.status !== status) scenarioToSave.auditLog.push(createScenarioAuditEvent('scenario_status_change', { field: 'status', previousValue: existing?.status, newValue: status, source: options.source, user: options.actor, scenarioId: scenario.scenarioId }));
  scenarioToSave.auditLog.push(createScenarioAuditEvent('scenario_update', { field: 'scenarios', previousValue: existing ? existing.scenarioName : undefined, newValue: scenario.scenarioName, source: options.source, user: options.actor, scenarioId: scenario.scenarioId }));
  const scenarios = existing ? client.scenarios.map(s => s.scenarioId === scenario.scenarioId ? scenarioToSave : s) : [...client.scenarios, scenarioToSave];
  const next: ClientProfile = { ...clone(client), scenarios, lastUpdated: now() };
  if (status !== 'Committed') return next;
  if (!options.commitToCurrentPosition || !options.confirmed) return next;
  return commitScenarioToClientProfile(next, scenarioToSave, options.actor, options.source);
}

export function commitScenarioToClientProfile(client: ClientProfile, scenario: ClientScenario, actor = 'Calculator user', source = 'Committed scenario'): ClientProfile {
  const previous = summarizeClientPortfolio(client);
  const committed = client.scenarios.map(s => s.scenarioId === scenario.scenarioId ? { ...s, status: 'Committed' as const, auditLog: [...s.auditLog, createScenarioAuditEvent('scenario_commit', { field: 'currentPosition', previousValue: previous, newValue: scenario.resultingPosition, source, user: actor, scenarioId: scenario.scenarioId })] } : s);
  return { ...clone(client), scenarios: committed, latestBorrowingCapacity: scenario.resultingPosition.borrowingCapacity, lastUpdated: now() };
}

export function buildClientScenarioOutputSummary(scenario: ClientScenario) {
  const o = scenario.calculatorOutputs as any;
  const p = scenario.proposedChanges as any;
  const current = scenario.currentPositionSnapshot;
  const result = scenario.resultingPosition;
  return {
    scenarioName: scenario.scenarioName, scenarioType: scenario.scenarioType, selectedProperty: p.selectedProperty,
    purchasePrice: p.purchasePrice, requiredEquity: p.requiredEquity ?? o?.fundsToComplete?.requiredEquity,
    availableEquity: current.availableLiquidity, equityShortfallSurplus: (current.availableLiquidity ?? 0) - (p.requiredEquity ?? o?.fundsToComplete?.requiredEquity ?? 0),
    finalRiskAdjustedLoan: o?.finalRiskAdjustedLoan, proposedLoan: p.proposedDebt ?? o?.proposedLoan,
    creditAssessmentStatus: o?.creditAssessmentStatus, purchaseAbilityStatus: o?.purchaseAbilityStatus,
    totalPortfolioValueAfterScenario: result.totalAssetValue, totalPortfolioDebtAfterScenario: result.totalDebt,
    weightedLvrAfterScenario: result.weightedLvr, portfolioIcrAfterScenario: result.portfolioIcr, portfolioDscrAfterScenario: result.portfolioDscr,
    annualCashflowMovement: result.preTaxCashflow - current.preTaxCashflow, postSettlementLiquidity: result.postSettlementLiquidity,
    keyWarnings: scenario.warnings, requiredDocuments: scenario.requiredDocuments, recommendedNextAction: o?.requiredNextAction ?? result.keyConstraint,
    reportSummary: scenario.reportSummary,
  };
}

export function importClientProfileField(currentValue: unknown, profileValue: unknown, currentTag: string | undefined, resolution?: SyncConflictResolution) {
  const protectedCurrent = currentTag === 'Verified' || currentTag === 'Manual Estimate' || currentTag === 'Overridden';
  if (protectedCurrent && currentValue !== profileValue && !resolution) return { requiresConfirmation: true, value: currentValue, tag: currentTag };
  if (resolution === 'keepCalculatorValues') return { requiresConfirmation: false, value: currentValue, tag: currentTag };
  if (resolution === 'createScenarioOverride') return { requiresConfirmation: false, value: currentValue, tag: 'Overridden', overrideValue: profileValue };
  return { requiresConfirmation: false, value: profileValue, tag: 'Client Profile Source' };
}

export function saveBackToPropertyRecord<T extends Record<string, unknown>>(property: T, outputs: Record<string, unknown>, options: PropertySaveOptions = {}): T {
  if (!options.selected) return property;
  return { ...property, ...outputs, auditLog: [...((property as any).auditLog ?? []), createScenarioAuditEvent('property_record_update', { field: 'propertyOutputs', previousValue: null, newValue: outputs, source: options.source ?? 'Save Back to Property', user: options.actor, scenarioId: options.scenarioId })] } as T;
}

export function acceptAiEstimateForScenario<T extends Record<string, unknown>>(scenarioState: T, estimate: AiEstimateResult, options: { accepted: boolean; previousValue?: unknown; actor?: string; scenarioId?: string; targetField?: string; existingTag?: string; confirmedOverwrite?: boolean } ) {
  const targetField = options.targetField ?? estimate.fieldKey;
  if (!options.accepted) return { state: scenarioState, audit: null, assumption: null };
  if (options.existingTag === 'Client Profile Source' && !options.confirmedOverwrite) return { state: scenarioState, audit: null, assumption: null, requiresConfirmation: true };
  const state = { ...scenarioState, [targetField]: estimate.estimatedValue };
  const audit = createScenarioAuditEvent('ai_estimate_acceptance', { field: targetField, previousValue: options.previousValue, newValue: { value: estimate.estimatedValue, confidence: estimate.confidence, reasoningSummary: estimate.reasoningSummary, verificationStatus: 'AI Estimate' }, source: estimate.sourceBasis.join('; '), user: options.actor, scenarioId: options.scenarioId });
  const assumption: AssumptionProvenance = { fieldKey: targetField, label: targetField, confidenceTag: 'AI Estimate', sourceBasis: estimate.sourceBasis, notes: estimate.reasoningSummary, verificationRequired: true, requiredDocuments: estimate.requiredDocuments };
  return { state, audit, assumption, requiresConfirmation: false };
}
