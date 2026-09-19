/**
 * Browser entry point for the shared political-exposure declaration rules —
 * see `supabase/functions/_shared/aml/pepDeclaration.pure.ts`.
 *
 * Which detail questions a declaration may carry is decided once, there: the
 * portal form renders it and `save_questionnaire` prunes at the write
 * boundary, so the fields on screen and the keys in
 * `aml.questionnaire_responses.payload` cannot drift into two different
 * answers — the same arrangement the purchasing structure uses, for the same
 * reason.
 */
export {
  PEP_DECLARATION_RELATIONSHIPS,
  PEP_RELATIONSHIP_LABEL,
  PEP_DETAIL_FIELDS,
  collectsPepDetail,
  prunePepDeclaration,
  readPepDeclaration,
  type PepDeclarationRelationship,
  type PepDeclarationReading,
} from '../../../supabase/functions/_shared/aml/pepDeclaration.pure.ts';
