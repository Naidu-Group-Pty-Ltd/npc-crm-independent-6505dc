/**
 * Which purchasing-structure questions a purchaser can actually answer.
 *
 * ## The defect this exists to make impossible
 *
 * The Purchasing structure section asks six things: the entity type, and five
 * questions only a legal entity has an answer to — entity legal name, ABN/ACN,
 * trustee/director names, beneficial owners over 25%, and the registered
 * office address. The form rendered all five unconditionally, so an
 * **Individual** purchaser was shown "Trustee / Director names" and
 * "Beneficial owners (>25% control)" with nowhere to put a sensible answer.
 *
 * Rendering was only the visible half. Anything typed against those fields was
 * autosaved into `aml.questionnaire_responses.payload`, and stayed there when
 * the client changed their mind and switched to Individual: it survived the
 * change invisibly, went out in the next draft, and was frozen into the
 * `submit_for_review` snapshot an analyst reads. A pack that says
 * `entity_type: 'Individual'` and also carries a company name and an ABN is not
 * a presentation bug — it is a purchaser record that contradicts itself, in the
 * one document the AML file is assembled from.
 *
 * ## What this module decides
 *
 * One rule, in one place: whether a declared structure collects the entity
 * questions, and what a payload looks like once the ones it cannot answer are
 * removed. The form renders it, and `save_questionnaire` applies it at the
 * write boundary — so what is on screen and what is in the row cannot disagree,
 * whichever client did the saving.
 *
 * `Joint` sits with `Individual` here, and deliberately. Two people buying in
 * their own names are not a legal entity: there is no legal name, no ABN/ACN,
 * no registered office and no >25% controller to declare. The server already
 * treats it that way — `ENTITY_STRUCTURES` in `aml-client-portal/index.ts`
 * raises the `entity_details` section for Company/Trust/SMSF/Partnership and
 * not for Joint, and co-purchasers are collected as `related_parties`. This is
 * the same set, stated once so the two cannot drift.
 *
 * Pure and dependency-free: no `@/` aliases, no imports, parses under Deno and
 * imports cleanly into a vitest suite in `src/`.
 */

/** The purchaser types the questionnaire offers, in the order it offers them. */
export const PURCHASING_STRUCTURE_TYPES = [
  'Individual', 'Joint', 'Company', 'Trust', 'SMSF', 'Partnership',
] as const;

export type PurchasingStructureType = typeof PURCHASING_STRUCTURE_TYPES[number];

/**
 * The structures that ARE a legal entity, and so have entity answers to give.
 *
 * Mirrors `ENTITY_STRUCTURES` in `aml-client-portal/index.ts` — the set that
 * decides whether the `entity_details` section is raised at all. A structure
 * that gets that section is exactly a structure whose entity questions apply.
 */
export const LEGAL_ENTITY_STRUCTURES: readonly string[] = [
  'Company', 'Trust', 'SMSF', 'Partnership',
];

/**
 * Keys in the `purchasing_structure` payload that only a legal entity answers.
 *
 * `registered_address` is on this list because it is the entity's REGISTERED
 * OFFICE, not a general purchaser address: `entity_details` collects the same
 * key under the same label and requires it of companies and trusts, while an
 * individual's own address is `personal_details.address` ("Residential
 * address"). An individual is never asked for it twice, and never asked for it
 * here.
 */
export const ENTITY_ONLY_STRUCTURE_FIELDS: readonly string[] = [
  'entity_name', 'abn_acn', 'controllers', 'beneficial_owners', 'registered_address',
];

/** Whether this declared structure is asked the entity questions at all. */
export function collectsEntityFields(entityType: unknown): boolean {
  return LEGAL_ENTITY_STRUCTURES.includes(String(entityType ?? ''));
}

/**
 * The payload with every answer the declared structure cannot give removed.
 *
 * Blank counts as "cannot give": a client who has not chosen a type yet is
 * shown none of these questions, so none of them may be stored against them
 * either. The rule is exactly "keep what the form shows", which is what stops
 * the row and the screen disagreeing.
 *
 * Returns the SAME object when there is nothing to remove. That is load-bearing
 * in the browser — the form holds this in React state, and handing back a fresh
 * object on every keystroke would re-render (and re-autosave) for no change.
 */
export function prunePurchasingStructure<T extends Record<string, unknown>>(payload: T): T {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  if (collectsEntityFields(payload.entity_type)) return payload;

  const stale = ENTITY_ONLY_STRUCTURE_FIELDS.filter((field) => field in payload);
  if (stale.length === 0) return payload;

  const next: Record<string, unknown> = { ...payload };
  for (const field of stale) delete next[field];
  return next as T;
}
