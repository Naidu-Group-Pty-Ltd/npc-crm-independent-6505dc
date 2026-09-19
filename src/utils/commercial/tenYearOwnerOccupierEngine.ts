import { calculateInvestorYears } from './tenYearInvestorCashFlowEngine';
import type { TenYearCashFlowInputs } from './tenYearCashFlowTypes';
export function calculateOwnerOccupierYears(inputs: TenYearCashFlowInputs) { return calculateInvestorYears({ ...inputs, mode: 'ownerOccupier' }); }
