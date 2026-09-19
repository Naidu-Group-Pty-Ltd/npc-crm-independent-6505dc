/**
 * Browser entry point for the PEP evidence contract — see
 * `supabase/functions/_shared/aml/pepEvidence.pure.ts`.
 *
 * What a determination must rest on is decided once, there: the dialog
 * renders it and `record_pep_determination` enforces it at the write
 * boundary, so what the operator is asked for and what the server accepts
 * cannot become two different standards.
 */
export {
  PEP_SOURCE_KINDS,
  PEP_SOURCE_KIND_LABEL,
  PEP_DECLARATION_KIND,
  SANCTIONS_SOURCE_TERMS,
  PEP_DEFERRAL_REASONS,
  PEP_DEFERRAL_REASON_LABEL,
  namesSanctionsRegister,
  normalisePepMethod,
  normalisePepMethods,
  independentMethods,
  assessPepEvidence,
  assessPepDeferral,
  sanctionsSignalForPep,
  type PepSourceKind,
  type PepMethod,
  type PepMethodInput,
  type PepDeferralReason,
  type SanctionsSignal,
} from '../../../supabase/functions/_shared/aml/pepEvidence.pure.ts';
