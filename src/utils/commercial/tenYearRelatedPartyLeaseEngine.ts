import { calculateInvestorYears } from './tenYearInvestorCashFlowEngine';
import type { TenYearCashFlowInputs } from './tenYearCashFlowTypes';
export function calculateRelatedPartyLeaseYears(inputs: TenYearCashFlowInputs) { return calculateInvestorYears({ ...inputs, mode: 'relatedPartyLease' }); }
