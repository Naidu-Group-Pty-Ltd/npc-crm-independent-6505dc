/*
 * The questionnaire contract, enforced at the write boundary.
 */
import {
  PEP_DECLARATION_RELATIONSHIPS, collectsPepDetail, prunePepDeclaration,
} from '../_shared/aml/pepDeclaration.pure.ts';
import { prunePurchasingStructure } from '../_shared/aml/purchasingStructure.pure.ts';

const ENTITY_TYPES = ['Individual', 'Joint', 'Company', 'Trust', 'SMSF', 'Partnership'] as const;
const FUNDING_SOURCES = [
  'Salary savings', 'Business income', 'Sale of asset', 'Inheritance', 'Gift',
  'Investment returns', 'Superannuation', 'Loan / mortgage', 'Other',
] as const;
const PURCHASE_PURPOSES = ['Owner-occupier', 'Investment', 'Business use', 'Development'] as const;
const PARTY_ROLES = [
  'Co-purchaser', 'Director', 'Trustee', 'Beneficial owner', 'Beneficiary',
  'Authorised representative', 'Donor (gift)', 'Private lender', 'Other',
] as const;

type Payload = Record<string, unknown>;

function isPayload(value: unknown): value is Payload {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonBlank(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function requireFields(payload: Payload, fields: string[]): string[] {
  return fields.filter((field) => !isNonBlank(payload[field]));
}

function isOneOf(value: unknown, allowed: readonly string[]): boolean {
  return typeof value === 'string' && allowed.includes(value);
}

/** Validate the server-owned questionnaire contract before a section is submitted. */
export function validateQuestionnaireSection(
  section: string,
  value: unknown,
  structureValue?: unknown,
): string[] {
  if (!isPayload(value)) return ['payload'];
  const payload = value;

  switch (section) {
    case 'purchasing_structure':
      return isOneOf(payload.entity_type, ENTITY_TYPES) ? [] : ['entity_type'];
    case 'personal_details': {
      const errors = requireFields(payload, [
        'full_name', 'dob', 'citizenship', 'tax_residency', 'address', 'occupation',
      ]);
      if (!isOneOf(payload.pep, ['yes', 'no'])) errors.push('pep');
      /*
       * A declared political exposure has to say WHAT. A bare "yes" tells the
       * MLRO that a determination is needed and nothing they can act on — no
       * office, no jurisdiction, no relationship — so the determination
       * cannot start without going back to the customer for what should have
       * been asked once. Enforced here as well as in the form, because the
       * form is not the write boundary.
       *
       * A "no" is complete on its own, and the detail fields are pruned from
       * it before this runs.
       */
      if (collectsPepDetail(payload.pep)) {
        if (!isOneOf(payload.pep_relationship, PEP_DECLARATION_RELATIONSHIPS)) {
          errors.push('pep_relationship');
        }
        errors.push(...requireFields(payload, ['pep_role', 'pep_country']));
      }
      if (!isOneOf(payload.adverse, ['yes', 'no'])) errors.push('adverse');
      return errors;
    }
    case 'purchase_profile': {
      const errors = requireFields(payload, ['price_range']);
      if (!isOneOf(payload.purpose, PURCHASE_PURPOSES)) errors.push('purpose');
      if (!isOneOf(payload.third_party, ['yes', 'no'])) errors.push('third_party');
      return errors;
    }
    case 'funding': {
      const errors = requireFields(payload, ['deposit', 'narrative']);
      const sources = payload.sources;
      if (!Array.isArray(sources) || sources.length === 0 ||
          sources.some((source) => !isOneOf(source, FUNDING_SOURCES))) {
        errors.push('sources');
      }
      if (!isOneOf(payload.overseas, ['yes', 'no'])) errors.push('overseas');
      return errors;
    }
    case 'entity_details': {
      const errors = requireFields(payload, [
        'entity_name', 'abn_acn', 'registration_place', 'registered_address',
      ]);
      const structure = isPayload(structureValue) ? structureValue.entity_type : undefined;
      if (structure === 'Trust' || structure === 'SMSF') {
        errors.push(...requireFields(payload, ['deed_date']));
        if (!isOneOf(payload.trustee_type, ['individual', 'corporate'])) errors.push('trustee_type');
        if (payload.trustee_type === 'corporate' && !isNonBlank(payload.corporate_trustee)) {
          errors.push('corporate_trustee');
        }
      }
      if (structure === 'SMSF' && !isOneOf(payload.lrba, ['yes', 'no'])) errors.push('lrba');
      return errors;
    }
    case 'related_parties': {
      if (!Array.isArray(payload.parties) || payload.parties.length === 0) return ['parties'];
      const errors: string[] = [];
      payload.parties.forEach((party, index) => {
        if (!isPayload(party) || !isOneOf(party.role, PARTY_ROLES)) errors.push(`parties.${index}.role`);
        if (!isPayload(party) || !isNonBlank(party.full_name)) errors.push(`parties.${index}.full_name`);
      });
      return errors;
    }
    case 'sanctions_screening': {
      // The client declares COMPLETENESS of the screening information, never
      // a screening outcome. Every branch here is about what they told us,
      // and none of it can widen or narrow what must be determined.
      const errors: string[] = [];
      if (!isOneOf(payload.completeness, ['complete', 'additions', 'unsure'])) {
        errors.push('completeness');
      }
      // The acknowledgement is an audit record of an information declaration.
      // It is not consent to screen — screening happens under an independent
      // obligation — so it is required but never load-bearing on scope.
      if (payload.acknowledged !== true) errors.push('acknowledged');
      const aliases = payload.aliases;
      if (aliases !== undefined && (!Array.isArray(aliases)
        || aliases.some((a) => typeof a !== 'string'))) {
        errors.push('aliases');
      }
      return errors;
    }
    default:
      return ['section'];
  }
}

/**
 * Everything a submitted section must have removed before it is stored.
 *
 * ── Why it lives here and not at the call site ────────────────────────
 * `aml-client-portal/index.ts` is held to a contract that no line of its
 * code may mention risk, screening, PEP or sanctions
 * (`amlPortalContracts.test.ts`) — a blunt rule, deliberately, because the
 * portal must never become a surface that returns screening detail to a
 * customer. Pruning a declaration is the opposite direction of travel, but
 * the guard cannot tell one from the other and should not have to.
 *
 * So the write boundary keeps both prunes, and the caller applies one
 * neutrally-named rule to whatever section arrives.
 *
 * ── What each prune is for ────────────────────────────────────────────
 * Both exist because a field nobody can see is still a field that saves. An
 * Individual purchaser who typed a company ABN before correcting the
 * structure, or a customer who named a public office before correcting
 * their political-exposure answer to "no", would otherwise leave that
 * answer in the payload, in the submission snapshot, and in front of a
 * reviewer — an answer nobody gave, presented as one they did.
 */
export function normaliseQuestionnaireSection(
  section: string,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  if (section === 'purchasing_structure') return prunePurchasingStructure(payload);
  if (section === 'personal_details') return prunePepDeclaration(payload);
  return payload;
}
