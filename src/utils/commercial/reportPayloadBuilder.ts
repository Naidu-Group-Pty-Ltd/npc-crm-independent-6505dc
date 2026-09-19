import type { CommercialIndustrialDealProfile } from './commercialDealState';
import { buildDynamicDocumentChecklist } from './documentChecklistEngine';
import { generateGlobalWarnings } from './warningEngine';
import { buildTenYearCashFlowReportPayload } from './tenYearCashFlowReportBuilder';
import { buildScenarioReportPayload } from './scenarioReportBuilder';

export interface ReportSectionPayload {
  title: string;
  data: unknown;
  verifiedInputs: string[];
  manualEstimateInputs: string[];
  aiEstimatedInputs: string[];
  clientProfileSourceInputs: string[];
  unknownInputs: string[];
  specialistReviewItems: string[];
  manualOverrides: string[];
}

export interface CommercialIndustrialReportPayload {
  generatedAt: string;
  transactionSummary: unknown;
  borrowingOutcome: unknown;
  purchaseAbility: unknown;
  assumptions: {
    verifiedValues: string[];
    manualEstimates: string[];
    aiEstimates: string[];
    clientProfileSourceValues: string[];
    unknownAssumptions: string[];
    specialistReviewItems: string[];
    manualOverrides: string[];
  };
  sections: ReportSectionPayload[];
}

const keysByTag = (profile: CommercialIndustrialDealProfile, tag: string) =>
  Object.values(profile.assumptions).filter(a => a.confidenceTag === tag).map(a => a.fieldKey);

export function buildCommercialIndustrialReportPayload(profile: CommercialIndustrialDealProfile): CommercialIndustrialReportPayload {
  const manualOverrides = Object.keys(profile.scenarioOverrides).filter(k => Object.keys((profile.scenarioOverrides as any)[k] ?? {}).length);
  const baseMeta = {
    verifiedInputs: keysByTag(profile, 'Verified'),
    manualEstimateInputs: keysByTag(profile, 'Manual Estimate'),
    aiEstimatedInputs: keysByTag(profile, 'AI Estimate'),
    clientProfileSourceInputs: keysByTag(profile, 'Client Profile Source'),
    unknownInputs: keysByTag(profile, 'Unknown'),
    specialistReviewItems: keysByTag(profile, 'Specialist Review Required'),
    manualOverrides,
  };
  const section = (title: string, data: unknown): ReportSectionPayload => ({ title, data, ...baseMeta });
  const borrowing = profile.borrowingOutputs;
  const documentChecklist = buildDynamicDocumentChecklist(profile);
  const tenYearPayload = profile.tenYearCashFlowOutputs ? buildTenYearCashFlowReportPayload(profile.tenYearCashFlowOutputs) : null;
  const scenarioPayload = profile.clientScenarioOutputs ? buildScenarioReportPayload(profile.clientScenarioOutputs) : null;

  return {
    generatedAt: new Date().toISOString(),
    transactionSummary: {
      assetDomain: profile.dealProfile.assetCategory,
      assetSubtype: profile.dealProfile.assetSubtype,
      acquisitionPurpose: profile.dealProfile.acquisitionPurpose,
      purchasePrice: profile.propertyValuation.purchasePrice,
      propertyValueUsed: borrowing?.propertyValueUsedForLvr ?? profile.propertyValuation.estimatedMarketValue,
    },
    borrowingOutcome: borrowing ? {
      maximumRiskAdjustedLoan: borrowing.finalRiskAdjustedLoan,
      proposedLoan: borrowing.proposedLoan || null,
      bindingConstraint: borrowing.bindingConstraint,
      impliedLvr: borrowing.impliedLvr,
      creditAssessmentStatus: borrowing.creditAssessmentStatus,
      creditAssessmentStatusLabel: borrowing.creditAssessmentStatusLabel,
    } : null,
    purchaseAbility: borrowing ? {
      purchaseAbilityStatus: borrowing.purchaseAbilityStatus,
      purchaseAbilityStatusLabel: borrowing.purchaseAbilityStatusLabel,
      requiredEquity: borrowing.fundsToComplete.requiredEquity,
      availableEquity: profile.purchaserStructure.availableCashEquity,
      equitySurplusShortfall: borrowing.fundsToComplete.equitySurplusShortfall,
      postSettlementLiquidity: borrowing.fundsToComplete.postSettlementLiquidity,
      requiredNextAction: borrowing.requiredNextAction,
    } : null,
    assumptions: {
      verifiedValues: baseMeta.verifiedInputs,
      manualEstimates: baseMeta.manualEstimateInputs,
      aiEstimates: baseMeta.aiEstimatedInputs,
      clientProfileSourceValues: baseMeta.clientProfileSourceInputs,
      unknownAssumptions: baseMeta.unknownInputs,
      specialistReviewItems: baseMeta.specialistReviewItems,
      manualOverrides,
    },
    sections: [
      section('Executive Summary', { warningGroups: generateGlobalWarnings(profile), recommendedNextAction: borrowing?.requiredNextAction }),
      section('Transaction Summary', profile.dealProfile),
      section('Borrowing Outcome', borrowing),
      section('Purchase Ability', borrowing?.fundsToComplete),
      section('Income / NOI Assessment', { inputs: profile.leaseIncome, outputs: profile.noiOutputs ?? borrowing?.noi }),
      section('Cap Rate / Valuation Assessment', { valuation: profile.propertyValuation, outputs: profile.capRateOutputs, assumptionStatuses: (profile.capRateOutputs as any)?.assumptionStatuses, aiEstimateWarning: baseMeta.aiEstimatedInputs.some(k => k.includes('capRate')) ? 'AI cap-rate estimate is benchmark only — valuer confirmation required.' : undefined, valuerConfirmationRequired: baseMeta.aiEstimatedInputs.some(k => k.includes('capRate')) || (profile.capRateOutputs as any)?.benchmarkLabel }),
      section('ICR / DSCR / Debt Yield Assessment', borrowing ? { icr: borrowing.icr, dscr: borrowing.dscr, debtYield: borrowing.debtYield, assessmentRate: borrowing.assessmentRate } : null),
      section('GST Assessment', { gstInputs: profile.gstInputs, gstOutputs: profile.gstOutputs, borrowingGst: borrowing?.fundsToComplete.gst }),
      section('DCF Assessment', { inputs: profile.dcfInputs, outputs: profile.dcfOutputs }),
      section('10-Year Cash Flow Assessment', tenYearPayload),
      section('Client Portfolio Scenario Assessment', scenarioPayload),
      ...(profile.dealProfile.assetCategory === 'industrial' ? [section('Industrial Metrics', profile.industrialMetrics)] : []),
      section('Risk Summary', { warnings: borrowing?.warnings, warningGroups: borrowing?.warningGroups, riskOutputs: profile.riskOutputs }),
      section('Fix-the-Deal Summary', borrowing?.reverseCalculators),
      section('Required Documents', documentChecklist),
      section('Assumptions', profile.assumptions),
      section('AI-Estimated Fields', profile.aiEstimateMetadata),
      section('Unknown Fields', baseMeta.unknownInputs),
      section('Specialist Review Items', baseMeta.specialistReviewItems),
    ],
  };
}

export * from './assumptionRegistry';
export * from './aiEstimateEngine';
