/**
 * The tenant a case belongs to — and the column that never existed.
 *
 * ── What went wrong ───────────────────────────────────────────────────
 * Eighteen call sites across five edge functions read the case row like
 * this:
 *
 *     const { data: caseRow } = await admin.schema('aml').from('cases')
 *       .select('id, tenant_id, subject_display_name').eq('id', caseId).maybeSingle();
 *     if (!caseRow) return jsonResponse({ error: 'Case not found' }, 404);
 *
 * `aml.cases` has no `tenant_id` column. It has thirty-seven columns and has
 * never had that one. So PostgREST answers
 *
 *     42703  column "tenant_id" does not exist
 *
 * the destructure discards `error`, `data` is null, and the handler reports
 * **"Case not found"** about a case the operator is looking at.
 *
 * Twelve of those eighteen fail exactly that way. Among them: every
 * ongoing-CDD operation in `aml-monitoring`, and `record_pep_determination`
 * — which is why `aml.pep_determinations` has been empty since the day it
 * was created, and why Stage 5's "Record PEP determination" appeared to do
 * nothing whatever.
 *
 * ── The two rules this module exists to keep ──────────────────────────
 * **Never name a column the table does not have.** Obvious in hindsight and
 * invisible in practice: the select is valid TypeScript, the failure is a
 * string returned by a server, and the discarded `error` turned it into a
 * plausible business outcome. It is the same shape as the `sync_id` defect
 * in the sanctions loader and the `.or()` claim predicate in the screening
 * consumer — a query that cannot run, reported as a fact about the data.
 *
 * **A read that FAILED is not a row that is ABSENT.** They need different
 * answers: a missing case is 404 and final, a failed read is 503 and worth
 * retrying. Collapsing them is how an operator gets told a case does not
 * exist while looking straight at it.
 */

/**
 * The tenant every AML row in this deployment carries.
 *
 * Verified against production: every `tenant_id` in the `aml` schema — role
 * assignments, screening scopes, party subjects, perimeters — is `default`.
 * The tenant is a property of the DEPLOYMENT rather than of the case, which
 * is precisely why `aml.cases` has no such column.
 *
 * If a per-case tenant is ever introduced it belongs here and nowhere else,
 * so that one edit reaches every writer instead of eighteen.
 */
export const DEFAULT_AML_TENANT = "default";

/** The tenant to stamp on rows written for this case. */
export function tenantForCase(_caseId: string): string {
  return DEFAULT_AML_TENANT;
}

export interface CaseRead<T> {
  /** The row, when one was read. Null when absent OR when the read failed. */
  row: T | null;
  /** Whether the READ failed, as distinct from the case being absent. */
  failed: boolean;
  /** The database's own message, for the log — never for the client. */
  error: string | null;
  tenantId: string;
}

/*
 * `any`, deliberately and in keeping with every other helper here. The
 * Supabase client's generic type is `SupabaseClient<any, "public", any>`
 * whatever schema you then select, so a structural type for it either
 * rejects the real client or re-states its generics badly enough to trip
 * TS2589 ("type instantiation is excessively deep"). The thing worth
 * type-checking is the COLUMN LIST, and that is checked at runtime below.
 */
// deno-lint-ignore no-explicit-any
type MaybeClient = any;

/**
 * Read a case by id, with the tenant resolved separately.
 *
 * `columns` must name only columns `aml.cases` actually has. It deliberately
 * REFUSES `tenant_id`: passing it throws here, where a developer sees it,
 * rather than producing a 42703 at the server and a "Case not found" at the
 * operator.
 */
export async function readCase<T = Record<string, unknown>>(
  admin: MaybeClient,
  caseId: string,
  columns: string,
): Promise<CaseRead<T>> {
  if (/\btenant_id\b/.test(columns)) {
    throw new Error(
      "aml.cases has no tenant_id column — use tenantForCase(caseId) instead. "
      + "Selecting it answers 42703, which reads as 'Case not found'.",
    );
  }
  const { data, error } = await admin.schema("aml").from("cases")
    .select(columns).eq("id", caseId).maybeSingle();
  if (error) {
    return {
      row: null,
      failed: true,
      tenantId: tenantForCase(caseId),
      error: String((error as { message?: string })?.message ?? error),
    };
  }
  return {
    row: (data ?? null) as T | null,
    failed: false,
    error: null,
    tenantId: tenantForCase(caseId),
  };
}
