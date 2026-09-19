/**
 * Public surface of the stamp duty engine.
 *
 * Import from here rather than reaching into the individual modules, so the
 * internal split can change without touching callers. `src/utils/stampDutyCalculator.ts`
 * re-exports this file wholesale for the browser bundle.
 */

export type {
  AustralianState,
  BandMode,
  Concession,
  DutyBand,
  DutySchedule,
  PropertyCategory,
  PurchaseIntent,
  StampDutyBreakdown,
  StampDutyInput,
} from './types.pure.ts';

export { AUSTRALIAN_STATES } from './types.pure.ts';

export {
  DUTY_SCHEDULES,
  SCHEDULES_VERIFIED_ON,
  getSchedule,
} from './schedules.pure.ts';

export {
  calculateStampDuty,
  concessionSaving,
  estimateOtherAcquisitionCosts,
  evaluateScale,
  selectScale,
} from './engine.pure.ts';

export type { ScheduleDrift, StalenessReport, ValidationIssue } from './validate.pure.ts';

export {
  DRIFT_REVIEW_THRESHOLD_PCT,
  assessAllStaleness,
  assessStaleness,
  compareSchedules,
  financialYearOf,
  validateAllSchedules,
  validateSchedule,
} from './validate.pure.ts';
