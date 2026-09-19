/**
 * Industrial DCF — re-exports the commercial DCF engine. Industrial cash
 * flows model the same way (NOI grown, capex schedule, terminal cap, debt).
 * Differences (per-sqm rents, net leases) are captured in NOI inputs.
 */
export {
  runDcf as runIndustrialDcf,
  type DcfInputs as IndustrialDcfInputs,
  type DcfResult as IndustrialDcfResult,
  type DcfYearRow as IndustrialDcfYearRow,
} from '../commercial/dcfEngine';
