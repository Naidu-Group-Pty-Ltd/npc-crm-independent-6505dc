import type { WarningGroups } from './calculatorTypes';

const empty = (): WarningGroups => ({ financial: [], data: [], asset: [], structure: [], lender: [], gstDuty: [], specialistReview: [] });

export function groupWarnings(warnings: string[]): WarningGroups {
  const groups = empty();
  for (const warning of warnings) {
    const w = warning.toLowerCase();
    if (w.includes('specialist') || w.includes('critical') || w.includes('indicative')) groups.specialistReview.push(warning);
    else if (w.includes('gst') || w.includes('duty') || w.includes('settlement') || w.includes('state charges') || w.includes('landholder')) groups.gstDuty.push(warning);
    else if (w.includes('trust') || w.includes('smsf') || w.includes('guarantee') || w.includes('structure') || w.includes('borrower')) groups.structure.push(warning);
    else if (w.includes('lease') || w.includes('environmental') || w.includes('asbestos') || w.includes('roof') || w.includes('slab') || w.includes('zoning') || w.includes('truck') || w.includes('capex')) groups.asset.push(warning);
    else if (w.includes('lender') || w.includes('lvr') || w.includes('icr') || w.includes('dscr') || w.includes('covenant') || w.includes('assessment')) groups.lender.push(warning);
    else if (w.includes('unknown') || w.includes('missing') || w.includes('verified') || w.includes('incomplete')) groups.data.push(warning);
    else groups.financial.push(warning);
  }
  return groups;
}
