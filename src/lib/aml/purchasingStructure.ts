/**
 * Browser entry point for the shared purchasing-structure rules — see
 * `supabase/functions/_shared/aml/purchasingStructure.pure.ts`.
 *
 * Which entity questions apply is decided once, there: the portal form renders
 * it and `save_questionnaire` enforces it at the write boundary, so the fields
 * on screen and the keys in `aml.questionnaire_responses.payload` cannot drift
 * into two different answers.
 */
export {
  PURCHASING_STRUCTURE_TYPES,
  LEGAL_ENTITY_STRUCTURES,
  ENTITY_ONLY_STRUCTURE_FIELDS,
  collectsEntityFields,
  prunePurchasingStructure,
  type PurchasingStructureType,
} from '../../../supabase/functions/_shared/aml/purchasingStructure.pure.ts';
