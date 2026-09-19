/**
 * Client-side re-export of the sanctions declaration contract.
 *
 * The shared module lives under `supabase/functions/_shared` so the SERVER
 * owns the vocabulary — the acknowledgement version a client agrees to must
 * be the one the server records, and two copies is how those come to differ.
 */
export {
  COMPLETENESS_ANSWERS,
  SANCTIONS_ACKNOWLEDGEMENT_VERSION,
  clientFacingScreeningStatus,
  declarationRequiresPartyDisclosure,
  describeDeclaration,
  readSanctionsDeclaration,
  type CompletenessAnswer,
  type SanctionsDeclaration,
} from "../../../supabase/functions/_shared/aml/sanctionsDeclaration.pure";
