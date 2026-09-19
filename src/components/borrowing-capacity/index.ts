export { BorrowingCapacityCard } from './BorrowingCapacityCard';
export { BorrowingCapacityModal } from './BorrowingCapacityModal';
export { ResultsPanel } from './ResultsPanel';
export { ScenarioModeling } from './ScenarioModeling';
export { StrategyScenarioModeling } from './scenarios/StrategyScenarioModeling';
export type { ScenarioPreset } from './scenarios/StrategyScenarioModeling';
export { CapacityHistoryChart } from './CapacityHistoryChart';
export { BankRateSelector } from './BankRateSelector';
export { BankRateComparisonModal } from './BankRateComparisonModal';
export { IncomeSection } from './sections/IncomeSection';
export { ExpensesSection } from './sections/ExpensesSection';
export { LiabilitiesSection } from './sections/LiabilitiesSection';
export { ProposedLoanSection } from './sections/ProposedLoanSection';
export { generateBorrowingCapacityPDF, fetchAndGenerateBorrowingCapacityPDF } from './BorrowingCapacityPDFReport';
export type { ThreeOutputAssessment, CurrentCapacityResult, ProposedLoanCheckResult, ScenarioCapacityResult, ScenarioDelta } from '@/utils/borrowingCapacityTypes';
// Phase 4: Scenario Delta Engine
export { runScenario, runMultipleScenarios, createPayOffAllDebtScenario, createSellPropertyScenario, createRefinanceToIOScenario, createRateChangeScenario, createIncomeChangeScenario, createMaximumStrategyScenario } from '@/utils/scenarioDeltaEngine';
export type { ScenarioContext, ScenarioProperty, ScenarioLiability } from '@/utils/scenarioDeltaEngine';
// Phase 5: Audit & Explanation Engine
export { AuditTrailPanel } from './AuditTrailPanel';
export type { AuditTrail, AuditEntry, AuditSummary } from '@/utils/auditEngine';
export type { ExplanationReport, ExplanationStep } from '@/utils/explanationEngine';
