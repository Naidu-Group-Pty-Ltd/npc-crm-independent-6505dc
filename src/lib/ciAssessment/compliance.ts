/**
 * Australian compliance classification — decision support, not a legal
 * conclusion.
 *
 * The important behaviour here is what the module *refuses* to do: it will not
 * conclude that a transaction is unregulated simply because someone labelled
 * it "commercial". Under the National Consumer Credit Protection Act the
 * predominant purpose of the credit governs, not the asset class, so a natural
 * person borrowing against residential security with a mixed purpose is
 * escalated even when every other field says "commercial".
 *
 * Every rule below is configurable data, and the output is a flag plus a
 * reason a human can act on — never an automated determination.
 */

import type { AssessmentPayload } from './types';
import { assessmentTypeDefinition } from './types';

export type ComplianceClassification =
  | 'business_purpose'
  | 'possible_consumer_credit'
  | 'mixed_purpose'
  | 'requires_specialist_review'
  | 'insufficient_information';

export interface ComplianceFlag {
  code: string;
  severity: 'info' | 'review' | 'block';
  message: string;
  /** What the user should do about it. */
  action: string;
}

export interface ComplianceResult {
  classification: ComplianceClassification;
  classificationLabel: string;
  /** True when the result must not be presented as an ordinary business-purpose assessment. */
  requiresComplianceReview: boolean;
  /** True when specialist (credit, legal or accounting) review is mandatory. */
  requiresSpecialistReview: boolean;
  flags: ComplianceFlag[];
  /** Structured answers to the classification questions, for the audit record. */
  classificationInputs: Record<string, unknown>;
}

const CLASSIFICATION_LABELS: Record<ComplianceClassification, string> = {
  business_purpose: 'Business purpose (indicative)',
  possible_consumer_credit: 'May fall within consumer credit regulation',
  mixed_purpose: 'Mixed personal and business purpose',
  requires_specialist_review: 'Requires specialist review',
  insufficient_information: 'Insufficient information to classify',
};

/** Purpose wording that suggests a personal or domestic component. */
const CONSUMER_PURPOSE_HINTS = [
  'personal', 'domestic', 'household', 'owner occupied home', 'home loan',
  'family home', 'private use', 'living expenses', 'renovate our home',
];

const BUSINESS_PURPOSE_HINTS = [
  'business', 'commercial', 'investment', 'trading', 'operating', 'warehouse',
  'premises', 'working capital', 'plant', 'equipment', 'expansion',
];

export function classifyCompliance(payload: AssessmentPayload): ComplianceResult {
  const flags: ComplianceFlag[] = [];
  const definition = assessmentTypeDefinition(payload.assessmentType);
  const ownership = payload.ownership;

  const purpose = (ownership.borrowingPurpose ?? '').toLowerCase();
  const consumerHint = CONSUMER_PURPOSE_HINTS.some((hint) => purpose.includes(hint));
  const businessHint = BUSINESS_PURPOSE_HINTS.some((hint) => purpose.includes(hint));

  const naturalPerson = ownership.naturalPersonBorrower
    || ownership.entities.some((entity) => entity.structure === 'individual' || entity.structure === 'joint_individuals');

  const residentialSecurity = ownership.residentialSecurityInvolved
    || payload.property.classification === 'mixed_use'
    || payload.portfolio.assets.some((asset) => asset.assetType === 'residential' && asset.crossCollateralised);

  const purposeDeclared = ownership.purposeIsPredominantlyBusiness;

  const classificationInputs = {
    borrowerStructures: ownership.entities.map((entity) => entity.structure),
    naturalPersonBorrower: naturalPerson,
    residentialSecurityInvolved: residentialSecurity,
    declaredPredominantlyBusiness: purposeDeclared,
    purposeText: ownership.borrowingPurpose,
    consumerPurposeHint: consumerHint,
    businessPurposeHint: businessHint,
    assessmentType: payload.assessmentType,
    propertyClassification: payload.property.classification,
  };

  // ---- Rules ---------------------------------------------------------------

  if (!ownership.entities.length) {
    flags.push({
      code: 'NO_BORROWER',
      severity: 'review',
      message: 'No borrower entity has been recorded.',
      action: 'Add the borrowing entity or entities in the Ownership step before relying on the classification.',
    });
  }

  if (purposeDeclared == null && !ownership.borrowingPurpose.trim()) {
    flags.push({
      code: 'PURPOSE_UNSTATED',
      severity: 'review',
      message: 'The predominant purpose of the credit has not been stated.',
      action: 'Record the borrowing purpose and confirm whether it is predominantly for business.',
    });
  }

  if (naturalPerson && residentialSecurity) {
    flags.push({
      code: 'NATURAL_PERSON_RESIDENTIAL',
      severity: 'review',
      message: 'A natural-person borrower is involved and residential security forms part of the transaction.',
      action: 'Confirm the predominant purpose and whether a business purpose declaration applies before treating this as unregulated.',
    });
  }

  if (consumerHint && businessHint) {
    flags.push({
      code: 'MIXED_PURPOSE_LANGUAGE',
      severity: 'review',
      message: 'The stated purpose describes both personal and business use.',
      action: 'Determine and record the predominant purpose. Where it is unclear, obtain specialist advice.',
    });
  } else if (consumerHint) {
    flags.push({
      code: 'CONSUMER_PURPOSE_LANGUAGE',
      severity: 'review',
      message: 'The stated purpose describes a personal, domestic or household use.',
      action: 'This may fall within consumer credit regulation. Do not proceed on a business-purpose basis without review.',
    });
  }

  if (purposeDeclared === false) {
    flags.push({
      code: 'DECLARED_NON_BUSINESS',
      severity: 'block',
      message: 'The purpose has been recorded as not predominantly for business.',
      action: 'Refer to a specialist. This tool does not assess regulated consumer credit.',
    });
  }

  if (payload.assessmentType === 'mixed_use') {
    flags.push({
      code: 'MIXED_USE_SECURITY',
      severity: 'review',
      message: 'Mixed-use security may include a residential component.',
      action: 'Confirm the split and whether any consumer-credit component arises.',
    });
  }

  if (definition.requiresSpecialistReview) {
    flags.push({
      code: 'TYPE_SPECIALIST',
      severity: 'review',
      message: `${definition.label} transactions are routed to specialist review by platform policy.`,
      action: 'Obtain specialist credit review before relying on the indicative result.',
    });
  }

  if (ownership.entities.some((entity) => entity.structure === 'smsf')) {
    flags.push({
      code: 'SMSF_BORROWER',
      severity: 'review',
      message: 'An SMSF borrower is involved.',
      action: 'SMSF lending requires a limited-recourse structure and specialist advice. Do not rely on this output alone.',
    });
  }

  if (ownership.entities.some((entity) => entity.residency === 'foreign' || entity.taxResidency === 'foreign')) {
    flags.push({
      code: 'FOREIGN_PARTY',
      severity: 'review',
      message: 'A foreign resident or foreign tax resident is involved.',
      action: 'Check foreign investment approval, surcharge duty and withholding obligations.',
    });
  }

  // ---- Classification ------------------------------------------------------

  let classification: ComplianceClassification;
  if (!ownership.entities.length || (purposeDeclared == null && !ownership.borrowingPurpose.trim())) {
    classification = 'insufficient_information';
  } else if (purposeDeclared === false || (consumerHint && !businessHint)) {
    classification = 'possible_consumer_credit';
  } else if (consumerHint && businessHint) {
    classification = 'mixed_purpose';
  } else if (definition.requiresSpecialistReview || ownership.entities.some((e) => e.structure === 'smsf')) {
    classification = 'requires_specialist_review';
  } else if (naturalPerson && residentialSecurity && purposeDeclared !== true) {
    classification = 'possible_consumer_credit';
  } else {
    classification = 'business_purpose';
  }

  const requiresComplianceReview = classification !== 'business_purpose';
  const requiresSpecialistReview = flags.some((flag) => flag.severity === 'block')
    || classification === 'requires_specialist_review'
    || classification === 'possible_consumer_credit';

  return {
    classification,
    classificationLabel: CLASSIFICATION_LABELS[classification],
    requiresComplianceReview,
    requiresSpecialistReview,
    flags,
    classificationInputs,
  };
}

/**
 * The disclaimer that must accompany every result surface and report.
 * Deliberately a single exported constant so it cannot drift between the
 * screen and the PDF.
 */
export const INDICATIVE_RESULT_DISCLAIMER =
  'This is an indicative assessment prepared from information supplied by the user and the assumptions '
  + 'recorded with it. It is not a credit approval, pre-approval, offer of finance, financial advice or '
  + 'legal advice, and it does not represent the policy of any particular lender. Figures are subject to '
  + 'verification of income, valuation, lease and structure documents, and to the credit policy of the '
  + 'lender ultimately approached.';
