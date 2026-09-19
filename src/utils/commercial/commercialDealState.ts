import { create } from 'zustand';
import type { AiEstimateAuditEvent, AiEstimateResult } from './aiEstimateEngine';
import type { AssumptionProvenance } from './assumptionRegistry';
import type { NoiEngineInputs, NoiEngineResult } from './noiEngine';
import type { CapRateEngineResult } from './capRateEngine';
import type { IcrDscrEngineResult } from './icrDscrEngine';
import type { CommercialGstEngineInputs, CommercialGstEngineResult } from './gstEngine';
import type { DcfAssessmentInputs, DcfAssessmentResult } from './dcfAssessmentEngine';
import type { BorrowingInputs, BorrowingResult } from './borrowing/calculatorTypes';
import type { TenYearCashFlowResult } from './tenYearCashFlowTypes';
import type { ClientScenario } from './clientPortfolioTypes';

export type CalculatorTabKey = 'borrowing' | 'noi' | 'capRate' | 'icrDscr' | 'gst' | 'dcf' | 'tenYearCashFlow' | 'overview' | 'industrialMetrics';
export type CalculatorSourceMode = 'global' | 'manualOverride' | 'aiPending' | 'savedPropertyLinked' | 'scenario';

export interface CommercialIndustrialDealProfile {
  dealProfile: Partial<BorrowingInputs['dealProfile']>;
  purchaserStructure: Partial<BorrowingInputs['purchaserStructure']>;
  propertyValuation: Partial<BorrowingInputs['propertyValuation']>;
  leaseIncome: Partial<NoiEngineInputs>;
  operatingExpenses: Record<string, number>;
  noiOutputs?: Partial<NoiEngineResult>;
  capRateOutputs?: Partial<CapRateEngineResult>;
  icrDscrOutputs?: Partial<IcrDscrEngineResult> & Record<string, unknown>;
  debtInputs: Record<string, number | string | boolean | undefined>;
  lendingAssumptions: Partial<BorrowingInputs['lendingAssumptions']>;
  gstInputs: Partial<CommercialGstEngineInputs>;
  gstOutputs?: Partial<CommercialGstEngineResult>;
  acquisitionCosts: Partial<BorrowingInputs['acquisitionCosts']>;
  fundsToComplete?: Partial<BorrowingResult['fundsToComplete']>;
  borrowingOutputs?: BorrowingResult;
  industrialMetrics: Record<string, number | string | undefined>;
  reportPayload?: unknown;
  tenYearCashFlowOutputs?: TenYearCashFlowResult;
  clientScenarioOutputs?: ClientScenario;
  dcfInputs: Partial<DcfAssessmentInputs>;
  dcfOutputs?: Partial<DcfAssessmentResult>;
  riskInputs: Record<string, unknown>;
  riskOutputs: Record<string, unknown>;
  aiEstimateMetadata: Record<string, AiEstimateResult>;
  documentVerificationStatus: Record<string, 'required' | 'uploaded' | 'reviewed' | 'verified' | 'missing' | 'not applicable'>;
  scenarioOverrides: Partial<Record<CalculatorTabKey, Record<string, unknown>>>;
  assumptions: Record<string, AssumptionProvenance>;
  aiEstimateAuditLog: AiEstimateAuditEvent[];
}

const defaultProfile: CommercialIndustrialDealProfile = {
  dealProfile: {},
  purchaserStructure: {},
  propertyValuation: {},
  leaseIncome: {},
  operatingExpenses: {},
  debtInputs: {},
  lendingAssumptions: {},
  gstInputs: {},
  acquisitionCosts: {},
  industrialMetrics: {},
  dcfInputs: {},
  riskInputs: {},
  riskOutputs: {},
  aiEstimateMetadata: {},
  documentVerificationStatus: {},
  scenarioOverrides: {},
  assumptions: {},
  aiEstimateAuditLog: [],
};

interface DealStateStore {
  profile: CommercialIndustrialDealProfile;
  sourceModes: Record<CalculatorTabKey, CalculatorSourceMode>;
  updateGlobal: <K extends keyof CommercialIndustrialDealProfile>(section: K, patch: Partial<CommercialIndustrialDealProfile[K]>) => void;
  clearTenYearCashFlowOutputs: () => void;
  setSourceMode: (tab: CalculatorTabKey, mode: CalculatorSourceMode) => void;
  setScenarioOverride: (tab: CalculatorTabKey, fieldKey: string, value: unknown) => void;
  clearScenarioOverrides: (tab: CalculatorTabKey) => void;
  recordAiEstimate: (estimate: AiEstimateResult) => void;
  appendAiAudit: (event: AiEstimateAuditEvent) => void;
  acceptAiEstimateIntoGlobal: (estimate: AiEstimateResult, section: keyof CommercialIndustrialDealProfile, fieldKey?: string) => void;
  resetDealProfile: () => void;
}

export const useCommercialDealState = create<DealStateStore>((set) => ({
  profile: defaultProfile,
  sourceModes: { overview: 'global', borrowing: 'global', noi: 'global', capRate: 'global', icrDscr: 'global', gst: 'global', dcf: 'global', tenYearCashFlow: 'global', industrialMetrics: 'global' },
  updateGlobal: (section, patch) => set(state => ({ profile: { ...state.profile, [section]: { ...(state.profile[section] as object), ...(patch as object) } } })),
  clearTenYearCashFlowOutputs: () => set(state => {
    const profile = { ...state.profile };
    delete profile.tenYearCashFlowOutputs;
    return { profile };
  }),
  setSourceMode: (tab, mode) => set(state => ({ sourceModes: { ...state.sourceModes, [tab]: mode } })),
  setScenarioOverride: (tab, fieldKey, value) => set(state => ({ profile: { ...state.profile, scenarioOverrides: { ...state.profile.scenarioOverrides, [tab]: { ...(state.profile.scenarioOverrides[tab] ?? {}), [fieldKey]: value } } } })),
  clearScenarioOverrides: (tab) => set(state => ({ profile: { ...state.profile, scenarioOverrides: { ...state.profile.scenarioOverrides, [tab]: {} } } })),
  recordAiEstimate: (estimate) => set(state => ({ profile: { ...state.profile, aiEstimateMetadata: { ...state.profile.aiEstimateMetadata, [estimate.fieldKey]: estimate } } })),
  appendAiAudit: (event) => set(state => ({ profile: { ...state.profile, aiEstimateAuditLog: [...state.profile.aiEstimateAuditLog, event] } })),
  acceptAiEstimateIntoGlobal: (estimate, section, fieldKey) => set(state => {
    const targetKey = fieldKey ?? estimate.fieldKey.split('.').pop() ?? estimate.fieldKey;
    return { profile: {
      ...state.profile,
      [section]: { ...((state.profile[section] as object) ?? {}), [targetKey]: estimate.estimatedValue },
      aiEstimateMetadata: { ...state.profile.aiEstimateMetadata, [estimate.fieldKey]: { ...estimate, accepted: true } as AiEstimateResult },
      assumptions: { ...state.profile.assumptions, [estimate.fieldKey]: { fieldKey: estimate.fieldKey, label: estimate.fieldKey, confidenceTag: 'AI Estimate', source: 'ai', sourceDetail: estimate.reasoningSummary, verificationRequired: true, requiredDocuments: estimate.requiredDocuments, updatedAt: new Date().toISOString() } as unknown as AssumptionProvenance },
    } };
  }),
  resetDealProfile: () => set({ profile: defaultProfile }),
}));

export function getDefaultCommercialIndustrialDealProfile(): CommercialIndustrialDealProfile {
  return JSON.parse(JSON.stringify(defaultProfile));
}
