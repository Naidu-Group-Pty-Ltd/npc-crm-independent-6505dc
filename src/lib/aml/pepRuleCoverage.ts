/**
 * Browser entry point for coverage against the AML/CTF Rules — see
 * `supabase/functions/_shared/aml/pepRuleCoverage.pure.ts`.
 *
 * The classification, the floors and the prose are decided once, there, and
 * rendered from here. The loader measures with the same module, so what an
 * operator reads is what the load actually reached.
 */
export {
  classifyOffice,
  describeRuleCoverage,
  summariseRuleCoverage,
  type PepRuleCategory,
  type PepRuleCoverage,
  type PepRuleCoverageSummary,
} from '../../../supabase/functions/_shared/aml/pepRuleCoverage.pure.ts';
