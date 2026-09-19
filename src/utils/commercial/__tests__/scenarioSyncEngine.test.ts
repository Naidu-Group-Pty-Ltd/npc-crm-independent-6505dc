import { describe, expect, it } from 'vitest';
import { createAiEstimate } from '../aiEstimateEngine';
import { buildClientScenario } from '../scenarioModellingEngine';
import { buildScenarioReportPayload } from '../scenarioReportBuilder';
import { acceptAiEstimateForScenario, importClientProfileField, saveBackToPropertyRecord, saveScenarioToClientProfile } from '../scenarioSyncEngine';
import { testClientProfiles } from './fixtures/clientProfile';

const client = () => structuredClone(testClientProfiles[0]);
const scenario = (status: any = 'Draft') => buildClientScenario(client(), { scenarioName: 'Acquire warehouse', scenarioType: 'Acquire Industrial Asset', status, purchasePrice: 1_000_000, proposedDebt: 650_000, requiredEquity: 350_000, annualNoi: 85_000, annualDebtService: 55_000, selectedProperty: 'Warehouse A', borrowingResult: { finalRiskAdjustedLoan: 650_000, proposedLoan: 650_000, creditAssessmentStatus: 'supportable', purchaseAbilityStatus: 'supportable', requiredNextAction: 'Collect loan statements', fundsToComplete: { requiredEquity: 350_000 } } as any } as any);

describe('scenarioSyncEngine safeguards', () => {
  it('Draft scenario save does not overwrite current client profile', () => {
    const saved = saveScenarioToClientProfile(client(), scenario('Draft'));
    expect(saved.scenarios).toHaveLength(1);
    expect(saved.latestBorrowingCapacity).toBe(2_400_000);
  });

  it('Recommended scenario save does not overwrite current client profile', () => {
    const saved = saveScenarioToClientProfile(client(), scenario('Recommended'));
    expect(saved.scenarios[0].status).toBe('Recommended');
    expect(saved.latestBorrowingCapacity).toBe(2_400_000);
  });

  it('Committed scenario can update client profile after confirmation', () => {
    const s = scenario('Committed');
    const saved = saveScenarioToClientProfile(client(), s, { commitToCurrentPosition: true, confirmed: true });
    expect(saved.latestBorrowingCapacity).toBe(s.resultingPosition.borrowingCapacity);
    expect(saved.scenarios[0].auditLog.some(e => e.action === 'scenario_commit')).toBe(true);
  });

  it('Save Back to Property only updates property-specific outputs when selected', () => {
    expect(saveBackToPropertyRecord({ id: 'p1', valuation: 1 }, { valuation: 2 }, { selected: false }).valuation).toBe(1);
    const saved = saveBackToPropertyRecord({ id: 'p1', valuation: 1 }, { valuation: 2 }, { selected: true, scenarioId: 's1' }) as any;
    expect(saved.valuation).toBe(2);
    expect(saved.auditLog[0].previousValue).toBeNull();
  });

  it('Audit log records previous and new values for status changes', () => {
    const c = client();
    const draft = scenario('Draft');
    const withDraft = saveScenarioToClientProfile(c, draft);
    const recommended = saveScenarioToClientProfile(withDraft, { ...draft, status: 'Recommended' }, { status: 'Recommended' });
    const event = recommended.scenarios[0].auditLog.find(e => e.action === 'scenario_status_change');
    expect(event?.previousValue).toBe('Draft');
    expect(event?.newValue).toBe('Recommended');
  });

  it('Accepted AI estimate updates scenario state', () => {
    const estimate = createAiEstimate({ fieldKey: 'marketRent', estimatedValue: 120_000, confidence: 'medium' });
    const result = acceptAiEstimateForScenario({ marketRent: 0 }, estimate, { accepted: true, previousValue: 0, scenarioId: 's1' });
    expect(result.state.marketRent).toBe(120_000);
    expect(result.audit?.action).toBe('ai_estimate_acceptance');
    expect(result.assumption?.confidenceTag).toBe('AI Estimate');
  });

  it('Rejected AI estimate does not update scenario state', () => {
    const estimate = createAiEstimate({ fieldKey: 'marketRent', estimatedValue: 120_000 });
    expect(acceptAiEstimateForScenario({ marketRent: 0 }, estimate, { accepted: false }).state.marketRent).toBe(0);
  });

  it('Scenario report identifies assumption statuses correctly', () => {
    const s = scenario();
    s.proposedChanges.assumptions = { marketRent: { confidenceTag: 'AI Estimate' }, purchasePrice: { confidenceTag: 'Client Profile Source' } };
    const payload = buildScenarioReportPayload(s) as any;
    expect(payload.assumptionStatuses.marketRent).toBe('AI Estimate');
    expect(payload.assumptionStatuses.purchasePrice).toBe('Client Profile Source');
  });

  it('Overview tab receives scenario summary payload', () => {
    const payload = buildScenarioReportPayload(scenario()) as any;
    expect(payload.savedScenarioOutput.scenarioName).toBe('Acquire warehouse');
    expect(payload.savedScenarioOutput.totalPortfolioValueAfterScenario).toBeGreaterThan(0);
  });

  it('Verified calculator fields require confirmation before client profile import overwrite', () => {
    const result = importClientProfileField(100, 200, 'Verified');
    expect(result.requiresConfirmation).toBe(true);
    expect(importClientProfileField(100, 200, 'Verified', 'replaceCalculatorValues').tag).toBe('Client Profile Source');
  });
});
