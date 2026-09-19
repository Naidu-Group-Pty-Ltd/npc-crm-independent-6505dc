/**
 * The client-request contract — ONE definition of what the Command Centre may
 * ask a client to do, and where that request lands in the Client Portal.
 *
 * ## Why this module exists
 *
 * The action vocabulary was written out three times: in `aml-cases`
 * (`create_client_request`), in `aml-client-portal` (the projection), and in
 * `src/lib/aml/portalRequestRoute.ts` (the button copy and destination step).
 * Three copies of a closed vocabulary is three chances for a code to be
 * accepted by the writer and unrecognised by the reader — and the symptom of
 * that is not an error, it is a client who receives a request with no button.
 *
 * ## The routing defect this fixes
 *
 * `action_target` carries where the request should open. The Client Portal
 * routes questionnaire amendments by `section_code` — `PortalAml` matches it
 * against the server-driven step list — and the *submission review* path
 * writes one. But the generic `create_client_request` sanitised the target
 * down to `{ target_step, requirement_id }` and dropped `section_code` on the
 * floor. So a questionnaire request created from anywhere except Submission
 * Review reached the client with nowhere to go and fell back to the generic
 * respond box.
 *
 * The mirror-image defect sat in the path that *did* keep it:
 * `String(body.section_code)` accepted any string at all. A routing value that
 * is not validated is a routing value an attacker chooses.
 *
 * ## The rules
 *
 *  - **Closed vocabularies only.** An unrecognised action code, target step or
 *    section code becomes `null`. Nothing is stored that the reader cannot
 *    resolve, and nothing is echoed back that was not recognised.
 *  - **No URLs, ever.** `action_target` is a set of named fields, never a
 *    location. `sanitiseActionTarget` cannot emit one: it only copies values
 *    that appear in a whitelist, and `requirement_id` is shape-checked.
 *  - **A dropped field is better than a trusted one.** Where a value fails
 *    validation the request is still created, minus the routing hint, and the
 *    portal falls back to the route that always works.
 *
 * Pure and dependency-free so both edge functions and the browser can hold the
 * same copy. No `@/` alias, explicit `.ts` on imports — this must parse under
 * Deno.
 */

/* ── action codes ────────────────────────────────────────────────────────
   Mirrored by the CHECK constraint in 20260831000100. Adding a code here
   without adding it there stores nothing; adding it there without adding it
   here routes nothing. */

export const CLIENT_ACTION_CODES = [
  'complete_identity_verification',
  'upload_document',
  'update_questionnaire_section',
  'review_consent',
  'provide_clarification',
  'review_and_submit',
] as const;

export type ClientActionCode = (typeof CLIENT_ACTION_CODES)[number];

export function isClientActionCode(v: unknown): v is ClientActionCode {
  return typeof v === 'string' && (CLIENT_ACTION_CODES as readonly string[]).includes(v);
}

/* ── questionnaire sections ──────────────────────────────────────────────
   The applicable set for a case is computed from its purchasing structure and
   funding sources, so which of these a given client sees varies. What does NOT
   vary is that a section code outside this list is not a section — it is
   somebody's guess, and routing on it would be routing on an unvalidated
   string.

   This is the same list `aml-client-portal` computes its active sections from;
   that function may return a SUBSET, never a value absent here. */

export const QUESTIONNAIRE_SECTION_CODES = [
  'purchasing_structure',
  'personal_details',
  'entity_details',
  'related_parties',
  'purchase_profile',
  'funding',
  // Australian Sanctions & Compliance Screening. The client does not declare
  // whether they are sanctioned — that is a determination we make. This
  // section declares whether the information we screen ON is COMPLETE.
  'sanctions_screening',
] as const;

export type QuestionnaireSectionCode = (typeof QUESTIONNAIRE_SECTION_CODES)[number];

export function isQuestionnaireSectionCode(v: unknown): v is QuestionnaireSectionCode {
  return typeof v === 'string' && (QUESTIONNAIRE_SECTION_CODES as readonly string[]).includes(v);
}

/* ── target steps ────────────────────────────────────────────────────────
   `target_step` is what the Command Centre already resolved from provider
   readiness when it created the request; the portal treats it as
   authoritative and downgrades an electronic target when the provider is
   unavailable. */

export const TARGET_STEPS = [
  'identity_verification',
  'upload_document',
  'documents',
  'questionnaire',
  'consent',
  'review',
  'respond',
] as const;

export type TargetStep = (typeof TARGET_STEPS)[number];

export function isTargetStep(v: unknown): v is TargetStep {
  return typeof v === 'string' && (TARGET_STEPS as readonly string[]).includes(v);
}

/* ── the routing target ──────────────────────────────────────────────────── */

export interface ClientActionTarget {
  target_step: TargetStep | null;
  requirement_id: string | null;
  section_code: QuestionnaireSectionCode | null;
}

/** A requirement id is a uuid on this schema. Anything else is not one. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Reduce caller-supplied routing to the three fields the portal understands.
 *
 * Every branch is an allow-list test. There is deliberately no passthrough,
 * no spread of the input, and no string coercion of an unrecognised value:
 * a target that arrives as `{ href: "https://…" }`, `{ section_code: "../../" }`
 * or `{ target_step: "javascript:…" }` produces three nulls and the portal
 * routes the client to the step that always works.
 */
export function sanitiseActionTarget(raw: unknown): ClientActionTarget {
  const t = (raw ?? {}) as Record<string, unknown>;
  return {
    target_step: isTargetStep(t.target_step) ? t.target_step : null,
    requirement_id:
      typeof t.requirement_id === 'string' && UUID.test(t.requirement_id)
        ? t.requirement_id
        : null,
    section_code: isQuestionnaireSectionCode(t.section_code) ? t.section_code : null,
  };
}

/** Narrow a caller-supplied action code, or null. */
export function sanitiseActionCode(raw: unknown): ClientActionCode | null {
  return isClientActionCode(raw) ? raw : null;
}

/* ── presentation: what the client is asked, and where it opens ──────────
   The label is the button the CLIENT sees, so it is written in their words
   rather than in AML vocabulary. `step` is the portal step the button opens
   when the request carries no more specific target. */

export interface ClientActionPresentation {
  /** The client-facing button. Plain English, never an internal reason. */
  label: string;
  /** The Client Portal step this action opens by default. */
  step: string;
  /** What the Command Centre calls it when composing a request. */
  operatorLabel: string;
  /** The `client_requests.kind` this action belongs to. */
  kind: 'additional_info' | 'new_document' | 'clarification' | 're_consent';
}

export const CLIENT_ACTIONS: Record<ClientActionCode, ClientActionPresentation> = {
  complete_identity_verification: {
    label: 'Complete identity verification',
    step: 'verify',
    operatorLabel: 'Identity verification',
    kind: 'additional_info',
  },
  upload_document: {
    label: 'Upload requested document',
    step: 'documents',
    operatorLabel: 'Document or evidence',
    kind: 'new_document',
  },
  update_questionnaire_section: {
    label: 'Update information',
    step: 'questionnaire',
    operatorLabel: 'Questionnaire update',
    kind: 'additional_info',
  },
  review_consent: {
    label: 'Review updated consent',
    step: 'consent',
    operatorLabel: 'Consent / re-consent',
    kind: 're_consent',
  },
  provide_clarification: {
    label: 'Respond',
    step: 'respond',
    operatorLabel: 'Clarification',
    kind: 'clarification',
  },
  review_and_submit: {
    label: 'Review and submit',
    step: 'review',
    operatorLabel: 'Review and resubmission',
    kind: 'additional_info',
  },
};

/**
 * The `client_requests.kind` an action belongs to.
 *
 * Kind and action code are two different columns that must agree: the kind
 * drives the client's notification wording and the request's retention class,
 * the action code drives the button. Deriving one from the other is what stops
 * a "document" request arriving with a "review consent" button.
 */
export function kindForAction(code: ClientActionCode): ClientActionPresentation['kind'] {
  return CLIENT_ACTIONS[code].kind;
}
